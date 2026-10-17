# Roadmap

Milestones and current focus. Terse by design; the devlog (`log/devlog.md`) carries the
running history.

## Done

- Raycast-faithful launcher: root search, applications, calculator (+ history, colors),
  clipboard history (+ OCR), snippets, quicklinks, notes, translator, file search, window
  management, focus/games/taskbar, Settings parity for the shipped pages.
- Rebrand to Openray with data-dir/settings/localStorage migrations.
- **MCP work (current milestone)**: command registry (250+ commands), event bus, loopback
  control channel with per-launch token, MCP server (stdio, bridged/headless), CLI,
  end-to-end verification through MCP.

## Current focus

- Everything user-visible is drivable by an agent: keep tightening command descriptions and
  schemas as domains get agent-facing attention (docs/gaps.md).

## Next

1. Settings-window visibility for agents (`get_state`/`screenshot` for the Settings window).
2. Headless smoke test wired into CI (CLI + fuzz + layer check).
3. Extension-side registry access (FlowKey SDK calling registry commands where it makes
   sense) — additive only.
4. Refresh the public GitHub mirror.
