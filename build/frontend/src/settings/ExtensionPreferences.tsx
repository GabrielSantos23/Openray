// The Extensions settings page: per installed extension — the command list with aliases and
// hotkeys, and (FlowKey) the manifest's preference fields with values persisted in localStorage
// (`openray:flowkey-preferences`, applied at launch). Aliases/hotkeys stay in localStorage
// (`openray:command-aliases` / `-command-hotkeys`), hotkeys registered with the host.

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
import { readFlowkeyPreferences, saveFlowkeyPreference, writeFlowkeyPreference } from "../features/extensions/preferences";
import type { ExtensionPreference, ExtensionSummary } from "../app/entries";
import { ExtensionIcon } from "../features/extensions/useExtensionIcon";

/** One text-like preference row: the input drafts locally, Save persists through the backend. */
function TextPreferenceRow({
  uuid,
  preference,
  stored,
  onSaved,
}: {
  uuid: string;
  preference: ExtensionPreference;
  stored: unknown;
  onSaved: (uuid: string, name: string, value: unknown) => void;
}) {
  const [draft, setDraft] = useState<string>(() => String(stored ?? preference.default ?? ""));
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await saveFlowkeyPreference(uuid, preference.name, draft);
    onSaved(uuid, preference.name, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="settings-extensions__row" key={preference.name}>
      <span className="settings-extensions__rowTitle">{preference.title}</span>
      <span className="settings-extensions__prefInput">
        <input
          className="settings-extensions__input"
          type={preference.type === "password" ? "password" : "text"}
          value={draft}
          placeholder={preference.placeholder ?? ""}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
        />
        <button type="button" className="settings-extensions__save" onClick={() => void save()}>
          {saved ? "Saved ✓" : "Save"}
        </button>
      </span>
    </div>
  );
}

/** Installed-extension summaries, polled so installs while the window is open show up. */
export function useInstalledExtensions(): ExtensionSummary[] {
  const [extensions, setExtensions] = useState<ExtensionSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const payload = (await ipc.backend("extensionHost.getInstalledNodeExtensionSummaries")) as {
        extensions?: ExtensionSummary[];
      };
      setExtensions(payload.extensions ?? []);
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

  return extensions;
}

/** Stored values for one extension's FlowKey preferences (backend file is authoritative). */
export function useExtensionPreferenceValues(extension: ExtensionSummary | undefined): Record<string, unknown> {
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!extension) return;
    let alive = true;
    setValues(readFlowkeyPreferences(extension.uuid));
    import("../features/extensions/preferences")
      .then(({ fetchFlowkeyPreferences }) => fetchFlowkeyPreferences(extension.uuid))
      .then((fetched) => {
        if (alive) setValues(fetched);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [extension]);
  return values;
}

/** The manifest's preference fields as Raycast-style rows (switch / select / text+Save). */
export function ExtensionPreferenceRows({
  extension,
  values,
  onValue,
}: {
  extension: ExtensionSummary;
  values: Record<string, unknown>;
  onValue: (name: string, value: unknown) => void;
}) {
  const preferences = extension.preferences ?? [];
  if (preferences.length === 0) return null;
  return (
    <div className="settings-section__content">
      {preferences.map((preference) =>
        preference.type === "checkbox" ? (
          <div className="settings-extensions__row" key={preference.name}>
            <span className="settings-extensions__rowTitle">{preference.title}</span>
            <Switch
              label={preference.title}
              checked={Boolean(values[preference.name] ?? preference.default)}
              onChange={(checked) => void writeFlowkeyPreference(extension.uuid, preference.name, checked).then((next) => onValue(preference.name, next))}
            />
          </div>
        ) : preference.type === "dropdown" || preference.type === "appPicker" ? (
          <div className="settings-extensions__row" key={preference.name}>
            <span className="settings-extensions__rowTitle">{preference.title}</span>
            <select
              className="settings-extensions__input"
              value={String(values[preference.name] ?? preference.default ?? "")}
              onChange={(event) => void writeFlowkeyPreference(extension.uuid, preference.name, event.target.value).then((next) => onValue(preference.name, next))}
            >
              {((preference.options ?? preference.data ?? [])).map((option) => (
                <option key={String(option.value ?? option.title)} value={String(option.value ?? option.title)}>
                  {option.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <TextPreferenceRow
            key={preference.name}
            uuid={extension.uuid}
            preference={preference}
            stored={values[preference.name] ?? preference.default}
            onSaved={(_, name, value) => onValue(name, value)}
          />
        ),
      )}
    </div>
  );
}

export function ExtensionPreferences() {
  const extensions = useInstalledExtensions();
  const [aliases, setAliases] = useState<Record<string, string>>(() => readCommandAliases());
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() => readCommandHotkeys());
  const [preferenceValues, setPreferenceValues] = useState<Record<string, Record<string, unknown>>>({});

  // Values are authoritative in the backend file (the mirror may be stale across windows).
  useEffect(() => {
    const next: Record<string, Record<string, unknown>> = {};
    for (const extension of extensions) {
      next[extension.uuid] = readFlowkeyPreferences(extension.uuid);
    }
    setPreferenceValues((current) => ({ ...next, ...current }));
    for (const extension of extensions) {
      import("../features/extensions/preferences")
        .then(({ fetchFlowkeyPreferences }) => fetchFlowkeyPreferences(extension.uuid))
        .then((values) => {
          setPreferenceValues((current) => ({ ...current, [extension.uuid]: { ...current[extension.uuid], ...values } }));
        })
        .catch(() => undefined);
    }
  }, [extensions]);

  const setAlias = (key: string, alias: string) => {
    setAliases(writeCommandAlias(key, alias));
  };

  const setHotkey = async (key: string, hotkey: string | null) => {
    setHotkeys(writeCommandHotkey(key, hotkey));
    await registerCommandHotkeyWithHost(key, hotkey);
  };

  if (extensions.length === 0) {
    return <p className="settings-section__empty">No extensions installed. FlowKey extensions live in the extensions folder.</p>;
  }

  return (
    <div className="settings-extensions">
      {extensions.map((extension) => {
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

              <ExtensionPreferenceRows
                extension={extension}
                values={preferenceValues[extension.uuid] ?? {}}
                onValue={(name, value) =>
                  setPreferenceValues((current) => ({
                    ...current,
                    [extension.uuid]: { ...(current[extension.uuid] ?? {}), [name]: value },
                  }))
                }
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
