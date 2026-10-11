// The dynamic placeholder engine shared by Quicklinks and Snippets.
//
// Reimplemented from the shipped `compose-ai-command-prompt-*.js` behavior (see
// `docs/quicklinks-spec.md`): `{` keyword `[\w-]+` + `name=value` options (values may be quoted with
// `"` and `\` escapes) + `|modifier` + `}`. Resolvers: argument, clipboard, calculator, date, time,
// datetime, day, uuid, selection, cursor, snippet. Modifiers: uppercase, lowercase, trim,
// percent-encode, json-stringify, raw. Placeholders are replaced right-to-left so nested results are
// not re-parsed. There is no `{Query}` legacy token.

"use strict";

const MAX_ARGUMENTS = 3;

const MODIFIERS = new Set([
  "uppercase",
  "lowercase",
  "trim",
  "percent-encode",
  "json-stringify",
  "raw",
]);

const OFFSET_UNITS = { m: "minute", h: "hour", d: "day", M: "month", y: "year" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** Reads one quoted option value starting at `index` (which must point at the opening quote). */
function readQuotedValue(text, index) {
  let value = "";
  let i = index + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length) {
      value += text[i + 1];
      i += 2;
      continue;
    }
    if (char === '"') return { value, next: i + 1 };
    value += char;
    i++;
  }
  return null;
}

/**
 * Parses `text` into placeholder records. A `{` that does not parse as a placeholder stays literal.
 * Each record: `{ keyword, options, modifiers, start, end, source }`.
 */
function parsePlaceholders(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    const start = i;
    let j = i + 1;
    let keyword = "";
    while (j < text.length && /[\w-]/.test(text[j])) {
      keyword += text[j];
      j++;
    }
    if (!keyword) {
      i++;
      continue;
    }
    const options = {};
    let broken = false;
    while (j < text.length && text[j] === " ") {
      j++;
      let name = "";
      while (j < text.length && /[\w-]/.test(text[j])) {
        name += text[j];
        j++;
      }
      if (!name || text[j] !== "=") {
        broken = true;
        break;
      }
      j++;
      if (text[j] === '"') {
        const quoted = readQuotedValue(text, j);
        if (!quoted) {
          broken = true;
          break;
        }
        options[name] = quoted.value;
        j = quoted.next;
      } else {
        let value = "";
        while (j < text.length && !/[\s|}]/.test(text[j])) {
          value += text[j];
          j++;
        }
        if (!value) {
          broken = true;
          break;
        }
        options[name] = value;
      }
    }
    const modifiers = [];
    while (!broken && text[j] === "|") {
      j++;
      let modifier = "";
      while (j < text.length && /[\w-]/.test(text[j])) {
        modifier += text[j];
        j++;
      }
      if (!modifier) {
        broken = true;
        break;
      }
      modifiers.push(modifier);
    }
    if (broken || text[j] !== "}") {
      i++;
      continue;
    }
    const end = j + 1;
    out.push({
      keyword,
      options,
      modifiers,
      start,
      end,
      source: text.slice(start, end),
    });
    i = end;
  }
  return out;
}

function applyModifiers(value, modifiers) {
  let result = value;
  for (const modifier of modifiers) {
    if (!MODIFIERS.has(modifier)) continue;
    if (modifier === "uppercase") result = result.toUpperCase();
    if (modifier === "lowercase") result = result.toLowerCase();
    if (modifier === "trim") result = result.trim();
    if (modifier === "percent-encode") result = encodeURIComponent(result);
    if (modifier === "json-stringify") result = JSON.stringify(result);
  }
  return result;
}

function parseOffset(raw) {
  const match = /^([+-])(\d+)([mhdMy])$/.exec(raw ?? "");
  if (!match || raw.length < 3) throw new Error("Could not parse the offset");
  return {
    unit: OFFSET_UNITS[match[3]],
    amount: match[1] === "-" ? -Number(match[2]) : Number(match[2]),
  };
}

function shiftDate(date, offset) {
  const shifted = new Date(date.getTime());
  if (offset.unit === "minute") shifted.setMinutes(shifted.getMinutes() + offset.amount);
  if (offset.unit === "hour") shifted.setHours(shifted.getHours() + offset.amount);
  if (offset.unit === "day") shifted.setDate(shifted.getDate() + offset.amount);
  if (offset.unit === "month") shifted.setMonth(shifted.getMonth() + offset.amount);
  if (offset.unit === "year") shifted.setFullYear(shifted.getFullYear() + offset.amount);
  return shifted;
}

function formatDate(date, format, locale) {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  let out = "";
  let i = 0;
  while (i < format.length) {
    const rest = format.slice(i);
    if (rest.startsWith("yyyy")) { out += String(date.getFullYear()); i += 4; continue; }
    if (rest.startsWith("yy")) { out += pad(date.getFullYear() % 100); i += 2; continue; }
    if (rest.startsWith("MMMM")) { out += MONTHS[date.getMonth()]; i += 4; continue; }
    if (rest.startsWith("MMM")) { out += MONTHS[date.getMonth()].slice(0, 3); i += 3; continue; }
    if (rest.startsWith("MM")) { out += pad(date.getMonth() + 1); i += 2; continue; }
    if (rest.startsWith("M")) { out += String(date.getMonth() + 1); i += 1; continue; }
    if (rest.startsWith("dd")) { out += pad(date.getDate()); i += 2; continue; }
    if (rest.startsWith("d")) { out += String(date.getDate()); i += 1; continue; }
    if (rest.startsWith("EEEE")) { out += WEEKDAYS[date.getDay()]; i += 4; continue; }
    if (rest.startsWith("EEE")) { out += WEEKDAYS[date.getDay()].slice(0, 3); i += 3; continue; }
    if (rest.startsWith("HH")) { out += pad(date.getHours()); i += 2; continue; }
    if (rest.startsWith("H")) { out += String(date.getHours()); i += 1; continue; }
    if (rest.startsWith("hh")) { out += pad(date.getHours() % 12 === 0 ? 12 : date.getHours() % 12); i += 2; continue; }
    if (rest.startsWith("h")) { out += String(date.getHours() % 12 === 0 ? 12 : date.getHours() % 12); i += 1; continue; }
    if (rest.startsWith("mm")) { out += pad(date.getMinutes()); i += 2; continue; }
    if (rest.startsWith("m")) { out += String(date.getMinutes()); i += 1; continue; }
    if (rest.startsWith("ss")) { out += pad(date.getSeconds()); i += 2; continue; }
    if (rest.startsWith("s")) { out += String(date.getSeconds()); i += 1; continue; }
    if (rest.startsWith("a")) { out += date.getHours() < 12 ? "AM" : "PM"; i += 1; continue; }
    out += format[i];
    i++;
  }
  if (locale) {
    try {
      Intl.getCanonicalLocales(locale);
    } catch {
      throw new Error("Unsupported locale option");
    }
  }
  return out;
}

function resolveDate(placeholder, context) {
  const now = context.now ?? new Date();
  let date = now;
  if (placeholder.options.offset !== undefined) {
    date = shiftDate(date, parseOffset(placeholder.options.offset));
  }
  const locale = placeholder.options.locale;
  if (locale !== undefined) {
    try {
      Intl.getCanonicalLocales(locale);
    } catch {
      throw new Error("Unsupported locale option");
    }
  }
  const defaults = {
    date: "MMM d, yyyy",
    datetime: "MMM d, yyyy h:mm a",
    time: "h:mm a",
    day: "EEEE",
  };
  const format = placeholder.options.format ?? defaults[placeholder.keyword];
  return formatDate(date, format, locale);
}

function resolveArgument(placeholder, context) {
  const name = placeholder.options.name ?? "Argument";
  const names = context.argumentNames;
  const index = names.indexOf(name);
  if (index === -1) return placeholder.options.default ?? "";
  const value = context.arguments?.[index];
  if (value !== undefined && value !== "") return value;
  return placeholder.options.default ?? "";
}

function parseIntegerOption(raw, error) {
  if (raw === undefined || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(error);
  return value;
}

/**
 * Resolves every placeholder in `text`. `context`:
 *   context        "quicklink" | "snippet"
 *   arguments      positional values for the argument placeholders
 *   clipboard      (offset: number) => string | null
 *   selectedText   string | null
 *   calculate      (expression: string) => string | null
 *   getSnippetById (id: string) => { text } | null
 *   now            Date override for tests
 */
function resolvePlaceholders(text, context) {
  const effectiveContext = { context: context.context ?? "quicklink", ...context };
  const placeholders = parsePlaceholders(text);

  const argumentNames = [];
  let cursorCount = 0;
  for (const placeholder of placeholders) {
    if (placeholder.keyword === "argument") {
      const name = placeholder.options.name ?? "Argument";
      if (!argumentNames.includes(name)) argumentNames.push(name);
    }
    if (placeholder.keyword === "cursor") cursorCount++;
  }
  if (argumentNames.length > MAX_ARGUMENTS) {
    throw new Error("Only 3 different Arguments are allowed");
  }
  if (cursorCount > 1) {
    throw new Error("Only one Cursor placeholder is allowed");
  }
  effectiveContext.argumentNames = argumentNames;

  let result = text;
  let cursor = null;
  const sorted = [...placeholders].sort((a, b) => b.start - a.start);
  for (const placeholder of sorted) {
    if (placeholder.keyword === "cursor") {
      if (effectiveContext.context !== "snippet") {
        throw new Error("The Cursor placeholder is only allowed in snippets");
      }
      cursor = placeholder.start;
      result = result.slice(0, placeholder.start) + result.slice(placeholder.end);
      continue;
    }
    let value = resolveValue(placeholder, effectiveContext);
    value = applyModifiers(value, placeholder.modifiers);
    const hasRaw = placeholder.modifiers.includes("raw");
    if (effectiveContext.context === "quicklink" && !hasRaw) {
      value = encodeURIComponent(value);
    }
    result = result.slice(0, placeholder.start) + value + result.slice(placeholder.end);
    if (cursor !== null && cursor >= placeholder.end) {
      cursor += value.length - (placeholder.end - placeholder.start);
    }
  }
  return { text: result, cursor };
}

function resolveValue(placeholder, context) {
  const options = placeholder.options;
  switch (placeholder.keyword) {
    case "argument":
      return resolveArgument(placeholder, context);
    case "uuid":
      return require("node:crypto").randomUUID();
    case "clipboard": {
      const offset = parseIntegerOption(options.offset, "Invalid offset value");
      const reader = context.clipboard;
      if (typeof reader !== "function") return "";
      return reader(offset) ?? "";
    }
    case "calculator": {
      const expression = options.expression;
      if (expression === undefined || expression === "") {
        throw new Error("The expression option is required");
      }
      if (typeof context.calculate !== "function") return "Invalid expression";
      return context.calculate(expression) ?? "Invalid expression";
    }
    case "date":
    case "time":
    case "datetime":
    case "day":
      return resolveDate(placeholder, context);
    case "selection":
      return context.selectedText ?? "";
    case "snippet": {
      const loader = context.getSnippetById;
      const snippet = typeof loader === "function" ? loader(options.id) : null;
      if (!snippet) {
        throw new Error("The Snippet placeholder requires the Snippets extension");
      }
      const nested = resolvePlaceholders(snippet.text, context);
      return nested.text;
    }
    default:
      return placeholder.source;
  }
}

/**
 * Enumerates the argument placeholders of a quicklink link the way Raycast's backend does: each
 * distinct `argument` placeholder becomes a form field, at most `MAX_ARGUMENTS` of them.
 */
function enumerateArguments(link) {
  const placeholders = parsePlaceholders(link ?? "").filter((p) => p.keyword === "argument");
  const seen = new Map();
  for (const placeholder of placeholders) {
    const name = placeholder.options.name ?? "Argument";
    if (seen.has(name)) continue;
    const optionsRaw = placeholder.options.options;
    if (optionsRaw !== undefined) {
      const data = optionsRaw.split("|").filter(Boolean).map((option) => ({ title: option, value: option }));
      seen.set(name, {
        type: "dropdown",
        name,
        placeholder: name,
        value: placeholder.options.default ?? "",
        required: placeholder.options.default === undefined,
        data,
      });
      continue;
    }
    seen.set(name, {
      type: "text",
      name,
      placeholder: name,
      value: placeholder.options.default ?? "",
      required: placeholder.options.default === undefined,
    });
  }
  const args = [...seen.values()];
  if (args.length > MAX_ARGUMENTS) {
    return { args: [], error: "Only 3 different Arguments are allowed" };
  }
  return { args };
}

module.exports = {
  MAX_ARGUMENTS,
  MODIFIERS,
  enumerateArguments,
  formatDate,
  parsePlaceholders,
  resolvePlaceholders,
};
