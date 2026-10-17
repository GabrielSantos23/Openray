// The Calculator (`calculator.*` handlers + the pure engine): arithmetic/percentage/unit/currency
// evaluation against a stubbed rate table, rem/em through the pixel-rate preference, the history
// store (upsert dedupe, pin ordering, 4096 cap, 90-day retention) and the rate cache (2 h minimum
// refresh interval, offline fallback to the stale cache, clear offline error). The engine never
// touches the network — rates are always injected or loaded from the cache file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { evaluate, formatNumber } = require("../src/calculator-engine.js");
const { createCalculator } = require("../src/calculator.js");

let cleanupQueue = [];

function withRoot(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "calculator-"));
  cleanupQueue = [];
  const cleanup = () => {
    for (const close of cleanupQueue) {
      try {
        close();
      } catch {
        /* already closed */
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  };
  // Async bodies must settle before the store closes and the directory goes away.
  const result = run(directory);
  if (result instanceof Promise) return result.finally(cleanup);
  cleanup();
  return result;
}

const RATES = { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 151.4, BRL: 5.32 };
const LOCALE = "en-US";

// ---------------------------------------------------------------------------------------------
// Engine — arithmetic, percentages, functions, number formats
// ---------------------------------------------------------------------------------------------

function ok(expression, options = {}) {
  const result = evaluate(expression, { rates: RATES, locale: LOCALE, ...options });
  assert.equal(result.ok, true, `expected "${expression}" to evaluate, got ${JSON.stringify(result)}`);
  return result;
}

function noResult(expression, options = {}) {
  const result = evaluate(expression, { rates: RATES, locale: LOCALE, ...options });
  assert.equal(result.ok, false, `expected "${expression}" to produce no result, got ${JSON.stringify(result)}`);
  return result;
}

test("arithmetic follows precedence with parentheses, powers and unary minus", () => {
  assert.equal(ok("2+2*3").unformatted, "8");
  assert.equal(ok("(2+2)*3").unformatted, "12");
  assert.equal(ok("2^10").unformatted, "1024");
  assert.equal(ok("10/4").unformatted, "2.5");
  assert.equal(ok("7 % 3").unformatted, "1");
  assert.equal(ok("-2^2").unformatted, "-4");
  assert.equal(ok("2^-3").unformatted, "0.125");
  assert.equal(ok("2 * -3").unformatted, "-6");
});

test("percentage forms: bare suffix, of, and add/subtract on a base", () => {
  const bare = ok("25%");
  assert.equal(bare.unformatted, "0.25");
  assert.equal(bare.evaluationType, "percentage");
  assert.equal(ok("25% of 500").unformatted, "125");
  assert.equal(ok("500 + 10%").unformatted, "550");
  assert.equal(ok("500 - 10%").unformatted, "450");
  assert.equal(ok("200 * 15%").unformatted, "30");
});

test("functions and constants", () => {
  assert.equal(ok("sqrt(9)").unformatted, "3");
  assert.equal(ok("min(3, 1, 2)").unformatted, "1");
  assert.equal(ok("max(4, 9)").unformatted, "9");
  assert.equal(ok("pow(2, 10)").unformatted, "1024");
  assert.equal(ok("log(100)").unformatted, "2");
  assert.equal(ok("ln(e)").unformatted, "1");
  assert.equal(ok("abs(3 - 8)").unformatted, "5");
  const pi = ok("pi");
  assert.ok(Math.abs(Number(pi.unformatted) - Math.PI) < 1e-9);
});

test("number formats: grouping underscores, radix prefixes, exponent", () => {
  assert.equal(ok("1_000 + 1").unformatted, "1001");
  assert.equal(ok("0xff").unformatted, "255");
  assert.equal(ok("0b101").unformatted, "5");
  assert.equal(ok("0o17").unformatted, "15");
  assert.equal(ok("1e3").unformatted, "1000");
});

test("answer formatting uses the locale and the unformatted copy stays raw", () => {
  assert.equal(ok("5 GB to MB").answer, "5,000 MB");
  assert.equal(ok("5 GB to MB").unformatted, "5000");
  assert.equal(formatNumber(1234567.891, "en-US"), "1,234,567.891");
  assert.equal(formatNumber(0.25, "en-US"), "0.25");
});

// ---------------------------------------------------------------------------------------------
// Engine — unit conversions
// ---------------------------------------------------------------------------------------------

test("unit conversions across dimensions, with metadata and a round-tripping swap", () => {
  const miles = ok("10 km to mi");
  assert.ok(Math.abs(Number(miles.unformatted) - 6.213711922373339) < 1e-6);
  assert.equal(miles.category, "unitConversion");
  assert.equal(miles.evaluationType, "unitExpression");
  assert.equal(miles.metadataType, "conversion");
  assert.equal(miles.unitFrom, "km");
  assert.equal(miles.unitTo, "mi");
  assert.equal(miles.swappedExpression, "10 mi to km");
  const back = evaluate(miles.swappedExpression, { rates: RATES, locale: LOCALE });
  assert.equal(back.ok, true);
  assert.ok(Math.abs(Number(back.unformatted) - 16.09344) < 1e-6, "the swapped expression converts the other way");

  assert.equal(ok("5 GB to MB").unformatted, "5000");
  assert.equal(ok("5 GiB to MiB").unformatted, "5120");
  assert.ok(Math.abs(Number(ok("100 °f to c").unformatted) - 37.77777777777778) < 1e-6);
  assert.equal(ok("90 min to h").unformatted, "1.5");
  assert.ok(Math.abs(Number(ok("1 kg to lb").unformatted) - 2.2046226218487757) < 1e-6);
  assert.equal(ok("10 kilometers to miles").category, "unitConversion");
  assert.equal(ok("5 in in cm").unformatted, "12.7");
  assert.equal(ok("12 h to min").unformatted, "720");
});

test("rem/em convert through the configured pixel rate", () => {
  assert.equal(ok("2rem to px").unformatted, "32");
  assert.equal(ok("2rem to px", { remToPxRate: 14 }).unformatted, "28");
  assert.equal(ok("32 px to em").unformatted, "2");
  noResult("5 km to px");
});

test("currency conversions use the supplied rate table, including symbol-led amounts", () => {
  const eur = ok("100 usd to eur");
  assert.equal(eur.answer, "92 EUR");
  assert.equal(eur.currencyFrom, "USD");
  assert.equal(eur.currencyTo, "EUR");
  assert.equal(eur.swappedExpression, "100 eur to usd");

  const gbp = ok("$500 in GBP");
  assert.equal(gbp.answer, "395 GBP");
  assert.equal(gbp.swappedExpression, "500 GBP in USD");

  assert.equal(ok("25% of $500 in GBP").unformatted, "98.75");
  const cross = ok("200 eur to gbp");
  assert.ok(Math.abs(Number(cross.unformatted) - (200 / 0.92) * 0.79) < 1e-9);
});

test("currency conversions without rates fail with the clear offline error", () => {
  const result = evaluate("100 usd to eur", { rates: null, locale: LOCALE });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Currency rates unavailable offline");
});

test("malformed input never evaluates — prose and broken expressions produce no row", () => {
  for (const expression of ["2+", "foo bar", "(", "notepad", "5 xyz to eur", "", "hello world 2"]) {
    noResult(expression);
  }
});

// ---------------------------------------------------------------------------------------------
// History store
// ---------------------------------------------------------------------------------------------

function makeCalculator(directory, options = {}) {
  const calculator = createCalculator({ dataRoot: directory, ...options });
  cleanupQueue.push(() => calculator.close());
  return calculator;
}

test("historyUpsert inserts, dedupes on expression+answer, and orders pinned first", () => {
  withRoot((root) => {
    const { handlers } = makeCalculator(root);
    const first = handlers.historyUpsert({ expression: "2+2", answer: "4", category: "math" });
    handlers.historyUpsert({ expression: "1+1", answer: "2", category: "math" });
    handlers.historyUpsert({ expression: "2+2", answer: "4", category: "math" });
    let entries = handlers.historyGetAll().entries;
    assert.equal(entries.length, 2, "duplicate expression+answer updates in place");
    assert.equal(entries[0].expression, "2+2", "the upserted entry moves to the top");

    handlers.historyPin({ id: entries[1].id });
    entries = handlers.historyGetAll().entries;
    assert.equal(entries[0].expression, "1+1");
    assert.equal(entries[0].pinned, 0);
    assert.equal(entries[1].pinned, null);

    handlers.historyUnpin({ id: entries[0].id });
    entries = handlers.historyGetAll().entries;
    assert.equal(entries[0].pinned, null);
    assert.equal(first.id, entries[0].id, "the deduped entry kept its id through the bump");
  });
});

test("historyPin ordering supports movePinnedUp/movePinnedDown", () => {
  withRoot((root) => {
    const { handlers } = makeCalculator(root);
    const a = handlers.historyUpsert({ expression: "1", answer: "1", category: "math" });
    const b = handlers.historyUpsert({ expression: "2", answer: "2", category: "math" });
    const c = handlers.historyUpsert({ expression: "3", answer: "3", category: "math" });
    for (const entry of [a, b, c]) handlers.historyPin({ id: entry.id });
    let entries = handlers.historyGetAll().entries;
    assert.deepEqual(entries.map((entry) => entry.expression), ["3", "2", "1"]);

    handlers.historyMovePinnedDown({ id: c.id });
    entries = handlers.historyGetAll().entries;
    assert.deepEqual(entries.map((entry) => entry.expression), ["2", "3", "1"]);

    handlers.historyMovePinnedUp({ id: c.id });
    entries = handlers.historyGetAll().entries;
    assert.deepEqual(entries.map((entry) => entry.expression), ["3", "2", "1"]);
  });
});

test("historyDelete and historyDeleteAll keep pinned entries unless includePinned", () => {
  withRoot((root) => {
    const { handlers } = makeCalculator(root);
    const a = handlers.historyUpsert({ expression: "1", answer: "1", category: "math" });
    handlers.historyUpsert({ expression: "2", answer: "2", category: "math" });
    handlers.historyPin({ id: a.id });

    handlers.historyDelete({ id: a.id });
    assert.equal(handlers.historyGetAll().entries.length, 1);

    handlers.historyUpsert({ expression: "3", answer: "3", category: "math" });
    handlers.historyPin({ id: handlers.historyGetAll().entries[0].id });
    handlers.historyDeleteAll({});
    const kept = handlers.historyGetAll().entries;
    assert.equal(kept.length, 1);
    assert.notEqual(kept[0].pinned, null);

    handlers.historyDeleteAll({ includePinned: true });
    assert.equal(handlers.historyGetAll().entries.length, 0);
  });
});

test("the history cap keeps the newest entries and never drops pinned ones", () => {
  withRoot((root) => {
    let tick = 1_700_000_000_000;
    const { handlers } = makeCalculator(root, { historyLimit: 50, now: () => (tick += 5) });
    const pinned = handlers.historyUpsert({ expression: "pinned", answer: "0", category: "math" });
    handlers.historyPin({ id: pinned.id });
    for (let index = 0; index < 60; index += 1) {
      handlers.historyUpsert({ expression: `expr ${index}`, answer: String(index), category: "math" });
    }
    const entries = handlers.historyGetAll().entries;
    assert.equal(entries.length, 50);
    assert.ok(entries.some((entry) => entry.id === pinned.id), "pinned entry survives the cap");
    assert.equal(entries.filter((entry) => entry.expression === "expr 0").length, 0, "oldest unpinned dropped");
    assert.ok(entries.some((entry) => entry.expression === "expr 59"), "newest kept");
  });
});

test("entries older than 90 days are purged on startup", () => {
  withRoot((root) => {
    const base = 1_700_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    const first = makeCalculator(root, { now: () => base });
    first.handlers.historyUpsert({ expression: "old", answer: "1", category: "math" });
    first.close();
    cleanupQueue.pop();

    // Reopening 91 days later: the constructor purge drops the base-anchored entry.
    const second = makeCalculator(root, { now: () => base + 91 * day });
    assert.deepEqual(second.handlers.historyGetAll().entries, [], "the 90-day-old entry is gone");
    second.handlers.historyUpsert({ expression: "new", answer: "2", category: "math" });
    second.close();
    cleanupQueue.pop();

    const third = makeCalculator(root, { now: () => base + 92 * day });
    const expressions = third.handlers.historyGetAll().entries.map((entry) => entry.expression);
    assert.deepEqual(expressions, ["new"], "the recent entry survives");
  });
});

// ---------------------------------------------------------------------------------------------
// Rate cache
// ---------------------------------------------------------------------------------------------

function stubFetch(payload, { fail = false, calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    if (fail) throw new Error("network unreachable");
    return {
      ok: true,
      json: async () => payload,
    };
  };
}

const RATE_PAYLOAD = { result: "success", rates: { usd: 1, eur: 0.92, gbp: 0.79 } };

test("rates are fetched once and cached for the confirmed 2 h interval", async () => {
  await withRoot(async (root) => {
    const calls = [];
    let clock = 1_700_000_000_000;
    const { handlers, warmRates, ratesPath } = makeCalculator(root, {
      fetchImpl: stubFetch(RATE_PAYLOAD, { calls }),
      now: () => clock,
    });
    await warmRates();
    assert.equal(calls.length, 1);

    clock += 60 * 60 * 1000; // 1 h later — still fresh
    assert.equal(handlers.calculate({ expression: "100 usd to eur" }).result.answer, "92 EUR");
    assert.equal(calls.length, 1, "no refetch inside the 2 h window");

    assert.ok(fs.existsSync(ratesPath), "the cache file is written");
    clock += 3 * 60 * 60 * 1000; // past the interval
    const stale = handlers.calculate({ expression: "100 usd to eur" });
    assert.equal(stale.rates.stale, true, "the response reports staleness");
    assert.equal(calls.length, 2, "a background refresh fires past the interval");
  });
});

test("calculate is synchronous-safe before rates arrive and reports the offline error", () => {
  withRoot((root) => {
    const { handlers, calculateExpression } = makeCalculator(root, {
      fetchImpl: stubFetch(RATE_PAYLOAD, { fail: true }),
    });
    assert.equal(calculateExpression("2+2*3"), "8", "math needs no rates");
    assert.equal(calculateExpression("100 usd to eur"), null, "no rates -> no currency answer");
    const result = handlers.calculate({ expression: "100 usd to eur" });
    assert.equal(result.result, null);
    assert.equal(result.error, "Currency rates unavailable offline");
  });
});

test("offline with a stale cache keeps converting; refreshCurrencies reports failure", async () => {
  await withRoot(async (root) => {
    const calls = [];
    let clock = 1_700_000_000_000;
    const warm = makeCalculator(root, { fetchImpl: stubFetch(RATE_PAYLOAD, { calls }), now: () => clock });
    await warm.warmRates();
    warm.close();
    cleanupQueue.pop();

    const offline = makeCalculator(root, {
      fetchImpl: stubFetch(RATE_PAYLOAD, { calls, fail: true }),
      now: () => clock,
    });
    assert.equal(offline.handlers.calculate({ expression: "100 usd to eur" }).result.answer, "92 EUR", "stale cache used");

    clock += 3 * 60 * 60 * 1000;
    await assert.rejects(() => offline.handlers.refreshCurrencies(), /Failed to refresh currencies/);
    assert.equal(offline.handlers.calculate({ expression: "100 usd to eur" }).result.answer, "92 EUR", "still convertible from the cache");

    offline.close();
    cleanupQueue.pop();
    const recovered = makeCalculator(root, {
      fetchImpl: stubFetch(RATE_PAYLOAD, { calls }),
      now: () => clock,
    });
    await recovered.handlers.refreshCurrencies();
    const meta = recovered.handlers.calculate({ expression: "100 usd to eur" }).rates;
    assert.equal(meta.stale, false, "a successful refresh clears the stale flag");
  });
});

test("calculateExpression is the synchronous placeholder entry ({calculator expression=…})", async () => {
  await withRoot(async (root) => {
    const { calculateExpression, warmRates } = makeCalculator(root, {
      fetchImpl: stubFetch(RATE_PAYLOAD, {}),
    });
    assert.equal(calculateExpression("2+2*3"), "8");
    assert.equal(calculateExpression("foo bar"), null);
    await warmRates();
    assert.equal(calculateExpression("100 usd to eur"), "92", "unformatted result for placeholders");
  });
});

test("currency names and shorthand resolve like their codes, accents included", () => {
  assert.equal(ok("100 dol to eur").answer, "92 EUR");
  assert.equal(ok("100 dólar to euro").answer, "92 EUR", "accented identifiers tokenize whole");
  assert.equal(ok("100 dollars in reais").answer, "532 BRL");
  assert.equal(ok("50 euro to real").currencyTo, "BRL");
  const gbp = ok("$500 in GBP");
  assert.equal(gbp.answer, "395 GBP", "the symbol form keeps working");
  const offline = evaluate("100 dol to eur", { rates: null, locale: LOCALE });
  assert.equal(offline.error, "Currency rates unavailable offline", "aliases keep the offline intent");
});

test("suffix symbols and r$-style compounds convert like the prefix form", () => {
  const D = "$";
  const suffixed = ok(`100${D} in r${D}`);
  assert.equal(suffixed.answer, "532 BRL", "`100$ in r$` reads as 100 USD in BRL");
  assert.equal(suffixed.swappedExpression, `100 r${D} in USD`, "the swap re-evaluates (r$ resolves back)");
  assert.equal(ok(`r${D}100 in usd`).answer, "18.79699248 USD");
  assert.equal(ok(`100${D} to eur`).answer, "92 EUR");
  assert.equal(ok(`100${D}`).unformatted, "100", "a glued suffix alone is plain math");
  assert.equal(ok("25% of 100$ in eur").unformatted, "23");
});

test("time in a place resolves locally with the place and GMT offset as badges", () => {
  const fixed = new Date("2026-10-11T12:00:00Z").getTime();
  const china = evaluate("time in china", { locale: "en-US", now: fixed });
  assert.equal(china.ok, true);
  assert.equal(china.category, "dateTime");
  assert.equal(china.metadataType, "timeAtPlaceSeeking");
  assert.equal(china.unitFrom, "China");
  assert.equal(china.unitTo, "GMT+8");
  assert.equal(
    china.answer,
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(fixed),
  );

  const newYork = evaluate("time in new york", { locale: "en-US", now: fixed });
  assert.equal(newYork.unitFrom, "New York");
  assert.equal(newYork.unitTo, "GMT-4");

  const suffix = evaluate("china time", { locale: "en-US", now: fixed });
  assert.equal(suffix.ok, true);
  assert.equal(suffix.answer, china.answer, "`china time` matches `time in china`");

  const direct = evaluate("time in asia/tokyo", { locale: "en-US", now: fixed });
  assert.equal(direct.unitFrom, "Tokyo");

  noResult("time in atlantis");
  noResult("foo bar time");
});

test("the remToPxRate preference validates and persists", () => {
  withRoot((root) => {
    const { handlers } = makeCalculator(root);
    assert.throws(() => handlers.setPreference({ key: "remToPxRate", value: 0 }), /at least 1/);
    assert.throws(() => handlers.setPreference({ key: "bogus", value: 1 }), /Unknown calculator preference/);
    handlers.setPreference({ key: "remToPxRate", value: 14 });
    assert.equal(handlers.getPreferences().remToPxRate, 14);
    assert.equal(handlers.calculate({ expression: "2rem to px" }).result.unformatted, "28");

    const reopened = makeCalculator(root);
    assert.equal(reopened.handlers.getPreferences().remToPxRate, 14, "preference survives a restart");
  });
});

test("color conversion: parse, formats, closest name and the enable switches", () => {
  withRoot((root) => {
    const { handlers } = makeCalculator(root);
    const white = handlers.getColor({ input: "#fff" });
    assert.ok(white, "#fff parses");
    assert.equal(white.hex, "#FFFFFF");
    assert.equal(white.name, "white");
    const formatIds = white.formats.map((format) => format.id);
    assert.ok(formatIds.includes("hex") && formatIds.includes("hsl") && formatIds.includes("uiColor"), "Raycast format list");

    const red = handlers.getColor({ input: "rgb(255, 0, 0)" });
    assert.equal(red.hex, "#FF0000");
    assert.equal(red.name, "red");

    assert.equal(handlers.getColor({ input: "not a color" }), null);

    handlers.setPreference({ key: "enableColorDetection", value: false });
    handlers.setPreference({ key: "syntaxHighlighting", value: true });
    const reopened = makeCalculator(root);
    assert.equal(reopened.handlers.getPreferences().enableColorDetection, false, "switch survives a restart");
    assert.equal(reopened.handlers.getPreferences().syntaxHighlighting, true);
  });
});
