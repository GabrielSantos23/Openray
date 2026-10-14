# Lucide Icons (RaycastMini)

Search the [Lucide](https://lucide.dev) icon set as a grid; copy names, SVG or components.

Ported from the FlowKey launcher (`GabrielSantos23/flowkey-launcher`,
`flowkey-native/extensions/lucide-icons` — itself a port of the Raycast extension) to
RaycastMini's FlowKey library. Changes from the source:

- imports `@flowkey-mini/*` instead of `@flowkey-cli/*`;
- bundled by `build.mjs` (esbuild + the sidecar shims) instead of the FlowKey CLI;
- the icon tint renders through the adapter's `iconSvg` → data-URI mapping and the
  frontend `Icon` data-URI branch (added in M3);
- `clipboard.paste` is declared in the manifest but not routed by the backend yet — the
  action fails with the typed "not implemented yet" error until host support lands (M5).

Icon metadata (names, keywords, canonical SVG) ships in `src/generated/` from the
`lucide-static` package (`version.json` records the source and date); everything works
offline. The upstream README describes the feature set: 8-column grid, live search over
names and keywords, a search-bar color dropdown (PrimaryText, Red, Blue, …), and per-icon
actions — Copy Name (optional Pascal case preference), Copy SVG, Paste SVG, Copy Component,
Open In Browser — with the primary action configurable in preferences.
