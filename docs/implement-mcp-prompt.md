\# Prompt: implement the command registry, control channel and MCP server in RaycastMini



You are working on RaycastMini, a Raycast-style launcher for Windows built on the FlowKey library. Other agents may be editing this repo at the same time.



\## Goal



Make every action in the app a command in a single registry, and expose that registry to AI agents through a control channel and an MCP server, so an agent can change the app, run it, operate it, look at the result and fix it without a human in the middle.



The reference design is photocraft (github.com/storytold/photocraft): one registry of commands, and the UI, the CLI, a JSON control channel and the MCP server all call the same commands. The MCP server works headless, or bridged to the running app. A loopback-only, authenticated control channel lets an agent inspect UI state, drive the app and take screenshots.



Do not copy photocraft code. Reproduce the architecture, in our stack.



\## Ground rules



\- Read `AGENTS.md` first. Follow it. Update it as part of this work (layer paths, run commands, command conventions).

\- Do not guess the stack. Phase 0 is discovery. Adapt every later phase to what the repo actually uses.

\- Touch only what the task needs. Never revert or reformat changes you did not make. Re-read a file right before editing it. Commit small, only your own files.

\- No inline comments in code. Dark UI, colors from CSS variables, Tailwind utilities over inline styles.

\- Do not stop after a phase to ask for permission. Stop only if something is genuinely blocked or the design forces a decision that changes the architecture, and then report it with a recommendation.



\## Phase 0: discover and report



Before writing code, map the repo and write `docs/mcp-architecture.md` with:



1\. The layers that exist today and their paths: core or shell, UI, extension runtime and sidecar, FlowKey SDK integration, settings, storage, hotkeys, windowing.

2\. How the UI triggers actions today (IPC calls, direct handlers, state stores) and where logic is tied to the UI.

3\. A table of every user-visible action currently in the app (search, run extension command, open settings, snippets, quicklinks, calculator, translator, file search, window management, notes, toggles in Settings, and so on) with where it lives today.

4\. How extension commands are declared and invoked, and how they could be listed and run from the outside.

5\. Your proposed placement of: the registry, the event bus, the control channel, the MCP server, the CLI.

6\. Risks (threading, window focus, Windows-specific capture, extension sidecar lifecycle).



Fill in the TODO paths in `AGENTS.md` from this. Then continue to Phase 1.



\## Phase 1: command registry (core)



Create the registry in the lowest layer that can run without a window.



\- A command has: `id` (`domain.action`), `title`, `description` written for an agent, `params` as JSON Schema, `risk` (`read`, `write`, `destructive`), and `run`.

\- Registration API that is easy to use from any module, with duplicate-id detection at startup.

\- Dispatch validates params against the schema, rejects unknown fields, runs the handler, and returns the same result envelope to every caller: `{ ok: true, result }` or `{ ok: false, error: { code, message, hint? } }`.

\- An event bus. Handlers emit events (for example `command.started`, `command.finished`, `ui.toast`, `settings.changed`); the UI subscribes. Handlers never call the UI directly.

\- A ring buffer of recent events for later use by `get\_events`.

\- Handlers must run with no window attached.



Add unit tests for registration, validation errors, unknown commands, risk metadata and the event buffer.



\## Phase 2: move existing actions into the registry



\- Port every action from the Phase 0 table into commands, grouped by domain. Prefer behavior-preserving moves over rewrites.

\- The UI must call the registry for these actions instead of its own handlers. No parallel code paths.

\- Settings: expose `settings.get`, `settings.set` and `settings.list` so every Settings control is reachable as a command, with schemas per setting.

\- Keep UI-only concerns (animation, focus, scroll) in the UI. If an action needs the UI to react, emit an event.

\- Work domain by domain. After each domain, the app must still build and run.



\## Phase 3: extension layer



\- Make extension commands appear in the registry under `ext.<extensionName>.<command>` with metadata derived from the extension manifest (title, description, argument schema, risk defaulting to `write`).

\- Extensions load, unload and reload at runtime: the registry must reflect that. Emit `registry.changed`.

\- Add `extensions.list`, `extensions.reload` and `extensions.run` as commands.

\- Handle the extension sidecar lifecycle: if it is down or restarting, return a clear typed error, not a hang. Add timeouts.

\- Add a way for FlowKey SDK extensions to call registry commands where it makes sense, without breaking the existing SDK contract. Additive changes only.



\## Phase 4: control channel



\- A local server bound to `127.0.0.1` only, disabled by default, enabled by a flag (`--control`).

\- A random token at every launch, required on every request, never logged. Write it somewhere only the current user can read, and print the path at startup.

\- Endpoints (or equivalent messages): run a command, list and describe commands, read app and UI state as JSON, read recent events, capture a screenshot of the app window as PNG, send input events (key presses, text, clicks) to the app.

\- `get\_state` returns what an agent needs to understand the screen: which view is open, the query text, the visible items with ids and titles, the selected item, open dialogs, current settings page. Add stable test ids to the UI where needed.

\- Screenshot: capture the app window using the best Windows-supported method for our stack. Offscreen rendering may not be possible; a window capture that works while the window is visible is fine. Document the limits.

\- Honor `risk`: destructive commands are refused unless the request sets an explicit flag.

\- Add tests for auth failure, wrong interface, schema errors and the risk gate.



\## Phase 5: MCP server



\- Implement the MCP server with the official SDK for our stack. Support stdio transport so Claude Code and similar clients can launch it.

\- Two modes:

&nbsp; - headless: uses the registry directly with no UI (commands that need the window return a typed `needs\_ui` error);

&nbsp; - bridged: connects to the running app through the control channel using the token file.

&nbsp; Auto-detect: use bridged if a running app is found, otherwise headless. Allow forcing a mode by flag.

\- Do not create one MCP tool per command. Expose these tools: `list\_commands` (with a text filter), `describe\_command`, `run\_command`, `get\_state`, `screenshot`, `send\_input`, `get\_events`. Tool descriptions must be written for an agent with no context.

\- Expose the command list as an MCP resource as well.

\- `run\_command` respects `risk` exactly like the control channel.

\- Add a CLI entry point: `run` (one command from the shell) and `mcp` (start the server). Same registry, same results.

\- Provide an example MCP client config for Claude Code in `docs/mcp-architecture.md`.



\## Phase 6: verify end to end



Verify through the MCP server itself, not by reading code:



1\. Start the app with the control channel on.

2\. Through MCP: list commands, open the Settings view, change a setting, run an extension command, run a snippet or calculator command, read `get\_state` after each step, take a screenshot.

3\. Confirm the UI actually changed and matches `get\_state`.

4\. Kill the sidecar and confirm commands fail with a typed error, then recover.

5\. Confirm the headless mode runs a registry command with the app closed.

6\. Confirm a destructive command is refused without the explicit flag.



Write the results into `docs/mcp-architecture.md` (what you ran and what you saw), including anything that does not work yet.



\## Phase 7: docs and tooling



`AGENTS.md` references docs and checks that must exist when you finish. Create what is missing, keep each file short and accurate:



\- `docs/architecture.md`: layer map with real paths, dependency rules, the registry/UI seam, extension runtime.

\- `docs/development.md`: build, test, run, how to start the app with the control channel, debug tricks.

\- `docs/contributing.md`: clean-room rules, layering, style, commit rules, and an "add a command" checklist with a minimal example.

\- `docs/control-protocol.md`: endpoints or messages, auth, risk gate, `get\_state` shape, screenshot limits.

\- `docs/mcp-architecture.md`: modes, tools, example Claude Code client config, verification results from Phase 6.

\- `docs/ui-design.md`: design tokens and widgets as they exist today.

\- `docs/parity.md`: generated or maintained list of Raycast commands and settings, live or missing, based on the Phase 0 table and the reverse engineering notes.

\- `docs/gaps.md`, `docs/roadmap.md`, `log/devlog.md` (first entry for this work), `ATTRIBUTION.md` if missing.

\- A layer check script wired into the repo's scripts and CI, enforcing the one-way layering from `AGENTS.md`. Register every package or module in it.

\- A command fuzz test that runs every registered command with adversarial params (empty, wrong type, huge, nested, null) and asserts an error envelope and no crash.



Then update `AGENTS.md`: replace every `TODO` with the real path or command, and fix anything that no longer matches the repo. List known gaps and next steps in `docs/gaps.md`.



\## Done means



\- Every user-visible action is a registry command and the UI uses the registry.

\- Extension commands are in the registry.

\- The control channel and MCP server work in headless and bridged modes.

\- Tests pass, build and typecheck pass, and the Phase 6 run was actually done.

\- Docs and `AGENTS.md` match the code.



At the end, reply with a short summary: what was built, where it lives, how to start it, what was verified, and what is still missing.

