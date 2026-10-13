// The Notes window page entry (frontend/notes.html) — the standalone window shell Raycast loads
// through `host.raycast.showNotesWindow`. The page owns its own error surface like the launcher.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotesPage } from "./features/notes/NotesPage";
import { installHostMessageListener } from "./ipc";
// The full stylesheet: the action panel, toasts and the alert host share the launcher's classes.
import "./styles.css";

interface MiniErrors {
  errors: string[];
}
const errors: MiniErrors = { errors: [] };
(window as unknown as { __raycastMiniErrors: MiniErrors }).__raycastMiniErrors = errors;
window.addEventListener("error", (event) => {
  errors.errors.push(`error: ${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  errors.errors.push(`unhandled: ${String((event as PromiseRejectionEvent).reason)}`);
});

installHostMessageListener();

const container = document.getElementById("root");
if (!container) {
  errors.errors.push("#root missing");
  throw new Error("#root missing");
}

createRoot(container).render(
  <StrictMode>
    <NotesPage />
  </StrictMode>,
);
