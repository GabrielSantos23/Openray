// Installed-extension detail page (Raycast's extension settings screen): centered intro with the
// extension's real icon, its FlowKey preference rows, then the Commands card — alias, hotkey and
// enable per command, written through the same commandConfig stores the Shortcuts page uses.
import { useState } from "react";
import { RaycastIcon } from "../icons";
import type { ExtensionSummary } from "../app/entries";
import { commandConfigKey } from "../commandConfig";
import { ExtensionIcon } from "../features/extensions/useExtensionIcon";
import { CommandsSection, type CommandRowData } from "./CommandsSection";
import { ExtensionPreferenceRows, useExtensionPreferenceValues, useInstalledExtensions } from "./ExtensionPreferences";

export function ExtensionDetailPage({ uuid }: { uuid: string }) {
  const extensions = useInstalledExtensions();
  const extension = extensions.find((candidate) => candidate.uuid === uuid);
  const stored = useExtensionPreferenceValues(extension);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const values = { ...stored, ...overrides };
  const [expanded, setExpanded] = useState(false);

  if (!extension) {
    return <div className="settings-page__empty">{extensions.length === 0 ? "Loading…" : "Extension not found."}</div>;
  }

  const rows: CommandRowData[] = extension.commands
    .filter((command) => command.mode !== "no-view")
    .map((command) => ({
      key: commandConfigKey(extension.uuid, command.name),
      title: command.title,
      subtitle: extension.title,
      lucide: "extension",
      lockedReason: command.disabledReason,
    }));
  const long = Boolean(extension.description && extension.description.length > 140);

  return (
    <div className="settings-detail">
      <div className="settings-page__intro">
        <span className="settings-page__introIcon">
          <ExtensionIcon uuid={extension.uuid} size={54} />
        </span>
        <div className="settings-page__introText">
          <h1 className="settings-page__introTitle">{extension.title}</h1>
          {extension.description ? (
            <p className="settings-page__introDescription" data-clamped={!expanded && long ? "true" : undefined}>
              {extension.description}
            </p>
          ) : null}
          {long ? (
            <button type="button" className="settings-page__introToggle" onClick={() => setExpanded((state) => !state)}>
              {expanded ? "Show Less" : "Show More"}{" "}
              <span className="settings-page__introToggleChevron" data-expanded={expanded ? "true" : undefined}>
                <RaycastIcon name="chevron-down" size={10} />
              </span>
            </button>
          ) : null}
        </div>
      </div>
      {extension.preferences?.length ? (
        <ExtensionPreferenceRows
          extension={extension}
          values={values}
          onValue={(name, value) => setOverrides((current) => ({ ...current, [name]: value }))}
        />
      ) : null}
      <CommandsSection rows={rows} />
    </div>
  );
}
