// The Translate view (`/extension/translate` in the shipped app).
//
// Ported from the shipped Translate page (docs/translator-spec.md), matching the shipped layout:
// the two language selectors sit on the top bar (flag + name + chevron) above side-by-side source
// and result panes, the swap button floats at the bottom center straddling the pane divider, the
// navigation loader bar sweeps while a translation is in flight. The confirmed behaviors live
// under the surface: source placeholder `Enter text…`, result placeholder `Translation` (pending
// appends `…`), selectors persisted in localStorage `translator::source-language` /
// `translator::target-language`, recent text under `translator::recent-text`, the 330 ms debounce
// with the same-language short-circuit, the `` `${n} Word(s) · ${n} Character(s)` `` counters, and
// the confirmed action set (Copy Translation, Paste, Copy Source Text, Swap Languages, Change
// Source/Target Language). Copy actions hide the launcher so the toast migrates to the HUD.
// TTS/dictation are out of scope (no speech stack) and not rendered as dead buttons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import { ipc } from "../../ipc";
import { RaycastIcon } from "../../icons";
import { CommandFooter } from "../../commandChrome";
import { LoadingBar } from "../../LoadingBar";

export interface TranslateLanguage {
  code: string;
  name: string;
}

interface TranslateResult {
  status: "pending" | "ready" | "failed";
  translatedText: string | null;
  detectedSourceLanguage: string | null;
  sourceLabel: string | null;
  targetLabel: string | null;
}

export interface TranslatorPreferences {
  primaryAction: "copy" | "paste";
  prefillFromSelectedText: boolean;
  defaultSourceLanguage: string | null;
  defaultTargetLanguage: string | null;
}

/** Seed from the root-search quick row ("Open in Translator") or a custom command. */
export interface TranslateSeed {
  id: string;
  sourceText?: string;
  source?: string | null;
  target?: string | null;
}

const SOURCE_LANGUAGE_KEY = "translator::source-language";
const TARGET_LANGUAGE_KEY = "translator::target-language";
const RECENT_TEXT_KEY = "translator::recent-text";
const TRANSLATE_DEBOUNCE_MS = 330; // confirmed view debounce

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export interface TranslateViewProps {
  command: "translate";
  seed?: TranslateSeed | null;
  showToast: (title: string, message?: string) => void;
  onBack: () => void;
  closeMainWindow: () => void;
}

export function TranslateView({ command, seed, showToast, onBack, closeMainWindow }: TranslateViewProps) {
  void command;
  const [languages, setLanguages] = useState<TranslateLanguage[]>([]);
  const [source, setSource] = useState<string>(() => seed?.source ?? localStorage.getItem(SOURCE_LANGUAGE_KEY) ?? "auto");
  const [target, setTarget] = useState<string>(() => seed?.target ?? localStorage.getItem(TARGET_LANGUAGE_KEY) ?? "en");
  const [sourceText, setSourceText] = useState<string>(() => seed?.sourceText ?? localStorage.getItem(RECENT_TEXT_KEY) ?? "");
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [preferences, setPreferences] = useState<TranslatorPreferences>({
    primaryAction: "copy",
    prefillFromSelectedText: false,
    defaultSourceLanguage: null,
    defaultTargetLanguage: null,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [pickingLanguage, setPickingLanguage] = useState<"source" | "target" | null>(null);
  const [pickerHighlight, setPickerHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    void ipc.backend("translator.getLanguages", {}, { module: "backend" })
      .then((raw) => setLanguages(((raw as { languages?: TranslateLanguage[] }).languages ?? []) as TranslateLanguage[]))
      .catch(() => undefined);
    void ipc.backend("translator.getPreferences", {}, { module: "backend" })
      .then((raw) => setPreferences((raw as TranslatorPreferences) ?? ({} as TranslatorPreferences)))
      .catch(() => undefined);
  }, []);

  // "Use Selected Text as Source": prefill once from the foremost app when enabled and the view
  // opens empty (the clone's selection read is a stub, so this is a no-op there).
  useEffect(() => {
    if (!preferences.prefillFromSelectedText) return;
    if (sourceText.trim()) return;
    void ipc.backend("shell.getSelectedText", {}, { module: "backend" })
      .then((raw) => {
        const value = (raw as { value?: string | null }).value;
        if (value && value.trim()) setSourceText(value);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.prefillFromSelectedText]);

  useEffect(() => {
    localStorage.setItem(RECENT_TEXT_KEY, sourceText);
  }, [sourceText]);

  const label = useCallback(
    (code: string | null) => {
      if (!code) return null;
      if (code === "auto") return "Detect Language";
      return languages.find((language) => language.code === code)?.name ?? code;
    },
    [languages],
  );

  // The confirmed 330 ms translate debounce with the same-language short-circuit.
  useEffect(() => {
    const text = sourceText;
    if (!text.trim()) {
      setResult(null);
      return;
    }
    if (source !== "auto" && source === target) {
      setResult({
        status: "ready",
        translatedText: text,
        detectedSourceLanguage: source,
        sourceLabel: label(source),
        targetLabel: label(target),
      });
      return;
    }
    let cancelled = false;
    setResult((current) => (current ? { ...current, status: "pending" } : { status: "pending", translatedText: null, detectedSourceLanguage: null, sourceLabel: null, targetLabel: null }));
    const timer = setTimeout(() => {
      void ipc
        .backend("translator.translate", { text, source, target }, { module: "backend" })
        .then((raw) => {
          if (cancelled) return;
          const payload = raw as {
            status: "ready" | "failed";
            translatedText?: string;
            detectedSourceLanguage?: string | null;
            sourceLabel?: string | null;
            targetLabel?: string | null;
            error?: string;
          };
          if (payload.status === "ready") {
            setResult({
              status: "ready",
              translatedText: payload.translatedText ?? "",
              detectedSourceLanguage: payload.detectedSourceLanguage ?? null,
              sourceLabel: payload.sourceLabel ?? null,
              targetLabel: payload.targetLabel ?? null,
            });
          } else {
            setResult({
              status: "failed",
              translatedText: null,
              detectedSourceLanguage: null,
              sourceLabel: source === "auto" ? null : label(source),
              targetLabel: label(target),
            });
            if (payload.error) showToast("Translation failed", payload.error);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setResult({ status: "failed", translatedText: null, detectedSourceLanguage: null, sourceLabel: null, targetLabel: label(target) });
        });
    }, TRANSLATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceText, source, target, label]);

  const effectiveSourceLabel = useMemo(() => {
    if (source === "auto") {
      return result?.status === "ready" && result.detectedSourceLanguage
        ? label(result.detectedSourceLanguage) ?? "Original"
        : "Detect Language";
    }
    return label(source) ?? "Detect Language";
  }, [source, result, label]);

  const targetLabel = label(target) ?? "English";
  const pending = result?.status === "pending";

  // Copy actions hide the launcher (like the calculator's Copy Answer): the toast migrates to the
  // HUD and the paste target is visible.
  const copyTranslation = useCallback(async () => {
    if (!result?.translatedText) return;
    try {
      await ipc.backend("clipboard.write", { content: result.translatedText }, { module: "backend" });
      showToast("Copied translation to clipboard");
      closeMainWindow();
    } catch {
      showToast("Failed copying translation");
    }
  }, [result, showToast, closeMainWindow]);

  const pasteTranslation = useCallback(async () => {
    if (!result?.translatedText) return;
    try {
      await ipc.backend("clipboard.paste", { text: result.translatedText, shouldCloseWindow: true }, { module: "backend" });
    } catch {
      showToast("Failed to paste");
    }
  }, [result, showToast]);

  const copySourceText = useCallback(async () => {
    if (!sourceText.trim()) return;
    try {
      await ipc.backend("clipboard.write", { content: sourceText }, { module: "backend" });
      showToast("Copied source text to clipboard");
      closeMainWindow();
    } catch {
      showToast("Failed copying source text");
    }
  }, [sourceText, showToast, closeMainWindow]);

  const swapLanguages = useCallback(() => {
    // With `Detect Language` the detected result stands in for the source; without one, English
    // keeps the swap well-defined (the shipped swap semantics for auto are not observable).
    const nextSource = target;
    const nextTarget = source === "auto" ? result?.detectedSourceLanguage ?? "en" : source;
    setSource(nextSource);
    setTarget(nextTarget);
    localStorage.setItem(SOURCE_LANGUAGE_KEY, nextSource);
    localStorage.setItem(TARGET_LANGUAGE_KEY, nextTarget);
  }, [target, source, result]);

  const chooseLanguage = useCallback((side: "source" | "target", code: string) => {
    if (side === "source") {
      setSource(code);
      localStorage.setItem(SOURCE_LANGUAGE_KEY, code);
    } else {
      setTarget(code);
      localStorage.setItem(TARGET_LANGUAGE_KEY, code);
    }
    setPickingLanguage(null);
  }, []);

  const runPrimary = useCallback(() => {
    if (preferences.primaryAction === "paste") void pasteTranslation();
    else void copyTranslation();
  }, [preferences.primaryAction, pasteTranslation, copyTranslation]);

  const overlayLanguages = useMemo(() => {
    if (!pickingLanguage) return [];
    return pickingLanguage === "source" ? [{ code: "auto", name: "Detect Language" }, ...languages] : languages;
  }, [pickingLanguage, languages]);

  // The language dropdown owns the keyboard while open: arrows move, Enter picks, Escape closes —
  // and a click outside any part of the open dropdown dismisses it, like the Settings dropdowns.
  useEffect(() => {
    setPickerHighlight(0);
  }, [pickingLanguage, overlayLanguages.length]);

  useEffect(() => {
    if (!pickingLanguage) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickingLanguage(null);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [pickingLanguage]);

  useEffect(() => {
    if (!pickingLanguage) return;
    const last = Math.max(0, overlayLanguages.length - 1);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPickingLanguage(null);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setPickerHighlight((index) => (index >= last ? 0 : index + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setPickerHighlight((index) => (index <= 0 ? last : index - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        setPickerHighlight(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setPickerHighlight(last);
      } else if (event.key === "Enter") {
        const language = overlayLanguages[pickerHighlight];
        if (language && pickingLanguage) {
          event.preventDefault();
          chooseLanguage(pickingLanguage, language.code);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [pickingLanguage, overlayLanguages, pickerHighlight, chooseLanguage]);

  // Keyboard highlight follows the list: the highlighted option scrolls into view like the
  // action panel's cursor does.
  useEffect(() => {
    if (!pickingLanguage) return;
    const menu = pickerRef.current?.querySelector(".translate-menu");
    const option = menu?.querySelector<HTMLElement>('[data-selected="true"]');
    option?.scrollIntoView({ block: "nearest" });
  }, [pickingLanguage, pickerHighlight, overlayLanguages]);

  useEffect(() => {
    if (pickingLanguage) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPanelOpen((open) => !open);
        return;
      }
      if (key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        runPrimary();
        return;
      }
      if (key === "Escape") {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [pickingLanguage, runPrimary, onBack]);

  const actionGroups = useMemo<ActionGroup[]>(() => {
    const actions: ActionGroup["actions"] = [
      { id: "translator:copyTranslation", title: "Copy Translation", itemId: "" },
      { id: "translator:paste", title: "Paste", itemId: "" },
      { id: "translator:copySourceText", title: "Copy Source Text", itemId: "" },
      { id: "translator:swapLanguages", title: "Swap Languages", itemId: "" },
      { id: "translator:changeSourceLanguage", title: "Change Source Language", itemId: "" },
      { id: "translator:changeTargetLanguage", title: "Change Target Language", itemId: "" },
    ];
    return [{ name: "actions", actions }];
  }, []);

  const runAction = useCallback(
    (actionId: string) => {
      setPanelOpen(false);
      switch (actionId) {
        case "translator:copyTranslation":
          void copyTranslation();
          return;
        case "translator:paste":
          void pasteTranslation();
          return;
        case "translator:copySourceText":
          void copySourceText();
          return;
        case "translator:swapLanguages":
          swapLanguages();
          return;
        case "translator:changeSourceLanguage":
          setPickingLanguage("source");
          return;
        case "translator:changeTargetLanguage":
          setPickingLanguage("target");
          return;
        default:
          return;
      }
    },
    [copyTranslation, pasteTranslation, copySourceText, swapLanguages],
  );

  const words = wordCount(sourceText);
  const failed = result?.status === "failed";

  // The language dropdown: the app's standard `.settings-menu` popover (blurred panel, open
  // animation) anchored centered under the selector, with group labels and a check on the
  // current language; keyboard highlight follows the picker effect above.
  const renderLanguageDropdown = (side: "source" | "target") => {
    const current = side === "source" ? source : target;
    const optionRow = (language: TranslateLanguage, flatIndex: number) => {
      const selected = current === language.code;
      return (
        <button
          key={language.code}
          type="button"
          role="option"
          aria-selected={selected}
          className="settings-menu__item translate-menu__item"
          data-selected={flatIndex === pickerHighlight || undefined}
          onMouseEnter={() => setPickerHighlight(flatIndex)}
          onClick={() => chooseLanguage(side, language.code)}
        >
          <span className="translate-menu__name">{language.name}</span>
          {selected ? <RaycastIcon name="Check" size={12} /> : null}
        </button>
      );
    };
    return (
      <div
        className="settings-menu translate-menu"
        role="listbox"
        aria-label={side === "source" ? "Choose source language" : "Choose target language"}
      >
        {side === "source" ? (
          <>
            <div className="translate-menu__group">Automatic</div>
            {optionRow(overlayLanguages[0], 0)}
            <div className="translate-menu__group">All Languages</div>
            {overlayLanguages.slice(1).map((language, index) => optionRow(language, index + 1))}
          </>
        ) : (
          <>
            <div className="translate-menu__group">All Languages</div>
            {overlayLanguages.map((language, index) => optionRow(language, index))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="window translate-window">
      <main className="window__body translate-body">
        <div className="translate-topbar">
          <button type="button" className="back-button translate-back" onClick={onBack} aria-label="Back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="translate-topbar__pane">
            <span className="translate-language-anchor" ref={pickingLanguage === "source" ? pickerRef : undefined}>
              <button
                type="button"
                className="translate-language"
                data-state={pickingLanguage === "source" ? "open" : "closed"}
                aria-haspopup="listbox"
                aria-expanded={pickingLanguage === "source"}
                onClick={() => setPickingLanguage((current) => (current === "source" ? null : "source"))}
              >
                <RaycastIcon name="flag" size={13} />
                <span className="translate-language__label">{effectiveSourceLabel}</span>
                <RaycastIcon name="chevron-down" size={12} />
              </button>
              {pickingLanguage === "source" ? renderLanguageDropdown("source") : null}
            </span>
          </div>
          <div className="translate-topbar__pane">
            <span className="translate-language-anchor" ref={pickingLanguage === "target" ? pickerRef : undefined}>
              <button
                type="button"
                className="translate-language"
                data-state={pickingLanguage === "target" ? "open" : "closed"}
                aria-haspopup="listbox"
                aria-expanded={pickingLanguage === "target"}
                onClick={() => setPickingLanguage((current) => (current === "target" ? null : "target"))}
              >
                <RaycastIcon name="flag" size={13} />
                <span className="translate-language__label">{targetLabel}</span>
                <RaycastIcon name="chevron-down" size={12} />
              </button>
              {pickingLanguage === "target" ? renderLanguageDropdown("target") : null}
            </span>
          </div>
          <LoadingBar isLoading={pending} />
        </div>

        <div className="translate-panes">
          <div className="translate-pane translate-pane--source">
            <textarea
              ref={textareaRef}
              className="translate-pane__input"
              autoFocus
              placeholder="Enter text…"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="translate-divider" aria-hidden />

          <div className="translate-pane translate-pane--result">
            <div className={`translate-pane__output${pending ? " translate-pane__output--pending" : ""}${failed ? " translate-pane__output--failed" : ""}`}>
              {result?.status === "ready" ? result.translatedText : failed ? "Translation unavailable" : result ? "Translation…" : null}
            </div>
          </div>

          <button type="button" className="translate-swap" onClick={swapLanguages} aria-label="Swap Languages">
            <RaycastIcon name="switch" size={15} />
          </button>
        </div>
      </main>

      <CommandFooter
        area="translator"
        title="Translator"
        leftActions={
          result?.status === "ready" ? (
            <button type="button" className="footer-action footer-action--kbd" onClick={runPrimary}>
              {preferences.primaryAction === "paste" ? "Paste to Active App" : "Copy Translation"}
              <span className="kbd">Ctrl</span>
              <span className="kbd">Enter</span>
            </button>
          ) : undefined
        }
        actions={
          <>
            {sourceText.trim() ? (
              <span className="translate-counters">{`${words} Word(s) · ${sourceText.length} Character(s)`}</span>
            ) : null}
            <button type="button" className="footer-action footer-action--kbd" onClick={() => setPanelOpen(true)}>
              Actions <span className="kbd">Ctrl</span>
              <span className="kbd">K</span>
            </button>
          </>
        }
      />

      <ActionPanel
        open={panelOpen}
        title="Translator"
        groups={actionGroups}
        onClose={() => setPanelOpen(false)}
        onRun={(action) => runAction(action.id)}
      />
    </div>
  );
}
