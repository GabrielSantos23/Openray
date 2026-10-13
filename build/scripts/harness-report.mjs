// The compatibility harness (docs/store-implementation-plan.md §7, M5).
//
// Runs the real pipeline end to end for the candidate Store extensions: pin the catalog commit,
// fetch each manifest, skip non-Windows listings, install through the store module (sparse
// checkout -> npm install -> esbuild -> classification), then launch every command the
// classifier marked compatible in a real worker. Disabled commands are never launched.
//
// Network is used for exactly what the task allows: the catalog, the extension sources and the
// extensions' own dependencies. Everything else is local.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const buildRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const API_ROOT = path.join(buildRoot, "api");
const { createBackend } = require(path.join(buildRoot, "backend", "src", "backend.js"));
const { createStore } = require(path.join(buildRoot, "backend", "src", "store.js"));

/**
 * Harness candidates (plan §7 themes mapped onto extensions that actually declare Windows in the
 * catalog at the pinned commit; several of the plan's example handles do not exist upstream or
 * are macOS-only — the substitution is part of the report):
 *
 *   plain views/prefs: google-translate, urban-dictionary, emoji-kitchen, currency-exchange,
 *     password-generator, modify-hash, unirate-currency, one-time-password, windows-terminal
 *   arguments/no-view: kill-process
 *   OAuth imports: github
 *   AppleScript (macOS) usage: spotify-player
 *   AI usage: chatgpt, ai-usage-tracker, ai-stats
 */
export const CANDIDATES = [
  "google-translate",
  "urban-dictionary",
  "emoji-kitchen",
  "currency-exchange",
  "password-generator",
  "modify-hash",
  "unirate-currency",
  "one-time-password",
  "windows-terminal",
  "kill-process",
  "github",
  "spotify-player",
  "chatgpt",
  "ai-usage-tracker",
  "ai-stats",
];

const LAUNCH_TIMEOUT_MS = 30000;

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "RaycastMini-harness" } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "RaycastMini-harness" } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

/**
 * Run the harness. `candidates` defaults to the plan list. Returns the full report; the caller
 * (test or CLI) formats it.
 */
export async function runHarness({ candidates = CANDIDATES, onEvent = () => undefined } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "store-harness-"));
  const extensionsRoot = path.join(scratch, "extensions");
  const dataRoot = path.join(scratch, "data");
  fs.mkdirSync(extensionsRoot);
  fs.mkdirSync(dataRoot);

  // Pin the catalog commit the way the Store does.
  onEvent({ type: "pin" });
  const branch = await fetchJson("https://api.github.com/repos/raycast/extensions/branches/main");
  const commit = branch.commit.sha;
  onEvent({ type: "pinned", commit });

  const store = createStore({
    dataRoot,
    extensionsRoot,
    apiRoot: API_ROOT,
    pushToFrontend: async () => undefined,
  });
  // Pin the commit and index only the candidates (the full catalog refresh is the Store's job,
  // exercised by the Store UI, not by the harness).
  store.db
    .prepare("INSERT INTO catalog_meta (key, value) VALUES ('commit_sha', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(commit);

  const backend = createBackend({ pipeName: "store-harness", apiRoot: API_ROOT, extensionsRoot });
  let renderCount = 0;
  backend.setTransport(async (_module, method) => {
    if (method === "extensionHost.render") renderCount += 1;
    return undefined;
  });
  backend.setLaunchGate(async (extension, command) => {
    store.assertLaunchable(extension.uuid, command.name, command.title);
  });

  const report = { commit, extensions: [], startedAt: new Date().toISOString() };
  const waitForRender = (baseline) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
      const poll = () => {
        if (renderCount > baseline) return resolve();
        if (Date.now() > deadline) return reject(new Error(`no render within ${LAUNCH_TIMEOUT_MS}ms`));
        setTimeout(poll, 250);
      };
      poll();
    });

  for (const handle of candidates) {
    const entry = { handle, status: null, commands: [], note: null };
    report.extensions.push(entry);
    onEvent({ type: "extension", handle });
    try {
      // Manifest at the pinned commit decides the platform skip before anything downloads, and
      // seeds the catalog row the installer's pre-download gate reads.
      const manifestText = await fetchText(`https://raw.githubusercontent.com/raycast/extensions/${commit}/extensions/${handle}/package.json`);
      const manifest = JSON.parse(manifestText);
      const platforms = manifest.platforms ?? [];
      store.db
        .prepare(
          `INSERT INTO catalog_extensions (handle, name, title, description, author, categories, platforms, version, updated_at, commands_json, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(handle) DO UPDATE SET platforms=excluded.platforms, title=excluded.title, version=excluded.version, updated_at=excluded.updated_at`,
        )
        .run(
          handle, manifest.name ?? handle, manifest.title ?? handle, manifest.description ?? "",
          typeof manifest.author === "object" ? manifest.author?.name ?? handle : manifest.author ?? "unknown",
          JSON.stringify(manifest.categories ?? []), JSON.stringify(platforms),
          String(manifest.updated_at ?? ""), typeof manifest.updated_at === "number" ? manifest.updated_at : null,
          JSON.stringify(manifest.commands ?? []), Date.now(),
        );
      if (!platforms.includes("Windows")) {
        entry.status = "skipped";
        entry.note = `platforms=[${platforms.join(", ") || "none (macOS-only)"}]`;
        continue;
      }

      let installed;
      try {
        installed = await store.handlers.install({ handle, confirmed: true, commitSha: commit });
      } catch (error) {
        entry.status = "install-failed";
        entry.note = String(error?.message ?? error).split("\n")[0].slice(0, 300);
        continue;
      }

      entry.status = installed.classification.installable ? "installed" : "installed-not-installable";
      entry.badge = installed.classification.badge;

      const classifications = store.handlers.getClassifications({ handle }).commands;
      for (const command of manifest.commands ?? []) {
        const classification = classifications.find((row) => row.command_name === command.name);
        const commandReport = {
          name: command.name,
          title: command.title,
          mode: command.mode ?? "view",
          class: classification?.class ?? "unclassified",
          reason: classification?.reason ?? null,
          harness: null,
          note: null,
        };
        entry.commands.push(commandReport);
        if (!classification || classification.class !== "compatible") {
          commandReport.harness = "disabled-by-policy";
          continue;
        }
        // Launch in a real worker; compatible commands must load.
        const extensionSummary = {
          uuid: handle,
          name: manifest.name,
          title: manifest.title,
          author: manifest.author,
          icon: manifest.icon,
          commands: manifest.commands,
          assetsPath: path.join(extensionsRoot, handle, "assets"),
        };
        try {
          // The first render ships DURING initialize (before loadCommand resolves), so the
          // baseline is captured before the launch.
          const renderBaseline = renderCount;
          const response = await withTimeout(
            backend.dispatchMessage("backend", "extensionHost.loadCommand", {
              extension: extensionSummary,
              command: { name: command.name, title: command.title, mode: command.mode ?? "view", type: "command" },
              preferences: {},
              props: {},
            }),
            LAUNCH_TIMEOUT_MS,
            `launch timed out after ${LAUNCH_TIMEOUT_MS}ms`,
          );
          // View commands must produce a first render; no-view commands complete initialize.
          if ((command.mode ?? "view") === "view") {
            await waitForRender(renderBaseline);
            commandReport.harness = "pass";
          } else {
            commandReport.harness = "pass";
            commandReport.note = "no-view: initialize completed";
          }
          await backend.dispatchMessage("backend", "extensionHost.unloadEntryPoint", { sessionId: response.sessionId }).catch(() => undefined);
        } catch (error) {
          const message = String(error?.message ?? error);
          // A compatible command that parks on OAuth sign-in is honest headless behavior, not a
          // failure: the flow needs the app UI (browser + redirect).
          if (/OAuth sign-in is unavailable in headless mode/.test(message)) {
            commandReport.harness = "auth-required";
            commandReport.note = message.split("\n")[0].slice(0, 300);
          } else {
            commandReport.harness = "fail";
            commandReport.note = message.split("\n")[0].slice(0, 300);
          }
        }
      }
    } catch (error) {
      entry.status = entry.status ?? "error";
      entry.note = String(error?.message ?? error).split("\n")[0].slice(0, 300);
    }
  }

  report.finishedAt = new Date().toISOString();
  store.close();
  // The sparse cache can be large; a relaxed retry rides out Windows handle latency.
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  return report;
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** CLI entry: `node build/scripts/harness-report.mjs [handle ...]` prints the report. */
if (process.argv[1] && process.argv[1].endsWith("harness-report.mjs")) {
  const candidates = process.argv.slice(2);
  runHarness({ candidates: candidates.length > 0 ? candidates : CANDIDATES }).then((report) => {
    console.log(JSON.stringify(report, null, 2));
    const failed = report.extensions.some((entry) =>
      entry.commands.some((command) => command.harness === "fail"));
    process.exit(failed ? 1 : 0);
  }).catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
