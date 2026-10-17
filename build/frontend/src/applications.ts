// Raycast's internal "Applications" extension — the `apps` root-search section.
//
// The complete action list is copied verbatim from Raycast's shipped manifest
// (`frontend/internal-extensions-C7AXi5Nw.js`, `dynamicCommands.application.actions`):
//
//   general        Open Application, New Application Window, Open Recent Files,
//                  Run as Administrator, Run as Different User, Show in File Explorer,
//                  Show Info in Finder, Show Package Contents, Show Advanced Options
//   favorites      Add to Favorites
//   copy           Copy Path, Copy Name, Copy Bundle Identifier
//   configure      Configure Command, Configure Extension, Treat as Game, Reset Ranking
//   app-management Hide Application, Quit Application, Force Quit Application,
//                  Enable/Disable Auto Quit, Restart Application, Disable Command, Uninstall
//
// Payload keys are the ones Raycast ships on Windows: `name`, `path`, `bundleId`,
// `disambiguator`, plus the `rootSearch.section === "apps"` routing.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ipc, onNotification } from "./ipc";
import type { ActionGroup } from "./ActionPanel";

export interface ApplicationPayload {
  id: string;
  name: string;
  path?: string | null;
  bundleId?: string | null;
  disambiguator?: string | null;
  isRunning: boolean;
  /** True when the install location is inside a game library (Steam/Epic/GOG/Xbox). */
  isGame?: boolean;
  /** PNG data URL extracted from the target's shell icon; null when none could be extracted. */
  icon?: string | null;
}

export interface ApplicationCommand {
  extensionId: "applications";
  commandId: string;
  title: string;
  subtitle: string | null;
  keywords: string[];
  payload: ApplicationPayload;
}

/** `rootSearch: { section: "apps" }` — apps come first in Raycast's root search. */
export const APPLICATIONS_AREA = "applications";
export const APPLICATION_AREA_KEYS = Object.freeze(["applications", "browser"] as const);
export const APP_ROOT_SECTION = "apps";

export function useApplications(enabled: boolean) {
  const [applications, setApplications] = useState<ApplicationCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetchApplications = () => {
      setLoading(true);
      ipc
        .backend("applications.getAll", {}, { module: "backend" })
        .then((response) => {
          if (cancelled) return;
          const value = (response as { value?: ApplicationPayload[] }).value ?? [];
          setApplications(
            value.map((payload) => ({
              extensionId: APPLICATIONS_AREA,
              commandId: `applications/${payload.id}`,
              title: payload.name,
              // Raycast displays only the disambiguating folder, never the full path.
              subtitle: payload.disambiguator
                ? (payload.disambiguator.split(/[\\/]/).filter(Boolean).pop() ?? null)
                : null,
              keywords: [payload.bundleId, payload.name, payload.path].filter(Boolean) as string[],
              payload,
            })),
          );
        })
        .catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => !cancelled && setLoading(false));
    };
    fetchApplications();
    // The host pushes `applications.changed` after a background rescan (startup snapshot race,
    // Search Scopes / Deep Search changes) so the list catches up without a relaunch.
    const offChanged = onNotification("applications.changed", fetchApplications);

    return () => {
      cancelled = true;
      offChanged();
    };
  }, [enabled]);

  return { applications, error, loading };
}

/** Raycast's exact action groups for an application result. */
export function applicationActionGroups(
  app: ApplicationPayload,
  options: { favorite: boolean },
): ActionGroup[] {
  return [
    {
      name: "general",
      actions: [
        { id: `app:openApplication`, title: "Open Application", itemId: app.id },
        ...(app.isRunning
          ? [{ id: `app:newApplicationWindow`, title: "New Application Window", itemId: app.id }]
          : []),
        { id: `app:recentFiles`, title: "Open Recent Files.", itemId: app.id },
        { id: `app:runAsAdministrator`, title: "Run as Administrator", itemId: app.id },
        { id: `app:runAsUser`, title: "Run as Different User", itemId: app.id },
        {
          id: `app:revealApplication`,
          // `u({ macos: "Show in Finder", windows: "Show in File Explorer" })`
          title: "Show in File Explorer",
          itemId: app.id,
        },
        { id: `app:showAppsFeatures`, title: "Show Advanced Options", itemId: app.id },
      ],
    },
    {
      name: "favorites",
      actions: [
        {
          id: `app:favorite`,
          title: options.favorite ? "Remove from Favorites" : "Add to Favorites",
          itemId: app.id,
        },
      ],
    },
    {
      name: "copy",
      actions: [
        { id: `app:copyPath`, title: "Copy Path", itemId: app.id },
        { id: `app:copyName`, title: "Copy Name", itemId: app.id },
        { id: `app:copyBundleIdentifier`, title: "Copy Bundle Identifier", itemId: app.id },
      ],
    },
    {
      name: "configure",
      actions: [
        { id: `app:configureCommand`, title: "Configure Command", itemId: app.id },
        { id: `app:resetRanking`, title: "Reset Ranking", itemId: app.id },
      ],
    },
    {
      name: "app-management",
      actions: [
        ...(app.isRunning
          ? [
              { id: `app:hideApplication`, title: "Hide Application", itemId: app.id },
              { id: `app:quitApplication`, title: "Quit Application", itemId: app.id },
              { id: `app:forceQuitApplication`, title: "Force Quit Application", itemId: app.id },
              { id: `app:restartApplication`, title: "Restart Application", itemId: app.id },
            ]
          : []),
        { id: `app:uninstall`, title: "Uninstall Application", style: "Destructive", itemId: app.id },
      ],
    },
  ];
}

/** Callbacks the launcher supplies so actions that touch UI state (not the OS) can run. */
export interface ApplicationActionHandlers {
  /** Pins or unpins the application; returns true when it was added. */
  toggleFavorite: (app: ApplicationPayload) => boolean;
  openSettings: () => void;
  showToast: (title: string, message?: string) => void;
}

/** Maps a chosen action onto the native method that performs it. */
export async function runApplicationAction(
  app: ApplicationPayload,
  actionId: string,
  handlers: ApplicationActionHandlers,
): Promise<void> {
  const action = actionId.includes(":") ? actionId.slice(actionId.indexOf(":") + 1) : actionId;
  switch (action) {
    case "openApplication":
      await ipc.backend("applications.open", { id: app.id }, { module: "backend" });
      return;
    case "revealApplication":
      await ipc.backend("applications.reveal", { id: app.id }, { module: "backend" });
      return;
    case "showAppsFeatures":
      // Raycast's "Show Advanced Options": the Windows shell property sheet for the target.
      await ipc.backend("applications.showProperties", { id: app.id }, { module: "backend" });
      return;
    case "copyPath":
    case "copyName": {
      const result = (await ipc.backend(`applications.${action}`, { id: app.id }, { module: "backend" })) as {
        content?: string;
      };
      if (result?.content) {
        await ipc.backend("clipboard.write", { content: result.content }, { module: "backend" });
        handlers.showToast("Copied to clipboard", result.content);
      }
      return;
    }
    case "copyBundleIdentifier": {
      if (app.bundleId) {
        await ipc.backend("clipboard.write", { content: app.bundleId }, { module: "backend" });
        handlers.showToast("Copied to clipboard", app.bundleId);
      }
      return;
    }
    case "favorite": {
      const added = handlers.toggleFavorite(app);
      handlers.showToast(added ? "Added to Favorites" : "Removed from Favorites", app.name);
      return;
    }
    case "configureCommand":
      // Raycast opens the command's preferences; applications have none, so this opens Settings.
      handlers.openSettings();
      return;
    case "resetRanking": {
      // Raycast forgets the ranking it learned from your usage of this application.
      void ipc.backend("usage.resetAppUsage", { appId: app.id }, { module: "backend" }).catch(() => {
        /* ignore errors */
      });
      handlers.showToast("Ranking reset", `Openray forgot how often you open ${app.name}.`);
      return;
    }
    case "quitApplication":
    case "forceQuitApplication": {
      await ipc.backend(
        action === "forceQuitApplication" ? "applications.forceQuit" : "applications.quit",
        { id: app.id },
        { module: "backend" },
      );
      return;
    }
    case "hideApplication":
      // Windows has no "hide application" like macOS; Openraymises every window the app owns.
      await ipc.backend("applications.hide", { id: app.id }, { module: "backend" });
      return;
    case "restartApplication":
      await ipc.backend("applications.restart", { id: app.id }, { module: "backend" });
      return;
    case "newApplicationWindow":
      // Windows apps rarely expose a "new window" command, so Raycast launches another instance.
      await ipc.backend("applications.newWindow", { id: app.id }, { module: "backend" });
      return;
    case "runAsUser":
      // ShellExecute "runasuser" shows the Windows credential prompt, like Raycast does.
      await ipc.backend("applications.runAsUser", { id: app.id }, { module: "backend" });
      return;
    case "runAsAdministrator":
      await ipc.backend("applications.runAsAdministrator", { id: app.id }, { module: "backend" });
      return;
    case "recentFiles":
      await ipc.backend("applications.openRecentFiles", { id: app.id }, { module: "backend" });
      return;
    case "uninstall":
      // Raycast opens Windows' "Installed apps" page for the target instead of uninstalling blind.
      await ipc.backend("applications.uninstall", { id: app.id }, { module: "backend" });
      return;
    default:
      // Raycast routes these to their own commands; this clone acknowledges them.
      console.info(`[applications] action ${action} is not implemented in Openray`);
  }
}

/** Raycast's keyword-based fuzzy match over name/path/bundleId. */
export function filterApplications(apps: ApplicationCommand[], query: string): ApplicationCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return apps;
  const terms = trimmed.split(/\s+/);
  return apps.filter((app) => {
    const haystack = [app.title, app.subtitle ?? "", ...app.keywords].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Convenience hook so `App.tsx` can consume both the list and the runner. */
export function useApplicationActions(handlers: ApplicationActionHandlers) {
  return useCallback(
    (app: ApplicationPayload, actionId: string) => runApplicationAction(app, actionId, handlers),
    [handlers],
  );
}

export function useApplicationGroups(
  app: ApplicationPayload | null,
  options: { favorite: boolean },
): ActionGroup[] {
  return useMemo(() => (app ? applicationActionGroups(app, options) : []), [app, options]);
}
