# Emoji & Symbols

Search emoji and symbols and paste, copy or save them — the clean-room port of Raycast's
internal `emoji-picker` extension ("Search Emoji & Symbols").

## Structure

- `src/generated/emoji-data.json` — the dataset (1,979 entries). Regenerate with
  `node scripts/build-dataset.mjs` (downloads [unicode-emoji-json](https://github.com/muan/unicode-emoji-json),
  MIT) and merges the curated `scripts/other-symbols.json` into the `Other Symbols` category.
- `src/data.ts` — categories, skin-tone application, `Copy Unicode` representation, ranked search.
- `src/state.ts` — pinned order, frecency (copy count + last use) and custom keywords, persisted
  through the extension storage route.
- `src/index.tsx` — the grid view.

## Behavior (observed in the shipped picker)

- Grid, 8 columns by default (`columnCount` preference, 2–12); labels hidden, color emoji glyphs.
- Search-bar dropdown: All Categories / Pinned / Frequently Used / Smileys & People / … / Other Symbols.
- Browse sections: Pinned, Frequently Used (top `columnCount × 2`), then one section per category
  with live counts.
- Search ranks by match quality (custom keyword > exact name > prefix > substring) with frecency
  as the tie-breaker.
- Actions: Paste (↵), Copy to Clipboard (Ctrl ↵), Paste and Keep Window Open (Ctrl Shift ↵),
  Copy Unicode (Ctrl Alt Shift C), Copy All Emojis from Section (Alt Shift C), Save as Snippet
  (Ctrl S), Pin/Unpin, Move Up/Down in Pinned, Reset Ranking, Delete Custom Keywords.
  `primaryAction` preference swaps Paste/Copy as the Enter action.
- Paste writes the clipboard and delivers the paste keystroke to the frontmost application, then
  closes the launcher.

## Known gaps vs the shipped picker

- `Paste with Skin Tone…` / `Copy with Skin Tone…` submenus: the FlowKey action model has no
  submenu yet; the `skinTone` preference covers tone selection.
- `Edit Custom Keywords` view (a pushed form in Raycast): keywords are deletable but not edited
  from the panel yet.
- AI suggestions: intentionally not ported (out of scope for the clean-room clone).
