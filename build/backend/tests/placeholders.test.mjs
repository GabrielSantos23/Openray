// The dynamic placeholder engine (`docs/quicklinks-spec.md`, section "Placeholder engine").
// Pinned: syntax parsing (quoted options, modifiers), the per-context output encoding, each
// resolver's semantics and error strings, the argument limit, and right-to-left replacement.

import assert from "node:assert/strict";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { enumerateArguments, formatDate, parsePlaceholders, resolvePlaceholders } = require("../src/placeholders.js");

const NOW = new Date(2026, 9, 10, 14, 30, 5);

function resolve(text, context = {}) {
  return resolvePlaceholders(text, {
    now: NOW,
    arguments: [],
    ...context,
    context: context.context ?? "quicklink",
  });
}

test("parsePlaceholders reads keywords, quoted options and modifiers; stray braces stay literal", () => {
  const parsed = parsePlaceholders('https://x.test/?q={argument name="Source Language" default="auto"|trim}');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].keyword, "argument");
  assert.deepEqual(parsed[0].options, { name: "Source Language", default: "auto" });
  assert.deepEqual(parsed[0].modifiers, ["trim"]);

  assert.deepEqual(parsePlaceholders("{Query"), [], "a legacy-style token is not a placeholder");
  assert.deepEqual(parsePlaceholders("no braces at all"), []);
  assert.deepEqual(parsePlaceholders("{not a placeholder}"), [], "bare words after the keyword are not options");
  assert.deepEqual(parsePlaceholders("{}"), []);
});

test("argument placeholders resolve positionally by distinct name and honor defaults", () => {
  const resolved = resolve("https://google.com/search?q={argument name=\"Query\"}", { arguments: ["raycast"] });
  assert.equal(resolved.text, "https://google.com/search?q=raycast");

  const defaulted = resolve("{argument name=\"Query\" default=\"auto\"}", {});
  assert.equal(defaulted.text, "auto");

  const positional = resolve("{argument name=\"A\"} and {argument name=\"B\"}", { arguments: ["first", "second"] });
  assert.equal(positional.text, "first and second");

  const shared = resolve("{argument name=\"A\"}/{argument name=\"A\"}", { arguments: ["x"] });
  assert.equal(shared.text, "x/x");

  assert.throws(
    () => resolve("{argument name=\"A\"} {argument name=\"B\"} {argument name=\"C\"} {argument name=\"D\"}", { arguments: ["1", "2", "3", "4"] }),
    /Only 3 different Arguments are allowed/,
  );

  assert.equal(resolve("{argument name=\"Missing\"}", { arguments: [] }).text, "");
});

test("the quicklink context percent-encodes values unless |raw is present", () => {
  assert.equal(resolve("{argument name=\"Q\"}", { arguments: ["hello world"] }).text, "hello%20world");
  assert.equal(resolve("{argument name=\"Q\"|raw}", { arguments: ["hello world"] }).text, "hello world");
  assert.equal(
    resolve("{argument name=\"Q\"|raw|uppercase}", { arguments: ["hello world"] }).text,
    "HELLO WORLD",
    "raw disables the context encoding, other modifiers still apply",
  );
  assert.equal(resolve("{argument name=\"Q\"}", { arguments: ["a/b?c=d"] }).text, "a%2Fb%3Fc%3Dd");
});

test("modifiers behave as confirmed", () => {
  assert.equal(resolve("{argument name=\"Q\"|uppercase}", { arguments: ["abc"] }).text, "ABC");
  assert.equal(resolve("{argument name=\"Q\"|lowercase}", { arguments: ["ABC"] }).text, "abc");
  assert.equal(resolve("{argument name=\"Q\"|trim|raw}", { arguments: ["  padded  "] }).text, "padded");
  assert.equal(resolve("{argument name=\"Q\"|percent-encode}", { arguments: ["a b"] }).text, "a%2520b");
  assert.equal(resolve("{argument name=\"Q\"|json-stringify}", { arguments: ["a\"b"] }).text, encodeURIComponent(JSON.stringify("a\"b")));
});

test("date, time, datetime and day resolve with the documented defaults, formats and offsets", () => {
  const enc = encodeURIComponent;
  assert.equal(resolve("{date}").text, enc("Oct 10, 2026"));
  assert.equal(resolve("{datetime}").text, enc("Oct 10, 2026 2:30 PM"));
  assert.equal(resolve("{time}").text, enc("2:30 PM"));
  assert.equal(resolve("{day}").text, "Saturday");
  assert.equal(resolve("{date format=\"yyyy-MM-dd\"}").text, "2026-10-10");
  assert.equal(resolve("{date format=\"EEEE d MMMM yyyy\"}").text, "Saturday%2010%20October%202026");
  assert.equal(resolve("{time format=\"HH:mm:ss\"}").text, "14%3A30%3A05");
  assert.equal(resolve("{date format=\"yyyy-MM-dd\" offset=\"+3d\"}").text, "2026-10-13");
  assert.equal(resolve("{date format=\"yyyy-MM-dd\" offset=\"-2M\"}").text, "2026-08-10");
  assert.equal(resolve("{date format=\"yyyy\" offset=\"+1y\"}").text, "2027");
  assert.equal(resolve("{time format=\"HH:mm\" offset=\"-90m\"}").text, "13%3A00");
  assert.throws(() => resolve("{date offset=\"3d\"}"), /Could not parse the offset/);
  assert.throws(() => resolve("{date offset=\"+3x\"}"), /Could not parse the offset/);
  assert.throws(() => resolve("{date locale=\"not a locale!!\"}"), /Unsupported locale option/);
  assert.equal(resolve("{date locale=\"de-DE\" format=\"dd.MM.yyyy\"}").text, "10.10.2026");
});

test("formatDate supports the token set the clone documents", () => {
  assert.equal(formatDate(NOW, "yyyy/MM/dd"), "2026/10/10");
  assert.equal(formatDate(NOW, "yy"), "26");
  assert.equal(formatDate(NOW, "MMM"), "Oct");
  assert.equal(formatDate(NOW, "h:mm a"), "2:30 PM");
  assert.equal(formatDate(NOW, "hh"), "02");
  assert.equal(formatDate(new Date(2026, 0, 1, 0, 5), "h:mm a"), "12:05 AM");
});

test("uuid resolves to a v4-shaped UUID", () => {
  const value = resolve("{uuid}").text;
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(value, resolve("{uuid}").text);
});

test("clipboard resolves through the injected reader with a validated offset", () => {
  const clipboard = (offset) => (offset === 0 ? "latest" : offset === 1 ? "older" : null);
  assert.equal(resolve("{clipboard}", { clipboard }).text, "latest");
  assert.equal(resolve("{clipboard offset=\"1\"}", { clipboard }).text, "older");
  assert.equal(resolve("{clipboard offset=\"9\"}", { clipboard }).text, "");
  assert.throws(() => resolve("{clipboard offset=\"x\"}", { clipboard }), /Invalid offset value/);
  assert.throws(() => resolve("{clipboard offset=\"-1\"}", { clipboard }), /Invalid offset value/);
});

test("calculator delegates to the injected engine and reports the confirmed failures", () => {
  assert.equal(resolve("{calculator expression=\"1+2\"}", { calculate: () => "3" }).text, "3");
  assert.equal(resolve("{calculator expression=\"2/0\"}", { calculate: () => null }).text, "Invalid%20expression");
  assert.throws(() => resolve("{calculator}", { calculate: () => "3" }), /The expression option is required/);
  assert.equal(resolve("{calculator expression=\"1+1\"}", {}).text, "Invalid%20expression");
});

test("selection resolves from the injected context", () => {
  assert.equal(resolve("{selection}", { selectedText: "picked text" }).text, "picked%20text");
  assert.equal(resolve("{selection}", {}).text, "");
});

test("cursor is snippet-only, unique, and reported as an index instead of being replaced", () => {
  assert.throws(() => resolve("a{cursor}b", { context: "quicklink" }), /Cursor placeholder is only allowed in snippets/);
  const snippet = resolve("before{cursor}after", { context: "snippet" });
  assert.equal(snippet.text, "beforeafter");
  assert.equal(snippet.cursor, "before".length);
  assert.throws(() => resolve("{cursor}{cursor}", { context: "snippet" }), /Only one Cursor placeholder is allowed/);
});

test("snippet embeds another snippet by id and resolves recursively", () => {
  const resolved = resolve("{snippet id=\"abc\"}", {
    context: "snippet",
    getSnippetById: (id) => (id === "abc" ? { text: "inner {argument name=\"A\"}" } : null),
    arguments: ["value"],
  });
  assert.equal(resolved.text, "inner value");
  assert.throws(() => resolve("{snippet id=\"nope\"}", { context: "snippet" }), /Snippet placeholder requires the Snippets extension/);
});

test("placeholders are replaced right-to-left so earlier results are never re-parsed", () => {
  const resolved = resolve("{argument name=\"A\"}{argument name=\"B\"}", { arguments: ["1", "2"] });
  assert.equal(resolved.text, "12");
  const literal = resolve("{clipboard}|{clipboard}", { clipboard: () => "{argument name=\"A\"}" });
  assert.equal(
    literal.text,
    "%7Bargument%20name%3D%22A%22%7D|%7Bargument%20name%3D%22A%22%7D",
    "an inserted value is encoded once and never re-parsed as a placeholder",
  );
});

test("enumerateArguments derives form fields exactly like the shipped backend", () => {
  const text = enumerateArguments('https://g.test/?q={argument name="Query"}');
  assert.equal(text.args.length, 1);
  assert.deepEqual(text.args[0], {
    type: "text",
    name: "Query",
    placeholder: "Query",
    value: "",
    required: true,
  });

  const defaulted = enumerateArguments("{argument name=\"Q\" default=\"auto\"}").args[0];
  assert.equal(defaulted.required, false);
  assert.equal(defaulted.value, "auto");

  const unnamed = enumerateArguments("{argument}").args[0];
  assert.equal(unnamed.name, "Argument");
  assert.equal(unnamed.required, true);

  const dropdown = enumerateArguments("{argument name=\"Lang\" options=\"auto|en|de\"}").args[0];
  assert.equal(dropdown.type, "dropdown");
  assert.deepEqual(dropdown.data, [
    { title: "auto", value: "auto" },
    { title: "en", value: "en" },
    { title: "de", value: "de" },
  ]);

  const repeated = enumerateArguments('{argument name="A"}{argument name="A"}');
  assert.equal(repeated.args.length, 1, "the same name shares one field");

  assert.deepEqual(enumerateArguments("https://plain.example.com"), { args: [] });

  const tooMany = enumerateArguments('{argument name="A"}{argument name="B"}{argument name="C"}{argument name="D"}');
  assert.equal(tooMany.args.length, 0);
  assert.equal(tooMany.error, "Only 3 different Arguments are allowed");
});
