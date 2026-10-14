# @flowkey-mini/native-sdk

The TypeScript SDK for [FlowKey](https://github.com/GabrielSantos23/flowkey-launcher) extensions — UI-tree and protocol types, the shared manifest validator, and typed capability helpers. Zero runtime dependencies.

You normally get this package automatically when you scaffold an extension:

```bash
npx @flowkey-mini/cli init "My Extension"
```

See [`@flowkey-mini/cli`](https://www.npmjs.com/package/@flowkey-mini/cli) for the
full getting-started guide — this README covers the SDK surface itself.

## What's in it

### 1. Types for everything on the wire

`ExtensionManifest`, `ManifestCommand`, `PreferenceSchema`, the UI trees
(`ListTree`, `GridTree`, `DetailTree` and their items, sections, filters,
icons) and the sidecar protocol messages (`InitMessage`, `ReadyMessage`,
`SearchMessage`, `NativeCallMessage`, …). Import them for type-checking:

```ts
import type { ExtensionManifest, CommandProps } from '@flowkey-mini/native-sdk';
```

### 2. Manifest validation — the same rules FlowKey enforces

```ts
import { validateManifest } from '@flowkey-mini/native-sdk';

const result = validateManifest(myManifestJson);
for (const issue of result.errors) {
  console.error(`${issue.field} [${issue.code}]: ${issue.message}`);
}
```

`validateManifest` implements exactly the rules the FlowKey shell applies when
a package is installed — id slug format, semver, command structure,
`nativeMethods` / `httpHosts` syntax (including `storage.*` wildcards),
image-file icon safety and preference schemas. Both implementations are pinned
to identical behavior by a shared test fixture, so `flowkey validate` (CLI)
approving a manifest means the shell will accept it too.

Icon values may be an emoji, a lucide name, or an image path shipped with your
package (`"icon": "command-icon.png"`) — traversal and absolute paths are
rejected.

### 3. Typed capabilities

FlowKey injects a `capabilities` object into every extension context and
component's props, so you never hand-roll native-call strings:

```ts
// available as props.capabilities inside a view component
const user = await props.capabilities.http.fetchJson<User>('https://api.example.com/me');
await props.capabilities.storage.set('lastSeen', Date.now());
await props.capabilities.clipboard.write('copied!');
await props.capabilities.secrets.set('apiKey', key); // DPAPI-encrypted at rest
await props.capabilities.shell.openUrl('https://example.com');
await props.capabilities.hud.show({ title: 'Done!' });
```

Every call is gated by the shell: the method must be declared in your
`manifest.json` (`nativeMethods`, `httpHosts`, `oauth`) and — for installed
extensions — covered by the capabilities the user accepted at install time.
`http.fetch` additionally enforces the per-host allowlist with SSRF
protections.

For calls without a typed wrapper there is the raw escape hatch:

```ts
await props.native.call('apps.launch', { id: 'spotify' });
```

## How it runs inside FlowKey

Extension views are React components rendered into FlowKey's native UI. The
sidecar injects everything your component needs as props (`query`,
`filterValue`, user `preferences`, `native`, `capabilities`); the SDK itself
is almost entirely **types** at runtime — the identity helper
`defineExtension` / `defineReactExtension` is all that executes. Extension
builds alias this package to the host's own copy (the `@flowkey-mini/cli`
bundler does this for you), so you never bundle a second copy.

## Full documentation

- [Extension quickstart](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-quickstart.md)
- [Package format & manifest reference](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-format.md)
- [Capabilities & consent](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-capabilities.md)

MIT licensed.
