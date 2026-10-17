// Window Management geometry tests: src/windowManagement.ts is TypeScript with an IPC import, so
// the suite bundles it with esbuild (already a dev dependency of the frontend), defining `window`
// away for Node, and asserts against the compiled output.
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// esbuild.exe cannot write files under the build sandbox, so bundle to memory and let Node
// persist the output itself.
const outDir = mkdtempSync(join(tmpdir(), "openray-wm-"));
const outFile = join(outDir, "window-management.cjs");

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/windowManagement.ts", import.meta.url))],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  logLevel: "silent",
  define: { window: "globalThis" },
});
writeFileSync(outFile, bundled.outputFiles[0].text);

const require = createRequire(import.meta.url);
const {
  WM_GEOMETRY,
  applyCommandGaps,
  clampRect,
  scaleRectForDisplay,
  findPreviousDisplay,
  findNextDisplay,
  cycleSizes,
  cycleDisplays,
  resetCyclingState,
  parseSizeArgs,
  parsePositionArgs,
  CYCLING,
} = require(outFile);

test.after(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const DISPLAY_1920 = { index: 0, id: 101, x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: true, isCurrent: true, name: "\\\\.\\DISPLAY1" };
const DISPLAY_2560 = { index: 1, id: 102, x: 0, y: 0, width: 2560, height: 1440, scaleFactor: 1, isPrimary: false, isCurrent: false, name: "\\\\.\\DISPLAY2" };

function context(bounds, desktop = DISPLAY_1920, displays = [DISPLAY_1920]) {
  return {
    window: {
      id: 42, pid: 100, exeName: "notepad.exe", title: "Untitled",
      bounds, displayIndex: desktop.index,
      resizable: true, positionable: true, topmost: false, maximized: false, minimized: false,
    },
    desktop,
    displays,
  };
}

test("every preset computes the shipped rect on 1920×1080", () => {
  const ctx = context({ x: 100, y: 100, width: 800, height: 600 });
  const expected = {
    maximize: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
    leftHalf: { position: { x: 0, y: 0 }, size: { width: 960, height: 1080 } },
    rightHalf: { position: { x: 960, y: 0 }, size: { width: 960, height: 1080 } },
    topHalf: { position: { x: 0, y: 0 }, size: { width: 1920, height: 540 } },
    bottomHalf: { position: { x: 0, y: 540 }, size: { width: 1920, height: 540 } },
    firstThird: { position: { x: 0, y: 0 }, size: { width: 640, height: 1080 } },
    centerThird: { position: { x: 640, y: 0 }, size: { width: 640, height: 1080 } },
    lastThird: { position: { x: 1280, y: 0 }, size: { width: 640, height: 1080 } },
    firstTwoThird: { position: { x: 0, y: 0 }, size: { width: 1280, height: 1080 } },
    centerTwoThird: { position: { x: 320, y: 0 }, size: { width: 1280, height: 1080 } },
    lastTwoThird: { position: { x: 640, y: 0 }, size: { width: 1280, height: 1080 } },
    firstThreeFourth: { position: { x: 0, y: 0 }, size: { width: 1440, height: 1080 } },
    centerThreeFourth: { position: { x: 240, y: 0 }, size: { width: 1440, height: 1080 } },
    lastThreeFourth: { position: { x: 480, y: 0 }, size: { width: 1440, height: 1080 } },
    topThird: { position: { x: 0, y: 0 }, size: { width: 1920, height: 360 } },
    middleThird: { position: { x: 0, y: 360 }, size: { width: 1920, height: 360 } },
    bottomThird: { position: { x: 0, y: 720 }, size: { width: 1920, height: 360 } },
    topTwoThird: { position: { x: 0, y: 0 }, size: { width: 1920, height: 720 } },
    bottomTwoThird: { position: { x: 0, y: 360 }, size: { width: 1920, height: 720 } },
    topThreeFourth: { position: { x: 0, y: 0 }, size: { width: 1920, height: 810 } },
    bottomThreeFourth: { position: { x: 0, y: 270 }, size: { width: 1920, height: 810 } },
    topCenterTwoThird: { position: { x: 320, y: 0 }, size: { width: 1280, height: 720 } },
    bottomCenterTwoThird: { position: { x: 320, y: 360 }, size: { width: 1280, height: 720 } },
    firstFourth: { position: { x: 0, y: 0 }, size: { width: 480, height: 1080 } },
    secondFourth: { position: { x: 480, y: 0 }, size: { width: 480, height: 1080 } },
    thirdFourth: { position: { x: 960, y: 0 }, size: { width: 480, height: 1080 } },
    lastFourth: { position: { x: 1440, y: 0 }, size: { width: 480, height: 1080 } },
    topFirstFourth: { position: { x: 0, y: 0 }, size: { width: 1920, height: 270 } },
    topSecondFourth: { position: { x: 0, y: 270 }, size: { width: 1920, height: 270 } },
    topThirdFourth: { position: { x: 0, y: 540 }, size: { width: 1920, height: 270 } },
    topLastFourth: { position: { x: 0, y: 810 }, size: { width: 1920, height: 270 } },
    topLeftQuarter: { position: { x: 0, y: 0 }, size: { width: 960, height: 540 } },
    topRightQuarter: { position: { x: 960, y: 0 }, size: { width: 960, height: 540 } },
    bottomLeftQuarter: { position: { x: 0, y: 540 }, size: { width: 960, height: 540 } },
    bottomRightQuarter: { position: { x: 960, y: 540 }, size: { width: 960, height: 540 } },
    topLeftSixth: { position: { x: 0, y: 0 }, size: { width: 640, height: 540 } },
    topCenterSixth: { position: { x: 640, y: 0 }, size: { width: 640, height: 540 } },
    topRightSixth: { position: { x: 1280, y: 0 }, size: { width: 640, height: 540 } },
    bottomLeftSixth: { position: { x: 0, y: 540 }, size: { width: 640, height: 540 } },
    bottomCenterSixth: { position: { x: 640, y: 540 }, size: { width: 640, height: 540 } },
    bottomRightSixth: { position: { x: 1280, y: 540 }, size: { width: 640, height: 540 } },
    centerHalf: { position: { x: 480, y: 0 }, size: { width: 960, height: 1080 } },
    center: { position: { x: 560, y: 240 } },
    moveLeft: { position: { x: 0, y: 240 } },
    moveRight: { position: { x: 1120, y: 240 } },
    moveTop: { position: { x: 560, y: 0 } },
    moveBottom: { position: { x: 560, y: 480 } },
    makeSmaller: { position: { x: 116, y: 116 }, size: { width: 768, height: 568 } },
    makeLarger: { position: { x: 84, y: 84 }, size: { width: 832, height: 632 } },
    maximizeAlmost: { position: { x: 96, y: 54 }, size: { width: 1728, height: 972 } },
    reasonableSize: { position: { x: 448, y: 216 }, size: { width: 1024, height: 648 } },
    maximizeHeight: { position: { y: 0 }, size: { height: 1080 } },
    maximizeWidth: { position: { x: 0 }, size: { width: 1920 } },
  };
  for (const [key, want] of Object.entries(expected)) {
    const geometry = WM_GEOMETRY[key];
    assert.ok(geometry, `${key} has no geometry`);
    assert.deepEqual(geometry(ctx), want, `${key} rect`);
  }
});

test("odd desktop widths keep the shipped floor semantics", () => {
  const odd = { ...DISPLAY_1920, width: 1921 };
  const ctx = context({ x: 0, y: 0, width: 400, height: 300 }, odd);
  assert.deepEqual(WM_GEOMETRY.leftHalf(ctx), { position: { x: 0, y: 0 }, size: { width: 960, height: 1080 } });
  assert.equal(WM_GEOMETRY.rightHalf(ctx).position.x, 961);
  assert.equal(WM_GEOMETRY.firstThird(ctx).size.width, 640);
  assert.equal(WM_GEOMETRY.firstTwoThird(ctx).size.width, 1280);
  // Center Half uses the raw half (960.5), unlike Left Half's floor — the shipped `ab`.
  const half = WM_GEOMETRY.centerHalf(ctx);
  assert.equal(half.size.width, 960.5);
  assert.equal(half.position.x, 480);
});

test("gap math insets flush edges by outerGap and internal edges by innerGap/2", () => {
  const gaps = { innerGap: 16, outerGap: 8 };
  const ctx = context({ x: 100, y: 100, width: 800, height: 600 });
  const left = applyCommandGaps(WM_GEOMETRY.leftHalf(ctx), ctx, gaps);
  assert.deepEqual(left, { position: { x: 8, y: 8 }, size: { width: 944, height: 1064 } });
  const right = applyCommandGaps(WM_GEOMETRY.rightHalf(ctx), ctx, gaps);
  assert.deepEqual(right, { position: { x: 968, y: 8 }, size: { width: 944, height: 1064 } });
  // The two halves sit innerGap apart in total (innerGap/2 on each facing edge).
  assert.equal(right.position.x - (left.position.x + left.size.width), gaps.innerGap);
  const maximized = applyCommandGaps(WM_GEOMETRY.maximize(ctx), ctx, gaps);
  assert.deepEqual(maximized, { position: { x: 8, y: 8 }, size: { width: 1904, height: 1064 } });
  // Position-only commands keep their position unless an edge is flush (moveLeft sits at outerGap).
  const centered = applyCommandGaps(WM_GEOMETRY.center(ctx), ctx, gaps);
  assert.deepEqual(centered, { position: { x: 560, y: 240 } });
  const moved = applyCommandGaps(WM_GEOMETRY.moveLeft(ctx), ctx, gaps);
  assert.deepEqual(moved, { position: { x: 8, y: 240 } });
});

test("a gap-collapsed explicit size skips the command unchanged", () => {
  const gaps = { innerGap: 2000, outerGap: 100 };
  const ctx = context({ x: 100, y: 100, width: 800, height: 600 });
  const rect = WM_GEOMETRY.leftHalf(ctx);
  assert.equal(applyCommandGaps(rect, ctx, gaps), rect);
});

test("clamping pulls off-screen windows back unless the command allows oversize", () => {
  const work = { width: 1920, height: 1080 };
  const current = { x: 100, y: 100, width: 800, height: 600 };
  const oversized = clampRect({ position: { x: -50, y: -10 }, size: { width: 2000, height: 1200 } }, work, current);
  assert.deepEqual(oversized, { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } });
  const kept = clampRect({ position: { x: -50, y: -10 }, size: { width: 2000, height: 1200 }, allowOversize: true }, work, current);
  assert.deepEqual(kept, { position: { x: 0, y: 0 }, size: { width: 2000, height: 1200 } });
  const nudged = clampRect({ position: { x: 1700, y: 900 }, size: { width: 400, height: 300 } }, work, current);
  assert.deepEqual(nudged, { position: { x: 1520, y: 780 }, size: { width: 400, height: 300 } });
});

test("cross-display moves scale position and size by the work-area ratios", () => {
  const scaled = scaleRectForDisplay(
    { position: { x: 0, y: 0 }, size: { width: 960, height: 1080 } },
    DISPLAY_1920,
    DISPLAY_2560,
    true,
  );
  assert.deepEqual(scaled, { position: { x: 0, y: 0 }, size: { width: 1280, height: 1440 } });
  const moved = scaleRectForDisplay(
    { position: { x: 480, y: 270 }, size: { width: 960, height: 1080 } },
    DISPLAY_1920,
    DISPLAY_2560,
    true,
  );
  assert.deepEqual(moved, { position: { x: 640, y: 360 }, size: { width: 1280, height: 1440 } });
  const unscaled = scaleRectForDisplay(
    { position: { x: 480, y: 270 }, size: { width: 960, height: 1080 } },
    DISPLAY_1920,
    DISPLAY_2560,
    false,
  );
  assert.deepEqual(unscaled, { position: { x: 480, y: 270 }, size: { width: 960, height: 1080 } });
});

test("display lookup walks the sorted list and wraps only when allowed", () => {
  const displays = [DISPLAY_1920, DISPLAY_2560];
  assert.equal(findNextDisplay(displays, DISPLAY_1920, false), DISPLAY_2560);
  assert.equal(findNextDisplay(displays, DISPLAY_2560, false), null);
  assert.equal(findNextDisplay(displays, DISPLAY_2560, true), DISPLAY_1920);
  assert.equal(findPreviousDisplay(displays, DISPLAY_2560, false), DISPLAY_1920);
  assert.equal(findPreviousDisplay(displays, DISPLAY_1920, false), null);
  assert.equal(findPreviousDisplay(displays, DISPLAY_1920, true), DISPLAY_2560);
});

test("sizes cycling walks base → two-thirds → one-third → base and resets on drift", () => {
  resetCyclingState();
  const pair = CYCLING.leftHalf;
  let bounds = { x: 100, y: 100, width: 800, height: 600 };
  const ctx = () => context(bounds);
  const apply = (rect) => {
    const full = {
      x: rect.position?.x ?? bounds.x,
      y: rect.position?.y ?? bounds.y,
      width: rect.size?.width ?? bounds.width,
      height: rect.size?.height ?? bounds.height,
    };
    bounds = { x: full.x, y: full.y, width: full.width, height: full.height };
    return rect;
  };
  assert.deepEqual(apply(cycleSizes(ctx(), "leftHalf", ...pair.sizes)), { position: { x: 0, y: 0 }, size: { width: 960, height: 1080 } });
  assert.deepEqual(apply(cycleSizes(ctx(), "leftHalf", ...pair.sizes)), { position: { x: 0, y: 0 }, size: { width: 1280, height: 1080 } });
  assert.deepEqual(apply(cycleSizes(ctx(), "leftHalf", ...pair.sizes)), { position: { x: 0, y: 0 }, size: { width: 640, height: 1080 } });
  assert.deepEqual(apply(cycleSizes(ctx(), "leftHalf", ...pair.sizes)), { position: { x: 0, y: 0 }, size: { width: 960, height: 1080 } });
  // The window moved by something else: the next press restarts at the base preset.
  bounds = { x: 200, y: 200, width: 300, height: 300 };
  assert.deepEqual(apply(cycleSizes(ctx(), "leftHalf", ...pair.sizes)), { position: { x: 0, y: 0 }, size: { width: 960, height: 1080 } });
  resetCyclingState();
});

test("displays cycling moves the mirrored geometry to the adjacent display", () => {
  resetCyclingState();
  const pair = CYCLING.leftHalf;
  const displays = [DISPLAY_1920, DISPLAY_2560];
  let bounds = { x: 100, y: 100, width: 800, height: 600 };
  const ctx = (desktop) => context(bounds, desktop, displays);
  const first = cycleDisplays(ctx(DISPLAY_1920), "leftHalf", pair.displays[0], pair.displays[1], pair.displays[2]);
  assert.deepEqual(first, { position: { x: 0, y: 0 }, size: { width: 960, height: 1080 } });
  bounds = { x: 0, y: 0, width: 960, height: 1080 };
  const second = cycleDisplays(ctx(DISPLAY_1920), "leftHalf", pair.displays[0], pair.displays[1], pair.displays[2]);
  // Shipped pairing: Left Half's second press lands as the RIGHT half of the previous display.
  assert.deepEqual(second, { position: { x: 1280, y: 0 }, size: { width: 1280, height: 1440 }, displayIndex: 1 });
  bounds = { x: 1280, y: 0, width: 1280, height: 1440 };
  const third = cycleDisplays(ctx(DISPLAY_2560), "leftHalf", pair.displays[0], pair.displays[1], pair.displays[2]);
  assert.deepEqual(third, { position: { x: 0, y: 0 }, size: { width: 1280, height: 1440 } });
  resetCyclingState();
});

test("the shipped displays-cycle directions pair left/top→previous with mirrored geometry, right/bottom→next", () => {
  // Directions verified against the shipped gb calls: leftHalf/bottomHalf → Ef (previous),
  // rightHalf/topHalf → vf (next); the geometry mirror is asserted by the displays-cycling test.
  assert.equal(CYCLING.leftHalf.displays[2], findPreviousDisplay);
  assert.equal(CYCLING.bottomHalf.displays[2], findPreviousDisplay);
  assert.equal(CYCLING.rightHalf.displays[2], findNextDisplay);
  assert.equal(CYCLING.topHalf.displays[2], findNextDisplay);
  assert.equal(CYCLING.leftHalf.displays[1], WM_GEOMETRY.rightHalf);
  assert.equal(CYCLING.rightHalf.displays[1], WM_GEOMETRY.leftHalf);
  assert.equal(CYCLING.topHalf.displays[1], WM_GEOMETRY.bottomHalf);
  assert.equal(CYCLING.bottomHalf.displays[1], WM_GEOMETRY.topHalf);
});

test("argument parsing uses the shipped regexes and coordinate ceiling", () => {
  assert.deepEqual(parseSizeArgs("800", "600"), { width: 800, height: 600 });
  assert.equal(parseSizeArgs("abc", "600"), null);
  assert.equal(parseSizeArgs("0", "600"), null);
  assert.equal(parseSizeArgs("32768", "600"), null);
  assert.equal(parseSizeArgs("-100", "600"), null);
  assert.deepEqual(parsePositionArgs("100,100"), { x: 100, y: 100 });
  assert.deepEqual(parsePositionArgs("100 100"), { x: 100, y: 100 });
  assert.deepEqual(parsePositionArgs("100x100"), { x: 100, y: 100 });
  assert.deepEqual(parsePositionArgs("100×100"), { x: 100, y: 100 });
  assert.deepEqual(parsePositionArgs("+50 , -20"), { x: 50, y: -20 });
  assert.equal(parsePositionArgs("100"), null);
  assert.equal(parsePositionArgs("100,100,100"), null);
  assert.equal(parsePositionArgs("99999,1"), null);
});

test("presets on a 2560×1440 desktop scale with the work area", () => {
  const ctx = context({ x: 0, y: 0, width: 1280, height: 720 }, DISPLAY_2560);
  assert.equal(WM_GEOMETRY.firstThird(ctx).size.width, 853);
  assert.deepEqual(WM_GEOMETRY.leftHalf(ctx), { position: { x: 0, y: 0 }, size: { width: 1280, height: 1440 } });
});
