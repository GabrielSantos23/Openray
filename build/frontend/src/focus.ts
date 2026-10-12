// Focus client (docs/focus-games-taskbar-spec.md §A) — the `focus.*` backend namespace plus the
// duration grammar the start/edit form shares. The default start input and the storage cap mirror
// the shipped frontend (`raycast-focus::last-start-input`, 24 h cap).

import { useCallback, useEffect, useState } from "react";
import { ipc, onNotification } from "./ipc";

export interface FocusSessionState {
  id: string;
  title: string;
  status: "running" | "paused";
  mode: "duration" | "noLimit";
  presentation: string;
  pauseEndsAt: string | null;
  startedAt: string;
  targetEndAt: string | null;
  effectiveEndAt: string | null;
  remainingMs: number | null;
}

export interface FocusStartInput {
  title?: string;
  mode: "block" | "allow";
  categoryIds: string[];
  raycastAppIds: string[];
  websiteHosts: string[];
  allowAllOnEmptyWebsiteAllowlist: boolean;
  snoozeDurationMs: number | null;
  restoreAppsWhenSessionEnds: boolean;
  goal: { mode: "duration"; durationMs: number } | { mode: "noLimit" };
}

export interface FocusPreferences {
  snoozeDurationMs: number | null;
  playSound: boolean;
  restoreAppsWhenSessionEnds: boolean;
  allowAllOnEmptyWebsiteAllowlist: boolean;
}

export interface FocusCategory {
  id: string;
  categoryId: string;
  kind: "builtin" | "custom";
  builtinId: string | null;
  title: string;
  icon: string;
  websiteHosts: string[];
  applicationIds: string[];
  createdAt: number;
  updatedAt: number;
  accessedAt: number | null;
}

export interface FocusSessionResponse {
  session: FocusSessionState | null;
  lastStartInput: FocusStartInput | null;
  preferences: FocusPreferences;
}

export const DEFAULT_START_INPUT: FocusStartInput = {
  title: "Focus session",
  mode: "block",
  categoryIds: [],
  raycastAppIds: [],
  websiteHosts: [],
  allowAllOnEmptyWebsiteAllowlist: false,
  snoozeDurationMs: 180000,
  restoreAppsWhenSessionEnds: false,
  goal: { mode: "noLimit" },
};

export const MAX_DURATION_MS = 1440 * 60 * 1000;

export function fetchSessionState(): Promise<FocusSessionResponse> {
  return ipc.backend("focus.getSession", {}, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function startFocusSession(input: FocusStartInput): Promise<FocusSessionResponse> {
  return ipc.backend("focus.startSession", input, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function updateFocusSession(input: FocusStartInput): Promise<FocusSessionResponse> {
  return ipc.backend("focus.updateSession", input, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function pauseFocusSession(durationMs: number | null): Promise<FocusSessionResponse> {
  return ipc.backend("focus.pauseSession", { durationMs }, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function resumeFocusSession(): Promise<FocusSessionResponse> {
  return ipc.backend("focus.resumeSession", {}, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function completeFocusSession(): Promise<FocusSessionResponse> {
  return ipc.backend("focus.completeSession", {}, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function cancelFocusSession(): Promise<FocusSessionResponse> {
  return ipc.backend("focus.cancelSession", {}, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function restartFocusSession(): Promise<FocusSessionResponse> {
  return ipc.backend("focus.restartSession", {}, { module: "backend" }) as Promise<FocusSessionResponse>;
}

export function searchFocusCategories(query: string): Promise<{ categories: FocusCategory[] }> {
  return ipc.backend(
    "focus.searchCategories",
    { query: query.trim() || undefined, limit: 512 },
    { module: "backend" },
  ) as Promise<{ categories: FocusCategory[] }>;
}

export function createFocusCategory(payload: {
  title: string;
  icon?: string;
  websiteHosts: string[];
  applicationIds: string[];
}): Promise<{ category: FocusCategory }> {
  return ipc.backend("focus.createCategory", payload, { module: "backend" }) as Promise<{ category: FocusCategory }>;
}

export function updateFocusCategory(payload: {
  categoryId: string;
  title: string;
  icon?: string;
  websiteHosts: string[];
  applicationIds: string[];
}): Promise<{ category: FocusCategory }> {
  return ipc.backend("focus.updateCategory", payload, { module: "backend" }) as Promise<{ category: FocusCategory }>;
}

export function deleteFocusCategory(categoryId: string): Promise<{ ok: boolean }> {
  return ipc.backend("focus.deleteCategory", { categoryId }, { module: "backend" }) as Promise<{ ok: boolean }>;
}

export function setFocusPreferences(preferences: Partial<FocusPreferences>): Promise<FocusPreferences> {
  return ipc.backend("focus.setPreferences", preferences, { module: "backend" }) as Promise<FocusPreferences>;
}

/** The confirmed duration suggestions, in order. */
export const DURATION_SUGGESTIONS: ReadonlyArray<{ label: string; text: string }> = [
  { label: "15 minutes", text: "15m" },
  { label: "30 minutes", text: "30m" },
  { label: "1 hour", text: "1h" },
  { label: "1 hour 30 minutes", text: "1h 30m" },
  { label: "Until Noon", text: "until noon" },
  { label: "Until 6 pm", text: "until 6pm" },
  { label: "Workday (8 am to 6 pm)", text: "workday" },
];

/**
 * The duration grammar: `Nm`, `Nh`, `Nh Nm`, `Nh30`, `until <time>`, `workday`; plain digits are
 * minutes. Empty text means No Limit. Clock targets in the past roll to tomorrow; the result is
 * capped at 24 h. Returns null for unparseable text.
 */
export function parseDurationText(text: string, now = new Date()): FocusStartInput["goal"] | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "") return { mode: "noLimit" };

  if (trimmed === "workday") {
    return targetEndAt(parseClockText("6 pm", now), now);
  }
  const untilMatch = trimmed.match(/^until\s+(.+)$/);
  if (untilMatch) {
    const target = parseClockText(untilMatch[1], now);
    return target ? targetEndAt(target, now) : null;
  }

  // Plain digits are minutes.
  const bareMinutes = trimmed.match(/^(\d+)$/);
  if (bareMinutes) {
    const totalMs = Number(bareMinutes[1]) * 60 * 1000;
    if (totalMs <= 0 || totalMs > MAX_DURATION_MS) return null;
    return { mode: "duration", durationMs: totalMs };
  }

  const combo = trimmed.match(/^(?:(\d+)\s*h(?:(?:(?:\s*(\d+))\s*m?)|(\d+))?)?(?:(?:^|\s+)(\d+)\s*m)?$/);
  if (combo) {
    const hours = combo[1] ? Number(combo[1]) : 0;
    const halfOpenMinutes = combo[2] ? Number(combo[2]) : 0;
    const gluedMinutes = combo[3] ? Number(combo[3]) : 0;
    const minutes = combo[4] ? Number(combo[4]) : 0;
    const totalMs = (hours * 60 + halfOpenMinutes + gluedMinutes + minutes) * 60 * 1000;
    if (totalMs <= 0 || totalMs > MAX_DURATION_MS) return null;
    return { mode: "duration", durationMs: totalMs };
  }
  return null;
}

function targetEndAt(target: Date | null, now: Date): FocusStartInput["goal"] | null {
  if (!target) return null;
  let durationMs = target.getTime() - now.getTime();
  if (durationMs <= 0) durationMs += 24 * 60 * 60 * 1000;
  if (durationMs > MAX_DURATION_MS) return null;
  return { mode: "duration", durationMs };
}

/** `noon`, `6pm`, `6 pm`, `18:00`, `9:30am` → today's date at that wall time (or tomorrow via caller). */
export function parseClockText(text: string, now = new Date()): Date | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "noon") return atWallTime(now, 12, 0);
  const meridiem = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (meridiem) {
    let hours = Number(meridiem[1]) % 12;
    if (meridiem[3] === "pm") hours += 12;
    return atWallTime(now, hours, meridiem[2] ? Number(meridiem[2]) : 0);
  }
  const clock24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (clock24) return atWallTime(now, Number(clock24[1]), Number(clock24[2]));
  return null;
}

function atWallTime(now: Date, hours: number, minutes: number): Date | null {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

/** Formats a duration the way the Duration field reads back: `1h 30m`, `15m`, `No Limit`. */
export function formatDuration(goal: FocusStartInput["goal"]): string {
  if (goal.mode === "noLimit") return "No Limit";
  const minutes = Math.round(goal.durationMs / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export interface FocusActionHandlers {
  showToast: (title: string, message?: string) => void;
  refresh: () => void;
}

/** The ephemeral command semantics (Toggle completes a running session — the confirmed flow). */
export async function runFocusAction(
  action: "toggle" | "pause" | "resume" | "complete",
  handlers: FocusActionHandlers,
  lastInput: FocusStartInput | null,
): Promise<void> {
  const { showToast } = handlers;
  try {
    const state = await fetchSessionState();
    if (action === "toggle") {
      if (state.session) {
        await completeFocusSession();
        showToast("Focus session completed");
      } else {
        await startFocusSession(mergePreferences(lastInput ?? DEFAULT_START_INPUT, state.preferences));
        showToast("Focus session started.");
      }
      handlers.refresh();
      return;
    }
    if (!state.session) {
      showToast(`Failed to ${action} focus session`, "No session is running");
      return;
    }
    if (action === "pause") {
      await pauseFocusSession(null);
      showToast("Focus session paused.");
    } else if (action === "resume") {
      await resumeFocusSession();
      showToast("Focus session running.");
    } else {
      await completeFocusSession();
      showToast("Focus session completed");
    }
    handlers.refresh();
  } catch (error) {
    showToast(`Failed to ${action} focus session`, error instanceof Error ? error.message : String(error));
  }
}

export function mergePreferences(input: FocusStartInput, preferences: FocusPreferences): FocusStartInput {
  return {
    ...input,
    allowAllOnEmptyWebsiteAllowlist: input.allowAllOnEmptyWebsiteAllowlist || preferences.allowAllOnEmptyWebsiteAllowlist,
    snoozeDurationMs: input.snoozeDurationMs ?? preferences.snoozeDurationMs,
    restoreAppsWhenSessionEnds: input.restoreAppsWhenSessionEnds || preferences.restoreAppsWhenSessionEnds,
  };
}

const LAST_INPUT_KEY = "raycast-focus::last-start-input";

export function readLastStartInput(): FocusStartInput | null {
  try {
    const raw = localStorage.getItem(LAST_INPUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FocusStartInput;
    // The shipped store caps the persisted duration at 24 h and drops stale goals.
    if (parsed.goal.mode === "duration" && (parsed.goal.durationMs <= 0 || parsed.goal.durationMs > MAX_DURATION_MS)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeLastStartInput(input: FocusStartInput): void {
  try {
    localStorage.setItem(LAST_INPUT_KEY, JSON.stringify(input));
  } catch {
    /* storage unavailable — the toggle falls back to defaults */
  }
}

/** Subscribes to `focus.sessionChanged` pushes; returns an unsubscribe function. */
export function useSessionState(): { state: FocusSessionResponse | null; refresh: () => void } {
  const [state, setState] = useState<FocusSessionResponse | null>(null);
  const refresh = useCallback(() => {
    fetchSessionState()
      .then((next) => setState(next))
      .catch(() => setState(null));
  }, []);
  useEffect(() => {
    refresh();
    return onNotification("focus.sessionChanged", (raw) => {
      const payload = raw as SessionChangedPayload;
      setState((current) => ({
        session: payload.session ?? null,
        lastStartInput: payload.lastStartInput ?? current?.lastStartInput ?? null,
        preferences: current?.preferences ?? {
          snoozeDurationMs: 180000,
          playSound: true,
          restoreAppsWhenSessionEnds: false,
          allowAllOnEmptyWebsiteAllowlist: false,
        },
      }));
    });
  }, [refresh]);
  return { state, refresh };
}

interface SessionChangedPayload {
  session: FocusSessionState | null;
  lastStartInput: FocusStartInput | null;
}
