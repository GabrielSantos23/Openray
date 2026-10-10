// Dev-only automation hooks (`--dev-extensions`). The drive scripts call them through the host's
// `window.eval` dispatch, which replaces fragile keyboard injection with direct function calls.
// Gated on the dev-extensions flag so a normal launch exposes nothing.

let devExtensions = false;

export function setDevExtensions(value: boolean): void {
  devExtensions = value;
}

export function isDevExtensions(): boolean {
  return devExtensions;
}

/** True when the flag came from localStorage instead of the host push. */
export function isDevExtensionsEnabled(): boolean {
  return devExtensions || localStorage.getItem("raycast-mini:dev-extensions") === "1";
}

export interface TestHooks {
  openCommand: (query: string) => { title: string } | null;
  rootSearch: (query: string) => void;
  press: (key: "enter" | "pop" | "popToRoot" | "escape") => boolean;
  submitForm?: () => boolean;
  state: () => unknown;
}

export function installTestHooks(hooks: TestHooks): void {
  const existing = (window as unknown as Record<string, unknown>).__raycastMiniTest as
    | Partial<TestHooks>
    | undefined;
  (window as unknown as Record<string, unknown>).__raycastMiniTest = { ...existing, ...hooks };
}

export function overrideTestHooks(hooks: Partial<TestHooks>): void {
  const existing = (window as unknown as Record<string, unknown>).__raycastMiniTest as
    | Partial<TestHooks>
    | undefined;
  if (!existing) return;
  (window as unknown as Record<string, unknown>).__raycastMiniTest = { ...existing, ...hooks };
}
