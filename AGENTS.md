# AGENTS.md: guide for AI agents and contributors

Openray (historically "RaycastMini") is a Raycast-style launcher for Windows: a global hotkey opens a search window, and everything the user can do (open apps, run extensions, snippets, quicklinks, calculator, translator, file search, window management, notes, settings) is a command. It runs on the FlowKey library (extension SDK and runtime). It does not use `@raycast/api`; the Raycast store was tried and removed on purpose, do not bring it back.

The goal is a launcher that feels like Raycast on Windows (same layout, behavior and speed), with every feature drivable by agents. Read this file first, then `docs/`.

If something here disagrees with the repo, the repo wins: fix this file in the same change.

## 1. Orientation (5 minutes)

| Read | Why |
|---|---|
| `docs/mcp-architecture.md` | Layer map, registry/control-channel/MCP design, verification log |
| `docs/development.md` | Build, test, run, drive the app programmatically, debug tricks |
| `docs/contributing.md` | Rules: clean-room, tests, layering, style, commits; the "add a command" checklist |
| `docs/control-protocol.md` | Control channel: how agents drive and screenshot the running app |
| `docs/ui-design.md` | Design tokens, themes, widgets, and how to match Raycast's look |
| `docs/*.md` | Per-domain specs (calculator, clipboard, snippets, quicklinks, notes, translator, file search, window management, focus/games/taskbar, root search, toasts/HUD, settings) |
| `docs/findings-REA.md` | Notes from the reverse engineering analysis of the real app |

## 2. Workspace map

```text
Layer                 Responsibility                                                      Path
L0 foundation         Logging, JSON helpers, paths                                        build/backend/src/
L1 core services      Settings, storage, search index, hotkeys, windows, clipboard,       build/backend/src/*.js
                      file search, notes, snippets, quicklinks                            build/host/*.cs (native half)
L2 command registry   Command definitions, schemas, dispatch, event bus                   build/backend/src/registry.js
                                                                                          build/backend/src/commands/
L3 extension runtime  Loads FlowKey extensions, worker lifecycle, exposes their           build/backend/src/backend.js
                      commands to the registry                                            build/flowkey/worker/
L4 UI                 Search window, lists, detail views, Settings (thin)                 build/frontend/src/
                                                                                          build/host/*Window*.cs
L5 control + MCP      Loopback control channel, MCP server, CLI                           build/backend/src/control-server.js
                                                                                          build/backend/src/mcp-server.js
                                                                                          build/backend/src/cli.js
tooling               Layer check, test helpers, scripts                                  build/scripts/, build/backend/tests/
```

**Layering is one-way.** A layer may depend only on lower layers. The registry and core services must not import UI code and must not assume a window exists. Nothing below the UI may touch the DOM, React state, window handles or webview APIs. The layer check (`node build/scripts/layer-check.mjs`) enforces this; a new module must be registered in it.

## 3. Golden rules

### Never lose user data, never crash (outranks feature work)

People keep snippets, notes and quicklinks here, and the launcher is opened dozens of times a day. A malformed extension, a bad command or MCP param, a corrupt settings file, an odd keystroke or a full disk must produce an error the user or agent can act on, never an unhandled exception or panic.

- **Dispatch never throws.** Command dispatch, extension calls, IPC handlers and the control channel catch everything and return the typed error envelope. An escaped error is a bug.
- **TypeScript/JavaScript code:** no non-null assertions on input-derived values, no unvalidated `JSON.parse` on boundary data, no `any` on data crossing a boundary. Validate with the command's schema at the boundary and trust types inside.
- **C# code:** no `.Result`/`.Wait()` on the UI thread, no file IO inside low-level keyboard hooks (it times out the hook and crashes the process — use a UI-thread-polled flag).
- **Extensions are untrusted.** A crash, hang or infinite loop in an extension never takes down the launcher. Calls have timeouts, the worker pool discards crashed workers, and the failing extension reports a typed error.
- **Storage writes are atomic or contained.** A corrupt settings or data file is moved aside or rebuilt without taking the app down; user content (snippets, notes, quicklinks, clipboard history) is never silently reset.
- **Bound recursion and loops** over user input (search expressions, nested lists, file trees).
- **Prove it.** Every crash fix comes with a small regression test that failed before the fix.

### Everything is a command

1. **New user-visible behavior is a command** in the registry with id, title, description, params schema, risk, and `run`, plus tests. The UI, extensions, CLI, control channel and MCP all dispatch commands by id. If a feature only works through a UI handler, it is not finished.
2. Ids are `domain.action`, dot separated (`snippets.create`, `windows.snapLeft`, `settings.set`). New ids are lowercase; pre-existing camelCase method ids keep their spelling (`historyGetAll`) so pipe callers stay compatible. Extension commands are `ext.<extensionName>.<command>`. Ids are stable; renaming one is a breaking change.
3. `risk` is `read`, `write` or `destructive`. Destructive commands (delete, overwrite, anything that leaves the machine) need an explicit opt-in (`allowDestructive: true`) from the caller.
4. Handlers work through core services, never through UI code. UI feedback goes out as events on the event bus; handlers never call the UI. Handlers must work with the window hidden and no UI attached (verbs that genuinely need the renderer or the WPF host return the typed `needs_ui` error when it is absent).
5. Results and errors are plain JSON in one envelope: `{ ok: true, result }` or `{ ok: false, error: { code, message, hint? } }`. The `hint` says how to fix the call.
6. Only pure view state (focus, animation, scroll, which pane is expanded) belongs to the UI.

### The rest

7. **Clean-room.** The Raycast for Windows 2.4.0.0 analysis (REA with Ghidra) is a reference for observed behavior and look, not a source of code. Implement from observed behavior and our own design. Never paste decompiled code. Never commit Raycast binaries, Ghidra projects or extracted resources, and never ship Raycast icons, fonts or assets. Findings go in `docs/` as notes: what was observed and how it was checked. Third-party assets must be permissively licensed, keep their license next to them, and get a row in `ATTRIBUTION.md` (path, title, author, source, license) in the same change.
8. **Tests are the gate.** Every change comes with tests. Commands get a headless test that runs them with no UI, and a graceful-failure test (empty, out-of-range and wrong-type params return an error envelope, not a crash). A command fuzz test runs every registered command with adversarial params and must stay green.
9. **The UI is thin and data-driven.** UI state is serializable so the control channel can read and drive it. Colors and radii come from design tokens (CSS variables in `build/frontend/src/styles/`), never hard-coded. Dark UI first. Plain CSS over inline styles (the repo does not use Tailwind).
10. **Verify UI changes visually.** Launch with the control channel on and take a screenshot, then look at it. Demo data must be fake: never commit screenshots or fixtures containing real clipboard history, file paths, emails, names or tokens.
11. **Performance is a feature.** Hotkey to visible window, keystroke to results, and extension command start are the numbers that matter. Measure heavy paths, cache per revision, never rescan everything per keystroke, and record before/after timings in the devlog. Budgets live in `docs/development.md` once measured; do not invent numbers.
12. **Windows specifics stay isolated.** OS calls (hotkeys, window management, capture, file search, clipboard) live in the C# host (`build/host/`) behind the pipe; the Node registry and tests do not depend on them directly.
13. **Comments state constraints, not narration.** The codebase documents Raycast-mirroring decisions and non-obvious constraints in block comments; keep comments for that, not for restating the next line.
14. **Commit messages and docs are in English.**

## 4. Picking work

Priorities: important infrastructure first, then low-hanging parity, then the long tail.

1. `log/devlog.md` → the "Still open" bullets of recent entries.
2. The per-domain specs in `docs/` describe target behavior; deviations are work to pick up.

When your work closes a gap, note it in the devlog in the same change.

## 5. Before you finish a task

```sh
node --test build/backend/tests/            # backend (Node) tests
node --test build/tests/                    # frontend logic tests
cd build/frontend && npm run build          # typecheck + bundle the frontend
dotnet build build/host/Openray.csproj -c m3-release   # host build
node build/scripts/layer-check.mjs          # layer check
node --test --test-force-exit build/backend/tests/command-fuzz.test.mjs  # after adding/changing commands
```

While iterating, run only the tests for what you touched, and keep the full set as the final gate.

Then exercise the feature on the running app:

1. Start the app with the control channel on (`--control`, see `docs/development.md`).
2. Drive the feature through `run_command` or input events.
3. Read `get_state` and take a `screenshot`.
4. Fix, repeat.

Then append a terse entry to `log/devlog.md` (what landed, numbers, what is still open). Sessions can end abruptly, so the devlog plus a green tree is how the next agent picks up. Keep the tree building at every step.

A change is done when:

- the behavior exists as a command and is reachable from UI, CLI and MCP;
- it has a headless test and a graceful-failure test;
- tests, frontend build and host build pass;
- it was checked on the running app with `get_state` and a screenshot;
- docs and this file are updated if layers, commands or run instructions changed.

## 6. Control channel and MCP

- The control channel binds to `127.0.0.1` only, is off by default, and is enabled with a flag (`--control`). A random token is generated at every launch and required on every request. Never bind to another interface, never log the token.
- The MCP server has two modes: headless (registry only, no UI) and bridged (talks to the running app through the control channel). Anything an agent can do through MCP must also be doable from the CLI, and the other way around.
- Do not expose one MCP tool per command. Expose `list_commands` (with a text filter), `describe_command`, `run_command`, `get_state`, `screenshot`, `send_input` and `get_events`.
- `run_command` respects `risk`: destructive commands are refused unless the call says so explicitly.

Details live in `docs/control-protocol.md` and `docs/mcp-architecture.md`.

## 7. Parallel agents

More than one agent may be editing this repo at the same time.

- Edit only the files your task needs. Never revert, reformat or "clean up" changes you did not make.
- Re-read a file right before editing it. It may have changed since you last saw it.
- Use your own build output directory when the toolchain locks it, so builds do not block each other.
- Shared files (registry index, command list, router, shared state, settings catalogs) get small, surgical edits.
- Put new commands in a **new module per domain** (`build/backend/src/commands/<domain>.js` with a `specs(deps)` function) instead of growing a shared file.
- If someone else's in-progress edit breaks the build, wait and retry; do not fix their files.
- Keep every manifest (`package.json`, `.csproj`) valid at all times. Create or rewrite manifests atomically: write to a temp file outside the repo tree, then move it into place.
- Do not run repo-wide formatters or codemods unless the task says so.
- Stage and commit only your own files, in small commits.
- If you hit a conflict or an unexpected change in a file you need, stop and report it instead of overwriting.

## 8. Where things are tracked

- `docs/mcp-architecture.md`: registry, control channel and MCP design + verification results.
- `docs/control-protocol.md`: endpoints, auth, risk gate, `get_state` shape, screenshot limits.
- `log/devlog.md`: session log.
- `ATTRIBUTION.md`: every third-party asset and its license.

## 9. Extensions and the FlowKey library

- Extension commands appear in the registry as `ext.<extensionName>.<command>` with metadata from the extension manifest (title, description, argument schema, risk defaulting to `write`).
- Loading, unloading and reloading an extension updates the registry and emits `registry.changed`.
- Changes to the FlowKey SDK contract are additive only. Do not break extensions that exist today.
- Internal extensions (Quicklinks, Snippets, Calculator, Translator, File Search, Window Management, Focus/Games/Taskbar, Notes) follow the same rules as any other extension and the same command conventions.
