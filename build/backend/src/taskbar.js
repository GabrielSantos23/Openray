// Taskbar handler — the `taskbar.*` namespace (docs/focus-games-taskbar-spec.md §C).
//
// The shipped extension persists `showTaskbar` (default false) and `position` (default bottom);
// `toggleTaskbar` shows or hides the strip with the `Taskbar Window Shown` / `Taskbar Window
// Hidden` toasts. The strip itself is a native AppBar window in the host; this store owns the
// settings and forwards every change (`taskbar.show`/`taskbar.hide`/`taskbar.setPosition`).

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const POSITIONS = ["top", "bottom", "left", "right"];
const DEFAULT_SETTINGS = { showTaskbar: false, position: "bottom" };

function createTaskbar({ dispatch, dataRoot } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "Openray");
  const settingsPath = path.join(root, "taskbar-settings.json");

  fs.mkdirSync(root, { recursive: true });

  let settings = { ...DEFAULT_SETTINGS };
  try {
    Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath, "utf-8")));
  } catch {
    /* first run keeps the defaults */
  }

  function persistSettings() {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error("[taskbar] could not persist settings", error);
    }
  }

  function hostCall(method, data) {
    if (typeof dispatch !== "function") return;
    Promise.resolve(dispatch(method, data)).catch((error) => console.error(`[taskbar] ${method} failed`, error));
  }

  const handlers = {
    getSettings: () => ({ ...settings }),
    setSetting: (data) => {
      const key = String(data?.key ?? "");
      if (key === "position") {
        const position = String(data?.value ?? "bottom");
        if (!POSITIONS.includes(position)) throw new Error(`Unknown taskbar position: ${position}`);
        settings.position = position;
        hostCall("taskbar.setPosition", { position });
      } else if (key === "showTaskbar") {
        settings.showTaskbar = data?.value === true;
        hostCall(settings.showTaskbar ? "taskbar.show" : "taskbar.hide", {});
      } else {
        throw new Error(`Unknown taskbar setting: ${key}`);
      }
      persistSettings();
      return { ...settings };
    },
    toggle: () => {
      settings.showTaskbar = !settings.showTaskbar;
      persistSettings();
      hostCall(settings.showTaskbar ? "taskbar.show" : "taskbar.hide", {});
      return { visible: settings.showTaskbar, ...settings };
    },
  };

  return {
    handlers,
    /** Applied at backend start so `showTaskbar: true` re-appears after an app restart. */
    pushSettingsToHost() {
      hostCall(settings.showTaskbar ? "taskbar.show" : "taskbar.hide", {});
      if (settings.position !== DEFAULT_SETTINGS.position) {
        hostCall("taskbar.setPosition", { position: settings.position });
      }
    },
  };
}

module.exports = { createTaskbar };
