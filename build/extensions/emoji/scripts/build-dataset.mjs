// Regenerates src/generated/emoji-data.json from unicode-emoji-json (MIT).
// Run: node scripts/build-dataset.mjs   (network required; the generated file is committed)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "src", "generated");

const sourceUrl = "https://raw.githubusercontent.com/muan/unicode-emoji-json/main/data-by-emoji.json";

// unicode-emoji-json groups -> the picker's category keys (Raycast's category list, observed in
// the shipped picker: Pinned / Frequently Used / Smileys & People / … / Other Symbols).
const CATEGORY_BY_GROUP = {
  "Smileys & Emotion": "smileys_people",
  "People & Body": "smileys_people",
  "Animals & Nature": "animals_nature",
  "Food & Drink": "food_drink",
  Activities: "activity",
  "Travel & Places": "travel_places",
  Objects: "objects",
  Symbols: "symbols",
  Flags: "flags",
};

const TONE_MODIFIERS = {
  light: "\u{1F3FB}",
  mediumLight: "\u{1F3FC}",
  medium: "\u{1F3FD}",
  mediumDark: "\u{1F3FE}",
  dark: "\u{1F3FF}",
};

function titleCase(name) {
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

async function main() {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
  const raw = await response.json();

  const entries = [];
  for (const [symbol, record] of Object.entries(raw)) {
    const category = CATEGORY_BY_GROUP[record.group];
    if (!category) continue;
    entries.push({
      s: symbol,
      n: titleCase(record.name ?? record.slug.replace(/_/g, " ")),
      g: record.slug,
      c: category,
      t: record.skin_tone_support ? 1 : 0,
      v: record.unicode_version ?? "1.0",
    });
  }

  // Hand-curated non-emoji symbol set for the `Other Symbols` category (the shipped picker keeps
  // a separate `unicode_symbols` bucket beyond emoji-test.txt).
  const otherSymbols = JSON.parse(
    fs.readFileSync(path.join(here, "other-symbols.json"), "utf8"),
  );
  for (const entry of otherSymbols) {
    entries.push({ s: entry.s, n: entry.n, g: entry.g, c: "unicode_symbols", t: 0, v: "1.0" });
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "emoji-data.json"), `${JSON.stringify(entries)}\n`);
  fs.writeFileSync(
    path.join(outDir, "version.json"),
    `${JSON.stringify(
      {
        source: "unicode-emoji-json (muan, MIT)",
        sourceUrl,
        generatedAt: new Date().toISOString(),
        count: entries.length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${entries.length} entries (${Object.keys(TONE_MODIFIERS).length} tone levels supported)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
