# Contributing

## Rules

- **Clean-room.** The Raycast for Windows 2.4.0.0 analysis is a reference for observed
  behavior and look, never a source of code. No decompiled code, binaries or assets.
- **Tests are the gate.** Every change ships with tests; run the full set before finishing
  (docs/development.md).
- **Layering is one-way** (docs/architecture.md); `node build/scripts/layer-check.mjs` must
  pass.
- **Dark UI, design tokens.** Colors and radii come from CSS variables
  (`build/frontend/src/styles/`); never hard-code hex values in components.
- **Comments state constraints** (Raycast-mirroring decisions, non-obvious invariants), not
  narration.
- **Commit messages and docs in English.** Small commits, only your own files.

## Add-a-command checklist

1. Implement (or reuse) a handler in a core-service module
   (`build/backend/src/<domain>.js`) with no UI dependency.
2. If the domain is new, wire its handler table in `build/backend/src/runtime.js` and add a
   `registerTable` call in the registry section; the command (id = `domain.method`) is then
   registered automatically with a heuristic risk.
3. Override risk/description when the heuristic reads the intent wrong: entries in
   `CATALOG` (`build/backend/src/commands/index.js`) and explicit `risk` maps.
4. Hand-written schemas only for new leaf commands (`settings.get` is the reference);
   generated commands validate `type: "object"` and trust the handler.
5. Tests: a headless test that runs the command (see `build/backend/tests/commands-wiring.test.mjs`)
   and graceful-failure coverage (empty / wrong-type / out-of-range params return an error
   envelope).
6. Run the fuzz test: `node --test --test-force-exit build/backend/tests/command-fuzz.test.mjs`
   — every registered command is swept with adversarial params. Add verbs that must not run
   in the fuzzer (network, real clipboard, long scans) to its exclusion set with a comment.
7. Verify on the running app: start it with `--control`, then
   `node build/backend/src/cli.mjs run <id> '<json>'`, `get_state` and a screenshot.
8. Devlog entry (`log/devlog.md`).

Minimal example — a new `bookmarks.list` command:

```js
// build/backend/src/runtime.js, inside createRuntime, after the other registerTable calls:
registry.register([
  {
    id: "bookmarks.list",
    title: "bookmarks list",
    description: "List saved bookmarks with tags.",
    risk: "read",
    domain: "bookmarks",
    params: { type: "object" },
    run: () => ({ bookmarks: bookmarkStore.all() }),
  },
]);
```

## Error envelope

`{ ok: true, result }` or `{ ok: false, error: { code, message, hint? } }` with codes
`unknown_command | invalid_params | destructive_refused | needs_ui | timeout | internal`.
Dispatch never throws; an escaped error is a bug.
