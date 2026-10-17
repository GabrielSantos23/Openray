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
7. **Emoji extension (`ext.emoji.search`) gaps vs the shipped picker**: no skin-tone
   submenus (tone is a preference), no Edit-Custom-Keywords view (keywords are
   deletable only), no AI keyword suggestions; the shipped dataset is embedded in a
   native Swift module, so the clone derives its dataset from `unicode-emoji-json`
   (version drift: 559 Smileys & People entries vs the shipped 555).
8. **Svgl extension (`ext.svgl.index`) gaps vs the Raycast svgl extension**: the
   package-manager first-run setup view is replaced by a pnpm fallback (Raycast's own
   runner lookup falls back the same way; the preference still exists); the grid filter
   dropdown does not persist the last selection across sessions; framework component
   output is byte-identical templates, but React components go through the svgl svgr
   endpoint like the original.
