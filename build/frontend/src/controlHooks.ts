// Control-channel hooks (`window.__openrayControl`): the serializable UI state the host's
// `window.controlState` route reads and the input sink `window.controlInput` routes into.
// These are app-internal event routes — no OS-level input injection. Always installed (the
// control channel is authenticated at the transport layer); the shape is documented in
// docs/control-protocol.md.

export interface ControlItem {
  index: number;
  kind: string;
  title: string;
}

export interface ControlState {
  window: string;
  view: string;
  query: string;
  windowMode: string;
  sections: Array<{ id: string; title: string; count: number }>;
  items: ControlItem[];
  selectedIndex: number;
  selected: ControlItem | null;
  openDialog: string | null;
}

export type ControlInput =
  | { type: "text"; text: string }
  | { type: "setQuery"; query: string }
  | { type: "clear" }
  | { type: "backspace" }
  | { type: "key"; key: string }
  | { type: "action"; name: "openSettings" | "close" | "popToRoot" };

export interface ControlHooks {
  state: () => ControlState | null;
  input: (event: ControlInput) => { ok: boolean; detail?: string };
}

export function installControlHooks(hooks: ControlHooks): void {
  (window as unknown as Record<string, unknown>).__openrayControl = hooks;
}
