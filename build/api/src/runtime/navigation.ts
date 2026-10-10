// The extension-side navigation stack — Raycast's `zg` (InternalNavigationRoot) and `Mw`
// (useNavigation) in `api/node_modules/@raycast/api/index.js`:
//
//   function zg(e){ let[t,r]=useState({routes:[{node:e.children}],lastNavigationInfo:{action:"new",id:""}}) …
//     return jsx("ray-navigation-stack",{navigationInfo:t.lastNavigationInfo,onPop:n,
//       children:jsx(Va.Provider,{value:r,children:t.routes.map(i=>i.node)})}) }
//
// The stack lives here, in the extension. The model ships only the top route's body plus
// `navigationInfo`; the renderer keeps its own page stack and mirrors push/pop through
// `navigationInfo.action`. A renderer-initiated pop (Escape) calls this element's `onPop` callback
// through `nativeCallback`; the same pop id round-trips back in `navigationInfo` so the renderer
// can tell the resulting render apart from an extension-initiated one.

import * as React from "react";
import { serializeCallback } from "./reconciler";

export interface NavigationInfo {
  id: string | null;
  action: string;
}

interface Route {
  node: React.ReactNode;
  onPop?: (id: string) => void;
}

interface NavigationState {
  routes: Route[];
  lastNavigationInfo: NavigationInfo;
}

export interface Navigation {
  push: (node: React.ReactNode, onPop?: (id: string) => void) => void;
  pop: () => void;
}

export const NavigationContext = React.createContext<Navigation | null>(null);

function nextId(): string {
  return `nav_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * `zg(e)` — wraps the command component in the `ray-navigation-stack` host element. The `onPop`
 * prop is the renderer's way to pop; functions cannot cross the wire, so it is registered by
 * callback id (`onPopCallbackId`) and `toModel` copies it onto the stack.
 */
export function InternalNavigationRoot({ children }: { children?: React.ReactNode }) {
  const [state, setState] = React.useState<NavigationState>({
    routes: [{ node: children }],
    lastNavigationInfo: { action: "new", id: "" },
  });
  const poppedForRef = React.useRef("");

  const popWithId = React.useCallback(
    (id: string) => {
      setState((previous) => {
        if (previous.routes.length <= 1) return previous;
        const routes = previous.routes.slice(0, -1);
        const popped = previous.routes[previous.routes.length - 1];
        if (popped?.onPop && poppedForRef.current !== id) {
          poppedForRef.current = id;
          popped.onPop(id);
        }
        return { routes, lastNavigationInfo: { action: "localPop", id } };
      });
    },
    [setState],
  );

  const onPop = React.useCallback((id: string) => popWithId(id), [popWithId]);
  const onPopCallbackId = React.useMemo(() => serializeCallback(onPop), [onPop]);

  const navigation = React.useMemo<Navigation>(
    () => ({
      push: (node, onPop) => {
        setState((previous) => ({
          routes: [...previous.routes, { node, onPop }],
          lastNavigationInfo: { action: "push", id: nextId() },
        }));
      },
      pop: () => {
        const id = nextId();
        setState((previous) => {
          if (previous.routes.length <= 1) return previous;
          const routes = previous.routes.slice(0, -1);
          const popped = previous.routes[previous.routes.length - 1];
          if (popped?.onPop && poppedForRef.current !== id) {
            poppedForRef.current = id;
            popped.onPop(id);
          }
          return { routes, lastNavigationInfo: { action: "pop", id } };
        });
      },
    }),
    [setState],
  );

  return React.createElement(
    "ray-navigation-stack",
    { navigationInfo: state.lastNavigationInfo, onPopCallbackId },
    React.createElement(
      NavigationContext.Provider,
      { value: navigation },
      state.routes.map((route, index) => React.createElement(React.Fragment, { key: index }, route.node)),
    ),
  );
}

/** `Mw()` — the public `useNavigation()` hook. */
export function useNavigation(): Navigation {
  const navigation = React.useContext(NavigationContext);
  if (!navigation) {
    throw new Error("useNavigation must be used inside a command view");
  }
  return navigation;
}
