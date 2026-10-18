// The onboarding window's standalone page: a separate, larger screen (own borderless window,
// shared WebView2 profile so the flags land in the launcher's localStorage). Finish/Skip post
// `openray:onboarding-finish` to the host, which closes the window and tells the launcher.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Onboarding } from "./onboarding/Onboarding";
import {
  loadFeatureFlags,
  markOnboardingCompleted,
  saveFeatureFlags,
} from "./onboarding/features";

function postToHost(message: string): void {
  (window as unknown as { chrome?: { webview?: { postMessage: (message: string) => void } } }).chrome?.webview?.postMessage(message);
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root missing");
}

createRoot(container).render(
  <StrictMode>
    <Onboarding
      initialFlags={loadFeatureFlags()}
      onComplete={(flags) => {
        saveFeatureFlags(flags);
        markOnboardingCompleted();
        postToHost("openray:onboarding-finish");
      }}
      onSkip={() => {
        markOnboardingCompleted();
        postToHost("openray:onboarding-finish");
      }}
    />
  </StrictMode>,
);
