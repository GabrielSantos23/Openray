# Gaps

Known shortfalls and next steps, most important first. Updated in the same change that
closes or discovers them.

1. **Settings window is invisible to agents.** `get_state`/`screenshot` cover the launcher
   window only; the Settings window is a separate WebView2 browser process. Settings are
   drivable through `settings.*` commands, but not inspectable visually.
   *Next*: a control route that activates and captures the Settings window.
2. **Generated command descriptions are minimal.** The CATALOG covers the high-traffic
   commands; the rest read as "Runs the domain action". *Next*: fill descriptions as
   domains get agent-facing polish.
3. **Schemas on generated commands are permissive** (`type: "object"`), so bad params reach
   handlers and fail with handler messages (still typed envelopes). *Next*: tighten schemas
   per command where it helps agents.
4. **`send_input` covers the root search surface.** Panels and forms are reachable through
   `openCommand`-style state but not every form field is driven yet.
5. **File search scopes UI** was removed by product decision; the indexer still supports
   scopes via `fileSearch.setSettings`.
6. **Public GitHub mirror is behind** the local main; refresh with the filtered-snapshot
   push when asked.
