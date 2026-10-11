// Calculator expression engine — the clone's answer to Raycast's `Calculator.node`.
//
// Raycast's grammar lives in a native addon that is not among the recovered artifacts, so the
// observable surface (docs/calculator-spec.md) is what this reimplements: arithmetic with
// `+ - * / ^ %` (spaced `%` is modulo, an attached `%` is a percent suffix), parentheses, unary
// minus, the function/constant set, the number formats, the percentage forms, and unit/currency
// conversions written `<quantity> <unit> to|in <unit>`. `rem`/`em` convert through the
// `remToPxRate` preference; currency goes through the rate table the caller supplies (open.er-api
// rates in `calculator.js`), so tests can stub it.
//
// Everything here is pure: no I/O, no eval/Function, no timers. `evaluate()` never throws —
// malformed input returns `{ ok: false }` and the caller renders no row.

"use strict";

const CONSTANTS = { pi: Math.PI, tau: Math.PI * 2, e: Math.E };

const FUNCTIONS = {
  sqrt: (x) => Math.sqrt(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  log: (x) => Math.log10(x),
  ln: (x) => Math.log(x),
  abs: (x) => Math.abs(x),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  exp: (x) => Math.exp(x),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  pow: (x, y) => Math.pow(x, y),
};

const FUNCTION_ARITY = {
  sqrt: 1, sin: 1, cos: 1, tan: 1, log: 1, ln: 1, abs: 1, round: 1, floor: 1, ceil: 1, exp: 1,
  min: [1, Infinity], max: [1, Infinity], pow: 2,
};

// Symbol -> factor against the dimension's base unit. Temperature is handled separately (offset
// conversion through Celsius); `rem`/`em` are registered per-evaluation with the px rate. Table
// order is the case-insensitive fallback priority — length before data so `mi` resolves to the
// mile when the exact-case `Mi` (mebibyte) does not match.
const UNIT_GROUPS = {
  length: [
    ["mm", 0.001], ["millimeter", 0.001], ["millimeters", 0.001], ["millimetre", 0.001], ["millimetres", 0.001],
    ["cm", 0.01], ["centimeter", 0.01], ["centimeters", 0.01], ["centimetre", 0.01], ["centimetres", 0.01],
    ["m", 1], ["meter", 1], ["meters", 1], ["metre", 1], ["metres", 1],
    ["km", 1000], ["kilometer", 1000], ["kilometers", 1000], ["kilometre", 1000], ["kilometres", 1000],
    ["in", 0.0254], ["inch", 0.0254], ["inches", 0.0254],
    ["ft", 0.3048], ["foot", 0.3048], ["feet", 0.3048],
    ["yd", 0.9144], ["yard", 0.9144], ["yards", 0.9144],
    ["mi", 1609.344], ["mile", 1609.344], ["miles", 1609.344],
  ],
  mass: [
    ["mg", 0.000001], ["milligram", 0.000001], ["milligrams", 0.000001],
    ["g", 0.001], ["gram", 0.001], ["grams", 0.001],
    ["kg", 1], ["kilogram", 1], ["kilograms", 1],
    ["t", 1000], ["tonne", 1000], ["tonnes", 1000],
    ["oz", 0.028349523125], ["ounce", 0.028349523125], ["ounces", 0.028349523125],
    ["lb", 0.45359237], ["lbs", 0.45359237], ["pound", 0.45359237], ["pounds", 0.45359237],
  ],
  data: [
    ["B", 1], ["byte", 1], ["bytes", 1],
    ["KB", 1e3], ["kilobyte", 1e3], ["kilobytes", 1e3],
    ["MB", 1e6], ["megabyte", 1e6], ["megabytes", 1e6],
    ["GB", 1e9], ["gigabyte", 1e9], ["gigabytes", 1e9],
    ["TB", 1e12], ["T", 1e12], ["terabyte", 1e12], ["terabytes", 1e12],
  ],
  dataBinary: [
    ["KiB", 1024], ["kibibyte", 1024], ["kibibytes", 1024],
    ["MiB", 1024 ** 2], ["Mi", 1024 ** 2], ["mebibyte", 1024 ** 2], ["mebibytes", 1024 ** 2],
    ["GiB", 1024 ** 3], ["gibibyte", 1024 ** 3], ["gibibytes", 1024 ** 3],
    ["TiB", 1024 ** 4], ["tebibyte", 1024 ** 4], ["tebibytes", 1024 ** 4],
  ],
  duration: [
    ["ms", 0.001], ["millisecond", 0.001], ["milliseconds", 0.001],
    ["s", 1], ["sec", 1], ["secs", 1], ["second", 1], ["seconds", 1],
    ["min", 60], ["mins", 60], ["minute", 60], ["minutes", 60],
    ["h", 3600], ["hr", 3600], ["hrs", 3600], ["hour", 3600], ["hours", 3600],
    ["day", 86400], ["days", 86400],
    ["week", 604800], ["weeks", 604800],
  ],
  temperature: [
    ["c", "temperature"], ["°c", "temperature"], ["celsius", "temperature"], ["celcius", "temperature"],
    ["f", "temperature"], ["°f", "temperature"], ["fahrenheit", "temperature"],
    ["k", "temperature"], ["kelvin", "temperature"],
  ],
  screen: [
    ["px", 1], ["pixel", 1], ["pixels", 1],
  ],
};

const CURRENCY_SYMBOLS = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };

// Compound symbol prefixes (`R$`, `US$`, `C$`, …): an identifier followed by `$` resolves to a
// code instead of leaving a dangling ident + symbol pair the parser cannot read.
const COMPOUND_SYMBOLS = { r: "BRL", us: "USD", c: "CAD", a: "AUD", nz: "NZD", hk: "HKD" };

// Accented Latin letters join identifiers so currency names and places tokenize whole
// (`dólar`, `São Paulo`); composed and combining forms both land here.
const ACCENTS = "ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝÆŒáàâãäåéèêëíìîïóòôõöúùûüçñýÿæœ";
const IDENTIFIER_START = new RegExp(`[a-zA-Z_°µπ${ACCENTS}\\u0300-\\u036f]`);
const IDENTIFIER_PART = new RegExp(`[a-zA-Z0-9_°µ${ACCENTS}\\u0300-\\u036f]`);

// ISO-4217 codes the engine recognizes for conversion INTENT even when no rate table is loaded —
// without them, `100 usd to eur` offline would fall through to "no result" instead of the clear
// offline error. Membership here never satisfies a conversion; only the rate table does.
const KNOWN_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "SEK", "NOK", "DKK", "PLN",
  "CZK", "HUF", "RON", "BGN", "RUB", "TRY", "BRL", "INR", "KRW", "MXN", "SGD", "HKD", "ZAR",
  "ILS", "AED", "SAR", "THB", "IDR", "MYR", "PHP", "VND", "CLP", "COP", "ARS", "EGP", "NGN",
]);

// Names and shorthand people actually type, resolved to ISO codes so `100 dol to eur` and
// `100 dólares to euros` behave like `100 usd to eur`. Single words only — the answer and the
// Swap Units rewrite always carry the code.
const CURRENCY_ALIASES = {
  dol: "USD", dolar: "USD", "dólar": "USD", dollar: "USD", dollars: "USD",
  euro: "EUR", euros: "EUR",
  pound: "GBP", pounds: "GBP", sterling: "GBP", quid: "GBP", libra: "GBP", libras: "GBP",
  yen: "JPY", iene: "JPY",
  real: "BRL", reais: "BRL",
  yuan: "CNY", rmb: "CNY", renminbi: "CNY",
  rupee: "INR", rupees: "INR", rupia: "INR",
  won: "KRW",
  krona: "SEK", kronor: "SEK",
  krone: "NOK",
  zloty: "PLN",
  lira: "TRY",
  ruble: "RUB", rouble: "RUB",
  rand: "ZAR",
  shekel: "ILS", shekels: "ILS",
  baht: "THB",
  dong: "VND",
  rupiah: "IDR",
  ringgit: "MYR",
  dirham: "AED",
  riyal: "SAR",
  franc: "CHF",
  koruna: "CZK",
  forint: "HUF",
  leu: "RON",
  lev: "BGN",
};

// Time-at-place: `time in china` / `time at new york` / `china time` — the shipped metadata type
// `timeAtPlaceSeeking`. Curated country/city table mapping to IANA zones, resolved locally (no
// network); the answer is the place's current time, badges are the place and the GMT offset.
const TIME_PLACES = new Map();
function addPlace(aliases, zone, name) {
  for (const alias of aliases) TIME_PLACES.set(alias.toLowerCase(), { zone, name });
}
addPlace(["china", "peoples republic of china"], "Asia/Shanghai", "China");
addPlace(["japan"], "Asia/Tokyo", "Japan");
addPlace(["tokyo"], "Asia/Tokyo", "Tokyo");
addPlace(["usa", "us", "united states", "united states of america", "america"], "America/New_York", "United States");
addPlace(["new york", "nyc"], "America/New_York", "New York");
addPlace(["washington"], "America/New_York", "Washington");
addPlace(["boston"], "America/New_York", "Boston");
addPlace(["philadelphia"], "America/New_York", "Philadelphia");
addPlace(["miami"], "America/New_York", "Miami");
addPlace(["toronto"], "America/Toronto", "Toronto");
addPlace(["montreal"], "America/Toronto", "Montreal");
addPlace(["canada"], "America/Toronto", "Canada");
addPlace(["chicago"], "America/Chicago", "Chicago");
addPlace(["houston"], "America/Chicago", "Houston");
addPlace(["dallas", "austin"], "America/Chicago", "Dallas");
addPlace(["mexico", "mexico city"], "America/Mexico_City", "Mexico");
addPlace(["denver", "phoenix"], "America/Denver", "Denver");
addPlace(["los angeles", "la"], "America/Los_Angeles", "Los Angeles");
addPlace(["san francisco", "sf"], "America/Los_Angeles", "San Francisco");
addPlace(["seattle"], "America/Los_Angeles", "Seattle");
addPlace(["vancouver"], "America/Vancouver", "Vancouver");
addPlace(["brazil", "brasil"], "America/Sao_Paulo", "Brazil");
addPlace(["sao paulo", "são paulo"], "America/Sao_Paulo", "São Paulo");
addPlace(["rio de janeiro", "rio"], "America/Sao_Paulo", "Rio de Janeiro");
addPlace(["argentina", "buenos aires"], "America/Argentina/Buenos_Aires", "Argentina");
addPlace(["chile", "santiago"], "America/Santiago", "Chile");
addPlace(["colombia", "bogota", "bogotá"], "America/Bogota", "Colombia");
addPlace(["peru", "lima"], "America/Lima", "Peru");
addPlace(["uk", "britain", "united kingdom", "great britain", "england"], "Europe/London", "United Kingdom");
addPlace(["london"], "Europe/London", "London");
addPlace(["dublin", "ireland"], "Europe/Dublin", "Ireland");
addPlace(["lisbon", "lisboa", "portugal"], "Europe/Lisbon", "Portugal");
addPlace(["porto"], "Europe/Lisbon", "Porto");
addPlace(["spain", "madrid", "barcelona"], "Europe/Madrid", "Spain");
addPlace(["france", "paris"], "Europe/Paris", "France");
addPlace(["belgium", "brussels"], "Europe/Brussels", "Belgium");
addPlace(["netherlands", "amsterdam"], "Europe/Amsterdam", "Netherlands");
addPlace(["germany", "berlin", "munich", "frankfurt"], "Europe/Berlin", "Germany");
addPlace(["switzerland", "zurich", "zürich"], "Europe/Zurich", "Switzerland");
addPlace(["austria", "vienna", "wien"], "Europe/Vienna", "Austria");
addPlace(["italy", "rome", "milan"], "Europe/Rome", "Italy");
addPlace(["vatican"], "Europe/Rome", "Vatican City");
addPlace(["poland", "warsaw"], "Europe/Warsaw", "Poland");
addPlace(["czechia", "czech republic", "prague"], "Europe/Prague", "Czechia");
addPlace(["hungary", "budapest"], "Europe/Budapest", "Hungary");
addPlace(["romania", "bucharest"], "Europe/Bucharest", "Romania");
addPlace(["bulgaria", "sofia"], "Europe/Sofia", "Bulgaria");
addPlace(["greece", "athens"], "Europe/Athens", "Greece");
addPlace(["sweden", "stockholm"], "Europe/Stockholm", "Sweden");
addPlace(["norway", "oslo"], "Europe/Oslo", "Norway");
addPlace(["denmark", "copenhagen", "københavn"], "Europe/Copenhagen", "Denmark");
addPlace(["finland", "helsinki"], "Europe/Helsinki", "Finland");
addPlace(["russia", "moscow"], "Europe/Moscow", "Russia");
addPlace(["ukraine", "kyiv", "kiev"], "Europe/Kyiv", "Ukraine");
addPlace(["turkey", "istanbul", "ankara"], "Europe/Istanbul", "Turkey");
addPlace(["israel", "tel aviv", "jerusalem"], "Asia/Jerusalem", "Israel");
addPlace(["uae", "united arab emirates", "dubai", "abu dhabi"], "Asia/Dubai", "United Arab Emirates");
addPlace(["saudi arabia", "riyadh"], "Asia/Riyadh", "Saudi Arabia");
addPlace(["qatar", "doha"], "Asia/Qatar", "Qatar");
addPlace(["egypt", "cairo"], "Africa/Cairo", "Egypt");
addPlace(["south africa", "johannesburg", "cape town"], "Africa/Johannesburg", "South Africa");
addPlace(["nigeria", "lagos"], "Africa/Lagos", "Nigeria");
addPlace(["kenya", "nairobi"], "Africa/Nairobi", "Kenya");
addPlace(["india", "mumbai", "delhi", "bangalore", "bengaluru"], "Asia/Kolkata", "India");
addPlace(["pakistan", "karachi"], "Asia/Karachi", "Pakistan");
addPlace(["bangladesh", "dhaka"], "Asia/Dhaka", "Bangladesh");
addPlace(["thailand", "bangkok"], "Asia/Bangkok", "Thailand");
addPlace(["vietnam", "ho chi minh", "hanoi", "saigon"], "Asia/Ho_Chi_Minh", "Vietnam");
addPlace(["indonesia", "jakarta", "bali"], "Asia/Jakarta", "Indonesia");
addPlace(["malaysia", "kuala lumpur"], "Asia/Kuala_Lumpur", "Malaysia");
addPlace(["singapore"], "Asia/Singapore", "Singapore");
addPlace(["philippines", "manila"], "Asia/Manila", "Philippines");
addPlace(["hong kong", "hk"], "Asia/Hong_Kong", "Hong Kong");
addPlace(["taiwan", "taipei"], "Asia/Taipei", "Taiwan");
addPlace(["south korea", "korea", "seoul"], "Asia/Seoul", "South Korea");
addPlace(["australia", "sydney"], "Australia/Sydney", "Australia");
addPlace(["melbourne"], "Australia/Melbourne", "Melbourne");
addPlace(["brisbane"], "Australia/Brisbane", "Brisbane");
addPlace(["perth"], "Australia/Perth", "Perth");
addPlace(["new zealand", "auckland", "wellington"], "Pacific/Auckland", "New Zealand");

// ---------------------------------------------------------------------------------------------
// Tokenizer. Unknown characters fail the whole expression — the root search must never render a
// row for prose like "notepad" just because it contains a digit. Every token keeps its character
// offsets so Swap Units can rewrite the original text instead of a re-serialized approximation.
// ---------------------------------------------------------------------------------------------

function tokenize(expression) {
  const tokens = [];
  let index = 0;
  let sawSpace = false;
  const text = String(expression ?? "");
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      sawSpace = true;
      index += 1;
      continue;
    }
    const spaced = sawSpace;
    sawSpace = false;
    // Numbers: decimal, 1_000 grouping, 0x/0b/0o radix, 1e5 exponent. A currency symbol glued to
    // the end (`100$`, `100€`) rides along as a suffix token the parser attaches to the amount.
    const radix = /^(0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+)/.exec(text.slice(index));
    if (radix) {
      const raw = radix[1];
      tokens.push({ type: "number", value: Number(raw.replace(/_/g, "")), raw, start: index, end: index + raw.length });
      index += raw.length;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^((?:[0-9][0-9_]*[0-9]|[0-9])(?:\.[0-9][0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9]+)?/.exec(text.slice(index));
      if (!match) return null;
      const raw = match[0];
      const value = Number(raw.replace(/_/g, ""));
      if (!Number.isFinite(value)) return null;
      tokens.push({ type: "number", value, raw, start: index, end: index + raw.length });
      index += raw.length;
      if (CURRENCY_SYMBOLS[text[index]]) {
        tokens.push({ type: "currency", value: CURRENCY_SYMBOLS[text[index]], raw: text[index], suffix: true, start: index, end: index + 1 });
        index += 1;
      }
      continue;
    }
    // Currency symbols are standalone one-character tokens so `$500` splits into the USD unit
    // and the amount; identifiers cover function names, constants, units, codes and accented
    // currency names (`dólar`, `São Paulo`). `r$`-style compounds become one currency token.
    if (CURRENCY_SYMBOLS[char]) {
      tokens.push({ type: "currency", value: CURRENCY_SYMBOLS[char], raw: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (IDENTIFIER_START.test(char)) {
      const match = new RegExp(`^${IDENTIFIER_START.source}${IDENTIFIER_PART.source}*`).exec(text.slice(index));
      if (!match) return null;
      const compound = COMPOUND_SYMBOLS[match[0].toLowerCase()];
      if (compound && text[index + match[0].length] === "$") {
        const end = index + match[0].length + 1;
        tokens.push({ type: "currency", value: compound, raw: text.slice(index, end), start: index, end });
        index = end;
        continue;
      }
      tokens.push({ type: "ident", value: match[0], raw: match[0], start: index, end: index + match[0].length });
      index += match[0].length;
      continue;
    }
    if ("+-*/^%(),×÷".includes(char)) {
      const normalized = char === "×" ? "*" : char === "÷" ? "/" : char;
      tokens.push({
        type: normalized === "(" || normalized === ")" || normalized === "," ? normalized : "op",
        value: normalized,
        raw: char,
        spaced,
        start: index,
        end: index + 1,
      });
      index += 1;
      continue;
    }
    if (char === "*" && text[index + 1] === "*") {
      tokens.push({ type: "op", value: "^", raw: "**", spaced, start: index, end: index + 2 });
      index += 2;
      continue;
    }
    return null;
  }
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// Parser -> AST. Nodes: {kind:"num", value, percent, currency?}, {kind:"ident", name, raw,
// prefixSymbol?}, {kind:"unary", op, operand}, {kind:"bin", op, left, right}, {kind:"call",
// name, args}. Unary minus binds looser than `^` (`-2^2` is -4) but tighter than `*` (`2*-3`).
// ---------------------------------------------------------------------------------------------

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos] ?? null;

  function parseExpression() {
    let left = parseTerm();
    while (true) {
      const token = peek();
      if (!token || token.type !== "op" || (token.value !== "+" && token.value !== "-")) break;
      pos += 1;
      left = { kind: "bin", op: token.value, left, right: parseTerm() };
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (true) {
      const token = peek();
      if (!token) break;
      if (token.type === "op" && (token.value === "*" || token.value === "/")) {
        pos += 1;
        left = { kind: "bin", op: token.value, left, right: parseUnary() };
        continue;
      }
      // Spaced `%` is modulo; an attached `%` never reaches here (parsePostfix ate it).
      if (token.type === "op" && token.value === "%" && token.spaced) {
        pos += 1;
        left = { kind: "bin", op: "%", left, right: parseUnary() };
        continue;
      }
      break;
    }
    return left;
  }

  function parseUnary() {
    const token = peek();
    if (token && token.type === "op" && (token.value === "-" || token.value === "+")) {
      pos += 1;
      const operand = parseUnary();
      return token.value === "-" ? { kind: "unary", op: "-", operand } : operand;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePostfix();
    const token = peek();
    if (token && token.type === "op" && token.value === "^") {
      pos += 1;
      return { kind: "bin", op: "^", left: base, right: parseUnary() };
    }
    return base;
  }

  function parsePostfix() {
    const token = peek();
    if (!token) throw new Error("unexpected end");

    if (token.type === "number") {
      pos += 1;
      let node = { kind: "num", value: token.value, percent: false };
      const next = peek();
      if (next?.type === "op" && next.value === "%" && !next.spaced) {
        pos += 1;
        node = { kind: "num", value: token.value, percent: true };
      }
      // `100$` — a glued currency suffix rides on the amount like the `$100` prefix does.
      const suffix = peek();
      if (suffix?.type === "currency" && suffix.suffix) {
        pos += 1;
        node = { ...node, currency: suffix.value };
      }
      return withOf(node);
    }

    if (token.type === "currency") {
      // `$500` is 500 USD: the currency rides along as the unit on conversion lines and is
      // ignored for plain math.
      pos += 1;
      const next = peek();
      if (next?.type !== "number") throw new Error("currency symbol without amount");
      pos += 1;
      return withOf({ kind: "num", value: next.value, percent: false, currency: token.value });
    }

    if (token.type === "ident") {
      pos += 1;
      const lower = token.value.toLowerCase();
      const next = peek();
      if (next?.type === "(") {
        pos += 1;
        const args = [];
        if (peek()?.type !== ")") {
          args.push(parseExpression());
          while (peek()?.type === ",") {
            pos += 1;
            args.push(parseExpression());
          }
        }
        if (peek()?.type !== ")") throw new Error("missing )");
        pos += 1;
        return { kind: "call", name: lower, args, raw: token.raw };
      }
      return { kind: "ident", name: lower, raw: token.raw };
    }

    if (token.type === "(") {
      pos += 1;
      const inner = parseExpression();
      if (peek()?.type !== ")") throw new Error("missing )");
      pos += 1;
      return inner;
    }

    throw new Error(`unexpected token ${token.raw}`);
  }

  // `25% of 500` — `of` multiplies a percent value by the operand that follows.
  function withOf(node) {
    const next = peek();
    if (node.kind === "num" && node.percent && next?.type === "ident" && next.value.toLowerCase() === "of") {
      pos += 1;
      return { kind: "bin", op: "of", left: node, right: parseUnary() };
    }
    return node;
  }

  const tree = parseExpression();
  if (pos !== tokens.length) throw new Error("trailing tokens");
  return tree;
}

// ---------------------------------------------------------------------------------------------
// Evaluator. Returns { value, percent, unit?, currency? } — `percent` only stays true for a bare
// `N%` that nothing consumed, which is what makes `500 + 10%` mean 550 while `25%` alone is 0.25.
// ---------------------------------------------------------------------------------------------

function evaluateNode(node, scope) {
  switch (node.kind) {
    case "num": {
      if (node.currency && scope.currencyUnits.has(node.currency)) {
        return { value: node.value, percent: false, currency: node.currency };
      }
      return { value: node.percent ? node.value / 100 : node.value, percent: node.percent, currency: node.currency ?? null };
    }
    case "ident": {
      if (node.name in CONSTANTS) return { value: CONSTANTS[node.name], percent: false };
      const unit = resolveUnitToken(node, scope);
      if (unit) return { value: 1, percent: false, unit };
      throw new Error(`unknown identifier ${node.raw}`);
    }
    case "unary": {
      const operand = evaluateNode(node.operand, scope);
      return { value: -operand.value, percent: false };
    }
    case "bin": {
      const left = evaluateNode(node.left, scope);
      const right = evaluateNode(node.right, scope);
      if (node.op === "of") {
        return { value: (left.percent ? left.value : left.value / 100) * right.value, percent: false };
      }
      if ((node.op === "+" || node.op === "-") && right.percent) {
        return {
          value: node.op === "+" ? left.value + left.value * right.value : left.value - left.value * right.value,
          percent: false,
        };
      }
      let value;
      switch (node.op) {
        case "+": value = left.value + right.value; break;
        case "-": value = left.value - right.value; break;
        case "*": value = left.value * right.value; break;
        case "/": value = right.value === 0 ? NaN : left.value / right.value; break;
        case "^": value = Math.pow(left.value, right.value); break;
        case "%": value = right.value === 0 ? NaN : left.value % right.value; break;
        default: throw new Error(`unknown operator ${node.op}`);
      }
      return { value, percent: false };
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new Error(`unknown function ${node.name}`);
      const arity = FUNCTION_ARITY[node.name];
      const count = node.args.length;
      if (typeof arity === "number" ? count !== arity : count < arity[0] || count > arity[1]) {
        throw new Error(`wrong argument count for ${node.name}`);
      }
      const args = node.args.map((arg) => {
        const value = evaluateNode(arg, scope);
        if (value.unit || value.currency) throw new Error("units inside function arguments");
        return value.value;
      });
      return { value: fn(...args), percent: false };
    }
    default:
      throw new Error(`unknown node ${node.kind}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Unit resolution. Exact case wins (T/t, Mi/mi), then case-insensitive over the tables in order.
// ---------------------------------------------------------------------------------------------

function buildUnitTable(remToPxRate) {
  const table = new Map();
  for (const [dimension, entries] of Object.entries(UNIT_GROUPS)) {
    for (const [symbol, factor] of entries) {
      table.set(symbol, { dimension, factor, symbol });
    }
  }
  table.set("rem", { dimension: "screen", factor: remToPxRate, symbol: "rem" });
  table.set("em", { dimension: "screen", factor: remToPxRate, symbol: "em" });
  return table;
}

function resolveUnitToken(token, scope) {
  const raw = token.raw ?? token.name ?? String(token.value ?? "");
  if (scope.units.has(raw)) return scope.units.get(raw);
  const lower = raw.toLowerCase();
  if (scope.units.has(lower)) return scope.units.get(lower);
  return null;
}

function toBase(value, unit) {
  if (unit.dimension === "temperature") return toCelsius(value, unit.symbol);
  return value * unit.factor;
}

function fromBase(value, unit) {
  if (unit.dimension === "temperature") return fromCelsius(value, unit.symbol);
  return value / unit.factor;
}

function toCelsius(value, symbol) {
  if (symbol === "f" || symbol === "°f" || symbol === "fahrenheit") return (value - 32) * (5 / 9);
  if (symbol === "k" || symbol === "kelvin") return value - 273.15;
  return value;
}

function fromCelsius(value, symbol) {
  if (symbol === "f" || symbol === "°f" || symbol === "fahrenheit") return value * (9 / 5) + 32;
  if (symbol === "k" || symbol === "kelvin") return value + 273.15;
  return value;
}

const TEMPERATURE_DISPLAY = { c: "°C", f: "°F", k: "K", "°c": "°C", "°f": "°F", kelvin: "K", celsius: "°C", celcius: "°C", fahrenheit: "°F" };

// ---------------------------------------------------------------------------------------------
// Formatting. Locale-driven separators (confirmed: separators come from the system locale), with
// the fraction-digit budget scaled to the magnitude so small results keep their precision.
// ---------------------------------------------------------------------------------------------

function formatNumber(value, locale) {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const ceiling = magnitude < 0 ? 12 : 10;
  const digits = Math.max(0, Math.min(ceiling, 9 - Math.max(magnitude, 0)));
  try {
    return new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: digits }).format(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------------------------
// Conversion detection. `<quantity> <unit> to|in <unit>` — the separator candidate is scanned
// right-to-left at depth 0 so `5 in in cm` resolves the inches correctly, and `$500 in GBP`
// resolves the dollar sign as the from-unit.
// ---------------------------------------------------------------------------------------------

function findConversion(tokens) {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.type !== "ident" || (token.value.toLowerCase() !== "to" && token.value.toLowerCase() !== "in")) continue;
    const right = tokens[index + 1];
    if (!right || (right.type !== "ident" && right.type !== "currency") || index + 2 !== tokens.length) continue;
    const left = tokens.slice(0, index);
    if (left.length < 1) continue;
    const last = left[left.length - 1];
    if (last.type === "ident") {
      if (left.length < 2) continue;
      return { separator: token, quantityTokens: left.slice(0, -1), unitToken: last, right };
    }
    // `$500 in GBP`: the currency symbol token stands as the from-unit, the amount is the quantity.
    if (last.type === "number" && left.length >= 2 && left[left.length - 2].type === "currency") {
      return {
        separator: token,
        quantityTokens: left.slice(0, -2).concat(left.slice(-1)),
        unitToken: left[left.length - 2],
        right,
      };
    }
    // `100$ in r$`: a glued suffix symbol is the from-unit, the number before it the quantity.
    if (last.type === "currency" && left.length >= 2) {
      return { separator: token, quantityTokens: left.slice(0, -1), unitToken: last, right };
    }
  }
  return null;
}

function conversionResult(converted, text, conversion, options, extra) {
  if (!Number.isFinite(converted)) return { ok: false };
  const { unitToken, separator, right } = conversion;
  let swapped;
  if (unitToken.type === "currency") {
    // A symbol-led amount (`$500 in GBP`) rebuilds as `500 GBP in USD` — splicing the code where
    // the symbol stood would glue it to the amount.
    const quantity = `${text.slice(0, unitToken.start)}${text.slice(unitToken.end, separator.start)}`.trim();
    swapped = `${quantity} ${right.raw} ${separator.raw} ${extra.swapFrom}`;
  } else {
    swapped = `${text.slice(0, unitToken.start)}${text.slice(right.start, right.end)}${text.slice(unitToken.end, right.start)}${text.slice(unitToken.start, unitToken.end)}${text.slice(right.end)}`;
  }
  return {
    ok: true,
    answer: `${formatNumber(converted, options.locale)} ${extra.answerUnit}`,
    unformatted: String(converted),
    category: "unitConversion",
    evaluationType: "unitExpression",
    metadataType: "conversion",
    unitFrom: extra.unitFrom ?? null,
    unitTo: extra.unitTo ?? null,
    currencyFrom: extra.currencyFrom ?? null,
    currencyTo: extra.currencyTo ?? null,
    swappedExpression: swapped,
  };
}

// ---------------------------------------------------------------------------------------------

/**
 * Evaluates one expression. Options:
 *   rates        { CODE: perUsdRate } | null — currency conversions fail without it
 *   remToPxRate  number (default 16)
 *   locale       BCP-47 tag for answer formatting (default: the system locale)
 *   now          Date|number override for the time-at-place evaluation (tests)
 * Never throws; malformed input is `{ ok: false }`.
 */
function evaluate(expression, options = {}) {
  const raw = String(expression ?? "").trim();
  if (!raw || raw.length > 512) return { ok: false };
  const text = raw.normalize("NFC");

  const timeResult = evaluateTimeAtPlace(text, options);
  if (timeResult !== null) return timeResult;

  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return { ok: false };

  const rates = options.rates ?? null;
  const scope = {
    units: buildUnitTable(options.remToPxRate ?? 16),
    currencyUnits: new Set(Object.keys(rates ?? {}).map((code) => String(code).toUpperCase())),
  };

  try {
    const conversion = findConversion(tokens);
    if (conversion) {
      let quantity;
      try {
        quantity = evaluateNode(parse(conversion.quantityTokens), scope);
      } catch {
        return { ok: false };
      }
      if (quantity.percent || quantity.unit || !Number.isFinite(quantity.value)) return { ok: false };

      const currencyFrom = resolveCurrency(conversion.unitToken, scope);
      const currencyTo = resolveCurrency(conversion.right, scope);
      if (currencyFrom && currencyTo) {
        if (!rates || !(currencyFrom in rates) || !(currencyTo in rates)) {
          return { ok: false, error: "Currency rates unavailable offline" };
        }
        const converted = (quantity.value / rates[currencyFrom]) * rates[currencyTo];
        return conversionResult(converted, text, conversion, options, {
          answerUnit: currencyTo,
          swapFrom: currencyFrom,
          currencyFrom,
          currencyTo,
        });
      }

      const unitFrom = resolveUnitToken(conversion.unitToken, scope);
      const unitTo = resolveUnitToken(conversion.right, scope);
      if (unitFrom && unitTo && unitFrom.dimension === unitTo.dimension) {
        const converted = fromBase(toBase(quantity.value, unitFrom), unitTo);
        const display = unitFrom.dimension === "temperature"
          ? (TEMPERATURE_DISPLAY[unitTo.symbol] ?? unitTo.symbol)
          : unitTo.symbol;
        return conversionResult(converted, text, conversion, options, {
          answerUnit: display,
          unitFrom: unitFrom.symbol,
          unitTo: unitTo.symbol,
        });
      }
      return { ok: false };
    }

    const result = evaluateNode(parse(tokens), scope);
    if (result.unit || !Number.isFinite(result.value)) return { ok: false };
    return {
      ok: true,
      answer: formatNumber(result.value, options.locale),
      unformatted: String(result.value),
      category: "math",
      evaluationType: result.percent ? "percentage" : "decimal",
      metadataType: "singleNumber",
      unitFrom: null,
      unitTo: null,
      currencyFrom: null,
      currencyTo: null,
      swappedExpression: null,
    };
  } catch {
    return { ok: false };
  }
}

function resolveCurrency(token, scope) {
  if (token.type === "currency") return token.value;
  const raw = String(token.raw ?? token.value ?? "");
  if (!raw) return null;
  const upper = raw.toUpperCase();
  // Rate-table codes govern actual conversion; the known-currency list catches the offline case
  // and the alias table carries the names people type (`dol`, `dólar`, `euro`).
  if (scope.currencyUnits.has(upper) || KNOWN_CURRENCIES.has(upper)) return upper;
  return CURRENCY_ALIASES[raw.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Time at place (`time in china` → 8:15 PM, badges China / GMT+8). Resolved locally against the
// curated place table or a direct IANA zone; null means "not a time query" so the expression
// falls through to the normal grammar.
// ---------------------------------------------------------------------------------------------

function titleCasePlace(name) {
  return name
    .split(" ")
    .map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function resolvePlace(phrase) {
  const key = phrase.trim().replace(/\s+/g, " ").toLowerCase();
  const place = TIME_PLACES.get(key);
  if (place) return place;
  // Direct IANA zone (`time in asia/tokyo`), matched case-insensitively.
  const zones = typeof Intl !== "undefined" && Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];
  const zone = zones.find((candidate) => candidate.toLowerCase() === key);
  if (zone) {
    const [city] = zone.split("/").pop().replace(/_/g, " ").split(", ");
    return { zone, name: titleCasePlace(city) };
  }
  return null;
}

function zoneOffsetLabel(zone, date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(date);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function evaluateTimeAtPlace(text, options) {
  const match = /^time\s+(?:in|at)\s+(.+)$/i.exec(text) || /^(.+)\s+time$/i.exec(text);
  if (!match) return null;
  const place = resolvePlace(match[1]);
  if (!place) return null;

  const now = options.now !== undefined ? new Date(options.now) : new Date();
  let answer;
  try {
    answer = new Intl.DateTimeFormat(options.locale || undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: place.zone,
    }).format(now);
  } catch {
    return null;
  }
  return {
    ok: true,
    answer,
    unformatted: answer,
    category: "dateTime",
    evaluationType: "dateTime",
    metadataType: "timeAtPlaceSeeking",
    unitFrom: place.name,
    unitTo: zoneOffsetLabel(place.zone, now) || null,
    currencyFrom: null,
    currencyTo: null,
    swappedExpression: null,
  };
}

/** `10 km to mi` -> `10 mi to km`; null when the expression is not a convertible pair. */
function swapUnits(expression, options = {}) {
  const result = evaluate(expression, options);
  return result.ok ? result.swappedExpression : null;
}

module.exports = {
  evaluate,
  swapUnits,
  formatNumber,
};
