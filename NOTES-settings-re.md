# REA findings: real Raycast Settings window (artifacts/frontend)

Source: `settings-window.html` + `settings-window-CpZLjTdD.js` + `settings-window-BQUPyk4Y.css`
+ `settings-ui.namespace-BuEl4Ff-.js` + `settings-ui-BNqj9rX1.css`
Analyzed via `npx rea-agents@latest analyze-javascript-application <staged dir>` (MCP tool broken;
schema mismatch). Staged dir: `%TEMP%\opencode\rea-settings-app`. Evidence: `%TEMP%\opencode\rea-settings.json` (580MB).

## Window shell
HTML body is only `<div id="settings-window-root" class="window-root">`; React renders everything.

Layout = `SettingsWindowView` (`settings-window-view` CSS, 56 rules):
```
<div sidebarWrapper>
  [window icon]
  <aside sidebar>                      width:var(--sidebar-width); border-right 1px separator (windows)
    <div sidebarTitleBar>              height:var(--window-header-height); bg var(--fg-5); 1px bottom border
      <span sidebarTitleText>Settings</span>     color:var(--color-text-secondary); Segoe UI Variable
    </div>
    <div sidebarSearch>                search input (@ calc(header-height + 12px))
      <SettingsSidebarSearch/>
    </div>
    <ScrollArea>
      <div sidebarContent>             gap:var(--space-16); padding: var(--sidebar-padding-x)
        <AccountLink/>                 <a account> avatar 32px circle + name|"Not Signed In" + "Account"
        <SidebarSection/>              1st: root pages
        <SidebarSection/>              2nd: extensions
      </div>
    </ScrollArea>
  </aside>
  <main main>                          flex:1 column
    <SettingsNavigationHeader/>         height var(--window-header-height); breadcrumbs left; options right
    <ScrollArea> page content </ScrollArea>
  </main>
</div>
```
- `SidebarSection` = plain `<div className="sidebarSection">` (gap 2px), NO visible title.
- Nav link (`navlink`): height 32px, gap 8px, padding 6px; icon 22px box; label `text`;
  badge (`Pro`/`Soon`) or dev icon pushed with `margin-left:auto`.
- Header/dragzone = window header height; Escape hides window.

## Sidebar root pages (order matters)
1. General   `/general`
2. Launcher  `/launcher`
3. Shortcuts `/shortcuts`
4. Keyboard  `/keyboard`
5. Cloud Sync `/cloud-sync`
6. Advanced  `/advanced`
7. Organizations `/organizations`
8. Internal  `/internal`
9. Remote    `/remote`
10. About    `/about`
Account link is pulled out of the list and rendered first (`/account`).
Icons: general, launcher, shortcutsWindows, keyboard, cloudSync, organizations, internal, remote, about.

## Page definition shape (`settings-page-definition-utils`)
```js
{ id, title, description, keywords[], icon, group:|'root'|'builtin-extension',
  parent, path, to, rootSearchCommand?, searchEntries }
rows:     { [id]: { id, title, description?, keywords[] } }
sections: { [id]: { id, title, keywords[] } }
```

## General page (`/general`) — most relevant to our clone
description: "Configure appearance, startup behavior, and the Raycast hotkey."
icon: general. group root. NO sections (flat rows). Rows in order:
1. follow-system-appearance  Follow System Appearance
2. theme-fixed               Theme
3. theme-dark                Dark Theme
4. theme-light               Light Theme
5. theme-studio              Theme Studio  ("Edit or create themes for Raycast")
6. interface-size            Interface Size ("Adjust the size of the Raycast interface")
7. window-mode               Window Mode ("Choose your preferred mode when opening Raycast")
8. show-favorites-in-compact-mode  Show Favorites in Compact Mode
9. open-at-login             Open at Login
10. show-in-menu-bar         Show in System Tray   (id is show-in-menu-bar, title is Windows naming)
11. automatically-show-taskbar  Automatically Show the Taskbar
12. raycast-hotkey           Raycast Hotkey

## Launcher page (`/launcher`) sections + rows
Sections: Behavior, Customize Search, Fallback Commands
Rows: Show Raycast on, Pop to Root Search ("Timeout after which Raycast will reset to
root search after closing the window."), Root Search Sensitivity ("Search sensitivity controls
the number of matching results presented in Root Search. Low sensitivity produces many results
for a search term, while high sensitivity displays fewer results."), Search History ("Clear recent
searches restored when pressing the up arrow in Root Search."), Include Files in Root Search,
Include File Content search results in Root Search.

## Settings UI primitives (`settings-ui__*`, settings-ui-BNqj9rX1.css)
- `root`: flex column, gap 16px, padding-inline var(--content-padding-x), padding-bottom
- `section`: flex column, gap 4px
- `sectionTitle`: min-height 32px, justify-between, align-center; container gap 4px, padding-left 12px
- `sectionContent`: `background-color: rgb(from var(--fg) r g b / 2.5%)` <- the translucent card,
  min-height 28px, flex column, overflow hidden
- `row`: gap 12px, min-height 46px, flex row, justify-between, align start,
  padding-block 12px, border-radius 8px; `[data-align=center]` centers
- `rowRight`: right accessory; `column`: left (title+description)
- `separator`: divider; `interactiveItem`; `externalLinkItem`; `table`/`tableRow`
Components: SettingsUI.Root/.Section/.SectionContent/.Row/.Column/.Separator/.Text/
InteractiveItem/ExternalLinkItem/Table/TableRow/.ExtensionIntro/.ExtensionRoot

## CSS variables
Defined outside staged dir (base theme css `css-FlvQZ5S4.css` not staged / is the app theme):
`--sidebar-width`, `--content-padding-x`, `--window-header-height`, `--sidebar-padding-x`,
`--radius-window`, `--space-*` (2,4,6,8,12,16,32), `--icon-16/22`, `--spx`, `--fg`, `--fg-5`,
`--color-text-secondary`, `--color-text-tertiary`, `--color-text-primary`,
`--color-border-separator`, `--color-border-secondary`, `--green`, `--red`,
`--radius-full`, `--selection-10`.

## Control components used by rows (need our own versions)
switch-B7CrJq8I.js, select-BNK0xI-C.js, dropdown-button-CnWglU06.js, input-field-CYzn64gj.js,
checkbox-BgpFxDNn.js, keyboard-shortcut-recorder-DiHx3PwG.js, button-DPxKsQf5.js,
icon-button-D9U1vB85.js, badge-CcWRbSms.js, scroll-area-DC0GNxog.js, tooltip-BRD7F9bx.js.
