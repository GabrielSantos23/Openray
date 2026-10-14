# @flowkey-mini/cli

Build, validate, package and install [FlowKey](https://github.com/GabrielSantos23/flowkey-launcher) extensions — without touching the FlowKey source code.

FlowKey is a fast, native Windows launcher. Extensions are written in
**TypeScript + React**, run in a sandboxed Bun sidecar, and render into the
launcher's native UI. This CLI scaffolds a ready-to-build extension project,
watches your edits while you work, and produces a shareable `.flowkey` package
that anyone can install into their FlowKey with two clicks.

## Requirements

- **FlowKey installed** — grab `FlowKey-win-Setup.exe` from the
  [latest release](https://github.com/GabrielSantos23/flowkey-launcher/releases/latest).
  FlowKey is Windows-only.
- **Node.js 20+** and a package manager (**pnpm** recommended; npm and bun work).
- No other toolchain — no Rust, no .NET, no Bun install needed.

## Quick start

```bash
npx @flowkey-mini/cli init "My Extension"
cd my-extension
pnpm install
pnpm dev
```

`init` scaffolds a complete project from a template: `manifest.json`, a
React view (`src/index.tsx`) that renders a searchable list, and scripts wired
to this CLI. `pnpm dev` builds the extension, installs it into
`%LOCALAPPDATA%\FlowKey.Shell\extensions\<id>\` and rebuilds on every change.
**Restart FlowKey** to load the new build — that's the only manual step in the
loop.

Now edit `src/index.tsx` and `manifest.json`; the scaffolded demo already
shows search, actions, clipboard and storage working end to end.

## Commands

| Command               | What it does                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `flowkey init <name>` | Scaffold a new extension project (`--id` overrides the derived id, `--dir` the target folder)                        |
| `flowkey dev`         | Validate + build + install into FlowKey, then rebuild on change                                                      |
| `flowkey build`       | Bundle into `dist/` — a self-contained `main.js` plus the manifest (and the manifest icon image, if one is declared) |
| `flowkey validate`    | Lint `manifest.json` with the same validator FlowKey itself uses                                                     |
| `flowkey package`     | Build and produce `<id>-<version>.flowkey` — the file you share                                                      |

## The manifest

`manifest.json` declares what your extension is and what it may do:

```jsonc
{
  "id": "my-extension", // lowercase slug, becomes the install directory
  "name": "My Extension",
  "version": "0.1.0", // semver; installs require a strictly newer version
  "description": "What it does.",
  "icon": "command-icon.png", // emoji, a lucide name, or an image file you ship
  "commands": [{ "id": "open", "title": "My Extension", "mode": "view", "keywords": ["demo"] }],
  "nativeMethods": [
    // capabilities you call — exact names or wildcards
    "http.fetch",
    "clipboard.write",
    "storage.*",
    "shell.openUrl",
    "hud.show",
  ],
  "httpHosts": ["api.example.com"], // the ONLY hosts http.fetch may contact
  "oauth": ["spotify"], // optional providers for managed OAuth
  "preferences": [
    // user-configurable values, edited in FlowKey settings
    { "name": "apiKey", "type": "password", "title": "API key" },
  ],
  "entry": "main.js", // optional; the bundled entry file name
}
```

Every capability you declare is shown to the user in a **consent dialog**
before your extension is installed, and enforced per call afterwards: an
undeclared or unconsented method fails, and `http.fetch` is rejected for any
host not in `httpHosts`. Declare the minimum you need.

## Writing the view

Extension views are React components rendered into FlowKey's native UI —
there is no DOM. The component receives everything as props:

```tsx
import {
  List,
  Action,
  ActionPanel,
  defineReactExtension,
  type CommandProps,
} from '@flowkey-mini/react-ui';
import manifest from '../manifest.json';

function MyView(props: CommandProps) {
  return (
    <List>
      <List.Item
        id="hello"
        title={`Hello, ${props.query}`}
        actions={
          <ActionPanel>
            <Action
              title="Save"
              onAction={async () => {
                await props.capabilities.storage.set('last', props.query);
                await props.capabilities.hud.show({ title: 'Saved!' });
              }}
            />
          </ActionPanel>
        }
      />
      <List.EmptyView title="Type something" />
    </List>
  );
}

export default defineReactExtension({ manifest, component: MyView });
```

`props.capabilities` gives you typed groups over the gated native calls:
`http.fetchJson`, `storage.get/set`, `clipboard.write/paste`, `secrets`,
`shell.openUrl`, `apps`, `media`, `image.fetch`, `hud.show`. Views come in
three shapes — `List`, `Grid` (with tinted SVG icons: `icon={{ svg, color }}`)
and `Detail` — see the
[UI reference](https://github.com/GabrielSantos23/flowkey-launcher/tree/main/flowkey-native/docs/extension-capabilities.md).

One rule to remember: the `actions` prop must be a **static element tree** —
map your `<Action>`s inline inside `<ActionPanel>`; wrapping them in a helper
component breaks serialization.

## Sharing and installing

```bash
pnpm package   # → my-extension-0.1.0.flowkey
```

A `.flowkey` is a zip: `manifest.json` + your bundled `main.js`. Send it to
anyone; they install it via **FlowKey → Settings → Extensions → Install from
file…** and confirm the capability dialog. Uninstalling (also in Settings)
removes the extension _and_ all of its data — storage, secrets and connected
accounts. Bump `version` for every package you distribute; FlowKey only
installs strictly newer versions.

## Troubleshooting

- **Extension doesn't appear / stops loading** — Settings → Extensions shows
  a "Failed to load" list with the reason (invalid manifest, bundle error).
- **Changes don't show up** — `pnpm dev` installs automatically, but FlowKey
  loads extensions at startup: restart the app.
- **`pnpm install` warns about ignored build scripts** — allow esbuild:
  `pnpm config set onlyBuiltDependencies esbuild --location project` (or approve it when pnpm prompts).
- **Publishing calls fail** — the method or host must be declared in the
  manifest _and_ consented at install time; extend `nativeMethods` / `httpHosts`,
  reinstall, and re-accept.

Full documentation lives in the
[repository docs](https://github.com/GabrielSantos23/flowkey-launcher/tree/main/flowkey-native/docs):
[quickstart](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-quickstart.md) ·
[package format & manifest reference](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-format.md) ·
[capabilities & consent](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-capabilities.md).

## Related packages

- [`@flowkey-mini/native-sdk`](https://www.npmjs.com/package/@flowkey-mini/native-sdk) — types, manifest validation, typed capability helpers
- [`@flowkey-mini/react-ui`](https://www.npmjs.com/package/@flowkey-mini/react-ui) — the React component set rendered by FlowKey

MIT licensed. FlowKey itself is the native launcher — this CLI only builds extensions for it.
