import { ipcRequest, onNotification } from "../ipc";

/** Applies the Windows system accent to the `--accent` token (host is the source of truth). */
export function applyAccentHex(hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  document.documentElement.style.setProperty("--accent", hex);
}

export function installSystemAccent(): void {
  void ipcRequest<{ color?: string }>("settings.systemAccent", {}, { module: "frontend" })
    .then((result) => {
      if (result?.color) applyAccentHex(result.color);
    })
    .catch(() => undefined);
  onNotification("settings.systemAccentChanged", (data) => {
    const color = (data as { color?: string } | null)?.color;
    if (color) applyAccentHex(color);
  });
}
