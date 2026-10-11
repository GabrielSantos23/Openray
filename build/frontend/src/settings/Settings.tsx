// The Settings window shell: sidebar + page router + the row renderer, plus the persistence
// wiring that routes each row to its backend store or localStorage.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RaycastIcon } from "../icons";
import { ipc } from "../ipc";
import { type Sensitivity } from "../matching";
import {
  ACCOUNT_PAGE_ID,
  PAGES,
  SIDEBAR_PAGE_IDS,
  type PageDefinition,
  type RowDefinition,
  type SettingsMap,
  type SettingsValue,
} from "./pages";
import {
  CALCULATOR_ROW_IDS,
  CLIPBOARD_PREFERENCE_ROWS,
  CLIPBOARD_ROW_IDS,
  CLIPBOARD_TEXTAREA_ROW,
  DEFAULTS,
  HISTORY_DURATION_BY_LABEL,
  QUICKLINKS_ROW_IDS,
  SENSITIVITY_MAP,
  SNIPPETS_INJECTION_DELAY_BY_LABEL,
  SNIPPETS_INJECTION_DELAY_LABEL,
  SNIPPETS_MODE_BY_LABEL,
  SNIPPETS_MODE_LABEL,
  SNIPPETS_RESPONSE_TIME_BY_LABEL,
  SNIPPETS_RESPONSE_TIME_LABEL,
  SNIPPETS_SOUND_BY_LABEL,
  SNIPPETS_SOUND_LABEL,
  SNIPPETS_ROW_IDS,
  TRANSLATOR_ROW_IDS,
  formatFilterRows,
  loadSettings,
  parseFallbackCommands,
  parseFilterRows,
  persistSettings,
  type ClipboardFilter,
} from "./persistence";
import { Dropdown, HotkeyRecorder, RadioGroup, Switch } from "./controls";
import { SearchField, SidebarLink, searchResults } from "./sidebar";
import { TranslatorCustomCommands } from "./TranslatorCustomCommands";

export function Settings() {
  const [values, setValues] = useState<SettingsMap>(() => loadSettings());
  const [query, setQuery] = useState("");

  const [route, setRoute] = useState<string>(() => window.location.hash.replace(/^#\/?/, "") || "general");

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.replace(/^#\/?/, "") || "general");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((pageId: string) => {
    window.location.hash = `#/${pageId}`;
    setRoute(pageId);
    setQuery("");
  }, []);

  // The clipboard rows live in the Node store; mirror them into the local map so the same Row
  // component renders them, but write through to the backend instead of localStorage.
  const [clipboardSettings, setClipboardSettings] = useState({
    historyDuration: "P1W",
    ignoreDuplicate: false,
    ignoredApplications: [] as Array<{ name: string; className?: string }>,
    filters: [] as ClipboardFilter[],
  });

  useEffect(() => {
    ipc
      .backend("clipboard.getSettings", {}, { module: "backend" })
      .then((response) => {
        const settings = response as {
          historyDuration?: string;
          ignoreDuplicate?: boolean;
          ignoredApplications?: Array<{ name: string; className?: string }>;
        };
        const label =
          Object.entries(HISTORY_DURATION_BY_LABEL).find(([, value]) => value === settings.historyDuration)?.[0] ??
          "1 Week";
        setClipboardSettings((current) => ({
          ...current,
          historyDuration: settings.historyDuration ?? "P1W",
          ignoreDuplicate: Boolean(settings.ignoreDuplicate),
          ignoredApplications: settings.ignoredApplications ?? [],
        }));
        setValues((current) => {
          const merged = {
            ...current,
            "clipboard-keep-history-for": label,
            "clipboard-ignore-duplicate": Boolean(settings.ignoreDuplicate),
            // A line carrying only a class name is rendered with the class-name marker so the round trip
            // through this field does not silently turn it into an executable name.
            "clipboard-ignored-applications": (settings.ignoredApplications ?? [])
              .map((application) => (application.className && !application.name
                ? `#${application.className}`
                : application.name))
              .filter(Boolean)
              .join("\n"),
          };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* the backend may not be up yet; the defaults stay in place */
      });

    ipc
      .backend("clipboard.getFilters", {}, { module: "backend" })
      .then((response) => {
        const filters = (response as { filters?: ClipboardFilter[] }).filters ?? [];
        setClipboardSettings((current) => ({ ...current, filters }));
        setValues((current) => {
          const merged = { ...current, "clipboard-filters": formatFilterRows(filters) };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* no filters yet */
      });
  }, []);

// Migrate localStorage usage data to backend on first run
  useEffect(() => {
    const migrationDone = localStorage.getItem("raycast-mini:usage-migrated");
    if (migrationDone) return;
    
    const usageData: Record<string, string> = {};
    const fileUsageData: Record<string, string> = {};
    const argumentHistoryData: Record<string, string> = {};
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (!value) continue;
        if (key.startsWith("raycast-mini:usage:")) {
          usageData[key.slice("raycast-mini:usage:".length)] = value;
        } else if (key?.startsWith("raycast-mini:file-usage:")) {
          fileUsageData[key.slice("raycast-mini:file-usage:".length)] = value;
        } else if (key?.startsWith("raycast-mini:argument-history:")) {
          argumentHistoryData[key.slice("raycast-mini:argument-history:".length)] = value;
        }
      }
    } catch {
      // Ignore errors
    }
    
    if (Object.keys(usageData).length > 0 || Object.keys(fileUsageData).length > 0 || Object.keys(argumentHistoryData).length > 0) {
      void ipc.backend("usage.migrateFromLocalStorage", { data: { usageData, fileUsageData, argumentHistoryData } }, { module: "backend" })
        .then(() => {
          localStorage.setItem("raycast-mini:usage-migrated", "true");
        })
        .catch(() => {
          // Ignore migration errors
        });
    }
  }, []);

  // Quicklinks preferences: the selected-text pref lives in the backend store, the delete warning
  // is the renderer-side flag the quicklinks view reads.
  useEffect(() => {
    ipc
      .backend("quicklinks.getPreferences", {}, { module: "backend" })
      .then((response) => {
        const preferences = response as { passSelectedTextAsArgument?: boolean };
        setValues((current) => {
          const merged = {
            ...current,
            "quicklinks-pass-selected-text": Boolean(preferences.passSelectedTextAsArgument),
          };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* the backend may not be up yet */
      });
    const warn = localStorage.getItem("raycast-mini:quicklinks-warn-delete") !== "0";
    setValues((current) => {
      const merged = { ...current, "quicklinks-warn-before-delete": warn };
      persistSettings(merged);
      return merged;
    });
  }, []);

  // Snippets: the expansion config lives in the backend store (which pushes it to the native hook);
  // the primary action and the delete warning are renderer-side flags.
  useEffect(() => {
    ipc
      .backend("snippets.getPreferences", {}, { module: "backend" })
      .then((response) => {
        const preferences = response as {
          autoExpansionEnabled?: boolean;
          expansionMode?: string;
          expandWithinWords?: boolean;
          injectionDelay?: string;
          responseTime?: string;
          completionSound?: string;
          disabledApplications?: string[];
        };
        setValues((current) => {
          const merged = {
            ...current,
            "snippets-enable-expansion": Boolean(preferences.autoExpansionEnabled),
            "snippets-expansion-mode": SNIPPETS_MODE_LABEL[preferences.expansionMode ?? "immediately"] ?? "Immediately",
            "snippets-expand-within-words": Boolean(preferences.expandWithinWords),
            "snippets-injection-delay":
              SNIPPETS_INJECTION_DELAY_LABEL[preferences.injectionDelay ?? "none"] ?? "None",
            "snippets-response-time": SNIPPETS_RESPONSE_TIME_LABEL[preferences.responseTime ?? "default"] ?? "Default",
            "snippets-completion-sound": SNIPPETS_SOUND_LABEL[preferences.completionSound ?? "none"] ?? "None",
            "snippets-disabled-applications": (preferences.disabledApplications ?? []).join("\n"),
          };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* the backend may not be up yet */
      });
    const warn = localStorage.getItem("settings-snippets-remember-delete") !== "0";
    const primary = localStorage.getItem("settings-snippets-primary-action") === "copy" ? "Copy to Clipboard" : "Paste to Active App";
    setValues((current) => {
      const merged = {
        ...current,
        "snippets-warn-before-delete": warn,
        "snippets-primary-action": primary,
      };
      persistSettings(merged);
      return merged;
    });
  }, []);

  // Calculator: the pixel rate lives in the backend store and feeds the conversion engine.
  useEffect(() => {
    ipc
      .backend("calculator.getPreferences", {}, { module: "backend" })
      .then((response) => {
        const preferences = response as { remToPxRate?: number };
        setValues((current) => {
          const merged = { ...current, "calculator-rem-to-px": String(preferences.remToPxRate ?? 16) };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* the backend may not be up yet */
      });
  }, []);

  // Translator: the language list feeds the two selects and the custom-commands editor; the
  // preferences map onto the same rows once the labels are known.
  const [translatorLanguages, setTranslatorLanguages] = useState<Array<{ code: string; name: string }>>([]);
  useEffect(() => {
    ipc
      .backend("translator.getLanguages", {}, { module: "backend" })
      .then((response) => {
        setTranslatorLanguages(((response as { languages?: Array<{ code: string; name: string }> }).languages ?? []) as Array<{ code: string; name: string }>);
      })
      .catch(() => {
        /* the backend may not be up yet */
      });
  }, []);

  useEffect(() => {
    if (translatorLanguages.length === 0) return;
    const labelByCode = new Map(translatorLanguages.map((language) => [language.code, language.name]));
    ipc
      .backend("translator.getPreferences", {}, { module: "backend" })
      .then((response) => {
        const preferences = response as {
          primaryAction?: "copy" | "paste";
          prefillFromSelectedText?: boolean;
          defaultSourceLanguage?: string | null;
          defaultTargetLanguage?: string | null;
        };
        setValues((current) => {
          const merged = {
            ...current,
            "translator-primary-action": preferences.primaryAction === "paste" ? "Paste to Active App" : "Copy Translation",
            "translator-prefill-from-selected-text": Boolean(preferences.prefillFromSelectedText),
            "translator-default-source-language": preferences.defaultSourceLanguage
              ? labelByCode.get(preferences.defaultSourceLanguage) ?? "Detect Language"
              : "Detect Language",
            "translator-default-target-language": preferences.defaultTargetLanguage
              ? labelByCode.get(preferences.defaultTargetLanguage) ?? "English"
              : "English",
          };
          persistSettings(merged);
          return merged;
        });
      })
      .catch(() => {
        /* the backend may not be up yet */
      });
  }, [translatorLanguages]);

  const setValue = useCallback((id: string, next: SettingsValue) => {
    setValues((current) => {
      const merged = { ...current, [id]: next };
      persistSettings(merged);
      return merged;
    });

    if (QUICKLINKS_ROW_IDS.has(id)) {
      if (id === "quicklinks-pass-selected-text") {
        void ipc
          .backend(
            "quicklinks.setPreference",
            { key: "passSelectedTextAsArgument", value: Boolean(next) },
            { module: "backend" },
          )
          .catch(() => undefined);
      } else if (id === "quicklinks-warn-before-delete") {
        localStorage.setItem("raycast-mini:quicklinks-warn-delete", next ? "1" : "0");
      }
      return;
    }
    if (SNIPPETS_ROW_IDS.has(id)) {
      const setSnippetPreference = (key: string, value: unknown) => {
        void ipc.backend("snippets.setPreference", { key, value }, { module: "backend" }).catch(() => undefined);
      };
      if (id === "snippets-enable-expansion") setSnippetPreference("autoExpansionEnabled", Boolean(next));
      else if (id === "snippets-expansion-mode") setSnippetPreference("expansionMode", SNIPPETS_MODE_BY_LABEL[String(next)] ?? "immediately");
      else if (id === "snippets-expand-within-words") setSnippetPreference("expandWithinWords", Boolean(next));
      else if (id === "snippets-injection-delay") setSnippetPreference("injectionDelay", SNIPPETS_INJECTION_DELAY_BY_LABEL[String(next)] ?? "none");
      else if (id === "snippets-response-time") setSnippetPreference("responseTime", SNIPPETS_RESPONSE_TIME_BY_LABEL[String(next)] ?? "default");
      else if (id === "snippets-completion-sound") setSnippetPreference("completionSound", SNIPPETS_SOUND_BY_LABEL[String(next)] ?? "none");
      else if (id === "snippets-disabled-applications") {
        setSnippetPreference(
          "disabledApplications",
          String(next)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        );
      } else if (id === "snippets-primary-action") {
        localStorage.setItem("settings-snippets-primary-action", next === "Copy to Clipboard" ? "copy" : "paste");
      } else if (id === "snippets-warn-before-delete") {
        localStorage.setItem("settings-snippets-remember-delete", next ? "1" : "0");
      }
      return;
    }
    if (CALCULATOR_ROW_IDS.has(id)) {
      if (id === "calculator-rem-to-px") {
        const rate = Number(next);
        if (Number.isFinite(rate) && rate >= 1) {
          void ipc
            .backend("calculator.setPreference", { key: "remToPxRate", value: rate }, { module: "backend" })
            .catch(() => undefined);
        }
      }
      return;
    }
    if (TRANSLATOR_ROW_IDS.has(id)) {
      const setTranslatorPreference = (key: string, value: unknown) => {
        void ipc.backend("translator.setPreference", { key, value }, { module: "backend" }).catch(() => undefined);
      };
      if (id === "translator-primary-action") {
        setTranslatorPreference("primaryAction", next === "Paste to Active App" ? "paste" : "copy");
      } else if (id === "translator-prefill-from-selected-text") {
        setTranslatorPreference("prefillFromSelectedText", Boolean(next));
      } else if (id === "translator-default-source-language") {
        const label = String(next);
        const code = label === "Detect Language" ? null : translatorLanguages.find((language) => language.name === label)?.code ?? null;
        setTranslatorPreference("defaultSourceLanguage", code);
      } else if (id === "translator-default-target-language") {
        const label = String(next);
        const code = translatorLanguages.find((language) => language.name === label)?.code ?? null;
        setTranslatorPreference("defaultTargetLanguage", code);
      }
      return;
    }
    if (!CLIPBOARD_ROW_IDS.has(id)) {
      if (id === "root-search-sensitivity") {
        const sensitivity = SENSITIVITY_MAP[String(next)] ?? "medium";
        localStorage.setItem("raycast-mini:root-search-sensitivity", sensitivity);
        window.dispatchEvent(new CustomEvent("raycast-mini:root-search-sensitivity-changed", { detail: sensitivity }));
      }
      if (id === "fallback-commands-list" || id === "fallback-commands-enabled") {
        const list = values["fallback-commands-list"] ?? "";
        const enabled = values["fallback-commands-enabled"] ?? true;
        const commands = parseFallbackCommands(String(list), Boolean(enabled));
        localStorage.setItem("raycast-mini:fallback-commands", JSON.stringify(commands));
        window.dispatchEvent(new CustomEvent("raycast-mini:fallback-commands-changed", { detail: commands }));
      }
      return;
    }
    if (id === "clipboard-history-hotkey") {
      // The recorder's key caps are the source of truth; the host re-registers the global hotkey.
      void ipc.backend("clipboard.setHotkey", { hotkey: String(next) }, { module: "backend" });
      return;
    }
    if (id === "clipboard-keep-history-for") {
      const duration = HISTORY_DURATION_BY_LABEL[String(next)] ?? "P1W";
      void ipc.backend("clipboard.setHistoryDuration", { duration }, { module: "backend" });
      setClipboardSettings((current) => ({ ...current, historyDuration: duration }));
      return;
    }
    if (id === "clipboard-ignore-duplicate") {
      const enabled = Boolean(next);
      void ipc.backend("clipboard.setIgnoreDuplicate", { enabled }, { module: "backend" });
      setClipboardSettings((current) => ({ ...current, ignoreDuplicate: enabled }));
      return;
    }
    if (id === "clipboard-ignored-applications") {
      // A `#` prefix marks a window class name, which Raycast matches through `IgnoredClassNames`
      // rather than against the executable file name.
      const applications = String(next)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) =>
          line.startsWith("#") ? { name: "", className: line.slice(1).trim() } : { name: line },
        )
        .filter((application) => application.name || application.className);
      void ipc
        .backend("clipboard.setIgnoredApplications", { applications }, { module: "backend" })
        .then(() => setClipboardSettings((current) => ({ ...current, ignoredApplications: applications })));
      return;
    }
    if (id === "clipboard-filters") {
      const filters = parseFilterRows(String(next));
      void ipc
        .backend("clipboard.setFiltersFromText", { text: String(next) }, { module: "backend" })
        .then(() => setClipboardSettings((current) => ({ ...current, filters })));
      return;
    }
    const preference = CLIPBOARD_PREFERENCE_ROWS[id];
    if (!preference) return;
    void ipc
      .backend(
        "clipboard.setPreference",
        { key: preference.key, value: preference.value(next) },
        { module: "backend" },
      )
      .catch((error: unknown) => {
        window.dispatchEvent(
          new CustomEvent("raycast-mini:settings-toast", {
            detail: {
              title: "Couldn't save that setting",
              message: error instanceof Error ? error.message : undefined,
            },
          }),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translatorLanguages]);

  const runAction = useCallback((id: string) => {
    if (id === "clipboard-run-maintenance") {
      void ipc
        .backend("clipboard.runMaintenance", {}, { module: "backend" })
        .then((response) => {
          const report = response as { cache?: { deletedEntries?: number; removedFiles?: number }; pruned?: number };
          const pruned = report.pruned ?? 0;
          const removed = report.cache?.deletedEntries ?? 0;
          const files = report.cache?.removedFiles ?? 0;
          window.dispatchEvent(
            new CustomEvent("raycast-mini:settings-toast", {
              detail: {
                title: "Maintenance finished",
                message: `${pruned} pruned, ${removed} entries dropped, ${files} cached files removed.`,
              },
            }),
          );
        });
    }
  }, []);

  const page = useMemo(() => PAGES.find((candidate) => candidate.id === route) ?? PAGES[0], [route]);
  const results = useMemo(() => searchResults(query), [query]);

  // The translator language selects draw their options from the backend's curated list.
  const translatorDynamicOptions = useMemo(() => {
    const names = translatorLanguages.map((language) => language.name);
    return {
      "translator-default-source-language": ["Detect Language", ...names],
      "translator-default-target-language": names,
    };
  }, [translatorLanguages]);

  return (
    <div className="settings-window">
      <aside className="settings-sidebar">
        <div className="settings-sidebar__titlebar">
          <span className="settings-sidebar__titletext">Settings</span>
        </div>

        <div className="settings-sidebar__search">
          {/* Raycast's `input-field-primitive`: 32px tall, rounded, 5% white fill, leading icon. */}
          <SearchField
            value={query}
            placeholder="Search settings"
            onChange={setQuery}
            onEscape={() => setQuery("")}
          />
        </div>

        <div className="settings-sidebar__scroll">
          {results.length > 0 ? (
            <div className="settings-sidebar__content" data-searching="true">
              {results.map((result) => (
                <button
                  key={`${result.pageId}:${result.rowId ?? result.title}`}
                  type="button"
                  className="settings-navlink settings-navlink--result"
                  onClick={() => navigate(result.pageId)}
                >
                  <span className="settings-navlink__icon">
                    <RaycastIcon name={result.rowId ? "chevron-right" : (PAGES.find((p) => p.id === result.pageId)?.icon ?? "cog")} size={14} />
                  </span>
                  <span className="settings-navlink__text">
                    <span className="settings-navlink__label">{result.title}</span>
                    <span className="settings-navlink__group">{result.group}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="settings-sidebar__content">
              {/* Raycast pulls the account link out of the page list and pins it on top. */}
              <SidebarLink
                pageId={ACCOUNT_PAGE_ID}
                title="Account"
                active={route === ACCOUNT_PAGE_ID || route.startsWith(`${ACCOUNT_PAGE_ID}/`)}
                onNavigate={navigate}
              />

              <div className="settings-sidebar__section">
                {SIDEBAR_PAGE_IDS.map((pageId) => {
                  const definition = PAGES.find((candidate) => candidate.id === pageId)!;
                  return (
                    <SidebarLink
                      key={pageId}
                      pageId={pageId}
                      title={definition.title}
                      active={route === pageId}
                      onNavigate={navigate}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="settings-main">
        <header className="settings-navigationHeader">
          <div className="settings-navigationHeader__breadcrumbs">
            <span className="settings-navigationHeader__crumb">Settings</span>
            <RaycastIcon name="ArrowRight" size={12} />
            <span className="settings-navigationHeader__crumb settings-navigationHeader__crumb--current">{page.title}</span>
          </div>
        </header>

        <div className="settings-page__scroll">
          <div className="settings-page">
            <div className="settings-page__heading">
              <h1 className="settings-page__title">{page.title}</h1>
              <p className="settings-page__description">{page.description}</p>
            </div>

            {page.sections.length === 0 || page.sections.every((section) => section.rows.length === 0) ? (
              <div className="settings-page__empty">{page.empty ?? "No settings available."}</div>
            ) : (
              page.sections.map((section) =>
                section.rows.length === 0 ? null : (
                  <section className="settings-section" key={section.id}>
                    {section.title ? <h2 className="settings-section__title">{section.title}</h2> : null}
                    {section.description ? (
                      <p className="settings-section__description">{section.description}</p>
                    ) : null}
                    <div className="settings-section__content">
                      {section.rows
                        .filter((row) => !row.visibleWhen || row.visibleWhen(values))
                        .map((row) => (
                        <Row
                          key={row.id}
                          row={row}
                          value={values[row.id]}
                          onValueChange={(next) => setValue(row.id, next)}
                          onAction={() => runAction(row.id)}
                          dynamicOptions={translatorDynamicOptions}
                        />
                      ))}
                    </div>
                    {section.empty ? <p className="settings-section__empty">{section.empty}</p> : null}
                  </section>
                ),
              )
            )}
            {page.id === "translator" ? <TranslatorCustomCommands /> : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({
  row,
  value,
  onValueChange,
  onAction,
  dynamicOptions,
}: {
  row: RowDefinition;
  value: SettingsValue | undefined;
  onValueChange: (next: SettingsValue) => void;
  onAction: () => void;
  /** Per-row option overrides for selects whose choices load from a backend store. */
  dynamicOptions?: Record<string, string[]>;
}) {
  const right = () => {
    switch (row.control) {
      case "switch":
        return (
          <Switch
            label={row.title}
            checked={Boolean(value)}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "select":
        return (
          <Dropdown
            label={row.title}
            value={String(value ?? row.options?.[0] ?? "")}
            options={dynamicOptions?.[row.id] ?? row.options ?? []}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "radio":
        return (
          <RadioGroup
            value={String(value ?? row.options?.[0] ?? "")}
            options={row.options ?? []}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "hotkey":
        return (
          <HotkeyRecorder
            value={String(value ?? row.value ?? "")}
            disabled={row.unavailable}
            onChange={onValueChange}
          />
        );
      case "textarea":
        return (
          <textarea
            className="settings-textarea"
            aria-label={row.title}
            placeholder={row.description}
            value={String(value ?? "")}
            disabled={row.unavailable}
            onChange={(event) => onValueChange(event.target.value)}
          />
        );
      case "text":
        return (
          <input
            className="settings-textfield"
            aria-label={row.title}
            inputMode="numeric"
            value={String(value ?? "")}
            disabled={row.unavailable}
            onChange={(event) => onValueChange(event.target.value)}
          />
        );
      case "action":
        return (
          <span className="settings-row__actions">
            {row.value ? <span className="settings-row__value">{row.value}</span> : null}
            <button
              type="button"
              className="settings-button"
              disabled={row.unavailable}
              onClick={() => {
                onAction();
                void runRowAction(row);
              }}
            >
              {row.action}
            </button>
          </span>
        );
      case "info":
        return <span className="settings-row__value">{row.value}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="settings-row" data-row-id={row.id} data-align={row.description ? "start" : "center"}>
      <div className="settings-row__column">
        <span className="settings-row__title">
          {row.title}
          {row.pro ? <span className="settings-row__pro">Pro</span> : null}
        </span>
        {row.description ? (
          <span className="settings-row__description" data-settings-description>
            {row.description}
          </span>
        ) : null}
        {row.unavailable ? <span className="settings-row__unavailable">Not available in Raycast Mini</span> : null}
      </div>
      <div className="settings-row__right" data-settings-accessory>
        {right()}
      </div>
    </div>
  );
}

/** Rows whose "action" is a real link or a no-op with a visible outcome. */
function runRowAction(row: RowDefinition): void {
  const links: Record<string, string> = {
    website: "https://www.raycast.com",
    "slack-community": "https://raycast.com/community",
    "open-changelog": "https://www.raycast.com/changelog",
    "send-feedback": "mailto:support@raycast.com",
  };
  const target = links[row.id];
  if (target) window.open(target, "_blank", "noopener");

  if (row.id === "reset-search-history") {
    // Clear search history from localStorage
    localStorage.removeItem("raycast-mini:search-history");
    window.dispatchEvent(
      new CustomEvent("raycast-mini:settings-toast", {
        detail: { title: "Search history cleared" },
      }),
    );
    return;
  }

  if (row.id === "reset-all-rankings") {
    // Reset all usage rankings via backend
    void ipc
      .backend("usage.resetAllAppUsage", {}, { module: "backend" })
      .then(() => {
        window.dispatchEvent(
          new CustomEvent("raycast-mini:settings-toast", {
            detail: { title: "All rankings reset" },
          }),
        );
      })
      .catch(() => {
        window.dispatchEvent(
          new CustomEvent("raycast-mini:settings-toast", {
            detail: { title: "Failed to reset rankings" },
          }),
        );
      });
    return;
  }
}

// ---------------------------------------------------------------------------------------------
// Translator custom commands (docs/translator-spec.md — the settings-page dialog strings).
// ---------------------------------------------------------------------------------------------
