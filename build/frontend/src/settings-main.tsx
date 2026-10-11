import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Settings } from "./settings/Settings";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root missing");
}

createRoot(container).render(
  <StrictMode>
    <Settings />
  </StrictMode>,
);