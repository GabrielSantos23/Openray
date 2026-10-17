// Window Management: geometry + command runner (docs/window-management-spec.md).
//
// The preset geometry, gap math, clamping, cycling and display-move scaling below are transcribed
// from the shipped bundle (`main-window-g1Vb1JLY.js` command runner + the shared bounds chunk):
// every `floor`/round and every default is theirs. Coordinates are logical pixels relative to the
// work area of the rect's display (`docs/window-management-spec.md`, "Displays source" decision).

import { ipc } from "./ipc";
import { loadSettings } from "./settings/persistence";

// -----------------------------------------------------------------------------------------
// Types + host client (`windowManagement.*`, dispatched to the C# host by the backend).
// -----------------------------------------------------------------------------------------

export interface WmDisplay {
  index: number;
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
  isCurrent: boolean;
  name: string;
}

export interface WmBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WmWindow {
  id: number;
  pid: number;
  exeName: string;
  title: string;
  bounds: WmBounds;
  displayIndex: number;
  resizable: boolean;
  positionable: boolean;
  topmost: boolean;
  maximized: boolean;
  minimized: boolean;
}

/** A partial command rect — every axis left out keeps the window's current value. */
export interface WmRect {
  position?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
  /** The rect is relative to this display's work area; defaults to the window's display. */
  displayIndex?: number;
  allowOversize?: boolean;
}

export interface WmSavedState {
  fullscreen?: boolean;
  displayIndex?: number;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

export async function fetchDisplays(): Promise<WmDisplay[]> {
  const result = await ipc.backend("windowManagement.getDisplays", {});
  return (result as { displays: WmDisplay[] }).displays;
}

export async function fetchActiveWindow(): Promise<WmWindow | null> {
  // The host answers with the bare window object (or null) — there is no `{ window }` envelope.
  const result = await ipc.backend("windowManagement.getActiveWindow", {});
  return (result as WmWindow | null) ?? null;
}

async function hostSetWindowBounds(params: {
  id: number;
  displayIndex: number;
  bounds: { position?: { x?: number; y?: number }; size?: { width?: number; height?: number } };
}): Promise<{ bounds: WmBounds; displayIndex: number | null }> {
  const result = await ipc.backend("windowManagement.setWindowBounds", params);
  return result as { bounds: WmBounds; displayIndex: number | null };
}

async function hostMinimizeWindow(id: number): Promise<void> {
  await ipc.backend("windowManagement.minimizeWindow", { id });
}

export async function hostToggleAlwaysOnTop(id: number): Promise<boolean> {
  const result = await ipc.backend("windowManagement.toggleAlwaysOnTop", { id });
  return (result as { topmost: boolean }).topmost;
}

async function hostEnumerateVisibleWindows(): Promise<Array<WmWindow & { zIndex: number }>> {
  const result = await ipc.backend("windowManagement.enumerateVisibleWindows", {});
  return (result as { windows: Array<WmWindow & { zIndex: number }> }).windows;
}

async function hostCycleAppWindows(direction: "next" | "previous"): Promise<{ outcome: string; appName: string | null }> {
  const result = await ipc.backend("windowManagement.cycleAppWindows", { direction });
  return result as { outcome: string; appName: string | null };
}

async function hostRegisterCommandHotkey(commandKey: string, hotkey: { modifiers: string[]; key: string } | null): Promise<void> {
  await ipc.backend("windowManagement.registerCommandHotkey", { commandKey, hotkey });
}

/** Saved bounds live in the backend store, keyed per the spec's `exe|title` decision. */
export async function fetchSavedWindowState(windowId: string): Promise<WmSavedState | null> {
  const result = await ipc.backend("windowManagement.getSavedWindowState", { windowId });
  return (result as { state: WmSavedState | null }).state;
}

async function saveWindowState(windowId: string, bounds: WmSavedState): Promise<void> {
  await ipc.backend("windowManagement.saveWindowState", { windowId, bounds });
}

// -----------------------------------------------------------------------------------------
// Settings (localStorage-backed via the Settings window).
// -----------------------------------------------------------------------------------------

export interface WmGaps {
  innerGap: number;
  outerGap: number;
}

const GAP_BY_LABEL: Record<string, number> = {
  "None": 0,
  "Tiny": 8,
  "Small": 16,
  "Medium": 32,
  "Large": 64,
  "Extra Large": 128,
};

export const WM_GAP_OPTIONS = Object.keys(GAP_BY_LABEL);

export function readWmGaps(): WmGaps {
  const values = loadSettings();
  const innerGap = GAP_BY_LABEL[String(values["wm-inner-gap"] ?? "None")] ?? 0;
  const outerGap = GAP_BY_LABEL[String(values["wm-outer-gap"] ?? "None")] ?? 0;
  return { innerGap, outerGap };
}

export type WmCycleMode = "none" | "sizes" | "displays";

const CYCLE_MODE_BY_LABEL: Record<string, WmCycleMode> = {
  "None": "none",
  "Cycle ½, ⅔, and ⅓": "sizes",
  "Cycle Displays": "displays",
};

export function readCycleMode(): WmCycleMode {
  return CYCLE_MODE_BY_LABEL[String(loadSettings()["wm-cycle-mode"] ?? "None")] ?? "none";
}

/** Per-command preferences (Move edges' `centerWindow`) ship default `true`; the per-command
 * preference UI is not replicated, so the default is always used (docs decision table). */
function centerWindowPref(): boolean {
  return true;
}

// -----------------------------------------------------------------------------------------
// Geometry — the shipped preset functions, 1:1 (`desktop` = the window's work area).
// -----------------------------------------------------------------------------------------

export interface WmContext {
  window: WmWindow;
  desktop: WmDisplay;
  displays: WmDisplay[];
}

type GeometryFn = (context: WmContext) => WmRect;

const floorHalf = (value: number) => Math.floor(value / 2);

function horizontalThirds(fraction: 3 | 4, numerator: number): GeometryFn {
  return ({ desktop }) => {
    const width = Math.floor((numerator * desktop.width) / fraction);
    return { size: { width, height: desktop.height }, position: { x: 0, y: 0 } };
  };
}

function centeredGeometry(width: number, height: number, desktopWidth: number, desktopHeight: number): WmRect {
  return {
    size: { width, height },
    position: { x: Math.floor((desktopWidth - width) / 2), y: Math.floor((desktopHeight - height) / 2) },
  };
}

export const WM_GEOMETRY: Record<string, GeometryFn> = {
  maximize: ({ desktop }) => ({ size: { width: desktop.width, height: desktop.height }, position: { x: 0, y: 0 } }),
  maximizeHeight: ({ desktop }) => ({ size: { height: desktop.height }, position: { y: 0 } }),
  maximizeWidth: ({ desktop }) => ({ size: { width: desktop.width }, position: { x: 0 } }),
  maximizeAlmost: ({ desktop }) => {
    const width = Math.floor(desktop.width * 0.9);
    const height = Math.floor(desktop.height * 0.9);
    return centeredGeometry(width, height, desktop.width, desktop.height);
  },
  reasonableSize: ({ desktop }) => {
    const width = Math.min(Math.floor(desktop.width * 0.6), 1024);
    const height = Math.min(Math.floor(desktop.height * 0.6), 900);
    return centeredGeometry(width, height, desktop.width, desktop.height);
  },
  center: ({ window, desktop }) => ({
    position: { x: floorHalf(desktop.width - window.bounds.width), y: floorHalf(desktop.height - window.bounds.height) },
  }),
  centerHalf: ({ desktop }) => {
    const width = desktop.width / 2;
    return { size: { width, height: desktop.height }, position: { x: Math.floor((desktop.width - width) / 2), y: 0 } };
  },
  leftHalf: ({ desktop }) => ({ size: { width: floorHalf(desktop.width), height: desktop.height }, position: { x: 0, y: 0 } }),
  rightHalf: ({ desktop }) => {
    const width = floorHalf(desktop.width);
    return { size: { width, height: desktop.height }, position: { x: desktop.width - width, y: 0 } };
  },
  topHalf: ({ desktop }) => ({ size: { width: desktop.width, height: floorHalf(desktop.height) }, position: { x: 0, y: 0 } }),
  bottomHalf: ({ desktop }) => {
    const height = floorHalf(desktop.height);
    return { size: { width: desktop.width, height }, position: { x: 0, y: desktop.height - height } };
  },
  firstThird: horizontalThirds(3, 1),
  centerThird: ({ desktop }) => {
    const width = Math.floor(desktop.width / 3);
    return { size: { width, height: desktop.height }, position: { x: Math.floor((desktop.width - width) / 2), y: 0 } };
  },
  lastThird: ({ desktop }) => {
    const width = Math.floor(desktop.width / 3);
    return { size: { width, height: desktop.height }, position: { x: desktop.width - width, y: 0 } };
  },
  firstTwoThird: horizontalThirds(3, 2),
  centerTwoThird: ({ desktop }) => {
    const width = Math.floor((2 * desktop.width) / 3);
    return { size: { width, height: desktop.height }, position: { x: Math.floor((desktop.width - width) / 2), y: 0 } };
  },
  lastTwoThird: ({ desktop }) => {
    const width = Math.floor((2 * desktop.width) / 3);
    return { size: { width, height: desktop.height }, position: { x: desktop.width - width, y: 0 } };
  },
  firstThreeFourth: horizontalThirds(4, 3),
  centerThreeFourth: ({ desktop }) => {
    const width = Math.floor((3 * desktop.width) / 4);
    return { size: { width, height: desktop.height }, position: { x: Math.floor((desktop.width - width) / 2), y: 0 } };
  },
  lastThreeFourth: ({ desktop }) => {
    const width = Math.floor((3 * desktop.width) / 4);
    return { size: { width, height: desktop.height }, position: { x: desktop.width - width, y: 0 } };
  },
  topThird: ({ desktop }) => ({ size: { width: desktop.width, height: Math.floor(desktop.height / 3) }, position: { x: 0, y: 0 } }),
  middleThird: ({ desktop }) => {
    const height = Math.floor(desktop.height / 3);
    return { size: { width: desktop.width, height }, position: { x: 0, y: Math.floor((desktop.height - height) / 2) } };
  },
  bottomThird: ({ desktop }) => {
    const height = Math.floor(desktop.height / 3);
    return { size: { width: desktop.width, height }, position: { x: 0, y: desktop.height - height } };
  },
  topTwoThird: ({ desktop }) => ({ size: { width: desktop.width, height: Math.floor((2 * desktop.height) / 3) }, position: { x: 0, y: 0 } }),
  bottomTwoThird: ({ desktop }) => {
    const height = Math.floor((2 * desktop.height) / 3);
    return { size: { width: desktop.width, height }, position: { x: 0, y: desktop.height - height } };
  },
  topThreeFourth: ({ desktop }) => ({ size: { width: desktop.width, height: Math.floor((3 * desktop.height) / 4) }, position: { x: 0, y: 0 } }),
  bottomThreeFourth: ({ desktop }) => {
    const height = Math.floor((3 * desktop.height) / 4);
    return { size: { width: desktop.width, height }, position: { x: 0, y: desktop.height - height } };
  },
  topCenterTwoThird: ({ desktop }) => {
    const width = Math.floor((2 * desktop.width) / 3);
    const height = Math.floor((2 * desktop.height) / 3);
    return { size: { width, height }, position: { x: Math.floor((desktop.width - width) / 2), y: 0 } };
  },
  bottomCenterTwoThird: ({ desktop }) => {
    const width = Math.floor((2 * desktop.width) / 3);
    const height = Math.floor((2 * desktop.height) / 3);
    return { size: { width, height }, position: { x: Math.floor((desktop.width - width) / 2), y: desktop.height - height } };
  },
  firstFourth: horizontalThirds(4, 1),
  secondFourth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 4);
    return { size: { width, height: desktop.height }, position: { x: width, y: 0 } };
  },
  thirdFourth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 4);
    return { size: { width, height: desktop.height }, position: { x: 2 * width, y: 0 } };
  },
  lastFourth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 4);
    return { size: { width, height: desktop.height }, position: { x: desktop.width - width, y: 0 } };
  },
  topFirstFourth: ({ desktop }) => ({ size: { width: desktop.width, height: Math.floor(desktop.height / 4) }, position: { x: 0, y: 0 } }),
  topSecondFourth: ({ desktop }) => {
    const height = Math.floor(desktop.height / 4);
    return { size: { width: desktop.width, height }, position: { x: 0, y: height } };
  },
  topThirdFourth: ({ desktop }) => {
    const height = Math.floor(desktop.height / 4);
    return { size: { width: desktop.width, height }, position: { x: 0, y: 2 * height } };
  },
  topLastFourth: ({ desktop }) => {
    const height = Math.floor(desktop.height / 4);
    return { size: { width: desktop.width, height }, position: { x: 0, y: desktop.height - height } };
  },
  topLeftQuarter: ({ desktop }) => ({ size: { width: floorHalf(desktop.width), height: floorHalf(desktop.height) }, position: { x: 0, y: 0 } }),
  topRightQuarter: ({ desktop }) => {
    const width = floorHalf(desktop.width);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: desktop.width - width, y: 0 } };
  },
  bottomLeftQuarter: ({ desktop }) => {
    const width = floorHalf(desktop.width);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: 0, y: desktop.height - height } };
  },
  bottomRightQuarter: ({ desktop }) => {
    const width = floorHalf(desktop.width);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: desktop.width - width, y: desktop.height - height } };
  },
  topLeftSixth: ({ desktop }) => ({ size: { width: Math.floor(desktop.width / 3), height: floorHalf(desktop.height) }, position: { x: 0, y: 0 } }),
  topCenterSixth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 3);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: Math.floor((desktop.width - width) / 2), y: 0 } };
  },
  topRightSixth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 3);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: desktop.width - width, y: 0 } };
  },
  bottomLeftSixth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 3);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: 0, y: desktop.height - height } };
  },
  bottomCenterSixth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 3);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: Math.floor((desktop.width - width) / 2), y: desktop.height - height } };
  },
  bottomRightSixth: ({ desktop }) => {
    const width = Math.floor(desktop.width / 3);
    const height = floorHalf(desktop.height);
    return { size: { width, height }, position: { x: desktop.width - width, y: desktop.height - height } };
  },
  makeSmaller: ({ window, desktop }) => makeSmallerRect(window, desktop, 32),
  makeLarger: ({ window, desktop }) => makeLargerRect(window, desktop, 32),
  moveLeft: edgeGeometry("left"),
  moveRight: edgeGeometry("right"),
  moveTop: edgeGeometry("top"),
  moveBottom: edgeGeometry("bottom"),
};

/** `Make Smaller`: step down by `delta`, never below 25% of the screen; the center stays put. */
function makeSmallerRect(window: WmWindow, desktop: WmDisplay, delta: number): WmRect {
  const minWidth = Math.floor(desktop.width * 0.25);
  const minHeight = Math.floor(desktop.height * 0.25);
  const width = Math.max(window.bounds.width - delta, minWidth);
  const height = Math.max(window.bounds.height - delta, minHeight);
  return {
    size: { width, height },
    position: {
      x: window.bounds.x + (window.bounds.width - width) / 2,
      y: window.bounds.y + (window.bounds.height - height) / 2,
    },
  };
}

/** `Make Larger`: step up by `delta`, capped at the screen; the center stays put. */
function makeLargerRect(window: WmWindow, desktop: WmDisplay, delta: number): WmRect {
  const width = Math.min(window.bounds.width + delta, desktop.width);
  const height = Math.min(window.bounds.height + delta, desktop.height);
  return {
    size: { width, height },
    position: {
      x: Math.max(0, window.bounds.x - (width - window.bounds.width) / 2),
      y: Math.max(0, window.bounds.y - (height - window.bounds.height) / 2),
    },
  };
}

/** Move-to-edge geometry: the window keeps its size, `centerWindow` centers it along the edge. */
function edgeGeometry(edge: "left" | "right" | "top" | "bottom"): GeometryFn {
  return ({ window, desktop }) => {
    const center = centerWindowPref();
    switch (edge) {
      case "left":
        return { position: { x: 0, y: center ? Math.floor((desktop.height - window.bounds.height) / 2) : window.bounds.y } };
      case "right":
        return { position: { x: Math.max(0, desktop.width - window.bounds.width), y: center ? Math.floor((desktop.height - window.bounds.height) / 2) : window.bounds.y } };
      case "top":
        return { position: { x: center ? Math.floor((desktop.width - window.bounds.width) / 2) : window.bounds.x, y: 0 } };
      case "bottom":
        return { position: { x: center ? Math.floor((desktop.width - window.bounds.width) / 2) : window.bounds.x, y: desktop.height - window.bounds.height } };
    }
  };
}

// -----------------------------------------------------------------------------------------
// Gap application, clamping, merging (the shared bounds chunk, transcribed).
// -----------------------------------------------------------------------------------------

/** `Df`: inset flush edges by `outerGap`, internal edges by `innerGap / 2`. */
function applyGapsToRect(rect: { x: number; y: number; width: number; height: number }, gaps: WmGaps, work: { width: number; height: number }) {
  const half = gaps.innerGap / 2;
  const left = rect.x === 0 ? gaps.outerGap : half;
  const top = rect.y === 0 ? gaps.outerGap : half;
  const right = rect.x + rect.width >= work.width ? gaps.outerGap : half;
  const bottom = rect.y + rect.height >= work.height ? gaps.outerGap : half;
  return { x: rect.x + left, y: rect.y + top, width: rect.width - left - right, height: rect.height - top - bottom };
}

/** `Eb`: clamp a position-only axis so a flush edge sits at `outerGap`. */
function clampPositionOnly(pos: number | undefined, size: number, total: number, outerGap: number): { pos: number | undefined; size: number | undefined } {
  const maxSize = total - 2 * outerGap;
  const clampedSize = size > maxSize && maxSize > 0 ? maxSize : undefined;
  const effective = clampedSize ?? size;
  let next = pos;
  if (pos !== undefined) {
    if (pos <= 0) next = outerGap;
    else if (pos + size >= total) next = total - effective - outerGap;
  }
  return { pos: next, size: clampedSize };
}

/** Position-only clamp (`c`): a flush edge ends up at `outerGap` instead of 0. */
function clampPositionWithGap(rect: WmRect, window: WmWindow, desktop: WmDisplay, outerGap: number): WmRect {
  if (!rect.position) return rect;
  let { x, y } = rect.position;
  if (x !== undefined) {
    if (x <= 0) x = outerGap;
    else if (x + window.bounds.width >= desktop.width) x = desktop.width - window.bounds.width - outerGap;
  }
  if (y !== undefined) {
    if (y <= 0) y = outerGap;
    else if (y + window.bounds.height >= desktop.height) y = desktop.height - window.bounds.height - outerGap;
  }
  return { ...rect, position: { x, y } };
}

/** `kre`: apply the gap settings to a command rect; an explicit size that collapses to ≤ 0 skips
 * the command unchanged (the rect comes back untouched and the changed-check no-ops the apply). */
export function applyCommandGaps(rect: WmRect, context: WmContext, gaps: WmGaps): WmRect {
  const { innerGap, outerGap } = gaps;
  if (innerGap === 0 && outerGap === 0) return rect;
  if (!rect.size) return clampPositionWithGap(rect, context.window, context.desktop, outerGap);
  const window = context.window.bounds;
  const gapped = applyGapsToRect(
    {
      x: rect.position?.x ?? window.x,
      y: rect.position?.y ?? window.y,
      width: rect.size.width ?? window.width,
      height: rect.size.height ?? window.height,
    },
    gaps,
    context.desktop,
  );
  const hasWidth = rect.size.width !== undefined;
  const hasHeight = rect.size.height !== undefined;
  if ((hasWidth && gapped.width <= 0) || (hasHeight && gapped.height <= 0)) return rect;
  const horizontal = hasWidth
    ? { pos: gapped.x, size: gapped.width }
    : clampPositionOnly(rect.position?.x, window.width, context.desktop.width, outerGap);
  const vertical = hasHeight
    ? { pos: gapped.y, size: gapped.height }
    : clampPositionOnly(rect.position?.y, window.height, context.desktop.height, outerGap);
  return { position: { x: horizontal.pos, y: vertical.pos }, size: { width: horizontal.size, height: vertical.size } };
}

/** `f`: clamp the rect onto the work area unless the command allows oversize. */
export function clampRect(rect: WmRect, work: { width: number; height: number }, current: WmBounds): WmRect {
  const x = rect.position?.x ?? current.x;
  const y = rect.position?.y ?? current.y;
  const width = rect.size?.width ?? current.width;
  const height = rect.size?.height ?? current.height;
  const oversize = rect.allowOversize === true;
  let nextX = x;
  let nextY = y;
  let nextWidth = width;
  let nextHeight = height;
  if (width > work.width) {
    nextX = 0;
    if (!oversize) nextWidth = work.width;
  } else if (x < 0) {
    nextX = 0;
  } else if (x + width > work.width) {
    nextX = work.width - width;
  }
  if (height > work.height) {
    nextY = 0;
    if (!oversize) nextHeight = work.height;
  } else if (y < 0) {
    nextY = 0;
  } else if (y + height > work.height) {
    nextY = work.height - height;
  }
  if (nextX === x && nextY === y && nextWidth === width && nextHeight === height) return rect;
  const positionChanged = nextX !== x || nextY !== y;
  const sizeChanged = nextWidth !== width || nextHeight !== height;
  return {
    position: positionChanged ? { x: nextX, y: nextY } : rect.position,
    size: sizeChanged ? { width: nextWidth, height: nextHeight } : rect.size,
    ...(rect.displayIndex !== undefined ? { displayIndex: rect.displayIndex } : {}),
  };
}

/** `l` (Tf): merge a command rect with the window's current bounds into the full expected bounds. */
export function mergeCommandBounds(context: WmContext, rect: WmRect): { displayIndex: number; position: { x: number; y: number }; size: { width: number; height: number } } {
  const bounds = context.window.bounds;
  return {
    displayIndex: rect.displayIndex ?? context.window.displayIndex,
    position: { x: rect.position?.x ?? bounds.x, y: rect.position?.y ?? bounds.y },
    size: { width: rect.size?.width ?? bounds.width, height: rect.size?.height ?? bounds.height },
  };
}

function boundsEqual(a: { displayIndex: number; position: { x: number; y: number }; size: { width: number; height: number } }, window: WmWindow): boolean {
  return (
    a.displayIndex === window.displayIndex &&
    a.position.x === window.bounds.x &&
    a.position.y === window.bounds.y &&
    a.size.width === window.bounds.width &&
    a.size.height === window.bounds.height
  );
}

function boundsChanged(window: WmWindow, rect: WmRect): boolean {
  if (rect.displayIndex !== undefined && rect.displayIndex !== window.displayIndex) return true;
  if (rect.position?.x !== undefined && rect.position.x !== window.bounds.x) return true;
  if (rect.position?.y !== undefined && rect.position.y !== window.bounds.y) return true;
  if (rect.size?.width !== undefined && rect.size.width !== window.bounds.width) return true;
  if (rect.size?.height !== undefined && rect.size.height !== window.bounds.height) return true;
  return false;
}

// -----------------------------------------------------------------------------------------
// Display moves (`Qb` + `Ef`/`vf`): gaps ignored; when the target's work area differs and
// `keepAspectRatio`, position and size scale by the work-area ratios.
// -----------------------------------------------------------------------------------------

export function scaleRectForDisplay(rect: WmRect, source: WmDisplay, target: WmDisplay, keepAspectRatio: boolean): WmRect {
  if (target.width === source.width && target.height === source.height) return rect;
  const position = { ...rect.position };
  const size = { ...rect.size };
  if (keepAspectRatio) {
    if (position.x !== undefined) position.x = position.x * (target.width / source.width);
    if (position.y !== undefined) position.y = position.y * (target.height / source.height);
    if (size.width !== undefined) size.width = size.width * (target.width / source.width);
    if (size.height !== undefined) size.height = size.height * (target.height / source.height);
  }
  return { ...rect, position, size };
}

/** `Ef`: previous display before the current one, wrapping past it when allowed. */
export function findPreviousDisplay(displays: WmDisplay[], current: WmDisplay, wrap: boolean): WmDisplay | null {
  const index = displays.findIndex((display) => display.id === current.id);
  if (index <= 0) return wrap && displays.length > 1 ? displays[displays.length - 1] : null;
  return displays[index - 1];
}

/** `vf`: next display after the current one, wrapping around when allowed. */
export function findNextDisplay(displays: WmDisplay[], current: WmDisplay, wrap: boolean): WmDisplay | null {
  const index = displays.findIndex((display) => display.id === current.id);
  if (index === -1 || index === displays.length - 1) return wrap && displays.length > 1 ? displays[0] : null;
  return displays[index + 1];
}

// -----------------------------------------------------------------------------------------
// Cycling (`mb`/`hb`/`gb`): per-command in-memory state — press 1 = base, press 2 = the
// two-thirds variant (sizes mode) or the same command on the adjacent display (displays mode),
// press 3 = the one-third variant; the state resets whenever the window's bounds stop matching
// what the last press produced.
// -----------------------------------------------------------------------------------------

interface CycleState {
  count: number;
  boundsAfter: { displayIndex: number; position: { x: number; y: number }; size: { width: number; height: number } };
}

const cycleStates = new Map<string, CycleState>();

/** `mb`: a window whose bounds drifted from the last application restarts the cycle. */
function cycleState(key: string, context: WmContext): CycleState {
  const state = cycleStates.get(key);
  if (!state || !boundsEqual(state.boundsAfter, context.window)) {
    cycleStates.clear();
    return { count: 0, boundsAfter: mergeCommandBounds(context, {}) };
  }
  return state;
}

function recordCycle(key: string, context: WmContext, rect: WmRect, count: number, achieved?: WmBounds | null): void {
  const merged = mergeCommandBounds(context, rect);
  if (achieved && rect.displayIndex === undefined) {
    cycleStates.set(key, {
      count,
      boundsAfter: {
        displayIndex: merged.displayIndex,
        position: { x: achieved.x, y: achieved.y },
        size: { width: achieved.width, height: achieved.height },
      },
    });
    return;
  }
  cycleStates.set(key, { count, boundsAfter: merged });
}

/** The shipped post-action `_b`: once the apply lands, the cycle's expected bounds become the
 * window's actual bounds so the next press compares against reality. */
function reconcileCycle(key: string, bounds: WmBounds, displayIndex: number | undefined): void {
  const state = cycleStates.get(key);
  if (!state) return;
  cycleStates.set(key, {
    ...state,
    boundsAfter: {
      displayIndex: displayIndex ?? state.boundsAfter.displayIndex,
      position: { x: bounds.x, y: bounds.y },
      size: { width: bounds.width, height: bounds.height },
    },
  });
}

/** `hb` — the `sizes` cycle: base, then two-thirds, then one-third variant. */
export function cycleSizes(context: WmContext, key: string, base: GeometryFn, twoThirds: GeometryFn, oneThird: GeometryFn): WmRect {
  const state = cycleState(key, context);
  let rect: WmRect;
  let nextCount: number;
  switch (state.count % 3) {
    case 1:
      rect = twoThirds(context);
      nextCount = state.count + 1;
      break;
    case 2:
      rect = oneThird(context);
      nextCount = state.count + 1;
      break;
    default:
      rect = base(context);
      nextCount = state.count + 1;
      break;
  }
  recordCycle(key, context, rect, nextCount);
  return rect;
}

/** `gb` — the `displays` cycle: base, then the variant geometry on the adjacent display. */
export function cycleDisplays(
  context: WmContext,
  key: string,
  base: GeometryFn,
  variant: GeometryFn,
  findDisplay: (displays: WmDisplay[], current: WmDisplay, wrap: boolean) => WmDisplay | null,
): WmRect {
  const state = cycleState(key, context);
  if (state.count === 1) {
    const target = findDisplay(context.displays, context.desktop, true);
    const rect = target ? variant({ ...context, desktop: target }) : base(context);
    if (target) rect.displayIndex = target.index;
    recordCycle(key, context, rect, 0);
    return rect;
  }
  const rect = base(context);
  recordCycle(key, context, rect, 1);
  return rect;
}

/** Test hook: the cycle map is module state that survives across tests. */
export function resetCyclingState(): void {
  cycleStates.clear();
}

/** The shipped per-command cycling pairings: base, sizes variants (two-thirds, one-third),
 * displays base + variant + direction. The shipped `gb` calls move Left/Top halves toward the
 * previous display with the mirrored geometry and Right/Bottom toward the next, verbatim. */
export const CYCLING: Record<string, { sizes: [GeometryFn, GeometryFn, GeometryFn]; displays: [GeometryFn, GeometryFn, (displays: WmDisplay[], current: WmDisplay, wrap: boolean) => WmDisplay | null] }> = {
  centerHalf: { sizes: [WM_GEOMETRY.centerHalf, WM_GEOMETRY.centerTwoThird, WM_GEOMETRY.centerThird], displays: [WM_GEOMETRY.centerHalf, WM_GEOMETRY.centerHalf, findNextDisplay] },
  leftHalf: { sizes: [WM_GEOMETRY.leftHalf, WM_GEOMETRY.firstTwoThird, WM_GEOMETRY.firstThird], displays: [WM_GEOMETRY.leftHalf, WM_GEOMETRY.rightHalf, findPreviousDisplay] },
  rightHalf: { sizes: [WM_GEOMETRY.rightHalf, WM_GEOMETRY.lastTwoThird, WM_GEOMETRY.lastThird], displays: [WM_GEOMETRY.rightHalf, WM_GEOMETRY.leftHalf, findNextDisplay] },
  topHalf: { sizes: [WM_GEOMETRY.topHalf, WM_GEOMETRY.topTwoThird, WM_GEOMETRY.topThird], displays: [WM_GEOMETRY.topHalf, WM_GEOMETRY.bottomHalf, findNextDisplay] },
  bottomHalf: { sizes: [WM_GEOMETRY.bottomHalf, WM_GEOMETRY.bottomTwoThird, WM_GEOMETRY.bottomThird], displays: [WM_GEOMETRY.bottomHalf, WM_GEOMETRY.topHalf, findPreviousDisplay] },
};

// -----------------------------------------------------------------------------------------
// Argument parsing (the shipped regexes, verbatim; `bb` = 32767).
// -----------------------------------------------------------------------------------------

export const WM_MAX_COORD = 32767;
const SIZE_PATTERN = /^\d+$/;
const POSITION_PATTERN = /^([+-]?\d+)\s*(?:[x×*,]|\s)\s*([+-]?\d+)$/i;

function parseSizeValue(raw: string): number | null {
  if (!SIZE_PATTERN.test(raw.trim())) return null;
  const value = Number(raw);
  if (!(value > 0 && value <= WM_MAX_COORD)) return null;
  return value;
}

/** `Resize Window` args — each of width/height matches `^\d+$` and lands in (0, 32767]. */
export function parseSizeArgs(width: string, height: string): { width: number; height: number } | null {
  const parsedWidth = parseSizeValue(width);
  const parsedHeight = parseSizeValue(height);
  if (parsedWidth === null || parsedHeight === null) return null;
  return { width: parsedWidth, height: parsedHeight };
}

/** `Move Window` args — `100,100`, `100 100`, `100x100`…, absolute value ≤ 32767. */
export function parsePositionArgs(raw: string): { x: number; y: number } | null {
  const match = POSITION_PATTERN.exec(raw.trim() ?? "");
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (Math.abs(x) > WM_MAX_COORD || Math.abs(y) > WM_MAX_COORD) return null;
  return { x, y };
}

// -----------------------------------------------------------------------------------------
// Command runner — the shipped `ex`/`tx`/`jx` flow: context, gate, close the launcher, apply,
// post-verify. Every failure toast below is a confirmed shipped string.
// -----------------------------------------------------------------------------------------

export interface WmRunnerHooks {
  showToast: (title: string, message?: string) => void;
  closeMainWindow: () => Promise<void> | void;
}

interface CommandSpec {
  operations: Array<"move" | "resize">;
  ignoreGap?: boolean;
  failureTitle?: string;
  action: (context: WmContext) => WmRect | Promise<WmRect> | undefined;
  postAction?: (context: WmContext, achieved: WmBounds | null) => Promise<void> | void;
}

function failureTitleFor(operations: Array<"move" | "resize">): string {
  const moves = operations.includes("move");
  const resizes = operations.includes("resize");
  if (moves && resizes) return "Cannot move or resize window";
  return resizes ? "Cannot resize window" : "Cannot move window";
}

function gate(context: WmContext, operations: Array<"move" | "resize">): string | null {
  if (!context.window.resizable && operations.includes("resize")) return "Focused window is not resizable";
  if (!context.window.positionable && operations.includes("move")) return "Focused window is not positionable";
  return null;
}

function appNameOf(window: WmWindow): string {
  return window.exeName.replace(/\.exe$/i, "") || "The app";
}

/** The command target: the host's captured pre-launch foreground window. When there is no
 * capture (the launcher auto-showed at boot and the hotkey path was bypassed), hide the launcher
 * first — the OS re-activates the previous window, which then reports as the live foreground. */
async function fetchTargetWindow(hooks: WmRunnerHooks): Promise<WmWindow | null> {
  const captured = await fetchActiveWindow();
  if (captured) return captured;
  await hooks.closeMainWindow();
  return fetchActiveWindow();
}

export function windowStateKey(window: WmWindow): string {
  return `${window.exeName}|${window.title}`;
}

/** `jb`: gap application, clamping, saved-state bookkeeping and the host call, with the shipped
 * re-check that treats a refusal as success when the window already sits at the requested bounds. */
async function applyCommand(context: WmContext, rect: WmRect, ignoreGap: boolean, gaps: WmGaps): Promise<{ rect: WmRect; achieved: WmBounds | null }> {
  const effective = ignoreGap ? rect : applyCommandGaps(rect, context, gaps);
  const target = context.displays.find((display) => display.index === (effective.displayIndex ?? context.window.displayIndex)) ?? context.desktop;
  const clamped = clampRect(effective, target, context.window.bounds);
  const changed = boundsChanged(context.window, clamped);
  if (!changed && clamped.allowOversize !== true) return { rect: clamped, achieved: null };
  if (changed) {
    await saveWindowState(windowStateKey(context.window), {
      displayIndex: context.window.displayIndex,
      position: { x: context.window.bounds.x, y: context.window.bounds.y },
      size: { width: context.window.bounds.width, height: context.window.bounds.height },
    });
  }
  try {
    const response = await hostSetWindowBounds({
      id: context.window.id,
      displayIndex: target.index,
      bounds: { position: clamped.position, size: clamped.size },
    });
    return { rect: clamped, achieved: response.bounds };
  } catch (error) {
    const fresh = await fetchActiveWindow().catch(() => null);
    if (fresh && fresh.id === context.window.id && !boundsChanged(fresh, clamped)) return { rect: clamped, achieved: fresh.bounds };
    throw error;
  }
}

async function runSpec(spec: CommandSpec, hooks: WmRunnerHooks): Promise<void> {
  const displays = await fetchDisplays();
  const window = await fetchTargetWindow(hooks);
  if (!window) {
    hooks.showToast("No focused window");
    return;
  }
  const desktop = displays.find((display) => display.index === window.displayIndex);
  const context: WmContext | null = desktop ? { window, desktop, displays } : null;
  if (!context) {
    hooks.showToast(spec.failureTitle ?? failureTitleFor(spec.operations));
    return;
  }
  const gateToast = gate(context, spec.operations);
  if (gateToast) {
    hooks.showToast(gateToast);
    return;
  }
  await hooks.closeMainWindow();
  try {
    const requested = spec.action(context);
    if (requested === undefined) return;
    const rect = await requested;
    const { achieved } = await applyCommand(context, rect, spec.ignoreGap ?? false, readWmGaps());
    if (spec.postAction) await spec.postAction(context, achieved);
  } catch {
    hooks.showToast(spec.failureTitle ?? failureTitleFor(spec.operations));
  }
}

/** The cycling commands (`Xb`): route to the base/sizes/displays variant by the setting. */
function cyclingRect(key: string, context: WmContext): WmRect {
  const entry = CYCLING[key];
  const mode = readCycleMode();
  if (mode === "sizes") return cycleSizes(context, key, entry.sizes[0], entry.sizes[1], entry.sizes[2]);
  if (mode === "displays") return cycleDisplays(context, key, entry.displays[0], entry.displays[1], entry.displays[2]);  return entry.sizes[0](context);
}

/** Commands whose geometry ignores the gap settings (`tx`'s `ignoreGap: true` rows). */
const IGNORE_GAP_COMMANDS = new Set(["maximize", "maximizeAlmost", "reasonableSize", "makeSmaller"]);
const MOVE_EDGE_COMMANDS = new Set(["moveLeft", "moveRight", "moveTop", "moveBottom"]);

/** `runWindowManagementCommand` — one entry point for root search, the args view and hotkeys. */
export async function runWindowManagementCommand(commandKey: string, hooks: WmRunnerHooks, args?: { position?: { x: number; y: number }; size?: { width: number; height: number } }): Promise<void> {
  const geometry = WM_GEOMETRY[commandKey];
  if (geometry) {
    if (CYCLING[commandKey]) {
      let appliedRect: WmRect | null = null;
      await runSpec(
        {
          operations: ["move", "resize"],
          action: (context) => {
            const rect = cyclingRect(commandKey, context);
            appliedRect = rect;
            return rect;
          },
          postAction: (_context, achieved) => {
            if (achieved && appliedRect) reconcileCycle(commandKey, achieved, appliedRect.displayIndex);
          },
        },
        hooks,
      );
      return;
    }
    if (commandKey === "center" || MOVE_EDGE_COMMANDS.has(commandKey)) {
      await runSpec({ operations: ["move"], action: geometry }, hooks);
      return;
    }
    await runSpec(
      { operations: ["move", "resize"], ignoreGap: IGNORE_GAP_COMMANDS.has(commandKey), action: geometry },
      hooks,
    );
    return;
  }

  switch (commandKey) {
    case "movePreviousDisplay":
    case "moveNextDisplay": {
      const previous = commandKey === "movePreviousDisplay";
      await runSpec(
        {
          operations: ["move", "resize"],
          ignoreGap: true,
          failureTitle: `Cannot move to ${previous ? "previous" : "next"} display`,
          action: (context) => {
            const target = previous
              ? findPreviousDisplay(context.displays, context.desktop, true)
              : findNextDisplay(context.displays, context.desktop, true);
            if (!target) {
              hooks.showToast(`No ${previous ? "previous" : "next"} display found`);
              return undefined;
            }
            const rect: WmRect = {
              position: { x: context.window.bounds.x, y: context.window.bounds.y },
              size: { width: context.window.bounds.width, height: context.window.bounds.height },
              displayIndex: target.index,
            };
            return scaleRectForDisplay(rect, context.desktop, target, true);
          },
        },
        hooks,
      );
      return;
    }
    case "minimize": {
      const window = await fetchTargetWindow(hooks);
      if (!window) {
        hooks.showToast("No focused window");
        return;
      }
      try {
        await hostMinimizeWindow(window.id);
      } catch {
        hooks.showToast("Cannot minimize window");
        return;
      }
      await hooks.closeMainWindow();
      return;
    }
    case "minimizeOnDisplay": {
      const displays = await fetchDisplays();
      const window = await fetchTargetWindow(hooks);
      if (!window) {
        hooks.showToast("No focused window");
        return;
      }
      const display = displays.find((entry) => entry.index === window.displayIndex);
      if (!display) {
        hooks.showToast("Couldn't determine current display");
        return;
      }
      const visible = await hostEnumerateVisibleWindows();
      const targets = visible.filter((entry) => entry.displayIndex === display.index);
      await hooks.closeMainWindow();
      if (targets.length === 0) {
        hooks.showToast("No windows to minimize");
        return;
      }
      const results = await Promise.allSettled(targets.map((entry) => hostMinimizeWindow(entry.id)));
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length === targets.length) hooks.showToast("Cannot minimize windows on this display");
      else if (failures.length > 0) hooks.showToast(`${failures.length} window${failures.length === 1 ? "" : "s"} could not be minimized`);
      return;
    }
    case "restore": {
      try {
        const displays = await fetchDisplays();
        const window = await fetchTargetWindow(hooks);
        if (!window) {
          hooks.showToast("No focused window");
          return;
        }
        const saved = await fetchSavedWindowState(windowStateKey(window));
        if (!saved || saved.fullscreen) {
          hooks.showToast("No previous window state");
          return;
        }
        await hooks.closeMainWindow();
        const desktop = displays.find((display) => display.index === (saved.displayIndex ?? window.displayIndex)) ?? displays[window.displayIndex] ?? displays[0];
        await applyCommand(
          { window, desktop, displays },
          { position: saved.position, size: saved.size, displayIndex: saved.displayIndex },
          true,
          readWmGaps(),
        );
      } catch {
        hooks.showToast("Cannot restore window");
      }
      return;
    }
    case "toggleAlwaysOnTop": {
      const window = await fetchTargetWindow(hooks);
      if (!window) {
        hooks.showToast("No focused window");
        return;
      }
      try {
        const topmost = await hostToggleAlwaysOnTop(window.id);
        const app = window.exeName.replace(/\.exe$/i, "");
        hooks.showToast(`${topmost ? "Pinned" : "Unpinned"}${app ? ` ${app}` : ""}`);
      } catch {
        hooks.showToast("Cannot toggle always on top");
      }
      return;
    }
    case "focusNextAppWindow":
    case "focusPreviousAppWindow": {
      const direction = commandKey === "focusNextAppWindow" ? "next" : "previous";
      await hooks.closeMainWindow();
      try {
        const result = await hostCycleAppWindows(direction);
        if (result.outcome === "noWindow") hooks.showToast("No focused window");
        else if (result.outcome === "noOtherWindows")
          hooks.showToast(result.appName ? `No other ${result.appName.replace(/\.exe$/i, "")} windows` : "No other windows of this app");
      } catch {
        hooks.showToast(`Cannot focus ${direction} app window`);
      }
      return;
    }
    case "resizeWindow": {
      const size = args?.size;
      if (!size) return;
      await runSpec(
        {
          operations: ["resize"],
          ignoreGap: true,
          failureTitle: `Cannot resize window to ${size.width} × ${size.height}`,
          action: (context) => ({ position: { x: context.window.bounds.x, y: context.window.bounds.y }, size, allowOversize: true }),
          postAction: async (context) => {
            const fresh = await fetchActiveWindow().catch(() => null);
            if (!fresh || fresh.id !== context.window.id) return;
            const drifted =
              Math.abs(fresh.bounds.width - size.width) > 1 || Math.abs(fresh.bounds.height - size.height) > 1;
            if (drifted) {
              hooks.showToast(
                `Window resized to ${fresh.bounds.width} × ${fresh.bounds.height}`,
                `${appNameOf(context.window)} does not allow ${size.width} × ${size.height}`,
              );
            }
          },
        },
        hooks,
      );
      return;
    }
    case "moveWindow": {
      const position = args?.position;
      if (!position) return;
      await runSpec(
        {
          operations: ["move"],
          ignoreGap: true,
          failureTitle: `Cannot move window to ${position.x}, ${position.y}`,
          action: () => ({ position, allowOversize: true }),
        },
        hooks,
      );
      return;
    }
    default:
      return;
  }
}

// -----------------------------------------------------------------------------------------
// Magnet preset (the shipped `Wt` map). `Ctrl+Alt+Delete` (Restore) is a Windows-reserved SAS
// combination and the two `Move to Display` entries use Win (Meta) — the clone's hotkey surface
// supports neither, so those three bindings are dropped (docs decision table).
// -----------------------------------------------------------------------------------------

export interface WmHotkey {
  modifiers: string[];
  key: string;
}

export const MAGNET_PRESET: Record<string, WmHotkey> = {
  leftHalf: { modifiers: ["ctrl", "alt"], key: "ArrowLeft" },
  rightHalf: { modifiers: ["ctrl", "alt"], key: "ArrowRight" },
  topHalf: { modifiers: ["ctrl", "alt"], key: "ArrowUp" },
  bottomHalf: { modifiers: ["ctrl", "alt"], key: "ArrowDown" },
  topLeftQuarter: { modifiers: ["ctrl", "alt"], key: "U" },
  topRightQuarter: { modifiers: ["ctrl", "alt"], key: "I" },
  bottomLeftQuarter: { modifiers: ["ctrl", "alt"], key: "J" },
  bottomRightQuarter: { modifiers: ["ctrl", "alt"], key: "K" },
  maximize: { modifiers: ["ctrl", "alt"], key: "Enter" },
  maximizeHeight: { modifiers: ["ctrl", "alt", "shift"], key: "ArrowUp" },
  makeSmaller: { modifiers: ["ctrl", "alt"], key: "Minus" },
  makeLarger: { modifiers: ["ctrl", "alt"], key: "Equal" },
  center: { modifiers: ["ctrl", "alt"], key: "C" },
  firstThird: { modifiers: ["ctrl", "alt"], key: "D" },
  firstTwoThird: { modifiers: ["ctrl", "alt"], key: "E" },
  centerThird: { modifiers: ["ctrl", "alt"], key: "F" },
  lastTwoThird: { modifiers: ["ctrl", "alt"], key: "T" },
  lastThird: { modifiers: ["ctrl", "alt"], key: "G" },
};

const HOTKEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "↵",
  Minus: "-",
  Equal: "=",
};

export function hotkeyLabel(hotkey: WmHotkey): string {
  const modifiers = hotkey.modifiers.map((mod) => (mod === "ctrl" ? "Ctrl" : mod === "alt" ? "Alt" : mod === "shift" ? "Shift" : "Win"));
  const key = HOTKEY_LABELS[hotkey.key] ?? hotkey.key.toUpperCase();
  return [...modifiers, key].join(" + ");
}

const HOTKEYS_STORAGE_KEY = "openray:wm-hotkeys";

export function readStoredHotkeys(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(HOTKEYS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function storeHotkeys(hotkeys: Record<string, string>): void {
  try {
    window.localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(hotkeys));
  } catch {
    /* private mode — hotkey labels simply do not persist */
  }
}

/** Apply the Magnet preset (or clear every command hotkey with `null`). */
export async function applyPreset(preset: "Magnet" | "Rectangle" | null): Promise<void> {
  if (preset) {
    for (const [commandKey, hotkey] of Object.entries(MAGNET_PRESET)) {
      await hostRegisterCommandHotkey(commandKey, hotkey);
    }
    storeHotkeys(Object.fromEntries(Object.entries(MAGNET_PRESET).map(([commandKey, hotkey]) => [commandKey, hotkeyLabel(hotkey)])));
    return;
  }
  const stored = readStoredHotkeys();
  for (const commandKey of Object.keys(stored)) {
    await hostRegisterCommandHotkey(commandKey, null);
  }
  storeHotkeys({});
}

/** Re-register stored hotkeys after a renderer reload (host registrations die with the process,
 * so a fresh launcher replays the stored map). */
export async function reregisterStoredHotkeys(): Promise<void> {
  const stored = readStoredHotkeys();
  for (const [commandKey, label] of Object.entries(stored)) {
    const hotkey = Object.entries(MAGNET_PRESET).find(([, hotkey]) => hotkeyLabel(hotkey) === label)?.[1];
    if (hotkey) await hostRegisterCommandHotkey(commandKey, hotkey);
  }
}

// -----------------------------------------------------------------------------------------
// The command catalog lives in ./wm-commands (imported by the Settings page catalog too).
// -----------------------------------------------------------------------------------------

export { WM_COMMANDS, wmCommandDefinition, wmCommandIcon } from './wm-commands';
export type { WmCommandDefinition } from './wm-commands';
