// The Extensions settings page: per installed extension — the command list with aliases and
// hotkeys, and (FlowKey) the manifest's preference fields with values persisted in localStorage
// (`raycast-mini:flowkey-preferences`, applied at launch). Aliases/hotkeys stay in localStorage
// (`raycast-mini:command-aliases` / `-command-hotkeys`), hotkeys registered with the host.

import { useCallback, useEffect, useState } from "react";
import { ipc } from "../ipc";
import { HotkeyRecorder, Switch } from "./controls";
import "./settings-extensions.css";
import {
  commandConfigKey,
  readCommandAliases,
  readCommandHotkeys,
  registerCommandHotkeyWithHost,
  writeCommandAlias,
  writeCommandHotkey,
} from "../commandConfig";
import { readFlowkeyPreferences, writeFlowkeyPreference } from "../features/extensions/preferences";
import type { ExtensionPreference, ExtensionSummary } from "../app/entries";
import { ExtensionIcon } from "../features/extensions/useExtensionIcon";

export function ExtensionPreferences() {
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>(() => readCommandAliases());
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() => readCommandHotkeys());
  const [preferenceValues, setPreferenceValues] = useState<Record<string, Record<string, unknown>>>({});

  const refresh = useCallback(async () => {
    try {
      const payload = (await ipc.backend("extensionHost.getInstalledNodeExtensionSummaries")) as {
        extensions?: ExtensionSummary[];
      };
      const loaded = payload.extensions ?? [];
      setExtensions(loaded);
      setPreferenceValues((current) => {
        const next = { ...current };
        for (const extension of loaded) {
          if (!(extension.uuid in next)) next[extension.uuid] = readFlowkeyPreferences(extension.uuid);
        }
        return next;
      });
    } catch {
      setExtensions([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The settings window is a separate WebView2 that receives no backend pushes, so poll while
    // the page is mounted to pick up extensions installed meanwhile.
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const setAlias = (key: string, alias: string) => {
    setAliases(writeCommandAlias(key, alias));
  };

  const setHotkey = async (key: string, hotkey: string | null) => {
    setHotkeys(writeCommandHotkey(key, hotkey));
    await registerCommandHotkeyWithHost(key, hotkey);
  };

  const setPreference = (uuid: string, name: string, value: unknown) => {
    setPreferenceValues((current) => ({ ...current, [uuid]: writeFlowkeyPreference(uuid, name, value) }));
  };

  if (extensions.length === 0) {
    return <p className="settings-section__empty">No extensions installed. FlowKey extensions live in the extensions folder.</p>;
  }

  return (
    <div className="settings-extensions">
      {extensions.map((extension) => {
        const preferences = extension.preferences ?? [];
        const values = preferenceValues[extension.uuid] ?? {};
        return (
          <section className="settings-section" key={extension.uuid}>
            <h2 className="settings-section__title">
              <ExtensionIcon uuid={extension.uuid} size={18} /> {extension.title}
              {extension.isFlowkey ? null : <span className="settings-section__description"> (@raycast — legacy)</span>}
            </h2>
            <div className="settings-section__content">
              {extension.commands.map((command) => {
                const key = commandConfigKey(extension.uuid, command.name);
                return (
                  <div key={command.name} className="settings-extensions__command">
                    <div className="settings-extensions__commandHeader">
                      <span className="settings-extensions__commandTitle">{command.title}</span>
                      {command.disabledReason ? (
                        <span className="settings-extensions__reason">{command.disabledReason}</span>
                      ) : null}
                    </div>

                    {command.disabledReason ? null : (
                      <>
                        <label className="settings-extensions__row">
                          <span className="settings-extensions__rowTitle">Alias</span>
                          <input
                            className="settings-extensions__input"
                            type="text"
                            value={aliases[key] ?? ""}
                            placeholder="Add a search alias"
                            onChange={(event) => setAlias(key, event.target.value)}
                          />
                        </label>
                        <label className="settings-extensions__row">
                          <span className="settings-extensions__rowTitle">Hotkey</span>
                          <HotkeyRecorder
                            value={hotkeys[key] ?? ""}
                            onChange={(next) => void setHotkey(key, next === "" ? null : next)}
                          />
                        </label>
                      </>
                    )}
                  </div>
                );
              })}

              {preferences.map((preference) => (
                <div className="settings-extensions__row" key={preference.name}>
                  <span className="settings-extensions__rowTitle">{preference.title}</span>
                  {preference.type === "checkbox" ? (
                    <Switch
                      label={preference.title}
                      checked={Boolean(values[preference.name] ?? preference.default)}
                      onChange={(checked) => setPreference(extension.uuid, preference.name, checked)}
                    />
                  ) : preference.type === "dropdown" || preference.type === "appPicker" ? (
                    <select
                      className="settings-extensions__input"
                      value={String(values[preference.name] ?? preference.default ?? "")}
                      onChange={(event) => setPreference(extension.uuid, preference.name, event.target.value)}
                    >
                      {((preference.options ?? preference.data ?? [])).map((option) => (
                        <option key={String(option.value ?? option.title)} value={String(option.value ?? option.title)}>
                          {option.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="settings-extensions__input"
                      type={preference.type === "password" ? "password" : "text"}
                      value={String(values[preference.name] ?? preference.default ?? "")}
                      placeholder={preference.placeholder ?? ""}
                      onChange={(event) => setPreference(extension.uuid, preference.name, event.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
