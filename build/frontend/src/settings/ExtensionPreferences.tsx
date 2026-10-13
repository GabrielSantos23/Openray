// The Extensions settings page: per installed (Store) extension — the command list with aliases
// and hotkeys, and the manifest's preference fields. Disabled commands show their reason and take
// no alias/hotkey. Preference values persist through the store module
// (`store.setCommandPreferences`); aliases/hotkeys in localStorage
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
import {
  storeGetCommandPreferences,
  storeSetCommandPreferences,
} from "../features/store/storeApi";
import type { ExtensionSummary } from "../app/entries";

interface ManifestPreference {
  name: string;
  title: string;
  type: string;
  required?: boolean;
  description?: string;
  placeholder?: string;
  default?: unknown;
  data?: { title?: string; value?: string }[];
}

type CommandSummary = ExtensionSummary["commands"][number] & { preferences?: ManifestPreference[] };

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
      for (const extension of loaded) {
        for (const command of extension.commands as CommandSummary[]) {
          void storeGetCommandPreferences(extension.uuid, command.name)
            .then((result) => {
              setPreferenceValues((current) => ({
                ...current,
                [`${extension.uuid}/${command.name}`]: result.preferences ?? {},
              }));
            })
            .catch(() => undefined);
        }
      }
    } catch {
      setExtensions([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setAlias = (key: string, alias: string) => {
    setAliases(writeCommandAlias(key, alias));
  };

  const setHotkey = async (key: string, hotkey: string | null) => {
    setHotkeys(writeCommandHotkey(key, hotkey));
    await registerCommandHotkeyWithHost(key, hotkey);
  };

  const setPreference = async (uuid: string, commandName: string, name: string, value: unknown) => {
    const key = `${uuid}/${commandName}`;
    const next = { ...(preferenceValues[key] ?? {}), [name]: value };
    setPreferenceValues((current) => ({ ...current, [key]: next }));
    void storeSetCommandPreferences(uuid, commandName, next).catch(() => undefined);
  };

  if (extensions.length === 0) {
    return <p className="settings-section__empty">Install extensions from the Store to configure them here.</p>;
  }

  return (
    <div className="settings-extensions">
      {extensions.map((extension) => (
        <section className="settings-section" key={extension.uuid}>
          <h2 className="settings-section__title">{extension.title}</h2>
          {extension.badge ? <p className="settings-section__description">{extension.badge}</p> : null}
          <div className="settings-section__content">
            {(extension.commands as CommandSummary[]).map((command) => {
              const key = commandConfigKey(extension.uuid, command.name);
              const values = preferenceValues[`${extension.uuid}/${command.name}`] ?? {};
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

                  {(command.preferences ?? []).map((preference) => (
                    <div className="settings-extensions__row" key={preference.name}>
                      <span className="settings-extensions__rowTitle">{preference.title}</span>
                      {preference.type === "checkbox" ? (
                        <Switch
                          label={preference.title}
                          checked={Boolean(values[preference.name] ?? preference.default)}
                          onChange={(checked) => void setPreference(extension.uuid, command.name, preference.name, checked)}
                        />
                      ) : preference.type === "dropdown" ? (
                        <select
                          className="settings-extensions__input"
                          value={String(values[preference.name] ?? preference.default ?? "")}
                          onChange={(event) => void setPreference(extension.uuid, command.name, preference.name, event.target.value)}
                        >
                          {(preference.data ?? []).map((option) => (
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
                          onChange={(event) => void setPreference(extension.uuid, command.name, preference.name, event.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
