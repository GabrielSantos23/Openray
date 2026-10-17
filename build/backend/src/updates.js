"use strict";

// App update check (`updates.*`): the launcher compares its own version against the latest
// GitHub Release of this repository and, when one is newer, reports it to the renderer so the
// root search shows the "New Update Available" card (docs/updates.md). `updates.install`
// downloads the release's `.zip` asset into a temp folder and reveals it in Explorer — the
// user runs the installer themselves; the app never replaces its own files at runtime.
//
// Scheduling mirrors Raycast's update agent: one check shortly after boot, then every six
// hours while the backend lives. Every state change is pushed to the renderer
// (`updates.changed`) so the card appears without a reload.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// Keep in sync with build/host/Openray.csproj `<Version>` and build/frontend/package.json —
// the release process bumps all three (docs/updates.md).
const APP_VERSION = "2.4.0.0";
const DEFAULT_REPO = "GabrielSantos23/Openray";

const BOOT_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** `"2.4.1.0"` -> `[2, 4, 1, 0]`; unknown segments are 0, so `2.4` == `2.4.0.0`. */
function parseVersion(version) {
  return String(version ?? "")
    .trim()
    .replace(/^v/i, "")
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

/** True when `latest` is strictly newer than `current` (numeric segments, 2.10 > 2.9). */
function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/** The `.zip` asset a release must carry (the workflow uploads exactly one); on multi-asset
 *  releases prefer a 64-bit Windows zip, then any Windows zip, then any zip. */
function pickZipAsset(assets) {
  if (!Array.isArray(assets)) return null;
  const zips = assets.filter((asset) => /\.zip$/i.test(String(asset?.name ?? "")));
  return (
    zips.find((asset) => /windows.*(amd64|x64)|(amd64|x64).*windows/i.test(String(asset?.name ?? ""))) ??
    zips.find((asset) => /win/i.test(String(asset?.name ?? ""))) ??
    zips[0] ??
    null
  );
}

function createUpdates(options = {}) {
  const {
    dispatch,
    pushToFrontend,
    fetchImpl,
    appVersion = APP_VERSION,
    repo = process.env.OPENRAY_UPDATE_REPO ?? DEFAULT_REPO,
    dataRoot = process.env.OPENRAY_DATA_DIR ?? path.join(os.tmpdir(), "Openray"),
    now = () => Date.now(),
  } = options;

  const statePath = path.join(dataRoot, "updates-state.json");
  const state = {
    available: false,
    checking: false,
    currentVersion: appVersion,
    latestVersion: null,
    url: null,
    downloadUrl: null,
    assetName: null,
    notes: null,
    publishedAt: null,
    lastCheckedAt: null,
    lastError: null,
    skippedVersion: null,
  };

  // The user may skip a version ("Skip This Version" action); the choice outlives restarts.
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (typeof saved?.skippedVersion === "string") state.skippedVersion = saved.skippedVersion;
  } catch {
    /* first run */
  }

  let checkTimer = null;
  let intervalTimer = null;
  let closed = false;

  function snapshot() {
    return { ...state };
  }

  function push() {
    try {
      pushToFrontend?.("updates.changed", snapshot());
    } catch {
      /* renderer pushes are fire-and-forget */
    }
  }

  function persist() {
    try {
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.writeFileSync(statePath, `${JSON.stringify({ skippedVersion: state.skippedVersion }, null, 2)}\n`);
    } catch {
      /* best effort */
    }
  }

  function applyRelease(release) {
    const asset = pickZipAsset(release?.assets);
    state.latestVersion = String(release?.tag_name ?? "").trim() || null;
    state.url = String(release?.html_url ?? "") || null;
    state.downloadUrl = asset ? String(asset.browser_download_url ?? "") || null : null;
    state.assetName = asset ? String(asset.name) : null;
    state.notes = typeof release?.body === "string" && release.body.trim() !== "" ? release.body : null;
    state.publishedAt = typeof release?.published_at === "string" ? release.published_at : null;
    const newer =
      state.latestVersion !== null &&
      isNewerVersion(state.latestVersion, appVersion) &&
      state.latestVersion !== state.skippedVersion;
    state.available = Boolean(newer);
    state.lastCheckedAt = now();
    state.lastError = null;
  }

  async function runCheck() {
    if (closed || state.checking) return snapshot();
    state.checking = true;
    push();
    try {
      const doFetch = fetchImpl ?? fetch;
      const response = await doFetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Openray" },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) {
        // No releases yet: not an error, just nothing to show.
        state.latestVersion = null;
        state.available = false;
        state.lastCheckedAt = now();
        state.lastError = null;
      } else if (!response.ok) {
        throw new Error(`GitHub API HTTP ${response.status}`);
      } else {
        applyRelease(await response.json());
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      state.lastCheckedAt = now();
    } finally {
      state.checking = false;
      push();
    }
    return snapshot();
  }

  function schedule() {
    checkTimer = setTimeout(() => {
      void runCheck();
    }, BOOT_DELAY_MS);
    checkTimer.unref?.();
    intervalTimer = setInterval(() => {
      void runCheck();
    }, CHECK_INTERVAL_MS);
    intervalTimer.unref?.();
  }

  const handlers = {
    /** Current update state for the renderer's boot render. */
    getState() {
      return snapshot();
    },

    /** Force a check now (also runs on the boot delay + 6h interval). */
    async check() {
      return runCheck();
    },

    /** Ignore `version` until a newer release appears (persisted across restarts). */
    async skipVersion(params) {
      const version = String(params?.version ?? state.latestVersion ?? "").trim();
      if (version === "") throw new Error("skipVersion: a version is required");
      state.skippedVersion = version;
      if (state.latestVersion === version) state.available = false;
      persist();
      push();
      return snapshot();
    },

    /** Download the release asset into `%TEMP%\Openray-update\` and reveal it in Explorer. */
    async install() {
      if (!state.available || !state.downloadUrl) {
        throw new Error("install: no update available");
      }
      const targetDir = path.join(os.tmpdir(), "Openray-update");
      fs.mkdirSync(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, state.assetName ?? `Openray-${state.latestVersion}.zip`);
      const doFetch = fetchImpl ?? fetch;
      const response = await doFetch(state.downloadUrl, {
        headers: { "User-Agent": "Openray", Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
      if (!response.body) throw new Error("download failed: empty response body");
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(targetPath));
      try {
        await dispatch?.("backend", "shell.revealFile", { path: targetPath });
      } catch {
        /* headless mode has no host; the file is still there */
      }
      return { path: targetPath, size: fs.statSync(targetPath).size, url: state.url };
    },
  };

  return { handlers, schedule, snapshot, close() { closed = true; if (checkTimer) clearTimeout(checkTimer); if (intervalTimer) clearInterval(intervalTimer); } };
}

module.exports = { createUpdates, parseVersion, isNewerVersion, pickZipAsset, APP_VERSION, DEFAULT_REPO };
