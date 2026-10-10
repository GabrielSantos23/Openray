// Clipboard history handler — the `handler::clipboard-history` table in Raycast's backend.
//
// The renderer talks to this the way it talks to Raycast's frontend bundle:
// `ipc.backend.clipboard.<method>` with `getAll` / `paste` / `copy` / `pin` / … and pushes arriving as
// `clipboard.stateChanged`. Native capture arrives from the .NET host as
// `clipboardHistory.capture`, which is Raycast's `nativeevents.on_clipboard_changed`.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createClipboardStore, maintainCache } = require("./clipboard-store");
const {
  COLOR_FORMATS,
  DEFAULT_SEQUENCE_NEWLINE,
  DEFAULT_SEQUENCE_TIMEOUT_SECONDS,
  baseMime: mimeBase,
  createPasteSequenceState,
  exportBytes,
  filePathOf,
  formattedColors,
  formattedJson,
  imageRepresentationOf,
  normalizeTitle,
  pasteAsOptions,
  pasteSequentiallyStep,
  representationForMime,
} = require("./clipboard-actions");
const {
  clipboardCapabilities,
  createOcrScheduler,
  createQrDecoder,
  hasOcr,
  ocrTextOf,
} = require("./clipboard-ocr");

const PRUNE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  historyDuration: "P1W",
  ignoredApplications: [],
  ignoreDuplicate: false,
  hotkey: "Ctrl + Shift + V",
  primaryAction: "paste",
  preferPastingAsPlainText: false,
  showLinkVisualInformation: true,
  updateHistoryAfterAction: true,
  textRecognitionEnabled: true,
  ocrLevel: "fast",
  sequentialPasteTimeoutSeconds: DEFAULT_SEQUENCE_TIMEOUT_SECONDS,
  addNewLineAfterPaste: DEFAULT_SEQUENCE_NEWLINE,
};

/**
 * Raycast's ignore list is matched three ways (`IgnoredExecutablePatterns`, `IgnoredClassNames` and
 * the exact executable list). A pattern may be `*`-globbed, which is how a user blocks a family of
 * apps such as `chrome*.exe` without naming every build.
 */
function sanitizeIgnoredApplications(applications) {
  const seen = new Set();
  const cleaned = [];
  for (const application of applications ?? []) {
    const name = String(application?.name ?? "").trim();
    const className = String(application?.className ?? "").trim();
    if (!name && !className) continue;
    const key = `${name.toLowerCase()}|${className.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(className ? { name, className } : { name });
  }
  return cleaned;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * `IsIgnoredExecutable` / `IgnoredClassNames` gate. Raycast compares the executable *file name with its
 * extension* (`chrome.exe`), so a source recorded as `chrome.exe` has to match an entry written as
 * either `chrome.exe` or `chrome`. Both forms are tried so the settings screen can accept whichever
 * reads better.
 */
function isIgnoredSource(source, ignoredApplications) {
  const className = String(source?.className ?? "").trim().toLowerCase();
  const name = executableName(source);
  return ignoredApplications.some((application) => {
    const entryClass = String(application.className ?? "").trim().toLowerCase();
    if (entryClass && entryClass === className) return true;
    const entryName = String(application.name ?? "").trim().toLowerCase();
    if (!entryName || !name) return false;
    if (entryName === name || globToRegExp(entryName).test(name)) return true;
    const extension = path.extname(name);
    if (!extension) return false;
    const stem = name.slice(0, -extension.length);
    return entryName === stem || globToRegExp(entryName).test(stem);
  });
}

/** The executable file name with extension, taken from the source's `url` and falling back to `name`. */
function executableName(source) {
  const fromUrl = typeof source?.url === "string" ? path.basename(source.url.trim()) : "";
  const name = String(fromUrl || source?.name || "").trim().toLowerCase();
  return name;
}

function createClipboardHistory({ dispatch, store = createClipboardStore() }) {
  const settings = { ...DEFAULT_SETTINGS };
  let pruneTimer = null;
  let maintenanceTimer = null;
  let overdueCheck = null;
  let attachPowerListener = null;
  let lastPruneAt = 0;
  let lastMaintenanceAt = 0;

  const settingsPath = path.join(store.paths.databasePath, "..", "clipboard-settings.json");

  function readSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, "utf-8")) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function persistSettings() {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error("[clipboard] could not persist clipboard settings", error);
    }
  }

  function loadSettings() {
    Object.assign(settings, readSettings());
    settings.historyDuration = store.normalizeDuration(settings.historyDuration);
    settings.ignoredApplications = sanitizeIgnoredApplications(settings.ignoredApplications);
    settings.primaryAction = settings.primaryAction === "copy" ? "copy" : "paste";
    settings.preferPastingAsPlainText = settings.preferPastingAsPlainText === true;
    settings.showLinkVisualInformation = settings.showLinkVisualInformation !== false;
    settings.updateHistoryAfterAction = settings.updateHistoryAfterAction !== false;
    settings.textRecognitionEnabled = settings.textRecognitionEnabled !== false;
    settings.ocrLevel = settings.ocrLevel === "accurate" ? "accurate" : "fast";
    const timeout = Number(settings.sequentialPasteTimeoutSeconds);
    settings.sequentialPasteTimeoutSeconds =
      Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SEQUENCE_TIMEOUT_SECONDS;
    settings.addNewLineAfterPaste = settings.addNewLineAfterPaste !== false;
    const hotkey = normalizeHotkey(settings.hotkey);
    settings.hotkey = hotkey ?? DEFAULT_SETTINGS.hotkey;
  }

  /**
   * Raycast's hotkey strings are normalised to `Ctrl + Shift + V` form. Anything the recorder produced
   * that cannot be expressed that way is rejected rather than registered as something unexpected.
   */
  function normalizeHotkey(value) {
    const parts = String(value ?? "")
      .split("+")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return null;
    const modifiers = ["ctrl", "alt", "shift", "cmd", "fn"];
    const foundModifiers = new Set();
    const keys = [];
    for (const part of parts) {
      if (modifiers.includes(part)) foundModifiers.add(part);
      else keys.push(part);
    }
    if (keys.length !== 1) return null;
    if (foundModifiers.size === 0) return null;
    const named = { space: "Space", enter: "Enter", return: "Enter", tab: "Tab", escape: "Escape", backspace: "Backspace", delete: "Delete" };
    const key = named[keys[0]] ?? keys[0].toUpperCase();
    const ordered = [...foundModifiers].sort();
    return `${ordered.map((modifier) => `${modifier[0].toUpperCase()}${modifier.slice(1)}`).join(" + ")} + ${key}`;
  }

  const pasteSequence = createPasteSequenceState();
  const ocr = createOcrScheduler({ dispatch, store });
  const decodeQrCode = createQrDecoder({ dispatch });

  /**
   * Raycast's auto-tagging: an enabled `clipboard_filters` row whose `sourceUrl` matches the source of a
   * new entry contributes its tags, unioned with the entry's own categories.
   */
  function tagsForSource(source) {
    const url = typeof source?.url === "string" ? source.url.trim() : "";
    if (!url) return [];
    const name = executableName(source);
    const match = store
      .getAllFilters()
      .find((filter) => filter.enabled && matchesFilterSource(filter.sourceUrl, name));
    return match ? match.tags : [];
  }

  function matchesFilterSource(filterUrl, name) {
    const pattern = String(filterUrl ?? "").trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === name) return true;
    const basename = path.basename(pattern);
    return basename === name || globToRegExp(basename).test(name);
  }

  function applyFilterTags(entry) {
    const tags = tagsForSource(entry.source);
    if (tags.length === 0) return entry;
    const merged = [...new Set([...(entry.tags ?? []), ...tags])].sort();
    return merged.length === (entry.tags ?? []).length ? entry : { ...entry, tags: merged };
  }

  /** Resolves a representation to something pasteable: inline text, or the bytes behind a file. */
  /**
   * Resolves a representation to something the host can put on the clipboard.
   *
   * Text stays text even when it was spilled to disk, because handing the host a *path* for spilled
   * text would paste the filename instead of the text. Images come back base64-encoded so the host
   * re-creates a bitmap rather than publishing a file drop. Files and other payloads stay as paths.
   */
  function materialize(representation) {
    if (!representation) return null;
    if (representation.contentType === "text") return representation.content;
    if (representation.contentType !== "url") return null;
    try {
      const stats = fs.statSync(representation.content);
      const mimeType = mimeBase(representation.mimeType);
      if (mimeType.startsWith("text/") || mimeType === "application/json") {
        return {
          mimeType: representation.mimeType,
          text: fs.readFileSync(representation.content, "utf-8"),
        };
      }
      if (mimeType.startsWith("image/") && stats.size <= MAX_PASTE_IMAGE_BYTES) {
        return {
          mimeType: representation.mimeType,
          base64: fs.readFileSync(representation.content).toString("base64"),
        };
      }
      return { path: representation.content, mimeType: representation.mimeType, size: stats.size };
    } catch {
      return null;
    }
  }

  function preparedEntry(entry) {
    const items = entry.items.map((item) => ({
      representations: item.representations
        .map((representation) => {
          const value = materialize(representation);
          if (value === null) return null;
          return typeof value === "string"
            ? { mimeType: representation.mimeType, text: value }
            : value;
        })
        .filter(Boolean),
    }));
    return { items: items.filter((item) => item.representations.length > 0) };
  }

  async function pasteById(id, { shouldCloseWindow = true, overridePasteboard = true, keepWindowOpen = false } = {}) {
    const entry = store.getOne(id);
    if (!entry) throw new Error("Couldn't paste clipboard entry because it doesn't exist anymore");
    touchCopied(id);
    // Raycast's `Paste and Keep Window Open` is the same paste with `skipStateNotification`, so the
    // launcher stays up and the list does not jump under the cursor.
    await dispatch("clipboardHistory.placeInClipboard", {
      target: "frontmost",
      items: preparedEntry(entry).items,
      shouldCloseWindow: keepWindowOpen ? false : shouldCloseWindow,
      overridePasteboard,
      skipStateNotification: keepWindowOpen,
    });
    return { pasted: true, keepWindowOpen };
  }

  function touchCopied(id) {
    return store.touchCopy(id);
  }

  async function copyById(id, { shouldCloseWindow = true, keepWindowOpen = false } = {}) {
    const entry = store.getOne(id);
    if (!entry) throw new Error("Couldn't copy clipboard entry because it doesn't exist anymore");
    touchCopied(id);
    await dispatch("clipboardHistory.placeInClipboard", {
      target: "pasteboard",
      items: preparedEntry(entry).items,
      shouldCloseWindow: keepWindowOpen ? false : shouldCloseWindow,
      skipStateNotification: keepWindowOpen,
    });
    return { copied: true, keepWindowOpen };
  }

  const handlers = {
    /** Native capture -> store. Raycast's `on_clipboard_changed` ingest. */
    async capture(entry) {
      if (isIgnoredSource(entry?.source, settings.ignoredApplications)) {
        console.info(
          `[clipboard] entry discarded for ignored application: ${entry.source.name}`,
        );
        return { stored: false, mutationKind: "ignored-application" };
      }
      if (shouldIgnoreDuplicate(entry, settings, store)) {
        console.info("[clipboard] entry discarded as a duplicate (ignoreDuplicate is on)");
        return { stored: false, mutationKind: "ignored-duplicate" };
      }
      // An enabled per-app filter contributes tags before the row is written, so the entry is born
      // tagged rather than being patched a moment later.
      const result = store.add(applyFilterTags(entry));
      if (result.mutationKind === "stale-observation") {
        console.info(
          `[clipboard] discarded a stale observation (${entry.observationId}); latest for that host is newer`,
        );
        return { stored: false, mutationKind: "stale-observation" };
      }
      if (result.entry && result.didMutate) {
        console.info(
          `[clipboard] ${result.mutationKind} entry ${result.entry.id} from ${result.entry.source?.name ?? "unknown"}`,
        );
        store.emitStateChanged();
        // Raycast runs text recognition in the background after the row lands, so a large image never
        // delays the capture itself.
        if (settings.textRecognitionEnabled) ocr.schedule(result.entry.id);
      }
      return { stored: Boolean(result.entry), mutationKind: result.mutationKind ?? null };
    },

    async getAll(params) {
      const page = store.all({
        cursor: params?.cursor,
        limit: params?.limit,
        filter: params?.filter,
        category: params?.category,
        tag: params?.tag,
      });
      return { entries: page.entries, nextCursor: page.nextCursor ?? null };
    },

    async getLast(params) {
      const entry = store.last(params?.offset ?? 0);
      return entry ? { entry } : { entry: null };
    },

    async paste(params) {
      if (typeof params?.id === "string") {
        return await pasteById(params.id, { ...params, keepWindowOpen: params.keepWindowOpen === true });
      }
      const items = params?.items ?? (typeof params?.text === "string"
        ? [{ representations: [{ mimeType: "text/plain", text: params.text }] }]
        : null);
      if (!items) throw new Error("paste: nothing to paste");
      await dispatch("clipboardHistory.placeInClipboard", {
        target: "frontmost",
        items,
        shouldCloseWindow: params?.shouldCloseWindow ?? true,
        overridePasteboard: params?.overridePasteboard ?? true,
      });
      return { pasted: true };
    },

    async copy(params) {
      if (typeof params?.id === "string") {
        return await copyById(params.id, { ...params, keepWindowOpen: params.keepWindowOpen === true });
      }
      const items = params?.items ?? (typeof params?.text === "string"
        ? [{ representations: [{ mimeType: "text/plain", text: params.text }] }]
        : null);
      if (!items) throw new Error("copy: nothing to copy");
      await dispatch("clipboardHistory.placeInClipboard", {
        target: "pasteboard",
        items,
        shouldCloseWindow: params?.shouldCloseWindow ?? true,
      });
      return { copied: true };
    },

    async pin(params) {
      return { entry: store.pin(params.id) };
    },

    async unpin(params) {
      return { entry: store.unpin(params.id) };
    },

    async movePinnedUp(params) {
      return { entry: store.movePinned(params.id, "up") };
    },

    async movePinnedDown(params) {
      return { entry: store.movePinned(params.id, "down") };
    },

    /** Raycast's `setTags`. */
    async setTags(params) {
      return { entry: store.setTags(params.id, params.tags) };
    },

    async getTags() {
      return { tags: store.getAllTags() };
    },

    async getDurations() {
      return {
        durations: store.historyDurations(),
        current: settings.historyDuration,
      };
    },

    async setHistoryDuration(params) {
      settings.historyDuration = store.normalizeDuration(params?.duration);
      await persistSettings();
      // Raycast prunes on the next scheduled run; doing it immediately makes the setting feel applied.
      const pruned = store.pruneHistory(settings.historyDuration);
      return { current: settings.historyDuration, pruned: pruned.pruned };
    },

    async getSettings() {
      return {
        historyDuration: settings.historyDuration,
        ignoredApplications: settings.ignoredApplications,
        ignoreDuplicate: settings.ignoreDuplicate,
      };
    },

    async setIgnoredApplications(params) {
      settings.ignoredApplications = sanitizeIgnoredApplications(params?.applications);
      await persistSettings();
      return { ignoredApplications: settings.ignoredApplications };
    },

    async setIgnoreDuplicate(params) {
      settings.ignoreDuplicate = Boolean(params?.enabled);
      await persistSettings();
      return { ignoreDuplicate: settings.ignoreDuplicate };
    },

    /** Manual trigger for the daily job; also used by the settings screen to prove it runs. */
    async runMaintenance() {
      return {
        cache: maintainCache(store),
        pruned: store.pruneHistory(settings.historyDuration).pruned,
      };
    },

    async delete(params) {
      return { deleted: store.deleteOne(params.id) };
    },

    async deleteAll(params) {
      return { deleted: store.deleteAll(params ?? {}) };
    },

    async deleteAllBeforeDate(params) {
      return { deleted: store.deleteAllBeforeDate(params) };
    },

    async deleteAllAfterDate(params) {
      return { deleted: store.deleteAllAfterDate(params) };
    },

    async getPreview(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't build a preview because the entry no longer exists");
      return buildPreview(entry);
    },

    /** Raycast's `Open in Browser` action on a link row. */
    async openUrl(params) {
      if (typeof params?.url !== "string" || !/^https?:\/\//i.test(params.url)) {
        throw new Error("openUrl: only http(s) links can be opened");
      }
      await dispatch("clipboardHistory.openUrl", { url: params.url });
      return { opened: true };
    },

    async paths() {
      return store.paths;
    },

    /**
     * One step of Raycast's `Paste Sequentially`. The cursor lives in memory; when the run goes quiet
     * for longer than the configured timeout, or the newest entry changes underneath it, it restarts.
     */
    async pasteSequentially() {
      const step = pasteSequentiallyStep({
        history: { store, preparedEntry },
        state: pasteSequence,
        sequenceTimeoutSeconds: settings.sequentialPasteTimeoutSeconds,
        addNewLine: settings.addNewLineAfterPaste,
      });
      if (step.status === "exhausted") {
        return { status: "exhausted", pasted: false, offset: 0 };
      }
      if (step.asText) {
        await dispatch("clipboardHistory.placeInClipboard", {
          target: "frontmost",
          items: [{ representations: [{ mimeType: "text/plain", text: step.text }] }],
          shouldCloseWindow: true,
          overridePasteboard: false,
        });
      } else {
        await dispatch("clipboardHistory.placeInClipboard", {
          target: "frontmost",
          items: step.items,
          shouldCloseWindow: true,
          overridePasteboard: false,
        });
      }
      return { status: step.status, pasted: true, entryId: step.entryId, offset: step.offset };
    },

    /** Raycast's `Reset Paste Sequence`: forget the cursor, the timer and the top entry. */
    async resetPasteSequence() {
      pasteSequence.offset = 0;
      pasteSequence.lastInvocation = null;
      pasteSequence.topItemId = null;
      return { reset: true };
    },

    /** Raycast's `getTextFromImage`: OCR at the `accurate` level, stored on the entry and returned. */
    async getTextFromImage(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't extract text because the entry no longer exists");
      const target = params?.path ?? imageRepresentationOf(entry)?.content;
      if (!target) throw new Error("No image found in this entry");
      const result = await dispatch("clipboardHistory.performOcr", {
        path: target,
        level: "accurate",
      });
      const text = String(result?.text ?? "").trim();
      if (!text) throw new Error("No text found in image");
      store.appendOcrRepresentation(entry.id, target, text);
      return { text };
    },

    /** Raycast's `getQrCodeFromImage`: local decode, one string per symbol found. */
    async getQrCodeFromImage(params) {
      const results = await decodeQrCode({
        path: params?.path,
        imageData: params?.imageData,
      });
      return { results };
    },

    /** Whether this entry already carries recognised text, and what it says. */
    async getOcrText(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't read recognised text because the entry no longer exists");
      return { text: ocrTextOf(entry), hasOcr: hasOcr(entry) };
    },

    /** The `Paste as…` submenu, built from the representations this entry actually holds. */
    async getPasteAsOptions(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't list formats because the entry no longer exists");
      return { options: pasteAsOptions(entry) };
    },

    /** Pasting one specific format of an entry, as the submenu asks for. */
    async pasteAs(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't paste because the entry no longer exists");
      const representation = representationForMime(entry, params?.mimeType ?? "");
      if (!representation) throw new Error("This entry has no such format");
      const prepared = materialize(representation);
      if (prepared === null) throw new Error("Couldn't read this format off disk anymore");
      touchCopied(entry.id);
      const item = typeof prepared === "string"
        ? { mimeType: representation.mimeType, text: prepared }
        : prepared;
      await dispatch("clipboardHistory.placeInClipboard", {
        target: "frontmost",
        items: [{ representations: [item] }],
        shouldCloseWindow: params?.shouldCloseWindow ?? true,
        overridePasteboard: params?.overridePasteboard ?? true,
      });
      return { pasted: true, mimeType: representation.mimeType };
    },

    /** Raycast's `getFormatted`: every colour format for a colour entry, in Raycast's own order. */
    async getFormattedColors(params) {
      return { formats: formattedColors(params?.color ?? params?.value) };
    },

    /** Raycast's `Edit`: replaces the entry's text payload and its title. */
    async editEntry(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't edit the entry because it no longer exists");
      const text = String(params?.text ?? "");
      if (text.length === 0) throw new Error("Couldn't edit the entry because the text is empty");
      const items = entry.items.map((item) => ({
        representations: item.representations.map((representation) =>
          baseMime(representation.mimeType) === "text/plain"
            ? { ...representation, contentType: "text", content: text, size: Buffer.byteLength(text, "utf8") }
            : representation),
      }));
      return {
        entry: store.updateOne(entry.id, {
          items,
          title: normalizeTitle(params?.title) ?? titleForItems(items),
          contentHash: store.hashOf(items),
        }),
      };
    },

    /** Raycast's `Rename Entry`: only the title changes. */
    async renameEntry(params) {
      return { entry: store.renameOne(params.id, normalizeTitle(params.title)) };
    },

    /** Raycast's `Copy Formatted JSON`: the whole entry, payloads still on disk. */
    async getFormattedJson(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't format the entry because it no longer exists");
      return { json: formattedJson(entry) };
    },

    /** Raycast's `Open in App`: a link goes to the browser, a file or image to its handler. */
    async openInApp(params) {
      const entry = params?.id ? store.getOne(params.id) : null;
      const target = params?.target ?? (entry ? openTargetOf(entry) : null);
      if (!target) throw new Error("Couldn't open this entry because it has nothing to open");
      const result = await dispatch("clipboardHistory.openInApp", { target });
      return { opened: true, target: result?.target ?? target };
    },

    async revealInFolder(params) {
      const entry = params?.id ? store.getOne(params.id) : null;
      const target = params?.target ?? (entry ? openTargetOf(entry) : null);
      if (!target) throw new Error("Couldn't reveal this entry because it has no file");
      await dispatch("clipboardHistory.revealInFolder", { target });
      return { revealed: true, target };
    },

    /**
     * Raycast's `Save as File`. The bytes are prepared here and written by the host, so nothing is read
     * into the renderer's memory beyond the file the user chose to write.
     */
    async saveAsFile(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't save the entry because it no longer exists");
      const destination = String(params?.destination ?? "").trim();
      if (!destination) throw new Error("Couldn't save the entry because no destination was chosen");
      const exported = exportBytes(entry);
      if (!exported) throw new Error("Couldn't save this entry because it has nothing to export");
      await dispatch("clipboardHistory.saveAsFile", {
        destination,
        base64: exported.bytes.toString("base64"),
      });
      return { saved: true, path: destination, bytes: exported.bytes.length };
    },

    /** Suggested file name for the save panel, derived from the entry. */
    async getExportSuggestion(params) {
      const entry = store.getOne(params?.id);
      if (!entry) throw new Error("Couldn't suggest a file name because the entry no longer exists");
      const exported = exportBytes(entry);
      const extension = exported?.extension ?? ".txt";
      const stem = sanitizeFileName(entry.title) || "clipboard-entry";
      return { suggestedName: `${stem.slice(0, 80)}${extension}` };
    },

    // --- auto-tagging filters ------------------------------------------------------------------

    async getFilters() {
      return { filters: store.getAllFilters() };
    },

    async setFilter(params) {
      return { filter: store.upsertFilter(params?.filter ?? params) };
    },

    /**
     * Replaces the whole filter list from the settings textarea. Lines are `app.exe: tag, tag`, with a
     * leading `-` marking a disabled rule, which is the same shape the settings screen writes.
     */
    async setFiltersFromText(params) {
      const filters = parseFilterText(params?.text);
      for (const filter of filters) store.upsertFilter(filter);
      const keep = new Set(filters.map((filter) => filter.sourceUrl));
      for (const existing of store.getAllFilters()) {
        if (!keep.has(existing.sourceUrl)) store.deleteFilter(existing.sourceUrl);
      }
      return { filters: store.getAllFilters() };
    },

    async deleteFilter(params) {
      return { deleted: store.deleteFilter(params?.sourceUrl ?? params?.filter?.sourceUrl) };
    },

    /**
     * The Clipboard History hotkey. Raycast stores it per command and hands the combination to the host's
     * `hotkey.register`; the persistence and the recorder both live in the same settings row.
     */
    async getHotkey() {
      return { hotkey: settings.hotkey };
    },

    async setHotkey(params) {
      const hotkey = normalizeHotkey(params?.hotkey);
      if (!hotkey) throw new Error("That's not a shortcut Raycast can use");
      settings.hotkey = hotkey;
      persistSettings();
      const registered = await dispatch("clipboardHistory.registerHotkey", { hotkey }).catch((error) => {
        console.warn("[clipboard] the host refused the hotkey", error);
        return { ok: false };
      });
      return { hotkey, registered: Boolean(registered?.ok) };
    },

    // --- preferences ---------------------------------------------------------------------------

    async getPreferences() {
      return {
        primaryAction: settings.primaryAction,
        preferPastingAsPlainText: settings.preferPastingAsPlainText,
        showLinkVisualInformation: settings.showLinkVisualInformation,
        updateHistoryAfterAction: settings.updateHistoryAfterAction,
        textRecognitionEnabled: settings.textRecognitionEnabled,
        ocrLevel: settings.ocrLevel,
        sequentialPasteTimeoutSeconds: settings.sequentialPasteTimeoutSeconds,
        addNewLineAfterPaste: settings.addNewLineAfterPaste,
      };
    },

    async setPreference(params) {
      const key = String(params?.key ?? "");
      const value = params?.value;
      switch (key) {
        case "primaryAction":
          settings.primaryAction = value === "copy" ? "copy" : "paste";
          break;
        case "preferPastingAsPlainText":
          settings.preferPastingAsPlainText = value === true;
          break;
        case "showLinkVisualInformation":
          settings.showLinkVisualInformation = value !== false;
          break;
        case "updateHistoryAfterAction":
          settings.updateHistoryAfterAction = value !== false;
          break;
        case "textRecognitionEnabled":
          settings.textRecognitionEnabled = value !== false;
          break;
        case "ocrLevel":
          settings.ocrLevel = value === "accurate" ? "accurate" : "fast";
          break;
        case "sequentialPasteTimeoutSeconds": {
          const timeout = Number(value);
          if (!Number.isFinite(timeout) || timeout <= 0) {
            throw new Error("The paste sequence timeout must be a positive number of seconds");
          }
          settings.sequentialPasteTimeoutSeconds = timeout;
          break;
        }
        case "addNewLineAfterPaste":
          settings.addNewLineAfterPaste = value !== false;
          break;
        default:
          throw new Error(`Unknown clipboard preference ${key}`);
      }
      persistSettings();
      return { key, value: settings[key], preferences: await handlers.getPreferences() };
    },

    /** What this host can actually do, so the UI hides what is unavailable rather than failing later. */
    async getCapabilities() {
      return clipboardCapabilities(dispatch);
    },

    /** The colour format list, so the submenu can be built without hard-coding it in the renderer. */
    async getColorFormats() {
      return { formats: COLOR_FORMATS };
    },
  };

  /** A link entry opens in the browser, an image or file entry opens in its default handler. */
  function openTargetOf(entry) {
    const uri = entry.items
      .flatMap((item) => item.representations)
      .find((representation) => baseMime(representation.mimeType).startsWith("text/uri-list"));
    const candidate = uri?.contentType === "text"
      ? String(uri.content).split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      : uri?.content;
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;

    const image = imageRepresentationOf(entry);
    if (image) return image.content;

    const file = filePathOf(entry);
    if (file) return file;

    const text = entry.items
      .flatMap((item) => item.representations)
      .find((representation) => representation.contentType === "text");
    const value = text?.content?.trim();
    return value && /^https?:\/\//i.test(value) ? value : null;
  }

  function sanitizeFileName(title) {
    return String(title ?? "")
      .replace(/[<>:"/\\|?* -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function titleForItems(items) {
    for (const item of items) {
      for (const representation of item.representations) {
        if (baseMime(representation.mimeType) === "text/plain" && representation.contentType === "text") {
          return representation.content.split(/\r?\n/, 1)[0].trim();
        }
      }
    }
    return "Clipboard Entry";
  }

  store.subscribeStateChanged(() => {
    dispatch("clipboard.stateChanged", {});
  });

  function startTasks() {
    loadSettings();
    lastPruneAt = Date.now();
    lastMaintenanceAt = Date.now();
    // Raycast prunes every 12 hours (`{name:"Delete old clipboard history", interval:{hours:12}}`)
    // and runs cache maintenance daily (`"Perform clipboard cache maintenance"`, every day). Both
    // also fire once at startup so a machine that was off for a week does not carry stale entries.
    const prune = () => {
      lastPruneAt = Date.now();
      try {
        const result = store.pruneHistory(settings.historyDuration);
        if (result.pruned > 0) {
          console.info(`[clipboard] pruned ${result.pruned} entries older than ${result.duration}`);
        }
      } catch (error) {
        console.error("[clipboard] history prune failed", error);
      }
    };
    const maintain = () => {
      lastMaintenanceAt = Date.now();
      try {
        maintainCache(store);
      } catch (error) {
        console.error("[clipboard] cache maintenance failed", error);
      }
    };

    prune();
    maintain();

    pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
    maintenanceTimer = setInterval(maintain, MAINTENANCE_INTERVAL_MS);
    pruneTimer.unref?.();
    maintenanceTimer.unref?.();

    // A plain interval measures wall-clock time, and a sleeping machine does not run callbacks: a laptop
    // asleep for a day would wake up and wait nearly a full interval before pruning again. The resume
    // hook runs whatever is overdue the moment the machine wakes, and a periodic `setTimeout` covers the
    // case where the resume event never arrives (a VM resume, for instance).
    let overdueCheck = null;
    const catchUp = () => {
      try {
        prune();
        maintain();
      } catch (error) {
        console.error("[clipboard] post-resume housekeeping failed", error);
      }
    };

    overdueCheck = setInterval(() => {
      const now = Date.now();
      if (now - lastPruneAt >= PRUNE_INTERVAL_MS) prune();
      if (now - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) maintain();
    }, 60 * 1000);
    overdueCheck.unref?.();

    // Windows only offers session-level `SystemEvents.PowerModeChanged` here, so a manual idle check is
    // the portable signal that the process has been frozen. Node stops responding while suspended, so
    // anything overdue is caught by whichever of the two fires first.
    let resumeListener = null;
    try {
      resumeListener = createPowerListener(catchUp);
    } catch (error) {
      console.warn("[clipboard] could not observe power state changes", error);
    }
    attachPowerListener = resumeListener;
  }

  function stopTasks() {
    if (pruneTimer) clearInterval(pruneTimer);
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    if (overdueCheck) clearInterval(overdueCheck);
    if (attachPowerListener) attachPowerListener();
    pruneTimer = null;
    maintenanceTimer = null;
    overdueCheck = null;
    attachPowerListener = null;
  }

  startTasks();

  return {
    handlers,
    store,
    settings,
    startTasks,
    stopTasks,
    preparedEntry,
    materialize,
    ocr,
    decodeQrCode,
    pasteSequence,
  };
}

/** Largest image inline-encoded for the detail pane; bigger files stay on disk. */
const MAX_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024;

/** Largest image inlined for a paste; bigger ones are pasted as a file drop, as Raycast does. */
const MAX_PASTE_IMAGE_BYTES = 32 * 1024 * 1024;

/**
 * With `bIgnoreDuplicate` on, a capture whose *normalised* content matches an entry we already hold is
 * dropped instead of merged — it must not bump `copyCount` or add representations. The hash has to be
 * computed the same way the store computes it, so this asks the store to do it.
 */
function shouldIgnoreDuplicate(entry, settings, store) {
  if (!settings.ignoreDuplicate) return false;
  const hash = store.hashOf(entry?.items);
  if (!hash) return false;
  return Boolean(store.getOneByContentHash(hash));
}

/**
 * Builds the detail pane model for the selected entry. Raycast renders this from
 * `ClipboardHistoryDetails` / `ImageItemDetails` / `TextItemDetails` / `LinkItemDetails`; the image
 * bytes are only encoded for the selected row, which is what keeps previews lazy.
 */
function buildPreview(entry) {
  const info = {
    id: entry.id,
    title: entry.title,
    categories: entry.categories,
    source: entry.source,
    copyCount: entry.copyCount,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };

  if (entry.items.length > 1) {
    return {
      ...info,
      kind: "multi",
      fileCount: entry.items.length,
      items: entry.items.map((item) => describeItem(item)),
    };
  }

  const item = entry.items[0];
  const description = describeItem(item);
  if (description.image) return { ...info, ...description, kind: "image" };
  if (description.paths.length > 0) return { ...info, ...description, kind: "file" };
  if (description.text !== null) return { ...info, ...description, kind: "text" };
  return { ...info, ...description, kind: "none" };
}

function describeItem(item) {
  const representations = item?.representations ?? [];
  const textRepresentation =
    representations.find((representation) => mimeBase(representation.mimeType) === "text/plain") ??
    representations.find(
      (representation) =>
        representation.contentType === "text" && mimeBase(representation.mimeType).startsWith("text/"),
    );
  const uriRepresentation = representations.find((representation) =>
    mimeBase(representation.mimeType).startsWith("text/uri-list"),
  );
  const imageRepresentation = representations.find((representation) =>
    mimeBase(representation.mimeType).startsWith("image"),
  );

  const text = inlineText(textRepresentation) ?? inlineText(uriRepresentation);
  const paths = filePathsFrom(uriRepresentation);

  let image = null;
  if (imageRepresentation) {
    const size = imageRepresentation.size ?? 0;
    image = {
      path: imageRepresentation.content,
      width: imageRepresentation.width ?? null,
      height: imageRepresentation.height ?? null,
      size,
      dataUrl:
        size > 0 && size <= MAX_PREVIEW_IMAGE_BYTES && imageRepresentation.contentType === "url"
          ? `data:${mimeBase(imageRepresentation.mimeType)};base64,${fs
              .readFileSync(imageRepresentation.content)
              .toString("base64")}`
          : null,
    };
  }

  return { text, paths, image };
}

function inlineText(representation) {
  if (!representation) return null;
  if (representation.contentType === "text") return representation.content;
  if (representation.contentType === "url") {
    try {
      return fs.readFileSync(representation.content, "utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

function filePathsFrom(representation) {
  if (!representation || !representation.content) return [];
  if (representation.contentType !== "text") {
    try {
      return [{ path: representation.content, size: fs.statSync(representation.content).size }];
    } catch {
      return [];
    }
  }
  return representation.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return { path: line, size: fs.statSync(line).size };
      } catch {
        return { path: line, size: null };
      }
    });
}

/** Parses the settings textarea's filter rows: `app.exe: tag, tag`, with `-` prefix meaning disabled. */
function parseFilterText(text) {
  const filters = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const enabled = !line.startsWith("-");
    const body = (enabled ? line : line.slice(1)).trim();
    const separator = body.indexOf(":");
    const sourceUrl = (separator === -1 ? body : body.slice(0, separator)).trim();
    if (!sourceUrl) continue;
    const tags = (separator === -1 ? "" : body.slice(separator + 1))
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    filters.push({ sourceUrl, tags, enabled });
  }
  return filters;
}

/**
 * Fires the callback when the machine suspends or resumes. Returns a function that detaches it.
 *
 * `SystemEvents.PowerModeChanged` is session-scoped, which is all a per-user desktop app needs, and it
 * needs a message pump on Windows — the host's UI thread runs that pump, so the subscription is made and
 * torn down through the same dispatch path the rest of the native work uses.
 */
function createPowerListener(onResume) {
  let detach = () => {};
  try {
    const systemEvents = require("systemevents");
    const session = typeof systemEvents.createSession === "function"
      ? systemEvents.createSession()
      : systemEvents;
    const handler = (event) => {
      if (event === "resume" || event === "systemResume") onResume();
    };
    session.on("PowerModeChanged", handler);
    detach = () => {
      try {
        session.removeListener("PowerModeChanged", handler);
      } catch {
        // The session may already be closed; nothing to undo.
      }
    };
  } catch (error) {
    // Without the event hook the minute-by-minute overdue check still runs, so this degrades rather
    // than breaks.
    console.warn("[clipboard] power events unavailable, falling back to periodic catch-up only", error);
  }
  return detach;
}

module.exports = { createClipboardHistory, buildPreview, isIgnoredSource, executableName, createPowerListener };