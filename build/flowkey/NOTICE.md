# NOTICE — vendored FlowKey packages

The packages under this directory are ported from the FlowKey launcher
(https://github.com/GabrielSantos23/flowkey-launcher), the repository owner's own project.

| Vendored package | Source package | Source version | Source location |
|---|---|---|---|
| `@flowkey-mini/native-sdk` | `@flowkey-cli/native-sdk` | 0.5.2 | `flowkey-native/sdk` |
| `@flowkey-mini/react-ui` | `@flowkey-cli/react-ui` | 0.3.0 | `flowkey-native/react-ui` |
| `@flowkey-mini/cli` | `@flowkey-cli/cli` | 0.4.0 | `flowkey-native/cli` |

Source repo commit at vendoring time: `62e0e5850b34a44b443ce8a67685a65b5bddb569` (main).

## License

The FlowKey repository is licensed **GPL-3.0-only** (LICENSE: "GNU GENERAL PUBLIC LICENSE Version
3, 29 June 2007"). The vendored code is the repository owner's own work, ported with their explicit
direction; the GPL-3.0 notice is preserved here and applies to these vendored sources.

## Renames applied

- Package names `@flowkey-cli/*` → `@flowkey-mini/*` (package.json and all internal imports).
- Nothing else changed at vendoring time.

## How to sync from FlowKey later

1. Re-download the wanted `@flowkey-cli/*` version tarballs (or copy the package sources from the
   repo).
2. Re-apply the rename above (`@flowkey-cli/` → `@flowkey-mini/` in package.json names and internal
   imports — mechanical, no other edits).
3. Re-apply our library additions; every place we changed the vendored sources is marked with a
   `FLOWKEY-MINI:` comment prefix so a three-way diff is mechanical.
4. Re-run the contract tests (`build/backend/tests/flowkey-contract.test.mjs`) and the adapter tests
   (`flowkey-adapter.test.mjs`) — they pin the behaviors we depend on.
