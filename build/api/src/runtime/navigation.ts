// The extension-side navigation stack — the wire contract of Raycast's `zg`
// (InternalNavigationRoot) and `Mw` (useNavigation) in `api/node_modules/@raycast/api/index.js`:
//
//   <ray-navigation-stack navigationInfo={lastNavigationInfo} onPop={pop}>{routes…}</ray-navigation-stack>
//   push: routes.push({node, onPop}); lastNavigationInfo = {action:"push", id}
//   pop:  routes.pop();  lastNavigationInfo = {action:"pop", id}
//   renderer-initiated pop: lastNavigationInfo = {action:"localPop", id:<the id from onPop>}
//
// Deliberately hook-free: the @raycast/api bundle can end up loading a different `react` instance
// than the one the reconciler drives (deployments mix api trees), and a hook would then read a
// null dispatcher. Module state + an explicit re-render of the command root produces the exact
// same model stream — `navigationInfo.action` values and the `onPop` id round trip included.

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

let state: NavigationState = { routes: [], lastNavigationInfo: { action: "new", id: "" } };
let rerender: () => void = () => undefined;
let lastPopId = "";
let active = false;

function nextId(): string {
  return `nav_${Math.random().toString(36).slice(2, 10)}`;
}

function replaceState(next: NavigationState): void {
  state = next;
  rerender();
}

function popWithId(id: string): void {
  if (state.routes.length <= 1) return;
  const routes = state.routes.slice(0, -1);
  const popped = state.routes[state.routes.length - 1];
  if (popped?.onPop && lastPopId !== id) {
    lastPopId = id;
    popped.onPop(id);
  }
  state = { routes, lastNavigationInfo: { action: "localPop", id } };
  rerender();
}

/** `InternalNavigationRoot` — a plain component rendering the stack from module state. */
export function InternalNavigationRoot({ children }: { children?: React.ReactNode }) {
  if (!active) {
    active = true;
    state = {
      routes: [{ node: children }],
      lastNavigationInfo: { action: "new", id: "" },
    };
  }
  const onPop = serializeCallback((id: string) => popWithId(id));
  return React.createElement(
    "ray-navigation-stack",
    { navigationInfo: state.lastNavigationInfo, onPopCallbackId: onPop },
    state.routes.map((route, index) => React.createElement(React.Fragment, { key: index }, route.node)),
  );
}

/** `Mw()` — the public `useNavigation()` hook shape, backed by module state. */
export function useNavigation(): Navigation {
  return {
    push: (node, onPop) => {
      replaceState({
        routes: [...state.routes, { node, onPop }],
        lastNavigationInfo: { action: "push", id: nextId() },
      });
    },
    pop: () => {
      const id = nextId();
      if (state.routes.length <= 1) return;
      const routes = state.routes.slice(0, -1);
      const popped = state.routes[state.routes.length - 1];
      if (popped?.onPop && lastPopId !== id) {
        lastPopId = id;
        popped.onPop(id);
      }
      state = { routes, lastNavigationInfo: { action: "pop", id } };
      rerender();
    },
  };
}

/** Called once per command launch: reset the stack and wire the re-render. */
export function resetNavigation(children: React.ReactNode, rerenderFn: () => void): void {
  active = true;
  lastPopId = "";
  rerender = rerenderFn;
  state = {
    routes: [{ node: children }],
    lastNavigationInfo: { action: "new", id: "" },
  };
}
