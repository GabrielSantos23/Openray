# @flowkey-mini/react-ui

React components for [FlowKey](https://github.com/GabrielSantos23/flowkey-launcher) extension views. Your components render into a custom reconciler that serializes the tree and sends it to the launcher, which renders it **natively** — there is no DOM and no web view.

Scaffold a working extension first (it wires everything up):

```bash
npx @flowkey-mini/cli init "My Extension"
```

## The mental model

You export one React component via `defineReactExtension`. FlowKey calls it
with everything it needs as props and re-renders it as the user types:

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
  // props.query        — what the user typed (search is live)
  // props.filterValue  — the search-bar dropdown selection, if you declared `filter`
  // props.preferences  — the user's configured values for this extension
  // props.capabilities — typed native calls (http, storage, clipboard, …)
  return (
    <List>
      <List.EmptyView title="Nothing here yet" />
      <List.Section title="Results">
        <List.Item
          id="example"
          title="Example item"
          subtitle="Shown under the title"
          actions={
            <ActionPanel>
              <Action
                title="Do it"
                primary
                onAction={async () => {
                  await props.capabilities.clipboard.write('done');
                  await props.capabilities.hud.show({ title: 'Done!' });
                }}
              />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

export default defineReactExtension({ manifest, component: MyView });
```

## The three view types

| Component  | Renders as                                         | Pieces                                                                                   |
| ---------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `<List>`   | searchable rows, optional sections and a side pane | `List.Section`, `List.Item`, `List.Item.Detail`, `List.EmptyView`, `filter` prop         |
| `<Grid>`   | icon tile grid                                     | `Grid.Section` (header + count), `Grid.Item`, `Grid.EmptyView`, `filter` prop, `columns` |
| `<Detail>` | single-item page                                   | `Detail.Metadata.Field`, `markdown`, `actions`                                           |

Every item takes an `actions` prop — the **primary** action runs on Enter and
shows in the footer; all actions appear in the launcher's `Ctrl+K` panel.

## Icons

`icon` accepts exactly one of:

```tsx
icon="🚀"                                   // emoji (rasterized by the shell)
icon={{ lucide: "activity", color: "#EF4444" }}  // name from the shell's built-in Lucide set
icon={{ svg: "<svg …/>", color: "#EC4899" }}     // arbitrary tinted SVG you ship
icon={{ uri: "file:///… | data:image/png…" }}    // a cached image (e.g. via image.fetch)
```

## Two rules that save debugging time

1. **The `actions` prop must be a static element tree.** Map your actions
   inline inside `<ActionPanel>` — a custom wrapper component (e.g.
   `<MyActions />`) cannot be serialized and fails with _"expected a FlowKey
   UI component"_.
2. **Don't bundle your own React.** The `@flowkey-mini/cli` build aliases
   `react` and this package to the host's single copies — a second React
   breaks hooks and serialization.

## Props your component receives (`CommandProps`)

| Prop           | Type                      | Meaning                                                                                                    |
| -------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `query`        | `string`                  | live search text                                                                                           |
| `filterValue`  | `string?`                 | selected option from your `filter` dropdown                                                                |
| `commandId`    | `string?`                 | which manifest command opened this view                                                                    |
| `preferences`  | `Record<string, unknown>` | user-configured values (typed by your manifest `preferences`)                                              |
| `native`       | `{ call, showHud }`       | raw gated native-call escape hatch                                                                         |
| `capabilities` | `FlowKeyCapabilities`     | typed groups: `http`, `storage`, `secrets`, `clipboard`, `shell`, `apps`, `media`, `image`, `hud`, `oauth` |
| `signal`       | `AbortSignal`             | aborted when the view closes — pass it into fetches                                                        |

## Related packages

- [`@flowkey-mini/cli`](https://www.npmjs.com/package/@flowkey-mini/cli) — scaffold, dev loop, packaging (**start here**)
- [`@flowkey-mini/native-sdk`](https://www.npmjs.com/package/@flowkey-mini/native-sdk) — types, manifest validation, capability types

Full docs: [quickstart](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-quickstart.md) ·
[capabilities & consent](https://github.com/GabrielSantos23/flowkey-launcher/blob/main/flowkey-native/docs/extension-capabilities.md).
MIT licensed.
