// Advanced handler — the `advanced.*` namespace: Raycast's Export section (manual export/import
// with an optional passphrase, scheduled backups with auto-delete and the skip-on-battery guard)
// plus the Connection preferences applied to this process (system proxy, extra CA). Export files
// are AES-256-GCM encrypted when a passphrase is set (scrypt-derived key), plain JSON otherwise.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SETTINGS_FILE = "advanced-export.json";
const SCHEDULE_MS = { off: 0, daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000, monthly: 30 * 24 * 60 * 60 * 1000 };

const DEFAULTS = {
  scheduled: "off",
  location: "",
  autoDelete: "never",
  skipOnBattery: false,
  passphrase: "",
  lastExportAt: 0,
};

function createAdvanced({ dispatch, dataRoot, settings } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "RaycastMini");
  const settingsPath = path.join(root, "store", "settings.json");
  const prefsPath = path.join(root, SETTINGS_FILE);

  fs.mkdirSync(root, { recursive: true });

  let prefs = { ...DEFAULTS };
  try {
    Object.assign(prefs, JSON.parse(fs.readFileSync(prefsPath, "utf-8")));
  } catch {
    /* first run keeps the defaults */
  }

  function persistPrefs() {
    try {
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
    } catch (error) {
      console.error("[advanced] could not persist export preferences", error);
    }
  }

  function readStoreSettings() {
    if (settings?.getAll) return settings.getAll();
    try {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      return {};
    }
  }

  function readStoreMapKey(key) {
    // Legacy renderer mirrors (aliases/hotkeys) ride along in the same document as JSON strings.
    return readStoreSettings()[key];
  }

  function encrypt(plain, passphrase) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(passphrase, salt, 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
    return {
      format: "raycast-mini-export",
      version: 1,
      encrypted: true,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      payload: data.toString("base64"),
    };
  }

  function decrypt(document, passphrase) {
    if (!document.encrypted) return document.payload;
    const key = crypto.scryptSync(passphrase, Buffer.from(document.salt, "base64"), 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(document.iv, "base64"));
    decipher.setAuthTag(Buffer.from(document.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(document.payload, "base64")), decipher.final()]).toString("utf-8");
  }

  function buildBundle() {
    return {
      format: "raycast-mini-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: readStoreSettings(),
      mirrors: {
        "command-aliases": readStoreMapKey("command-aliases") ?? null,
        "command-hotkeys": readStoreMapKey("command-hotkeys") ?? null,
        "app-aliases": readStoreMapKey("app-aliases") ?? null,
        "quicklink-aliases": readStoreMapKey("quicklink-aliases") ?? null,
        "shortcuts-disabled": readStoreMapKey("shortcuts-disabled") ?? null,
      },
    };
  }

  function pruneBackups(directory) {
    if (prefs.autoDelete === "never") return 0;
    const keep = prefs.autoDelete === "1" ? 1 : Number(prefs.autoDelete) || 0;
    const files = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith("raycast-mini-settings-") && name.endsWith(".json"))
      .sort()
      .reverse();
    let removed = 0;
    for (const name of files.slice(keep)) {
      try {
        fs.unlinkSync(path.join(directory, name));
        removed++;
      } catch {
        /* best effort */
      }
    }
    return removed;
  }

  async function runExport({ passphrase, directory } = {}) {
    let target = directory || prefs.location;
    if (!target && typeof dispatch === "function") {
      const picked = await dispatch("fileSystem.showSelectFolderDialog", { title: "Choose Backup Location" });
      target = picked?.path ?? null;
    }
    if (!target) return { ok: false, cancelled: true };
    const plain = JSON.stringify(buildBundle(), null, 2);
    const secret = passphrase ?? prefs.passphrase ?? "";
    const document = secret ? encrypt(plain, secret) : JSON.parse(plain);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(target, `raycast-mini-settings-${stamp}.json`);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(document, null, 2));
    prefs.location = target;
    prefs.lastExportAt = Date.now();
    persistPrefs();
    const removed = pruneBackups(target);
    return { ok: true, file, removed };
  }

  function onBattery() {
    if (typeof dispatch !== "function") return false;
    return dispatch("system.powerStatus", {})
      .then((status) => status?.onBattery === true)
      .catch(() => false);
  }

  async function scheduledTick() {
    const interval = SCHEDULE_MS[prefs.scheduled] ?? 0;
    if (interval === 0) return;
    if (Date.now() - (prefs.lastExportAt ?? 0) < interval) return;
    if (prefs.skipOnBattery && (await onBattery())) return;
    if (!prefs.location) return;
    await runExport({});
  }

  const timer = setInterval(() => {
    Promise.resolve(scheduledTick()).catch((error) => console.error("[advanced] scheduled export failed", error));
  }, 5 * 60 * 1000);
  timer.unref?.();

  const handlers = {
    getExportPreferences: () => ({ ...prefs }),
    setExportPreferences: (data) => {
      if (data?.scheduled !== undefined) {
        const value = String(data.scheduled);
        if (!(value in SCHEDULE_MS)) throw new Error("Unknown backup schedule");
        prefs.scheduled = value;
      }
      if (data?.location !== undefined) prefs.location = String(data.location ?? "");
      if (data?.autoDelete !== undefined) {
        const value = String(data.autoDelete);
        if (!["never", "1", "5", "10"].includes(value)) throw new Error("Unknown auto-delete policy");
        prefs.autoDelete = value;
      }
      if (data?.skipOnBattery !== undefined) prefs.skipOnBattery = data.skipOnBattery === true;
      if (data?.passphrase !== undefined) prefs.passphrase = String(data.passphrase ?? "");
      persistPrefs();
      return { ...prefs };
    },
    exportNow: (data) => Promise.resolve(runExport(data ?? {})),
    importFromFile: async (data) => {
      let file = data?.file ?? null;
      if (!file && typeof dispatch === "function") {
        const picked = await dispatch("fileSystem.showOpenFileDialog", {
          title: "Import Settings",
          filters: [{ name: "RaycastMini export", extensions: ["json"] }],
        });
        file = picked?.path ?? null;
      }
      if (!file) return { ok: false, cancelled: true };
      const document = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (document?.format !== "raycast-mini-export") throw new Error("Not a RaycastMini settings export");
      const plain = decrypt(document, data?.passphrase ?? prefs.passphrase ?? "");
      const bundle = typeof plain === "string" ? JSON.parse(plain) : plain;
      const imported = { settings: bundle.settings ?? {}, mirrors: bundle.mirrors ?? {} };
      // Merge through the settings store so both windows receive the `settings.changed` push.
      if (settings?.set) {
        settings.set(imported.settings);
        for (const [key, value] of Object.entries(imported.mirrors)) {
          if (value !== null && value !== undefined) {
            settings.set({ [key]: typeof value === "string" ? value : JSON.stringify(value) });
          }
        }
      } else {
        fs.writeFileSync(settingsPath, JSON.stringify({ ...readStoreSettings(), ...imported.settings }, null, 2));
      }
      return { ok: true, keys: Object.keys(imported.settings).length };
    },
  };

  function bootstrap() {
    // Connection preferences apply to this process at boot; the host ones are pushed like Game Mode.
    const store = readStoreSettings();
    if (store["additional-certificate-authorities"]) {
      process.env.NODE_EXTRA_CA_CERTS = String(store["additional-certificate-authorities"]);
    }
    if (store["use-system-proxy-settings"] === true) {
      try {
        const { execSync } = require("node:child_process");
        const out = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
          { encoding: "utf-8" },
        );
        const match = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out);
        if (match) {
          const proxy = match[1].startsWith("http") ? match[1] : `http://${match[1]}`;
          process.env.HTTPS_PROXY = proxy;
          process.env.HTTP_PROXY = proxy;
          try {
            const { EnvHttpProxyAgent, setGlobalDispatcher } = require("undici");
            setGlobalDispatcher(new EnvHttpProxyAgent());
          } catch {
            /* older undici: env vars still cover most clients */
          }
        }
      } catch {
        /* no system proxy configured */
      }
    }
    if (typeof dispatch === "function") {
      const behavior = store["window-activation-behavior"] === "Switch Space" ? "switch" : "move";
      Promise.resolve(dispatch("applications.setActivationBehavior", { behavior })).catch(() => undefined);
      Promise.resolve(
        dispatch("shell.setOpenUrlPreferences", {
          preferExistingTabs: store["quicklinks-prefer-existing-tabs"] === true,
        }),
      ).catch(() => undefined);
    }
    void scheduledTick();
  }

  return { handlers, bootstrap };
}

module.exports = { createAdvanced };
