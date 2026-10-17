# Raycast parity

Status against the Raycast for Windows 2.4.0.0 reference, per domain. Every row lists the
user-visible action and whether it is live (registry command id in parentheses), partial, or
missing. The per-domain specs in this directory carry the behavioral detail.

## Live (with registry commands)

| Domain | Coverage |
|---|---|
| Root search | Sections, favorites, aliases, usage ranking, fallbacks (`applications.getAll`, usage commands) |
| Applications | List/launch/new window/quit/restart/force quit/reveal/properties/recent files/run-as, activation behavior, deep search, auto-quit |
| Calculator | Evaluation, units, currencies, bases, history, colors, preferences (`calculator.*`) |
| Clipboard History | Capture, list/filter/pin/delete, paste/paste-as/sequential paste, OCR, QR, save-as-file, tags, ignored apps, history duration (`clipboard.*`) |
| Snippets | CRUD, pinning, tags, import/export, keyword expansion with placeholders (`snippets.*`) |
| Quicklinks | CRUD, pinning, tags, import/export, argument placeholders, prefer-existing-tabs (`quicklinks.*`) |
| Notes | CRUD, folders, trash (recover/purge), markdown conversions, notes window (`notes.*`) |
| Translator | Quick translate, custom commands, languages, preferences (`translator.*`) |
| File Search | Scoped index, search, exclude paths, ignore patterns (`fileSearch.*`) |
| Window Management | 52 command set (snap/half/thirds/quarters/cycle/minimize/always-on-top…), hotkey presets, saved states, args views (`windowManagement.*`) |
| Focus | Sessions (duration/no-limit), pause/resume/complete, categories, blocking, panel (`focus.*`) |
| Games | Game classification flags, Game Mode (`games.*`) |
| Taskbar | Windows taskbar strip: position, visibility (`taskbar.*`) |
| Settings | Every Settings-page control is reachable via `settings.set`; import/export via advanced |
| Advanced | Scheduled backups, export/import, connection prefs (`advanced.*`) |
| Extensions (FlowKey) | Install, run, preferences, native consent gates (`ext.*`, `extensions.*`) |
| Emoji & Symbols (`ext.emoji.search`) | Emoji/symbol search, categories, skin tones, Frequently Used frecency, pin, custom keywords, paste/copy/copy-unicode/save-as-snippet with the reference shortcut set |
| Svgl (`ext.svgl.index`) | SVG logo search grid (svgl.app), category dropdown (All/Pinned/Recently Used + categories), titled action panel (Copy SVG/File/Wordmark, shadcn/ui registry, React/Vue/Svelte/Angular/Astro components, URLs, pin/move, open-in-browser), light/dark logo variants, recently used |
| Agents | Command registry, control channel, MCP, CLI (this work — no Raycast counterpart) |

## Partial

- **Store**: the GitHub-catalog extension store was removed on purpose; local publishing
  remains. No plans to bring the remote store back.
- **Window Management hotkey presets**: Magnet/Rectangle presets exist; per-command argument
  grammar is documented in `docs/window-management-spec.md`.

## Missing (no clone planned or not yet built)

- Cloud sync and organizations (removed on purpose)
- AI Extensions / Ask-anything features (removed on purpose; the app is AI-free)
- Raycast account sign-in, store purchases
- Quicklinks > some platform-specific deep links beyond prefer-existing-tabs

Regenerate/extend this list when commands are added (AGENTS.md §5).
