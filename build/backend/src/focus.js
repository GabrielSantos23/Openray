// Focus handler — the `focus.*` namespace (docs/focus-games-taskbar-spec.md §A).
//
// Mirrors the shipped session manager (backend/index.mjs @~3757k): one active session with
// start/update/toggle/pause/resume/restart/complete/cancel, auto-complete of expired sessions and
// auto-resume of expired pauses on bootstrap, built-in category upsert at bootstrap, and the same
// public shapes (public session state, focus category record). Session persistence is a JSON file
// (active session + last start input + presentation), categories live in SQLite.
//
// The host half (`focus.startSession|pauseSession|resumeSession|completeSession|cancelSession`
// native routes) owns the app-blocking watch loop and the timer panel; this module stays the state
// machine source of truth and re-syncs the host on every mutation.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const MAX_DURATION_MS = 1440 * 60 * 1e3;
const COMPLETION_RETRY_MS = 5e3;
const DEFAULT_TITLE = "Focus session";
const DEFAULT_ICON = "bulls-eye-16";
const DEFAULT_CATEGORY_ID = "focus-category";
const GAME_BIT = 2048;

// The seven built-in categories, verbatim from the shipped store (windows app ids included —
// bare exe names and MSIX package ids both match through the app-rule normalizer below).
const BUILTIN_CATEGORIES = [
  {
    builtinId: "messaging",
    categoryId: "messaging",
    title: "Messaging",
    icon: "speech-bubble-16",
    websiteHosts: ["web.whatsapp.com", "web.telegram.org", "messenger.com", "discord.com", "slack.com", "signal.org", "wechat.com", "skype.com", "viber.com", "line.me", "chat.google.com", "teams.microsoft.com", "zoom.us", "icq.com", "wire.com", "element.io", "threema.ch", "chatwork.com", "kik.com"],
    applicationIds: ["5319275A.WhatsAppDesktop_cv1g1gvanyjgm", "TelegramMessengerLLP.TelegramDesktop_t4vj0pshhgkwm", "com.squirrel.Discord.Discord", "MSTeams_8wekyb3d8bbwe", "91750D7E.Slack_8she8kybcnzg4", "Signal.exe", "Weixin.exe", "LineLauncher.exe", "Viber.exe"],
  },
  {
    builtinId: "gaming",
    categoryId: "gaming",
    title: "Gaming",
    icon: "game-controller-16",
    websiteHosts: ["steampowered.com", "epicgames.com", "gog.com", "origin.com", "ubisoft.com", "battle.net", "riotgames.com", "itch.io", "humblebundle.com", "greenmangaming.com", "gamespot.com", "ign.com", "polygon.com", "kotaku.com", "pcgamer.com", "nintendo.com", "playstation.com", "xbox.com", "twitch.tv"],
    applicationIds: ["com.valvesoftware.steam", "com.epicgames.EpicGamesLauncher", "com.ea.mac.eaapp", "steam.exe", "EpicGamesLauncher.exe", "Microsoft.GamingApp_8wekyb3d8bbwe", "GogCom.GalaxyClient.Main", "UbisoftConnect.exe", "Battle.net Launcher.exe", "EALauncher.exe", "io.itch.itch"],
  },
  {
    builtinId: "shopping",
    categoryId: "shopping",
    title: "Shopping",
    icon: "cart-16",
    websiteHosts: ["alibaba.com", "aliexpress.com", "allegro.pl", "amazon.*", "asos.com", "bershka.com", "craigslist.com", "ebay.com", "etsy.com", "fr.boohoo.com", "homedepot.com", "ikea.com", "mercadolivre.com.br", "nordstromrack.com", "ozon.ru", "rakuten.com", "shein.com", "taobao.com", "temu.com", "us.boohoo.com", "walmart.com", "wish.com", "zalando.com", "target.com", "bestbuy.com", "wayfair.com", "boots.com", "argos.co.uk", "johnlewis.com", "currys.co.uk", "next.co.uk", "very.co.uk", "zara.com", "hm.com", "uniqlo.com", "macys.com", "nordstrom.com", "shopify.com", "overstock.com", "newegg.com", "nike.com", "adidas.com", "jd.com", "tesco.com", "sainsburys.co.uk", "asda.com", "marksandspencer.com", "ao.com", "debenhams.com"],
    applicationIds: [],
  },
  {
    builtinId: "social",
    categoryId: "social",
    title: "Social",
    icon: "two-people-16",
    websiteHosts: ["facebook.com", "instagram.com", "linkedin.com", "mastodon.social", "messenger.com", "myspace.com", "pinterest.com", "quora.com", "reddit.com", "threads.net", "tiktok.com", "tumblr.com", "viber.com", "vimeo.com", "web.telegram.org", "x.com", "mobile.x.com", "twitter.com", "bsky.app"],
    applicationIds: ["com.atebits.Tweetie2"],
  },
  {
    builtinId: "streaming",
    categoryId: "streaming",
    title: "Streaming",
    icon: "play-16",
    websiteHosts: ["canalplus.com", "crunchyroll.com", "dazn.com", "discoveryplus.com", "disneyplus.com", "hulu.com", "iflix.com", "iqiyi.com", "max.com", "mgmplus.com", "mubi.com", "netflix.com", "ocs.com", "paramountplus.com", "peacocktv.com", "plus.espn.com", "plus.rtl.com", "primevideo.com", "rakuten.tv", "skyshowtime.com", "sonyliv.com", "starz.com", "tv.apple.com", "v.qq.com", "viaplay.com", "wetv.vip", "youku.com", "youtube.com", "zee5.com"],
    applicationIds: ["4DF9E0F8.Netflix_mcm4njqhnhss8", "AppleInc.AppleTVWin_nzyj5cx40ttqa", "AmazonVideo.PrimeVideo_pwbj9vvecjh7j", "Disney.37853FC22B2CE_6rarf9sa4v8jt", "2BDFC20A.CBS_bd059sf7kn2rm"],
  },
  {
    builtinId: "news",
    categoryId: "news",
    title: "News",
    icon: "book-16",
    websiteHosts: ["news.ycombinator.com", "reuters.com", "bloomberg.com", "ap.org", "bbc.com", "cnn.com", "aljazeera.com", "theguardian.com", "nytimes.com", "wsj.com", "telegraph.co.uk", "independent.co.uk", "dailymail.co.uk", "mirror.co.uk", "thesun.co.uk", "metro.co.uk", "standard.co.uk", "ft.com", "dw.com", "france24.com", "euronews.com", "thelocal.eu", "politico.eu", "washingtonpost.com", "usatoday.com", "foxnews.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com", "latimes.com", "globe.com", "nationalpost.com", "cbc.ca", "scmp.com", "japantimes.co.jp", "straittimes.com", "abc.net.au", "news.com.au", "nzherald.co.nz", "thehindu.com", "ndtv.com", "feedly.com", "rssviewer.app", "newsblur.com", "inoreader.com"],
    applicationIds: ["Microsoft.BingNews_8wekyb3d8bbwe"],
  },
  {
    builtinId: "travel",
    categoryId: "travel",
    title: "Travel",
    icon: "airplane-16",
    websiteHosts: ["booking.com", "airbnb.com", "expedia.com", "kayak.com", "tripadvisor.com", "hotels.com", "skyscanner.com", "priceline.com", "vrbo.com", "hotwire.com", "agoda.com", "britishairways.com", "easyjet.com", "ryanair.com", "lufthansa.com", "emirates.com", "trainline.com", "nationalexpress.com", "hostelworld.com", "viator.com", "rentalcars.com", "hertz.com", "avis.com", "enterprise.com", "marriott.com", "hilton.com", "ihg.com", "accor.com", "travelocity.com", "orbitz.com", "lastminute.com", "holidaypirates.com", "secretflying.com", "thetrainline.com", "eurostar.com", "norwegian.com", "klm.com", "airfrance.com", "cruisecritic.com", "royalcaribbean.com", "carnival.com"],
    applicationIds: [],
  },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS focus_categories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  builtin_id TEXT,
  title TEXT NOT NULL,
  icon TEXT NOT NULL,
  website_hosts TEXT NOT NULL DEFAULT '[]',
  application_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accessed_at INTEGER
);
`;

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry).trim()).filter((entry) => entry !== "")));
}

/**
 * Turns Raycast application identifiers into process-match rules for the host watch loop:
 * full paths match the process exe path; bare `X.exe` names match the process name; package /
 * bundle ids match the executable's base name (the last segment, dots and `_publisher` dropped).
 */
function toAppRules(appIds) {
  const rules = [];
  const seen = new Set();
  const push = (rule) => {
    const key = `${rule.kind}:${rule.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push(rule);
  };
  for (const raw of normalizeList(appIds)) {
    const id = raw.toLowerCase();
    const asPath = id.startsWith("path:") ? id.slice(5) : id.includes("\\") || id.includes("/") ? id : null;
    if (asPath) {
      push({ kind: "path", value: asPath.replace(/\//g, "\\") });
      const exeName = asPath.split(/[\\/]/).filter(Boolean).pop();
      if (exeName) push({ kind: "exeName", value: exeName.endsWith(".exe") ? exeName : `${exeName}.exe` });
    } else if (id.endsWith(".exe")) {
      push({ kind: "exeName", value: id });
    } else {
      const withoutPublisher = id.split("_")[0];
      const base = withoutPublisher.split(".").filter(Boolean).pop();
      if (base) push({ kind: "exeBase", value: base });
    }
  }
  return rules;
}

function createFocus({ pushToFrontend, dispatch, dataRoot, now = Date.now } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "RaycastMini");
  const databasePath = path.join(root, "focus-categories.sqlite");
  const sessionPath = path.join(root, "focus-session.json");

  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA);

  let session = null;
  let lastSessionStartInput = null;
  let lastPresentation = "panel";
  let completionTimer = null;
  let pauseResumeTimer = null;

  try {
    const stored = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
    if (typeof stored.presentation === "string" && stored.presentation) lastPresentation = stored.presentation;
    if (stored.lastSessionStartInput && typeof stored.lastSessionStartInput === "object") {
      lastSessionStartInput = stored.lastSessionStartInput;
    }
    if (stored.session && typeof stored.session === "object") session = stored.session;
  } catch {
    /* first run keeps defaults */
  }

  function persistSession() {
    try {
      fs.writeFileSync(sessionPath, JSON.stringify({ session, lastSessionStartInput, presentation: lastPresentation }, null, 2));
    } catch (error) {
      console.error("[focus] could not persist the session", error);
    }
  }

  function rowToCategory(row) {
    return {
      id: row.id,
      categoryId: row.id,
      kind: row.kind,
      builtinId: row.builtin_id ?? null,
      title: row.title,
      icon: row.icon,
      websiteHosts: JSON.parse(row.website_hosts ?? "[]"),
      applicationIds: JSON.parse(row.application_ids ?? "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessedAt: row.accessed_at ?? null,
    };
  }

  function insertCategory(record) {
    const timestamp = now();
    db.prepare(
      "INSERT OR REPLACE INTO focus_categories (id, kind, builtin_id, title, icon, website_hosts, application_ids, created_at, updated_at, accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      record.categoryId,
      record.kind,
      record.builtinId ?? null,
      record.title,
      record.icon,
      JSON.stringify(record.websiteHosts ?? []),
      JSON.stringify(record.applicationIds ?? []),
      record.createdAt ?? timestamp,
      record.updatedAt ?? timestamp,
      record.accessedAt ?? null,
    );
  }

  function bootstrapCategories() {
    for (const builtin of BUILTIN_CATEGORIES) {
      const existing = getByCategoryId(builtin.categoryId);
      if (existing && existing.kind === "custom") continue;
      insertCategory({
        categoryId: builtin.categoryId,
        kind: "builtin",
        builtinId: builtin.builtinId,
        title: builtin.title,
        icon: builtin.icon,
        websiteHosts: builtin.websiteHosts,
        applicationIds: builtin.applicationIds,
      });
    }
  }

  function getByCategoryId(categoryId) {
    const row = db.prepare("SELECT * FROM focus_categories WHERE id = ?").get(categoryId);
    return row ? rowToCategory(row) : null;
  }

  function listCategories(query, limit, offset) {
    const clauses = [];
    const params = [];
    if (query) {
      clauses.push("(LOWER(title) LIKE ? OR id LIKE ?)");
      const pattern = `%${query.toLowerCase()}%`;
      params.push(pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    let sql = `SELECT * FROM focus_categories ${where} ORDER BY kind DESC, LOWER(title) ASC`;
    if (Number.isFinite(limit) && limit > 0) {
      sql += " LIMIT ? OFFSET ?";
      params.push(Math.floor(limit), Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0);
    }
    return db.prepare(sql).all(...params).map(rowToCategory);
  }

  function toPublicCategory(record) {
    return { ...record };
  }

  function slugify(title) {
    const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug === "" ? DEFAULT_CATEGORY_ID : slug;
  }

  function makeUniqueCategoryId(slug) {
    for (let suffix = 0; suffix < GAME_BIT; suffix += 1) {
      const candidate = suffix === 0 ? slug : `${slug}-${suffix + 1}`;
      if (!getByCategoryId(candidate)) return candidate;
    }
    throw new Error("Could not generate a unique focus category identifier");
  }

  function normalizeIcon(icon) {
    const trimmed = typeof icon === "string" ? icon.trim() : "";
    return trimmed.length > 0 ? trimmed : DEFAULT_ICON;
  }

  function resolveCategoryFilters(categoryIds) {
    const ids = normalizeList(categoryIds);
    if (ids.length === 0) {
      return { websiteHosts: [], applicationIds: [], resolvedCategoryIds: [], missingCategoryIds: [] };
    }
    const resolved = [];
    const missing = [];
    for (const id of ids) {
      const record = getByCategoryId(id);
      if (!record) {
        missing.push(id);
        continue;
      }
      resolved.push(record);
    }
    const resolvedIds = resolved.map((record) => record.categoryId);
    const timestamp = now();
    for (const id of resolvedIds) {
      db.prepare("UPDATE focus_categories SET accessed_at = ? WHERE id = ?").run(timestamp, id);
    }
    return {
      websiteHosts: normalizeList(resolved.flatMap((record) => record.websiteHosts)),
      applicationIds: normalizeList(resolved.flatMap((record) => record.applicationIds)),
      resolvedCategoryIds: resolvedIds,
      missingCategoryIds: missing,
    };
  }

  function isTimedSession(current) {
    return current.mode === "duration" || current.mode === "endDate";
  }

  function computeRemainingMs(current, timestamp) {
    if (current.status === "paused") {
      return Math.max(0, current.remainingMsAtPause ?? current.effectiveEndAtMs - timestamp);
    }
    return Math.max(0, current.effectiveEndAtMs - timestamp);
  }

  function getRemainingPauseDurationMs(current, timestamp) {
    if (current.pauseResumeAtMs == null) return null;
    return current.pauseResumeAtMs - timestamp;
  }

  function validateDuration(durationMs) {
    const value = Math.floor(durationMs);
    if (!Number.isFinite(value) || value <= 0) throw new Error("Focus session duration must be greater than zero");
    if (value > MAX_DURATION_MS) throw new Error("Focus session duration cannot exceed 24 hours");
    return value;
  }

  function normalizePauseDuration(durationMs) {
    return durationMs == null ? null : validateDuration(durationMs);
  }

  function createHostConfiguration(input) {
    return {
      title: typeof input.title === "string" && input.title.trim() !== "" ? input.title.trim() : DEFAULT_TITLE,
      mode: input.mode === "allow" ? "allow" : "block",
      categoryIds: normalizeList(input.categoryIds),
      raycastAppIds: normalizeList(input.raycastAppIds),
      websiteHosts: normalizeList(input.websiteHosts),
      allowAllOnEmptyWebsiteAllowlist: input.allowAllOnEmptyWebsiteAllowlist === true,
      snoozeDurationMs: typeof input.snoozeDurationMs === "number" && Number.isFinite(input.snoozeDurationMs) && input.snoozeDurationMs > 0
        ? Math.floor(input.snoozeDurationMs)
        : null,
      restoreAppsWhenSessionEnds: input.restoreAppsWhenSessionEnds === true,
    };
  }

  async function normalizeSessionStartInput(input) {
    const categoryIds = normalizeList(input.categoryIds);
    const websiteHosts = normalizeList(input.websiteHosts);
    const raycastAppIds = normalizeList(input.raycastAppIds);
    if (categoryIds.length === 0) {
      return { ...input, categoryIds, websiteHosts, raycastAppIds };
    }
    const resolved = resolveCategoryFilters(categoryIds);
    return {
      ...input,
      categoryIds,
      websiteHosts: normalizeList([...websiteHosts, ...resolved.websiteHosts]),
      raycastAppIds: normalizeList([...raycastAppIds, ...resolved.applicationIds]),
    };
  }

  function createSession(input, timestamp) {
    const hostConfiguration = createHostConfiguration(input);
    if (input.goal.mode === "noLimit") {
      return { id: crypto.randomUUID(), mode: "noLimit", status: "running", presentation: lastPresentation, startedAtMs: timestamp, hostConfiguration };
    }
    const durationMs = validateDuration(input.goal.durationMs);
    return {
      id: crypto.randomUUID(),
      mode: "duration",
      status: "running",
      presentation: lastPresentation,
      startedAtMs: timestamp,
      targetEndAtMs: timestamp + durationMs,
      effectiveEndAtMs: timestamp + durationMs,
      hostConfiguration,
    };
  }

  function toHostSession(current) {
    return {
      id: current.id,
      durationMs: isTimedSession(current) ? Math.max(0, current.targetEndAtMs - current.startedAtMs) : null,
      title: current.hostConfiguration.title,
      mode: current.hostConfiguration.mode,
      appRules: toAppRules(current.hostConfiguration.raycastAppIds),
      restoreAppsWhenSessionEnds: current.hostConfiguration.restoreAppsWhenSessionEnds,
      playSound: preferences.playSound === true,
      snoozeDurationMs: current.hostConfiguration.snoozeDurationMs ?? preferences.snoozeDurationMs ?? 180000,
    };
  }

  function toSessionStartInput(current) {
    return {
      title: current.hostConfiguration.title,
      mode: current.hostConfiguration.mode,
      categoryIds: current.hostConfiguration.categoryIds,
      raycastAppIds: current.hostConfiguration.raycastAppIds,
      websiteHosts: current.hostConfiguration.websiteHosts,
      allowAllOnEmptyWebsiteAllowlist: current.hostConfiguration.allowAllOnEmptyWebsiteAllowlist,
      snoozeDurationMs: current.hostConfiguration.snoozeDurationMs,
      restoreAppsWhenSessionEnds: current.hostConfiguration.restoreAppsWhenSessionEnds,
      goal: isTimedSession(current) ? { mode: "duration", durationMs: Math.max(1, current.targetEndAtMs - current.startedAtMs) } : { mode: "noLimit" },
    };
  }

  function toPublicState(current, timestamp) {
    if (!current) return null;
    const base = {
      id: current.id,
      title: current.hostConfiguration.title,
      status: current.status,
      mode: current.mode,
      presentation: current.presentation,
      pauseEndsAt: current.pauseResumeAtMs == null ? null : new Date(current.pauseResumeAtMs).toISOString(),
      startedAt: new Date(current.startedAtMs).toISOString(),
    };
    if (!isTimedSession(current)) {
      return { ...base, targetEndAt: null, effectiveEndAt: null, remainingMs: null };
    }
    return {
      ...base,
      targetEndAt: new Date(current.targetEndAtMs).toISOString(),
      effectiveEndAt: new Date(current.effectiveEndAtMs).toISOString(),
      remainingMs: computeRemainingMs(current, timestamp),
    };
  }

  function emitSessionChanged() {
    persistSession();
    if (typeof pushToFrontend === "function") {
      pushToFrontend("focus.sessionChanged", {
        session: toPublicState(session, now()),
        lastStartInput: lastSessionStartInput,
      });
    }
  }

  function clearCompletionTimer() {
    if (completionTimer) {
      clearTimeout(completionTimer);
      completionTimer = null;
    }
  }

  function clearPauseResumeTimer() {
    if (pauseResumeTimer) {
      clearTimeout(pauseResumeTimer);
      pauseResumeTimer = null;
    }
  }

  function scheduleCompletion(remainingMs) {
    clearCompletionTimer();
    const delay = Math.max(0, Math.floor(remainingMs));
    completionTimer = setTimeout(() => {
      completeSessionUnsafe("timer").catch((error) => {
        console.error("[focus] failed to auto-complete the session", error);
        const current = session;
        if (!current || current.status !== "running" || !isTimedSession(current)) return;
        if (computeRemainingMs(current, now()) > 0) scheduleCompletion(COMPLETION_RETRY_MS);
      });
    }, delay);
  }

  function schedulePauseResume(remainingMs) {
    clearPauseResumeTimer();
    if (remainingMs == null) return;
    const delay = Math.max(0, Math.floor(remainingMs));
    pauseResumeTimer = setTimeout(() => {
      resumeSessionUnsafe().catch((error) => console.error("[focus] failed to auto-resume the session", error));
    }, delay);
  }

  function hostCall(method, data) {
    if (typeof dispatch !== "function") return;
    Promise.resolve(dispatch(method, data)).catch((error) => console.error(`[focus] ${method} failed`, error));
  }

  function requireRunning(source) {
    if (!session || session.status !== "running") throw new Error(`No running focus session to ${source}`);
    return session;
  }

  const preferences = { snoozeDurationMs: 180000, playSound: true, restoreAppsWhenSessionEnds: false, allowAllOnEmptyWebsiteAllowlist: false };

  function readPreferences() {
    return { ...preferences };
  }

  function setPreference(key, value) {
    if (!(key in preferences)) throw new Error(`Unknown focus preference: ${key}`);
    preferences[key] = value;
    return readPreferences();
  }

  async function startSessionUnsafe(input, source) {
    if (session) throw new Error("Cannot start a focus session while another session is active");
    if (!input || typeof input.goal !== "object" || input.goal === null) throw new Error("Focus session input requires a goal");
    const normalized = await normalizeSessionStartInput(input);
    const created = createSession(normalized, now());
    hostCall("focus.startSession", toHostSession(created));
    session = created;
    lastSessionStartInput = toSessionStartInput(created);
    if (isTimedSession(created)) scheduleCompletion(computeRemainingMs(created, now()));
    else clearCompletionTimer();
    clearPauseResumeTimer();
    emitSessionChanged();
    console.log(JSON.stringify({ log: "focus session started", source, id: created.id, mode: created.mode }));
    return getSessionState();
  }

  async function updateSessionUnsafe(input) {
    if (!session) throw new Error("No active focus session to update");
    const timestamp = now();
    const normalized = await normalizeSessionStartInput(input);
    const hostConfiguration = createHostConfiguration(normalized);
    const elapsedMs = getElapsedSessionDurationMs(session, timestamp);
    const resumedStartMs = timestamp - elapsedMs;
    let updated;
    if (normalized.goal.mode === "noLimit") {
      updated = { ...session, mode: "noLimit", startedAtMs: resumedStartMs, hostConfiguration };
      delete updated.targetEndAtMs;
      delete updated.effectiveEndAtMs;
      delete updated.remainingMsAtPause;
    } else {
      const durationMs = validateDuration(normalized.goal.durationMs);
      const remainingMs = Math.max(0, durationMs - elapsedMs);
      if (remainingMs <= 0) throw new Error("Updated focus session duration must exceed elapsed time");
      updated = {
        ...session,
        mode: "duration",
        startedAtMs: resumedStartMs,
        targetEndAtMs: resumedStartMs + durationMs,
        effectiveEndAtMs: timestamp + remainingMs,
        hostConfiguration,
      };
      if (session.status === "paused") updated.remainingMsAtPause = remainingMs;
      else delete updated.remainingMsAtPause;
    }
    hostCall("focus.startSession", toHostSession(updated));
    if (updated.status === "paused") hostCall("focus.pauseSession", { durationMs: null });
    session = updated;
    lastSessionStartInput = toSessionStartInput(updated);
    if (updated.status === "running") {
      if (isTimedSession(updated)) scheduleCompletion(computeRemainingMs(updated, timestamp));
      else clearCompletionTimer();
      clearPauseResumeTimer();
    } else {
      clearCompletionTimer();
      schedulePauseResume(getRemainingPauseDurationMs(updated, timestamp));
    }
    emitSessionChanged();
    return getSessionState();
  }

  async function toggleSessionUnsafe(input, source) {
    if (!session) {
      if (!input || typeof input.goal !== "object" || input.goal === null) throw new Error("No active focus session to toggle");
      return startSessionUnsafe(input, source);
    }
    if (session.status === "running") return pauseSessionUnsafe(null);
    return resumeSessionUnsafe();
  }

  async function pauseSessionUnsafe(durationMs) {
    const current = requireRunning("pause");
    const normalized = normalizePauseDuration(durationMs);
    const timestamp = now();
    let paused;
    if (!isTimedSession(current)) {
      paused = { ...current, status: "paused", pauseResumeAtMs: normalized == null ? null : timestamp + normalized, pausedAtMs: timestamp };
    } else {
      const remainingMs = computeRemainingMs(current, timestamp);
      if (remainingMs <= 0) {
        await completeSessionUnsafe("timer");
        throw new Error("Cannot pause a completed focus session");
      }
      paused = {
        ...current,
        status: "paused",
        remainingMsAtPause: remainingMs,
        pauseResumeAtMs: normalized == null ? null : timestamp + normalized,
        pausedAtMs: timestamp,
      };
    }
    hostCall("focus.pauseSession", { durationMs: normalized });
    session = paused;
    clearCompletionTimer();
    schedulePauseResume(getRemainingPauseDurationMs(paused, timestamp));
    emitSessionChanged();
    return getSessionState();
  }

  async function resumeSessionUnsafe() {
    if (!session || session.status !== "paused") throw new Error("No paused focus session to resume");
    clearPauseResumeTimer();
    const timestamp = now();
    if (!isTimedSession(session)) {
      // The shipped resume shifts a no-limit session's start forward by the pause length so the
      // elapsed time excludes the pause.
      const shiftMs = session.pausedAtMs == null ? 0 : Math.max(0, timestamp - session.pausedAtMs);
      session = { ...session, status: "running", startedAtMs: session.startedAtMs + shiftMs, pauseResumeAtMs: null, pausedAtMs: null };
      hostCall("focus.resumeSession", {});
      clearCompletionTimer();
      emitSessionChanged();
      return getSessionState();
    }
    const remainingMs = session.remainingMsAtPause ?? computeRemainingMs(session, timestamp);
    if (remainingMs <= 0) {
      await completeSessionUnsafe("timer");
      throw new Error("Cannot resume a completed focus session");
    }
    session = { ...session, status: "running", effectiveEndAtMs: timestamp + remainingMs, pauseResumeAtMs: null };
    delete session.remainingMsAtPause;
    hostCall("focus.resumeSession", {});
    scheduleCompletion(remainingMs);
    emitSessionChanged();
    return getSessionState();
  }

  async function restartSessionUnsafe() {
    const current = session;
    const input = current ? toSessionStartInput(current) : lastSessionStartInput;
    if (!input) throw new Error("No focus session available to restart");
    clearCompletionTimer();
    clearPauseResumeTimer();
    session = null;
    try {
      return await startSessionUnsafe(input, "command");
    } catch (error) {
      session = current;
      emitSessionChanged();
      throw error;
    }
  }

  async function completeSessionUnsafe(source) {
    const current = session;
    if (!current) return null;
    hostCall("focus.completeSession", {});
    clearCompletionTimer();
    clearPauseResumeTimer();
    session = null;
    emitSessionChanged();
    console.log(JSON.stringify({ log: "focus session completed", source, id: current.id }));
    return getSessionState();
  }

  async function cancelSessionUnsafe() {
    const current = session;
    if (!current) return null;
    hostCall("focus.cancelSession", {});
    clearCompletionTimer();
    clearPauseResumeTimer();
    session = null;
    emitSessionChanged();
    return getSessionState();
  }

  function getElapsedSessionDurationMs(current, timestamp) {
    if (!isTimedSession(current)) {
      const end = current.status === "paused" ? current.pausedAtMs ?? timestamp : timestamp;
      return Math.max(0, end - current.startedAtMs);
    }
    const totalMs = Math.max(0, current.targetEndAtMs - current.startedAtMs);
    return Math.max(0, totalMs - computeRemainingMs(current, timestamp));
  }

  function getSessionState() {
    return { session: toPublicState(session, now()), lastStartInput: lastSessionStartInput, preferences: readPreferences() };
  }

  // Bootstrap: restore the persisted session, auto-complete expired ones and auto-resume expired
  // pauses (the shipped manager does the same at backend start), then re-sync the host.
  function bootstrap() {
    bootstrapCategories();
    if (!session) return getSessionState();
    if (session.status === "running" && isTimedSession(session)) {
      const remainingMs = computeRemainingMs(session, now());
      if (remainingMs <= 0) {
        completeSessionUnsafe("bootstrap").catch((error) => console.error("[focus] bootstrap completion failed", error));
        return getSessionState();
      }
      scheduleCompletion(remainingMs);
    }
    if (session.status === "paused") {
      const remainingPauseMs = getRemainingPauseDurationMs(session, now());
      if (remainingPauseMs != null && remainingPauseMs <= 0) {
        resumeSessionUnsafe().catch((error) => console.error("[focus] bootstrap resume failed", error));
        return getSessionState();
      }
      schedulePauseResume(remainingPauseMs);
    }
    hostCall("focus.startSession", toHostSession(session));
    if (session.status === "paused") hostCall("focus.pauseSession", { durationMs: null });
    return getSessionState();
  }

  function closeDatabase() {
    db.close();
  }

  const handlers = {
    getSession: () => getSessionState(),
    startSession: (data) => startSessionUnsafe(data ?? {}, "command"),
    updateSession: (data) => updateSessionUnsafe(data ?? {}),
    toggleSession: (data) => toggleSessionUnsafe(data ?? {}, "command"),
    pauseSession: (data) => pauseSessionUnsafe(data?.durationMs ?? null),
    resumeSession: () => resumeSessionUnsafe(),
    restartSession: () => restartSessionUnsafe(),
    completeSession: () => completeSessionUnsafe("manual"),
    cancelSession: () => cancelSessionUnsafe(),
    getSessionStartInput: () => ({ input: session ? toSessionStartInput(session) : lastSessionStartInput }),
    setPreferences: (data) => {
      for (const [key, value] of Object.entries(data ?? {})) setPreference(key, value);
      return readPreferences();
    },
    searchCategories: (data) => {
      const query = typeof data?.query === "string" && data.query.trim() !== "" ? data.query.trim() : null;
      const categories = listCategories(query, data?.limit, data?.offset);
      return { categories: categories.map(toPublicCategory) };
    },
    createCategory: (data) => {
      const title = String(data?.title ?? "").trim();
      if (title === "") throw new Error("Focus category title cannot be empty");
      const record = {
        categoryId: makeUniqueCategoryId(slugify(title)),
        kind: "custom",
        builtinId: null,
        title,
        icon: normalizeIcon(data?.icon),
        websiteHosts: normalizeList(data?.websiteHosts),
        applicationIds: normalizeList(data?.applicationIds),
      };
      insertCategory(record);
      return { category: toPublicCategory(record) };
    },
    updateCategory: (data) => {
      const categoryId = String(data?.categoryId ?? "").trim();
      if (categoryId === "") throw new Error("Focus category identifier cannot be empty");
      const existing = getByCategoryId(categoryId);
      if (!existing) throw new Error("Focus category not found");
      if (existing.kind !== "custom") throw new Error("Only custom focus categories can be updated");
      const title = String(data?.title ?? "").trim();
      if (title === "") throw new Error("Focus category title cannot be empty");
      const updated = {
        ...existing,
        title,
        icon: normalizeIcon(data?.icon),
        websiteHosts: normalizeList(data?.websiteHosts),
        applicationIds: normalizeList(data?.applicationIds),
      };
      insertCategory({ ...updated, updatedAt: now() });
      return { category: toPublicCategory({ ...updated, updatedAt: now() }) };
    },
    deleteCategory: (data) => {
      const categoryId = String(data?.categoryId ?? "").trim();
      const existing = getByCategoryId(categoryId);
      if (!existing) throw new Error("Focus category not found");
      if (existing.kind !== "custom") throw new Error("Only custom focus categories can be deleted");
      db.prepare("DELETE FROM focus_categories WHERE id = ?").run(categoryId);
      return { ok: true };
    },
    resolveCategoryFilters: (data) => resolveCategoryFilters(data?.categoryIds),
  };

  return {
    handlers,
    bootstrap,
    closeDatabase,
    toAppRules,
    // Exposed for tests: the raw session state machine without the host round-trip.
    getSessionState,
  };
}

module.exports = { createFocus, toAppRules, BUILTIN_CATEGORIES, MAX_DURATION_MS };
