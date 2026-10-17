// Onboarding feature flags: the eight built-in feature areas the "Anything you'd rather turn
// off?" step controls. Persisted to localStorage so the flags gate root-search sections on every
// start (see buildSections) and can be replayed from Settings → General.

export type FeatureFlagId =
  | "quicklinks"
  | "snippets"
  | "calculator"
  | "translator"
  | "fileSearch"
  | "windowManagement"
  | "notes"
  | "focus";

export type FeatureFlags = Record<FeatureFlagId, boolean>;

export const FEATURE_FLAGS_STORAGE_KEY = "raycast-mini:onboarding-features";
export const ONBOARDING_COMPLETED_STORAGE_KEY = "raycast-mini:onboarding-completed";

/** Fired on the launcher document whenever flags change (onboarding finish). */
export const FEATURE_FLAGS_CHANGED_EVENT = "raycast-mini:onboarding-features-changed";

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  quicklinks: true,
  snippets: true,
  calculator: true,
  translator: true,
  fileSearch: true,
  windowManagement: true,
  notes: true,
  focus: false,
};

export function loadFeatureFlags(): FeatureFlags {
  try {
    const stored = localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_FEATURE_FLAGS, ...(JSON.parse(stored) as Partial<FeatureFlags>) };
    }
  } catch {
    // Ignore errors
  }
  return { ...DEFAULT_FEATURE_FLAGS };
}

export function saveFeatureFlags(flags: FeatureFlags): void {
  try {
    localStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // Ignore errors
  }
  window.dispatchEvent(new CustomEvent<FeatureFlags>(FEATURE_FLAGS_CHANGED_EVENT, { detail: flags }));
}

export function isOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_COMPLETED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETED_STORAGE_KEY, "1");
  } catch {
    // Ignore errors
  }
}

/** Fired by the host (Settings → General "Replay onboarding") into the launcher document. */
export const SHOW_ONBOARDING_EVENT = "raycast-mini:show-onboarding";
