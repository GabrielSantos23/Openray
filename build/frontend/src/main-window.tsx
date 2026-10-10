import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MainWindow } from "./App";
import { ToastLayer } from "./Toast";

// Surface uncaught renderer errors to the host's diagnostics hook so a broken UI is visible in
// launcher.log instead of an empty window.
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

const container = document.getElementById("root");
if (!container) {
  errors.errors.push("#root missing");
  throw new Error("#root missing");
}

// The toast layer mounts once next to the app tree — like Raycast's single `InWindowToasts` in
// the window shell. Mounting it inside `MainWindow` would unmount it on every root-search ->
// command-session transition, and the unmount closes the live toast (`InWindowToasts`' cleanup).
createRoot(container).render(
  <StrictMode>
    <MainWindow />
    <ToastLayer />
  </StrictMode>,
);
