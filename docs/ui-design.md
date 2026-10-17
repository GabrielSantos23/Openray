# UI design

The UI matches Raycast for Windows 2.4.0.0's look: dark-first, rounded panels, translucent
launcher, compact search bar.

## Tokens

All colors and radii are CSS variables in `build/frontend/src/styles/` (and
`build/frontend/src/styles.css`); components never hard-code hex values. Themes set the
variables per theme id (`build/frontend/src/app/themes.ts`) — the built-ins mirror the
reference app's dark/light palettes, with a system-accent option (`app/systemAccent.ts`).

## Layout

- **Launcher** (`main-window.html`): search bar on top; grouped result list with section
  titles (Favorites, Suggestions, Commands, Calculator, Color, Translate, Files…); footer
  with the primary action and `Actions Ctrl K`; big detail panels (color, calculator,
  translator) render as split rows, matching the reference layout.
- **Settings** (`settings-main.html`): sidebar pages + content cards; per-extension enable
  switch lives in the page titlebar. Card corners use the shared radius tokens (the
  Commands sections had clipped corners — fixed once in the card chrome, not per page).
- **Notes window**: its own page and window chrome (`NotesWindow.cs`).
- **HUD/toasts**: host-owned `HudWindow.cs` overlay; extension toasts match the reference's
  two-line toast.

## Widgets worth reusing

- `ActionPanel.tsx` — grouped action lists (Ctrl K panels) with stable action ids.
- `icons.tsx` — the OpenrayIcon fallback set (lucide names); extension icons resolve
  manifest assets or emoji.
- `commandChrome.tsx` — footer/actions chrome shared by command pages.

## Verification

UI changes are verified visually: run with the control channel, `GET /screenshot`, and look
at the PNG. Demo data must be fake (no real clipboard content, paths or tokens in fixtures).
