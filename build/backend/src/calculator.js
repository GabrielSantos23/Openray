// Calculator handler — the `calculator.*` table in the clone's backend.
//
// Mirrors the shipped store contract (docs/calculator-spec.md): handlers `calculate` plus the
// history store `historyGetAll|Upsert|Delete|DeleteAll|Pin|Unpin|MovePinnedUp|MovePinnedDown`
// with the 4096-entry cap and the 90-day retention purge, and the currency-rate cache with the
// confirmed 2-hour minimum refresh interval. Rates come from open.er-api.com (the one
// network-allowed feature, cached in `calculator-rates.json`); offline falls back to the cache
// and reports a clear error when there is none.
//
// `calculateExpression` is the synchronous engine entry the snippet/quicklink placeholder
// resolution uses (`{calculator expression=…}`), evaluated against the in-memory rate table.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { evaluate, swapUnits } = require("./calculator-engine");

const RATE_URL = "https://open.er-api.com/v6/latest/USD";
const RATE_REFRESH_INTERVAL_MS = 7200 * 1000; // confirmed 2 h minimum
const RATE_FETCH_TIMEOUT_MS = 5000; // the shipped engine's 5 s outer timeout
const HISTORY_LIMIT = 4096; // confirmed historyUpsert cap
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // confirmed "preserved for the last 3 months"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calculator_history (
  id TEXT PRIMARY KEY,
  expression TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL,
  pinned_order INTEGER,
  created_at INTEGER NOT NULL
);
`;

function createCalculator({ pushToFrontend, dataRoot, fetchImpl, now = () => Date.now(), historyLimit = HISTORY_LIMIT } = {}) {
  const root = dataRoot ?? path.join(process.env.LOCALAPPDATA ?? process.env.HOME ?? ".", "RaycastMini");
  const databasePath = path.join(root, "calculator.sqlite");
  const ratesPath = path.join(root, "calculator-rates.json");
  const settingsPath = path.join(root, "calculator-settings.json");
  const fetchJson = fetchImpl ?? ((url, init) => fetch(url, init));

  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(SCHEMA);

  const preferences = { remToPxRate: 16 };
  try {
    Object.assign(preferences, JSON.parse(fs.readFileSync(settingsPath, "utf-8")));
  } catch {
    /* first run keeps the default */
  }

  // Rates live in memory so `calculateExpression` stays synchronous for the placeholder engine;
  // a cache file from a previous run loads at startup and the network only ever refreshes it.
  let rates = null;
  let ratesFetchedAt = 0;
  let ratesFetchInFlight = null;
  try {
    const cached = JSON.parse(fs.readFileSync(ratesPath, "utf-8"));
    if (cached && cached.rates && typeof cached.rates === "object") {
      rates = cached.rates;
      ratesFetchedAt = Number(cached.fetchedAt ?? 0);
    }
  } catch {
    /* no cache yet */
  }

  purgeOldEntries();

  function purgeOldEntries() {
    db.prepare("DELETE FROM calculator_history WHERE pinned_order IS NULL AND created_at < ?").run(now() - RETENTION_MS);
  }

  function persistRates() {
    try {
      fs.writeFileSync(ratesPath, JSON.stringify({ base: "USD", rates, fetchedAt: ratesFetchedAt }, null, 2));
    } catch (error) {
      console.error("[calculator] could not persist the rate cache", error);
    }
  }

  async function fetchRates() {
    const response = await fetchJson(RATE_URL, { signal: AbortSignal.timeout(RATE_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`rate endpoint returned ${response.status}`);
    const payload = await response.json();
    const table = payload?.rates;
    if (payload?.result !== "success" || !table || typeof table !== "object") {
      throw new Error("rate endpoint returned no rate table");
    }
    const normalized = {};
    for (const [code, value] of Object.entries(table)) {
      const rate = Number(value);
      if (Number.isFinite(rate) && rate > 0) normalized[String(code).toUpperCase()] = rate;
    }
    rates = normalized;
    ratesFetchedAt = now();
    persistRates();
    return rates;
  }

  function ratesAreStale() {
    return ratesFetchedAt <= 0 || now() - ratesFetchedAt > RATE_REFRESH_INTERVAL_MS;
  }

  /** Refreshes at most every 2 h; failures keep the stale cache (offline fallback). */
  function getRates({ force = false } = {}) {
    if (!force && rates && !ratesAreStale()) return Promise.resolve(rates);
    if (ratesFetchInFlight) return ratesFetchInFlight;
    ratesFetchInFlight = fetchRates()
      .catch((error) => {
        console.warn("[calculator] could not refresh currency rates:", error.message);
        return rates;
      })
      .finally(() => {
        ratesFetchInFlight = null;
      });
    return ratesFetchInFlight;
  }

  function notifyChanged() {
    if (typeof pushToFrontend === "function") {
      Promise.resolve(pushToFrontend("calculator.updated", {})).catch(() => undefined);
    }
  }

  function rows() {
    return db
      .prepare(
        `SELECT * FROM calculator_history
         ORDER BY CASE WHEN pinned_order IS NULL THEN 1 ELSE 0 END, pinned_order ASC, created_at DESC`,
      )
      .all();
  }

  function movePinned(id, direction) {
    const pinned = db
      .prepare("SELECT id, pinned_order FROM calculator_history WHERE pinned_order IS NOT NULL ORDER BY pinned_order ASC")
      .all();
    const index = pinned.findIndex((row) => row.id === id);
    if (index === -1) return;
    const target = index + direction;
    if (target < 0 || target >= pinned.length) return;
    const swapped = pinned[index];
    pinned[index] = pinned[target];
    pinned[target] = swapped;
    const update = db.prepare("UPDATE calculator_history SET pinned_order = ? WHERE id = ?");
    pinned.forEach((row, position) => update.run(position + 1, row.id));
  }

  function deleteExceedingLimit() {
    const count = db.prepare("SELECT COUNT(*) AS total FROM calculator_history").get().total;
    if (count <= historyLimit) return;
    // Pinned entries survive the cap; oldest unpinned go first.
    db.prepare(
      `DELETE FROM calculator_history WHERE id IN (
         SELECT id FROM calculator_history WHERE pinned_order IS NULL ORDER BY created_at ASC LIMIT ?)`,
    ).run(count - historyLimit);
  }

  function ratesMeta() {
    if (!rates) return null;
    return { fetchedAt: ratesFetchedAt, stale: ratesAreStale() };
  }

  const handlers = {
    calculate({ expression, locale } = {}) {
      // Past the 2 h interval the refresh happens in the background; the response always carries
      // the in-memory rates plus the stale flag, and the row shows "Currency rates are out of
      // date" until it lands. With no rates at all the offline error is the answer — no retry
      // storm per keystroke.
      if (rates && ratesAreStale()) void getRates();
      const result = evaluate(String(expression ?? ""), {
        rates,
        remToPxRate: preferences.remToPxRate,
        locale: typeof locale === "string" && locale ? locale : undefined,
      });
      if (!result.ok) {
        return { result: null, error: result.error ?? null, rates: ratesMeta() };
      }
      return { result, error: null, rates: ratesMeta() };
    },

    swapUnits({ expression } = {}) {
      const swapped = swapUnits(String(expression ?? ""), {
        rates,
        remToPxRate: preferences.remToPxRate,
      });
      return { expression: swapped ?? null };
    },

    async refreshCurrencies() {
      // Force the fetch here rather than through getRates, whose failure fallback (keep the
      // stale cache) must not mask the action's confirmed error strings.
      try {
        await fetchRates();
      } catch {
        if (!rates) throw new Error("Currency rates unavailable offline");
        throw new Error("Failed to refresh currencies");
      }
      return { fetchedAt: ratesFetchedAt };
    },

    getPreferences() {
      return { ...preferences };
    },

    setPreference({ key, value } = {}) {
      if (key !== "remToPxRate") throw new Error(`Unknown calculator preference: ${key}`);
      const rate = Number(value);
      if (!Number.isFinite(rate) || rate < 1) throw new Error("The pixel rate must be a number of at least 1");
      preferences.remToPxRate = rate;
      try {
        fs.writeFileSync(settingsPath, JSON.stringify(preferences, null, 2));
      } catch (error) {
        console.error("[calculator] could not persist preferences", error);
      }
      return { value: preferences.remToPxRate };
    },

    historyGetAll() {
      return {
        entries: rows().map((row) => ({
          id: row.id,
          expression: row.expression,
          answer: row.answer,
          category: row.category,
          pinned: row.pinned_order ?? null,
          createdAt: row.created_at,
        })),
      };
    },

    historyUpsert({ expression, answer, category } = {}) {
      const text = String(expression ?? "").trim();
      const value = String(answer ?? "").trim();
      if (!text || !value) throw new Error("Expression and answer are required");
      const existing = db
        .prepare("SELECT id FROM calculator_history WHERE expression = ? AND answer = ?")
        .get(text, value);
      let id;
      if (existing) {
        id = existing.id;
        db.prepare("UPDATE calculator_history SET created_at = ? WHERE id = ?").run(now(), id);
      } else {
        id = crypto.randomUUID();
        db.prepare(
          `INSERT INTO calculator_history (id, expression, answer, category, pinned_order, created_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
        ).run(id, text, value, String(category ?? "math"), now());
        deleteExceedingLimit();
      }
      notifyChanged();
      return { id };
    },

    historyDelete({ id } = {}) {
      db.prepare("DELETE FROM calculator_history WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    historyDeleteAll({ includePinned } = {}) {
      if (includePinned === true) {
        db.prepare("DELETE FROM calculator_history").run();
      } else {
        db.prepare("DELETE FROM calculator_history WHERE pinned_order IS NULL").run();
      }
      notifyChanged();
      return { ok: true };
    },

    historyPin({ id } = {}) {
      db.prepare("UPDATE calculator_history SET pinned_order = pinned_order + 1 WHERE pinned_order IS NOT NULL").run();
      db.prepare("UPDATE calculator_history SET pinned_order = 0 WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    historyUnpin({ id } = {}) {
      db.prepare("UPDATE calculator_history SET pinned_order = NULL WHERE id = ?").run(id);
      notifyChanged();
      return { ok: true };
    },

    historyMovePinnedUp({ id } = {}) {
      movePinned(id, -1);
      notifyChanged();
      return { ok: true };
    },

    historyMovePinnedDown({ id } = {}) {
      movePinned(id, 1);
      notifyChanged();
      return { ok: true };
    },
  };

  return {
    handlers,
    databasePath,
    ratesPath,
    // Synchronous engine access for the placeholder resolver ({calculator expression=…}) in
    // snippets and quicklinks; uses whatever rates are cached in memory.
    calculateExpression(expression) {
      const result = evaluate(String(expression ?? ""), { rates, remToPxRate: preferences.remToPxRate });
      return result.ok ? result.unformatted : null;
    },
    /** Startup refresh — non-blocking, keeps the cache warm within the 2 h interval. */
    warmRates() {
      return getRates();
    },
    purgeOldEntries,
    close() {
      db.close();
    },
  };
}

module.exports = { createCalculator, RATE_REFRESH_INTERVAL_MS };
