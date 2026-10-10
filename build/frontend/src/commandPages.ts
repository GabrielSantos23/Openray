// The renderer-side page stack for one running command.
//
// Raycast keeps this in `z.mainRouter.context.nodeExtensionStack` and mirrors the extension's
// renders onto it through the switch in `NQ` (NodeCommandViewContent,
// `main-window-g1Vb1JLY.js`):
//
//   case `push`: case `new`:  nodeExtensionStack.push(zq, {…w, bufferedValue: S})
//   case `pop`:               nodeExtensionStack.pop(); update(new top, w)
//   case `localPop`:          break                     // deduped to `idle` via the pop id
//   case `idle`:              update(top, w)
//
// All pages stay mounted in Raycast, which is what restores filter text and selection on pop; here
// each page *record* keeps `searchText`/`selectedItemId` and the view re-applies them, with the same
// observable behavior. The reducer is pure so the navigation contract is unit-testable.

import type { RenderTree, ViewAction, ViewBody } from "./useExtensionCommand";

export interface PageState {
  /** The `navigationInfo.id` of the render that created this page. */
  id: string;
  body: ViewBody;
  actions: ViewAction[];
  searchText: string;
  selectedItemId: string | null;
}

export interface CommandPagesState {
  pages: PageState[];
}

export function emptyPages(): CommandPagesState {
  return { pages: [] };
}

export function topPage(state: CommandPagesState): PageState | null {
  return state.pages.length > 0 ? state.pages[state.pages.length - 1] : null;
}

function pageFrom(navId: string, body: ViewBody, actions: ViewAction[]): PageState {
  return {
    id: navId,
    body,
    actions,
    searchText: "",
    selectedItemId: body.selectedItemId?.value ?? null,
  };
}

function withBody(page: PageState, body: ViewBody, actions: ViewAction[]): PageState {
  return {
    ...page,
    body,
    actions: actions.length > 0 ? actions : page.actions,
  };
}

/**
 * Apply one decoded render to the page stack. `action` is `navigationInfo.action`; the pop id
 * dedupe (`navigationInfo.id === lastPopId` rewrites a `localPop` render to an in-place update, per
 * the round trip in Raycast's `NQ`) happens in `popPage`, which records the id it generated.
 */
export function applyRender(
  previous: CommandPagesState,
  model: RenderTree,
): CommandPagesState {
  const stack = model.navigationStack;
  if (!stack || !stack.body) return previous;

  const body = stack.body;
  const actions = stack.actions ?? body.actions ?? [];
  const action = stack.navigationInfo.action;
  const navId = stack.navigationInfo.id ?? `render_${Math.random().toString(36).slice(2, 8)}`;
  const pages = [...previous.pages];

  switch (action) {
    case "push":
    case "new": {
      if (action === "new" && pages.length === 1 && pages[0].id === navId) {
        // Initial render replaying for the same root page — update in place.
        pages[0] = withBody(pages[0], body, actions);
        break;
      }
      pages.push(pageFrom(navId, body, actions));
      break;
    }
    case "pop": {
      if (pages.length > 1) pages.pop();
      const top = pages[pages.length - 1];
      if (top) pages[pages.length - 1] = withBody(top, body, actions);
      break;
    }
    case "localPop":
    case "idle":
    default: {
      const top = pages[pages.length - 1];
      if (top) pages[pages.length - 1] = withBody(top, body, actions);
      else pages.push(pageFrom(navId, body, actions));
      break;
    }
  }
  return { pages };
}

/** Per-page view state updates (filter text / selection of the current page). */
export function updateTop(
  state: CommandPagesState,
  patch: Partial<Pick<PageState, "searchText" | "selectedItemId">>,
): CommandPagesState {
  if (state.pages.length === 0) return state;
  const pages = [...state.pages];
  pages[pages.length - 1] = { ...pages[pages.length - 1], ...patch };
  return { pages };
}

/**
 * Pop one page locally (Escape / Ctrl+[). Returns the next state plus the pop id that must be sent
 * to the extension's `navigationStack.onPop` callback — the extension replies with
 * `navigationInfo {action:"localPop", id}` and `applyRender` updates the top page in place.
 */
export function popPage(
  state: CommandPagesState,
  popId: string,
): { state: CommandPagesState; popped: boolean; popId: string } {
  if (state.pages.length <= 1) return { state, popped: false, popId };
  return { state: { pages: state.pages.slice(0, -1) }, popped: true, popId };
}

/** `popToRoot` — keep only the root page. */
export function popToRootPages(state: CommandPagesState): CommandPagesState {
  if (state.pages.length <= 1) return state;
  return { pages: state.pages.slice(0, 1) };
}
