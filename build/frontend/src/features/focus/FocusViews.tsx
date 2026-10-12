// Focus views (docs/focus-games-taskbar-spec.md §A): the Start/Edit session form with the
// confirmed fields, the Search Focus Categories view with the confirmed actions, and the category
// form (create/edit/open). Strings are the shipped ones; behaviors not extractable from the
// artifacts are documented as deltas in the spec.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RaycastIcon } from "../../icons";
import {
  DEFAULT_START_INPUT,
  DURATION_SUGGESTIONS,
  createFocusCategory,
  deleteFocusCategory,
  fetchSessionState,
  formatDuration,
  mergePreferences,
  parseDurationText,
  readLastStartInput,
  searchFocusCategories,
  startFocusSession,
  updateFocusCategory,
  updateFocusSession,
  writeLastStartInput,
  type FocusCategory,
  type FocusPreferences,
  type FocusStartInput,
} from "../../focus";
import { filterApplications, type ApplicationCommand, type ApplicationPayload } from "../../applications";
import { ipc } from "../../ipc";
import { alertStore } from "../../alertStore";

type FocusToasts = (title: string, message?: string) => void;

interface ViewShellProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** The extension indicator rendered at the footer's left (green mark + extension name). */
  footerLeft?: React.ReactNode;
}

function ViewShell({ title, onBack, children, footer, footerLeft }: ViewShellProps) {
  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <main className="window__body focus-body">{children}</main>
      <footer className="window__footer">
        {footerLeft ?? (
          <button type="button" className="footer-icon-button" aria-label="Back" onClick={onBack}>
            <RaycastIcon name="arrow-clockwise" size={16} />
          </button>
        )}
        <span className="footer__spacer" />
        {footer}
      </footer>
    </div>
  );
}

/** The green Focus extension indicator: mark + `Raycast Focus` (the shipped footer layout). */
function FocusFooterLeft() {
  return (
    <span className="focus-footer__left">
      <span className="command-tile command-tile--focus focus-footer__mark" aria-hidden>
        <RaycastIcon name="clock" size={13} />
      </span>
      <span className="focus-footer__name">Raycast Focus</span>
    </span>
  );
}

// -------------------------------------------------------------------------------------------
// Start / Edit session form
// -------------------------------------------------------------------------------------------

const BLOCK_MODES: ReadonlyArray<{ value: "block" | "allow"; label: string }> = [
  { value: "block", label: "Block Apps & Websites" },
  { value: "allow", label: "Allow Apps & Websites" },
];

export function FocusFormView({
  formMode,
  showToast,
  onBack,
  closeMainWindow,
  applications,
}: {
  formMode: "start" | "edit";
  showToast: FocusToasts;
  onBack: () => void;
  closeMainWindow: () => void;
  applications: ApplicationCommand[];
}) {
  const [goal, setGoal] = useState("");
  const [durationText, setDurationText] = useState("");
  const [mode, setMode] = useState<"block" | "allow">("block");
  const [allCategories, setAllCategories] = useState<FocusCategory[]>([]);
  const [categories, setCategories] = useState<FocusCategory[]>([]);
  const [allApps, setAllApps] = useState<ApplicationCommand[]>(applications);
  const [apps, setApps] = useState<ApplicationPayload[]>([]);
  const [websites, setWebsites] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState<"filter" | "duration" | "mode" | null>(null);
  const [filterText, setFilterText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preferences, setPreferences] = useState<FocusPreferences>({
    snoozeDurationMs: 180000,
    playSound: true,
    restoreAppsWhenSessionEnds: false,
    allowAllOnEmptyWebsiteAllowlist: false,
  });
  const filterRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (applications.length > 0) {
      setAllApps(applications);
    } else {
      ipc.backend("applications.getAll", {}, { module: "backend" })
        .then((response) => {
          const value = (response as { value?: ApplicationPayload[] }).value ?? [];
          setAllApps(
            value.map((payload) => ({
              extensionId: "applications",
              commandId: `applications/${payload.id}`,
              title: payload.name,
              subtitle: payload.disambiguator
                ? (payload.disambiguator.split(/[\\/]/).filter(Boolean).pop() ?? null)
                : null,
              keywords: [payload.bundleId, payload.name, payload.path].filter(Boolean) as string[],
              payload,
            })),
          );
        })
        .catch(() => undefined);
    }
  }, [applications]);

  useEffect(() => {
    searchFocusCategories("").then((result) => setAllCategories(result.categories)).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchSessionState()
      .then(async (state) => {
        setPreferences(state.preferences);
        if (formMode !== "edit") return;
        const input = state.lastStartInput ?? readLastStartInput();
        if (!input) return;
        setGoal(input.title && input.title !== "Focus session" ? input.title : "");
        setMode(input.mode);
        setWebsites(input.websiteHosts);
        setDurationText(formatDuration(input.goal) === "No Limit" ? "" : formatDuration(input.goal));
        if (input.categoryIds && input.categoryIds.length > 0) {
          const catsRes = await searchFocusCategories("").catch(() => ({ categories: [] }));
          setCategories(catsRes.categories.filter((c) => input.categoryIds.includes(c.categoryId)));
        }
        if (input.raycastAppIds && input.raycastAppIds.length > 0) {
          const matchingApps = allApps.filter((a) => input.raycastAppIds.includes(a.payload.id)).map((a) => a.payload);
          setApps(matchingApps);
        }
      })
      .catch(() => undefined);
  }, [formMode, allApps]);

  const goal_ = goal;
  const duration = parseDurationText(durationText);
  const durationInvalid = durationText.trim().length > 0 && duration === null;

  const filteredCategories = useMemo(() => {
    const selectedIds = new Set(categories.map((c) => c.categoryId));
    const unselected = allCategories.filter((c) => !selectedIds.has(c.categoryId));
    const query = filterText.trim().toLowerCase();
    if (!query) return unselected;
    return unselected.filter((category) => `${category.title} ${category.categoryId}`.toLowerCase().includes(query));
  }, [allCategories, categories, filterText]);

  const filteredApps = useMemo(() => {
    const selectedAppIds = new Set(apps.map((a) => a.id));
    const unselected = allApps.filter((a) => !selectedAppIds.has(a.payload.id));
    return filterApplications(unselected, filterText);
  }, [allApps, apps, filterText]);

  const selectedCategoryIds = useMemo(() => new Set(categories.map((category) => category.categoryId)), [categories]);

  const addCategory = (category: FocusCategory) => {
    setCategories((current) => (current.some((entry) => entry.categoryId === category.categoryId) ? current : [...current, category]));
    setFilterText("");
    filterRef.current?.focus();
  };

  const addApp = (app: ApplicationPayload) => {
    setApps((current) => (current.some((entry) => entry.id === app.id) ? current : [...current, app]));
    setFilterText("");
    filterRef.current?.focus();
  };

  const addWebsite = () => {
    const host = filterText.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!host.includes(".") || /\s/.test(host)) {
      showToast("Failed parsing website URL", filterText.trim());
      return;
    }
    setWebsites((current) => (current.includes(host) ? current : [...current, host]));
    setFilterText("");
    filterRef.current?.focus();
  };

  const buildInput = useCallback(
    (title: string): FocusStartInput => ({
      title: title.trim() !== "" ? title.trim() : "Focus session",
      mode,
      categoryIds: categories.map((category) => category.categoryId),
      raycastAppIds: apps.map((app) => app.id),
      websiteHosts: websites,
      allowAllOnEmptyWebsiteAllowlist: false,
      snoozeDurationMs: preferences.snoozeDurationMs,
      restoreAppsWhenSessionEnds: preferences.restoreAppsWhenSessionEnds,
      goal: duration ?? { mode: "noLimit" },
    }),
    [mode, categories, apps, websites, preferences, duration],
  );

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const input = buildInput(goal_);
    try {
      if (formMode === "start") {
        const state = await fetchSessionState();
        await startFocusSession(mergePreferences(input, state.preferences));
        writeLastStartInput(input);
        showToast("Focus session started.");
        closeMainWindow();
      } else {
        await updateFocusSession(input);
        showToast("Focus session updated.");
      }
      onBack();
    } catch (error) {
      showToast(formMode === "start" ? "Failed to start focus session" : "Failed to update focus session", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const pickerSections: Array<{ id: string; title: string; rows: Array<{ key: string; label: string; detail: string | null; onPick: () => void }> }> = [];
  if (filteredCategories.length > 0) {
    pickerSections.push({
      id: "categories",
      title: "Focus Categories",
      rows: filteredCategories.map((category) => ({
        key: `cat:${category.categoryId}`,
        label: category.title,
        detail: null,
        onPick: () => addCategory(category),
      })),
    });
  }
  if (filteredApps.length > 0) {
    pickerSections.push({
      id: "apps",
      title: "Applications",
      rows: filteredApps.map((app) => ({
        key: `app:${app.payload.id}`,
        label: app.title,
        detail: app.subtitle,
        onPick: () => addApp(app.payload),
      })),
    });
  }

  return (
    <ViewShell
      title={formMode === "start" ? "Start Focus Session" : "Edit Focus Session"}
      onBack={onBack}
      footerLeft={<FocusFooterLeft />}
      footer={
        <button type="button" className="footer-action footer-action--kbd" onClick={() => void submit()} disabled={busy}>
          {formMode === "start" ? "Start Focus Session" : "Save"} <span className="kbd">Ctrl</span>
          <span className="kbd">⏎</span>
        </button>
      }
    >
      <div className="focus-form">
        {/* Label-left rows matching the shipped form: Goal, Duration, Mode, Block/Allow. */}
        <div className="focus-form__row">
          <span className="focus-form__label">Goal</span>
          <div className="focus-form__control">
            <input
              className="focus-form__input"
              value={goal}
              placeholder="Focus session"
              onChange={(event) => setGoal(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
        </div>

        <div className="focus-form__row">
          <span className="focus-form__label">Duration</span>
          <div className="focus-form__control">
            <input
              ref={durationRef}
              className="focus-form__input focus-form__input--trailing"
              value={durationText}
              placeholder="No Limit"
              onChange={(event) => setDurationText(event.target.value)}
              onFocus={() => setPickerOpen("duration")}
              onBlur={() => setPickerOpen((current) => (current === "duration" ? null : current))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <span className={`focus-form__trailing${durationInvalid ? " focus-form__trailing--invalid" : ""}`}>
              {durationInvalid
                ? "Up to 24 h"
                : durationText
                  ? formatDuration(duration ?? { mode: "noLimit" })
                  : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 3" strokeLinecap="round" />
                    </svg>
                  )}
            </span>
            {pickerOpen === "duration" ? (
              <div className="settings-menu translate-menu focus-menu">
                {DURATION_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.text}
                    type="button"
                    className="settings-menu__item translate-menu__item"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setDurationText(suggestion.text);
                      setPickerOpen(null);
                      durationRef.current?.focus();
                    }}
                  >
                    <span className="translate-menu__name">{suggestion.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="focus-form__row">
          <span className="focus-form__label">Mode</span>
          <div className="focus-form__control">
            <button
              type="button"
              className="focus-form__select"
              onClick={() => setPickerOpen((current) => (current === "mode" ? null : "mode"))}
            >
              <span>{BLOCK_MODES.find((entry) => entry.value === mode)?.label}</span>
              <svg className="focus-form__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {pickerOpen === "mode" ? (
              <div className="settings-menu translate-menu focus-menu">
                {BLOCK_MODES.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    className="settings-menu__item translate-menu__item"
                    onClick={() => {
                      setMode(entry.value);
                      setPickerOpen(null);
                    }}
                  >
                    <span className="translate-menu__name">{entry.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="focus-form__row">
          <span className="focus-form__label">{mode === "block" ? "Block" : "Allow"}</span>
          <div className="focus-form__control">
            <div
              className={`focus-form__multi${pickerOpen === "filter" ? " focus-form__multi--open" : ""}`}
              onClick={() => filterRef.current?.focus()}
            >
              <div className="focus-form__chips">
                {categories.map((category) => (
                  <span key={`cat:${category.categoryId}`} className="focus-chip">
                    <RaycastIcon name={category.icon} size={12} />
                    <span className="focus-chip__label">{category.title}</span>
                    <button
                      type="button"
                      className="focus-chip__remove"
                      aria-label={`Remove ${category.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setCategories((current) => current.filter((entry) => entry.categoryId !== category.categoryId));
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {apps.map((app) => (
                  <span key={`app:${app.id}`} className="focus-chip">
                    {app.icon ? <img className="focus-chip__icon" src={app.icon} alt="" /> : null}
                    <span className="focus-chip__label">{app.name}</span>
                    <button
                      type="button"
                      className="focus-chip__remove"
                      aria-label={`Remove ${app.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setApps((current) => current.filter((entry) => entry.id !== app.id));
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {websites.map((host) => (
                  <span key={`web:${host}`} className="focus-chip">
                    <span className="focus-chip__label">{host}</span>
                    <button
                      type="button"
                      className="focus-chip__remove"
                      aria-label={`Remove ${host}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setWebsites((current) => current.filter((entry) => entry !== host));
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <input
                  ref={filterRef}
                  className="focus-form__filter-input"
                  value={filterText}
                  placeholder={categories.length + apps.length + websites.length > 0 ? "" : mode === "block" ? "What apps or websites do you want to block?" : "What apps or websites do you want to allow?"}
                  onChange={(event) => setFilterText(event.target.value)}
                  onFocus={() => setPickerOpen("filter")}
                  onBlur={() => setPickerOpen((current) => (current === "filter" ? null : current))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (filteredCategories.length > 0) addCategory(filteredCategories[0]);
                      else if (filteredApps.length > 0) addApp(filteredApps[0].payload);
                      else if (filterText.trim()) addWebsite();
                    }
                  }}
                />
              </div>
              <svg className="focus-form__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {pickerOpen === "filter" && pickerSections.length > 0 ? (
              <div className="focus-picker">
                {pickerSections.map((section) => (
                  <div key={section.id} className="focus-picker__section">
                    <div className="focus-picker__title">{section.title}</div>
                    {section.rows.map((row) => (
                      <button key={row.key} type="button" className="focus-picker__row" onMouseDown={(event) => { event.preventDefault(); row.onPick(); }}>
                        <span className="focus-picker__label">{row.label}</span>
                        {row.detail ? <span className="focus-picker__detail">{row.detail}</span> : null}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ViewShell>
  );
}

// -------------------------------------------------------------------------------------------
// Search Focus Categories
// -------------------------------------------------------------------------------------------

const categoryCount = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;

export function FocusCategoriesView({
  showToast,
  onBack,
  openForm,
  refreshKey,
}: {
  showToast: FocusToasts;
  onBack: () => void;
  openForm: (mode: "create" | "edit" | "open", category?: FocusCategory, initialTitle?: string) => void;
  refreshKey: number;
}) {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<FocusCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    searchFocusCategories(query)
      .then((result) => {
        if (cancelled) return;
        setCategories(result.categories);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, refreshKey]);

  const selected = categories.find((category) => category.id === selectedId) ?? null;

  const copyList = async (items: string[], toast: string) => {
    const { ipc } = await import("../../ipc");
    await ipc.backend("clipboard.write", { content: items.join("\n") }, { module: "backend" });
    showToast(toast);
  };

  const exportCategory = async (category: FocusCategory) => {
    try {
      const { ipc } = await import("../../ipc");
      const dialog = (await ipc.backend(
        "fileSystem.showSaveFileDialog",
        { title: "Export Category", fileName: `${category.title}.json` },
        { module: "backend" },
      )) as { path: string | null };
      if (!dialog.path) return;
      const payload = JSON.stringify([{ title: category.title, iconName: category.icon, apps: category.applicationIds, websites: category.websiteHosts }], null, 2);
      await ipc.backend("fileSystem.writeFile", { path: dialog.path, content: payload }, { module: "backend" });
      showToast("Exported Focus Category", category.title);
    } catch (error) {
      showToast("Could not export focus category", error instanceof Error ? error.message : String(error));
    }
  };

  const confirmDelete = (category: FocusCategory) => {
    alertStore.open({
      title: `Delete Focus Category "${category.title}"`,
      description: "Warning: This action cannot be undone.",
      primaryAction: {
        title: "Delete",
        style: "destructive",
        action: () => {
          void deleteFocusCategory(category.categoryId)
            .then(() => {
              showToast("Deleted Focus Category", category.title);
              setSelectedId(null);
              searchFocusCategories(query).then((result) => setCategories(result.categories)).catch(() => undefined);
            })
            .catch((error) => showToast("Could not delete focus category", error instanceof Error ? error.message : String(error)));
        },
      },
      secondaryAction: { title: "Cancel", action: () => undefined },
    });
  };

  const customCategories = categories.filter((category) => category.kind === "custom");
  const builtInCategories = categories.filter((category) => category.kind === "builtin");
  const searching = query.trim().length > 0;
  const sections = searching
    ? [{ title: "Results", entries: categories }]
    : [
        { title: "Custom", entries: customCategories },
        { title: "Built-in", entries: builtInCategories },
      ];

  const runPrimary = () => {
    if (!selected) {
      openForm("create", undefined, query.trim() || undefined);
      return;
    }
    if (selected.kind === "custom") openForm("edit", selected);
    else openForm("open", selected);
  };

  return (
    <div className="window">
      <header className="window__header">
        <button type="button" className="icon icon--plain" onClick={onBack} aria-label="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="searchbar">
          <input
            className="searchbar__input"
            autoFocus
            value={query}
            placeholder="Search focus categories..."
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runPrimary();
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const ids = categories.map((category) => category.id);
                const index = selectedId ? ids.indexOf(selectedId) : -1;
                const next = event.key === "ArrowDown" ? Math.min(index + 1, ids.length - 1) : Math.max(index - 1, 0);
                setSelectedId(ids[next] ?? null);
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
        </div>
      </header>

      <main className="window__body" style={{ padding: 0 }}>
        {categories.length === 0 && !loading ? (
          <div className="state">
            <div className="state__title">No Focus Categories Found</div>
            <div className="state__message">{searching ? "Try a different search term." : "Create your first custom focus category to organize apps and websites."}</div>
            <button type="button" className="action action--primary" onClick={() => openForm("create", undefined, query.trim() || undefined)}>
              Create Focus Category
            </button>
          </div>
        ) : (
          <ul className="list">
            {sections
              .filter((section) => section.entries.length > 0)
              .map((section) => (
                <li key={section.title} className="list__section">
                  <div className="list__sectionHeader">
                    <span className="list__sectionTitle">{section.title}</span>
                    <span className="list__sectionCount">{section.entries.length}</span>
                  </div>
                  <ul className="list__sectionBody">
                    {section.entries.map((category) => (
                      <li key={category.id}>
                        <button
                          type="button"
                          className="list__row"
                          data-selected={selected?.id === category.id}
                          onClick={() => setSelectedId(category.id)}
                          onDoubleClick={() => (category.kind === "custom" ? openForm("edit", category) : openForm("open", category))}
                        >
                          <span className="icon" aria-hidden>
                            <RaycastIcon name={category.icon} size={16} />
                          </span>
                          <span className="list__text">
                            <span className="list__title">{category.title}</span>
                          </span>
                          <span className="list__accessory">
                            <span className="pill">{categoryCount(category.websiteHosts.length, "website", "websites")}</span>
                            <span className="pill">{categoryCount(category.applicationIds.length, "app", "apps")}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </main>

      <footer className="window__footer">
        <button type="button" className="footer-icon-button" aria-label="Back" onClick={onBack}>
          <RaycastIcon name="arrow-clockwise" size={16} />
        </button>
        <span className="footer__spacer" />
        <button type="button" className="footer-action footer-action--kbd" onClick={runPrimary}>
          {selected ? (selected.kind === "custom" ? "Edit Focus Category" : "Open Focus Category") : "Create Focus Category"} <span className="kbd">Enter</span>
        </button>
        {selected ? (
          <>
            {selected.websiteHosts.length > 0 ? (
              <button type="button" className="footer-action" onClick={() => void copyList(selected.websiteHosts, "Copied websites")}>
                Copy Websites
              </button>
            ) : null}
            {selected.applicationIds.length > 0 ? (
              <button type="button" className="footer-action" onClick={() => void copyList(selected.applicationIds, "Copied apps")}>
                Copy Apps
              </button>
            ) : null}
            <button type="button" className="footer-action" onClick={() => void exportCategory(selected)}>
              Export Category
            </button>
            {selected.kind === "custom" ? (
              <button type="button" className="footer-action footer-action--destructive" onClick={() => confirmDelete(selected)}>
                Delete
              </button>
            ) : null}
          </>
        ) : null}
      </footer>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Import Focus Categories + the categories/form session wrapper
// -------------------------------------------------------------------------------------------

/** Import: the shipped export shape (`[{title, iconName, apps, websites}]`) read from a JSON file. */
export function FocusImportView({
  showToast,
  onBack,
  onChanged,
}: {
  showToast: FocusToasts;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const pickFile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { ipc } = await import("../../ipc");
      const dialog = (await ipc.backend("fileSystem.showOpenFileDialog", { title: "Import Focus Categories" }, { module: "backend" })) as { path: string | null };
      if (!dialog.path) return;
      const file = (await ipc.backend("fileSystem.readFile", { path: dialog.path }, { module: "backend" })) as { content: string };
      const parsed = JSON.parse(file.content) as Array<{ title?: string; iconName?: string; apps?: string[]; websites?: string[] }>;
      if (!Array.isArray(parsed)) throw new Error("The file does not contain a category list");
      let created = 0;
      for (const entry of parsed) {
        if (!entry?.title || typeof entry.title !== "string") continue;
        await createFocusCategory({
          title: entry.title,
          icon: typeof entry.iconName === "string" ? entry.iconName : undefined,
          websiteHosts: Array.isArray(entry.websites) ? entry.websites.filter((host) => typeof host === "string") : [],
          applicationIds: Array.isArray(entry.apps) ? entry.apps.filter((id) => typeof id === "string") : [],
        });
        created += 1;
      }
      showToast("Imported Focus Categories", `${created} categor${created === 1 ? "y" : "ies"} created`);
      setResult(`${created} categor${created === 1 ? "y" : "ies"} imported from ${dialog.path}`);
      onChanged();
    } catch (error) {
      showToast("Could not import focus categories", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ViewShell
      title="Import Focus Categories"
      onBack={onBack}
      footer={
        <button type="button" className="footer-action footer-action--kbd" onClick={() => void pickFile()} disabled={busy}>
          Choose File <span className="kbd">Enter</span>
        </button>
      }
    >
      <div className="state">
        <div className="state__title">{result ?? "Import focus categories from a JSON file"}</div>
        <div className="state__message">
          The file holds a list of `{"{ title, iconName, apps, websites }"}` objects — the same shape `Export Category` writes.
        </div>
      </div>
    </ViewShell>
  );
}

/** The Search Focus Categories command: the view and its create/edit/open form share one session. */
export function FocusCategoriesSession({
  showToast,
  onBack,
  applications,
}: {
  showToast: FocusToasts;
  onBack: () => void;
  applications: ApplicationCommand[];
}) {
  const [form, setForm] = useState<{ mode: "create" | "edit" | "open"; category?: FocusCategory; initialTitle?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (form) {
    return (
      <FocusCategoryFormView
        formMode={form.mode}
        category={form.category}
        initialTitle={form.initialTitle}
        applications={applications}
        showToast={showToast}
        onBack={() => setForm(null)}
        onChanged={() => setRefreshKey((value) => value + 1)}
      />
    );
  }
  return (
    <FocusCategoriesView
      showToast={showToast}
      onBack={onBack}
      openForm={(mode, category, initialTitle) => setForm({ mode, category, initialTitle })}
      refreshKey={refreshKey}
    />
  );
}

export function FocusCategoryFormView({
  formMode,
  category,
  initialTitle,
  applications,
  showToast,
  onBack,
  onChanged,
}: {
  formMode: "create" | "edit" | "open";
  category?: FocusCategory | null;
  initialTitle?: string;
  applications: ApplicationCommand[];
  showToast: FocusToasts;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(formMode === "create" ? initialTitle ?? "" : category?.title ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "bulls-eye-16");
  const [hosts, setHosts] = useState<string[]>(category?.websiteHosts ?? []);
  const [appIds, setAppIds] = useState<string[]>(category?.applicationIds ?? []);
  const [filterText, setFilterText] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [allApps, setAllApps] = useState<ApplicationCommand[]>(applications);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (applications.length > 0) {
      setAllApps(applications);
    } else {
      ipc.backend("applications.getAll", {}, { module: "backend" })
        .then((response) => {
          const value = (response as { value?: ApplicationPayload[] }).value ?? [];
          setAllApps(
            value.map((payload) => ({
              extensionId: "applications",
              commandId: `applications/${payload.id}`,
              title: payload.name,
              subtitle: payload.disambiguator ? (payload.disambiguator.split(/[\\/]/).filter(Boolean).pop() ?? null) : null,
              keywords: [payload.bundleId, payload.name, payload.path].filter(Boolean) as string[],
              payload,
            })),
          );
        })
        .catch(() => undefined);
    }
  }, [applications]);

  const filteredApps = useMemo(() => {
    const selected = new Set(appIds);
    return filterApplications(allApps.filter((a) => !selected.has(a.payload.id)), filterText);
  }, [allApps, appIds, filterText]);
  const readOnly = formMode === "open";

  const pickApp = (app: ApplicationPayload) => {
    if (readOnly) return;
    setAppIds((current) => (current.includes(app.id) ? current : [...current, app.id]));
    setFilterText("");
  };

  const submit = async () => {
    if (readOnly) return;
    if (title.trim() === "") {
      setTitleError(true);
      return;
    }
    try {
      if (formMode === "create") {
        await createFocusCategory({ title: title.trim(), icon, websiteHosts: hosts, applicationIds: appIds });
      } else if (category) {
        await updateFocusCategory({ categoryId: category.categoryId, title: title.trim(), icon, websiteHosts: hosts, applicationIds: appIds });
      }
      showToast(formMode === "create" ? "Created Focus Category" : "Saved Focus Category", title.trim());
      onChanged();
      onBack();
    } catch (error) {
      showToast("Could not save focus category", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <ViewShell
      title={formMode === "create" ? "Create Focus Category" : formMode === "edit" ? "Edit Focus Category" : "Open Focus Category"}
      onBack={onBack}
      footerLeft={<FocusFooterLeft />}
      footer={
        readOnly ? null : (
          <button type="button" className="footer-action footer-action--kbd" onClick={() => void submit()}>
            {formMode === "create" ? "Create Focus Category" : "Save"} <span className="kbd">⏎</span>
          </button>
        )
      }
    >
      <div className="focus-form">
        <div className="focus-form__row">
          <span className="focus-form__label">Name</span>
          <div className="focus-form__control">
            <input
              className={`focus-form__input${titleError ? " focus-form__input--invalid" : ""}`}
              value={title}
              disabled={readOnly}
              placeholder="Name your focus category"
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleError(false);
              }}
            />
            {titleError ? <span className="searchbar__hint searchbar__hint--invalid">Title is required</span> : null}
          </div>
        </div>

        <div className="focus-form__row">
          <span className="focus-form__label">Icon</span>
          <div className="focus-form__control">
            <input className="focus-form__input" value={icon} disabled={readOnly} placeholder="bulls-eye-16" onChange={(event) => setIcon(event.target.value)} />
          </div>
        </div>

        <div className="focus-form__row">
          <span className="focus-form__label">Apps &amp; Websites</span>
          <div className="focus-form__control">
            <div className="focus-form__multi" onClick={() => !readOnly && filterRef.current?.focus()}>
              <div className="focus-form__chips">
                {appIds.map((id) => (
                  <span key={`app:${id}`} className="focus-chip">
                    <span className="focus-chip__label">{applications.find((app) => app.payload.id === id)?.title ?? id}</span>
                    {!readOnly ? (
                      <button type="button" className="focus-chip__remove" aria-label="Remove" onClick={(event) => { event.stopPropagation(); setAppIds((current) => current.filter((entry) => entry !== id)); }}>
                        ✕
                      </button>
                    ) : null}
                  </span>
                ))}
                {hosts.map((host) => (
                  <span key={`web:${host}`} className="focus-chip">
                    <span className="focus-chip__label">{host}</span>
                    {!readOnly ? (
                      <button type="button" className="focus-chip__remove" aria-label="Remove" onClick={(event) => { event.stopPropagation(); setHosts((current) => current.filter((entry) => entry !== host)); }}>
                        ✕
                      </button>
                    ) : null}
                  </span>
                ))}
                <input
                  ref={filterRef}
                  className="focus-form__filter-input"
                  value={filterText}
                  disabled={readOnly}
                  placeholder={appIds.length + hosts.length > 0 ? "" : "Search applications or type a website"}
                  onChange={(event) => setFilterText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (filteredApps.length > 0) pickApp(filteredApps[0].payload);
                      else if (filterText.trim()) {
                        const host = filterText.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
                        if (host.includes(".")) setHosts((current) => (current.includes(host) ? current : [...current, host]));
                        else showToast("Failed parsing website URL", filterText.trim());
                        setFilterText("");
                      }
                    }
                  }}
                />
              </div>
              <svg className="focus-form__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {!readOnly && filterText.trim().length > 0 && filteredApps.length > 0 ? (
              <div className="focus-picker">
                <div className="focus-picker__section">
                  <div className="focus-picker__title">Applications</div>
                  {filteredApps.map((app) => (
                    <button key={app.payload.id} type="button" className="focus-picker__row" onMouseDown={(event) => { event.preventDefault(); pickApp(app.payload); }}>
                      <span className="focus-picker__label">{app.title}</span>
                      {app.subtitle ? <span className="focus-picker__detail">{app.subtitle}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ViewShell>
  );
}
