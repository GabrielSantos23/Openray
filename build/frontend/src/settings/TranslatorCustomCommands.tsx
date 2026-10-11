// Translator custom commands (docs/translator-spec.md — the settings-page dialog strings).

import { useCallback, useEffect, useState } from "react";
import { ipc } from "../ipc";

export interface TranslatorCommand {
  id: string;
  name: string;
  source: string | null;
  target: string;
  sourceLabel: string | null;
  targetLabel: string;
  outputBehavior: "open" | "replace";
  enabled: boolean;
}

export interface TranslatorDialogState {
  mode: "create" | "edit";
  id?: string;
  name: string;
  nameTouched: boolean;
  source: string;
  target: string;
  outputBehavior: "open" | "replace";
}

export function settingsToast(title: string, message?: string): void {
  window.dispatchEvent(new CustomEvent("raycast-mini:settings-toast", { detail: { title, message } }));
}

export function TranslatorCustomCommands() {
  const [commands, setCommands] = useState<TranslatorCommand[]>([]);
  const [languages, setLanguages] = useState<Array<{ code: string; name: string }>>([]);
  const [dialog, setDialog] = useState<TranslatorDialogState | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<TranslatorCommand | null>(null);
  const [deleting, setDeleting] = useState<TranslatorCommand | null>(null);

  const refresh = useCallback(() => {
    void ipc
      .backend("translator.getAllTranslateCustomCommands", {}, { module: "backend" })
      .then((raw) => setCommands(((raw as { commands?: TranslatorCommand[] }).commands ?? []) as TranslatorCommand[]))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    void ipc
      .backend("translator.getLanguages", {}, { module: "backend" })
      .then((raw) => setLanguages(((raw as { languages?: Array<{ code: string; name: string }> }).languages ?? [])))
      .catch(() => undefined);
  }, [refresh]);

  const label = useCallback(
    (code: string | null, fallback: string) => {
      if (!code) return fallback;
      if (code === "auto") return "Detect Language";
      return languages.find((language) => language.code === code)?.name ?? code;
    },
    [languages],
  );

  const autoName = useCallback(
    (source: string, target: string) =>
      source && source !== "auto"
        ? `Translate ${label(source, source)} to ${label(target, target)}`
        : `Translate to ${label(target, target)}`,
    [label],
  );

  const openCreate = () => {
    setNameError(null);
    setDialog({ mode: "create", name: "", nameTouched: false, source: "auto", target: "en", outputBehavior: "open" });
  };

  const openEdit = (command: TranslatorCommand) => {
    setNameError(null);
    setDialog({
      mode: "edit",
      id: command.id,
      name: command.name,
      nameTouched: true,
      source: command.source ?? "auto",
      target: command.target,
      outputBehavior: command.outputBehavior,
    });
  };

  const save = async () => {
    if (!dialog) return;
    const name = dialog.nameTouched ? dialog.name.trim() : autoName(dialog.source, dialog.target);
    if (!name) {
      setNameError("Please enter a name");
      return;
    }
    try {
      const payload = {
        name,
        source: dialog.source === "auto" ? null : dialog.source,
        target: dialog.target,
        outputBehavior: dialog.outputBehavior,
      };
      if (dialog.mode === "create") {
        await ipc.backend("translator.saveTranslateCustomCommand", payload, { module: "backend" });
        settingsToast("Command created");
      } else if (dialog.id) {
        await ipc.backend("translator.updateTranslateCustomCommand", { id: dialog.id, ...payload }, { module: "backend" });
        settingsToast("Command saved");
      }
      setDialog(null);
      refresh();
    } catch (error) {
      settingsToast("Couldn't save the command", error instanceof Error ? error.message : String(error));
    }
  };

  const duplicate = async (command: TranslatorCommand) => {
    setMenuFor(null);
    try {
      await ipc.backend(
        "translator.saveTranslateCustomCommand",
        {
          name: `${command.name} Copy`,
          source: command.source,
          target: command.target,
          outputBehavior: command.outputBehavior,
        },
        { module: "backend" },
      );
      settingsToast("Command duplicated");
      refresh();
    } catch (error) {
      settingsToast("Couldn't duplicate the command", error instanceof Error ? error.message : String(error));
    }
  };

  const copyDeeplink = async (command: TranslatorCommand) => {
    setMenuFor(null);
    // No raycast-mini:// protocol handler exists; the string mirrors Raycast's deeplink shape
    // and is informational only (our decision in docs/translator-spec.md).
    try {
      await ipc.backend(
        "clipboard.write",
        { content: `raycast-mini://translate?id=${encodeURIComponent(command.id)}` },
        { module: "backend" },
      );
      settingsToast("Copied deeplink");
    } catch {
      settingsToast("Failed copying deeplink");
    }
  };

  const setEnabled = async (command: TranslatorCommand, enabled: boolean) => {
    setMenuFor(null);
    try {
      await ipc.backend("translator.updateTranslateCustomCommand", { id: command.id, enabled }, { module: "backend" });
      refresh();
    } catch (error) {
      settingsToast("Couldn't update the command", error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await ipc.backend("translator.deleteTranslateCustomCommand", { id: target.id }, { module: "backend" });
      settingsToast("Deleted Command");
      refresh();
    } catch (error) {
      settingsToast("Couldn't delete the command", error instanceof Error ? error.message : String(error));
    }
  };

  const dialogName = dialog ? (dialog.nameTouched ? dialog.name : autoName(dialog.source, dialog.target) || dialog.name) : "";
  const dialogMode = dialog?.mode === "create";

  return (
    <section className="settings-section" data-translator-commands="true">
      <h2 className="settings-section__title">Custom Commands</h2>
      <div className="settings-section__content">
        {commands.map((command) => (
          <div className="settings-row" key={command.id} data-row-id={`translator-command-${command.id}`}>
            <div className="settings-row__column">
              <span className="settings-row__title">
                {command.name}
                {!command.enabled ? <span className="settings-row__unavailable">Disabled</span> : null}
              </span>
              <span className="settings-row__description" data-settings-description>
                {command.sourceLabel
                  ? `Translate ${command.sourceLabel} to ${command.targetLabel}`
                  : `Translate to ${command.targetLabel}`}
                {" · "}
                {command.outputBehavior === "replace" ? "Replace Selection" : "Open in Raycast"}
              </span>
            </div>
            <div className="settings-row__right" data-settings-accessory>
              <span className="settings-row__actions">
                <button type="button" className="settings-button" onClick={() => setMenuFor(command)}>
                  Menu
                </button>
                <button type="button" className="settings-button" onClick={() => openEdit(command)}>
                  Edit
                </button>
              </span>
            </div>
          </div>
        ))}
        <div className="settings-row">
          <div className="settings-row__column">
            <span className="settings-row__description" data-settings-description>
              {commands.length === 0
                ? "Commands appear in the root search while you type."
                : "Saved commands appear in the root search while you type."}
            </span>
          </div>
          <div className="settings-row__right" data-settings-accessory>
            <button type="button" className="settings-button" onClick={openCreate}>
              Create Command
            </button>
          </div>
        </div>
      </div>

      {dialog ? (
        <div className="settings-overlay">
          <div className="settings-overlay__backdrop" onClick={() => setDialog(null)} aria-hidden />
          <div className="settings-overlay__panel translator-command-form" role="dialog" aria-label={dialogMode ? "New Translate Command" : "Edit Translate Command"}>
            <div className="translator-command-form__title">{dialogMode ? "New Translate Command" : "Edit Translate Command"}</div>

            <label className="translator-command-form__field">
              <span className="translator-command-form__label">Translate From</span>
              <span className="translator-command-form__hint">Language you would like to translate from</span>
              <select
                className="translator-command-form__select"
                value={dialog.source}
                onChange={(event) => setDialog({ ...dialog, source: event.target.value })}
              >
                <option value="auto">Detect Language</option>
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="translator-command-form__field">
              <span className="translator-command-form__label">Translate To</span>
              <span className="translator-command-form__hint">Language you would like this command to translate to</span>
              <select
                className="translator-command-form__select"
                value={dialog.target}
                onChange={(event) => setDialog({ ...dialog, target: event.target.value })}
              >
                {languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="translator-command-form__field">
              <span className="translator-command-form__label">Output Behavior</span>
              <span className="translator-command-form__hint">Open Translator, or replace the selected text in place</span>
              <select
                className="translator-command-form__select"
                value={dialog.outputBehavior}
                onChange={(event) => setDialog({ ...dialog, outputBehavior: event.target.value === "replace" ? "replace" : "open" })}
              >
                <option value="open">Open in Raycast</option>
                <option value="replace">Replace Selection</option>
              </select>
            </label>

            <label className="translator-command-form__field">
              <span className="translator-command-form__label">Command Name</span>
              <span className="translator-command-form__hint">Auto-named from the languages until you type one</span>
              <input
                className="translator-command-form__input"
                type="text"
                placeholder="Translate to…"
                value={dialogName}
                onChange={(event) => setDialog({ ...dialog, name: event.target.value, nameTouched: true })}
              />
              {nameError ? <span className="translator-command-form__error">{nameError}</span> : null}
            </label>

            <div className="translator-command-form__actions">
              <button type="button" className="settings-button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" className="settings-button settings-button--primary" onClick={() => void save()}>
                {dialogMode ? "Create Command" : "Save Command"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {menuFor ? (
        <div className="settings-overlay">
          <div className="settings-overlay__backdrop" onClick={() => setMenuFor(null)} aria-hidden />
          <div className="settings-overlay__panel translator-menu" role="menu">
            <div className="translator-menu__title">{menuFor.name}</div>
            <button
              type="button"
              className="translator-menu__item"
              onClick={() => {
                const command = menuFor;
                setMenuFor(null);
                openEdit(command);
              }}
            >
              Edit Command
            </button>
            <button type="button" className="translator-menu__item" onClick={() => void duplicate(menuFor)}>
              Duplicate Command
            </button>
            <button type="button" className="translator-menu__item" onClick={() => void copyDeeplink(menuFor)}>
              Copy Deeplink
            </button>
            <button
              type="button"
              className="translator-menu__item"
              onClick={() => void setEnabled(menuFor, !menuFor.enabled)}
            >
              {menuFor.enabled ? "Disable Command" : "Enable Command"}
            </button>
            <button
              type="button"
              className="translator-menu__item translator-menu__item--destructive"
              onClick={() => {
                setDeleting(menuFor);
                setMenuFor(null);
              }}
            >
              Delete Command
            </button>
          </div>
        </div>
      ) : null}

      {deleting ? (
        <div className="settings-overlay">
          <div className="settings-overlay__backdrop" onClick={() => setDeleting(null)} aria-hidden />
          <div className="settings-overlay__panel translator-confirm" role="alertdialog">
            <div className="translator-command-form__title">{`Delete Command "${deleting.name}"`}</div>
            <div className="translator-confirm__body">Warning: This action cannot be undone.</div>
            <div className="translator-command-form__actions">
              <button type="button" className="settings-button" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button type="button" className="settings-button settings-button--danger" onClick={() => void remove()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
