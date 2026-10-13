// The Notes window page (docs/notes-spec.md, "Notes window"): top bar with the live title and the
// confirmed buttons, a rich contentEditable editor over the confirmed markdown node subset (the
// backend renders markdown → HTML and serializes back), the Find/Replace bar with the N/M counter,
// the Raycast footer with the format buttons (heading/format/link/code/code block/task list/list,
// plus the counter and the hide toggle), the Ctrl K action panel, Browse Notes, Recently Deleted
// and zoom. The WPF host (NotesWindow) drives window height from `notes:size` and hides on Escape
// per the `escapeKeyBehavior` preference.

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ipc, ipcRequest, onNotification } from "../../ipc";
import { ActionPanel, type ActionGroup } from "../../ActionPanel";
import AlertHost from "../../AlertHost";
import { RaycastIcon } from "../../icons";
import { toastStore } from "../../toastStore";
import { countWords, noteDeeplink, relativeOpened, type NoteEntry } from "../../notes";

interface NotesPreferences {
  zoom: number;
  escapeKeyBehavior: "closesWindow" | "losesFocus";
  windowAutoSizing: boolean;
}

const UNTITLED = "Untitled";

function firstLineTitle(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return UNTITLED;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const COUNTER_MODE_KEY = "raycast-notes-counter-mode";
const FORMAT_BAR_KEY = "raycast-notes-format-bar-visible";

function readCounterMode(): "words" | "characters" {
  try {
    return localStorage.getItem(COUNTER_MODE_KEY) === "characters" ? "characters" : "words";
  } catch {
    return "words";
  }
}

function writePersisted(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable keeps the default */
  }
}

/** Raw web message to the host window (drag requests — requests go through the ipc host object). */
function postToHost(message: Record<string, unknown>): void {
  const webview = (window as unknown as { chrome?: { webview?: { postMessage?: (message: string) => void } } })
    .chrome?.webview;
  webview?.postMessage?.(JSON.stringify(message));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Current block-level element under the caret, scoped to the editor. */
function blockAtCaret(editor: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  let node: Node | null = selection.getRangeAt(0).startContainer;
  while (node && node !== editor) {
    if (node.nodeType === 1) {
      const element = node as HTMLElement;
      const display = getComputedStyle(element).display;
      if (display !== "inline" && element !== editor) return element;
    }
    node = node.parentNode;
  }
  return null;
}

export function NotesPage() {
  const [prefs, setPrefs] = useState<NotesPreferences | null>(null);
  const [note, setNote] = useState<NoteEntry | null>(null);
  const [allNotes, setAllNotes] = useState<NoteEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashQuery, setTrashQuery] = useState("");
  const [trashNotes, setTrashNotes] = useState<NoteEntry[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceText] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [counterMode, setCounterMode] = useState<"words" | "characters">(readCounterMode);
  const [formatBarVisible, setFormatBarVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FORMAT_BAR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [openFormatMenu, setOpenFormatMenu] = useState<"heading" | "format" | "list" | null>(null);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [confirmPermanent, setConfirmPermanent] = useState<NoteEntry | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const browseInputRef = useRef<HTMLInputElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const serializeTimer = useRef<number | null>(null);
  const serverUpdatedAt = useRef<number>(0);
  const backStack = useRef<string[]>([]);
  const forwardStack = useRef<string[]>([]);
  const lastReportedSize = useRef<string>("");
  const renderingRef = useRef(false);
  const savedRange = useRef<Range | null>(null);

  const showToast = useCallback((title: string, message?: string) => {
    toastStore.open({ id: `notes-${Date.now()}`, title, message, variant: "success" });
  }, []);

  // The editor flushes 300 ms after the last change (the confirmed debounce); a conflict is
  // resolved last-write-wins by replaying against the server's fresh updatedAt.
  const flushSave = useCallback((entry: NoteEntry) => {
    void ipc
      .backend("notes.update", { id: entry.id, text: entry.text, expectedUpdatedAt: serverUpdatedAt.current }, { module: "backend" })
      .then((response) => {
        const result = response as { result: string; note: NoteEntry };
        if (result.result === "conflict") {
          return ipc
            .backend("notes.update", { id: entry.id, text: entry.text, expectedUpdatedAt: result.note.updatedAt }, { module: "backend" })
            .then((retry) => {
              serverUpdatedAt.current = ((retry as { note: NoteEntry }).note).updatedAt;
              return null;
            });
        }
        serverUpdatedAt.current = result.note.updatedAt;
        return null;
      })
      .catch(() => undefined);
  }, []);

  const renderEditor = useCallback((entry: NoteEntry) => {
    void ipc
      .backend("notes.markdownToHtml", { text: entry.text }, { module: "backend" })
      .then((response) => {
        const editor = editorRef.current;
        if (!editor || note?.id !== entry.id) return;
        const html = (response as { html: string }).html;
        renderingRef.current = true;
        editor.innerHTML = html || "<p><br></p>";
        renderingRef.current = false;
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      })
      .catch(() => undefined);
    // `note` is captured only to drop stale renders after a note switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  /** Serializes the DOM back to markdown and schedules the save (called after every input). */
  const serializeSoon = useCallback(
    (id: string) => {
      if (serializeTimer.current !== null) window.clearTimeout(serializeTimer.current);
      serializeTimer.current = window.setTimeout(() => {
        const editor = editorRef.current;
        if (!editor) return;
        void ipc
          .backend("notes.htmlToMarkdown", { html: editor.innerHTML }, { module: "backend" })
          .then((response) => {
            const text = (response as { text: string }).text;
            setNote((previous) => {
              if (!previous || previous.id !== id) return previous;
              const next = { ...previous, text, title: firstLineTitle(text) };
              flushSave(next);
              return next;
            });
          })
          .catch(() => undefined);
      }, 300);
    },
    [flushSave],
  );

  const loadNote = useCallback(
    (id: string) => {
      void ipc
        .backend("notes.getWindowData", { noteId: id }, { module: "backend" })
        .then((response) => {
          const payload = (response as { currentNote: NoteEntry | null }).currentNote;
          if (!payload) return;
          setNote(payload);
          serverUpdatedAt.current = payload.updatedAt;
          renderEditor(payload);
        })
        .catch(() => undefined);
    },
    [renderEditor],
  );

  // Boot: preferences, then the window's current note (the confirmed `getCurrentWindowData`).
  useEffect(() => {
    let cancelled = false;
    void ipc
      .backend("notes.getPreferences", {}, { module: "backend" })
      .then((response) => {
        if (cancelled) return;
        const payload = response as NotesPreferences;
        setPrefs({
          zoom: payload.zoom ?? 1,
          escapeKeyBehavior: payload.escapeKeyBehavior ?? "closesWindow",
          windowAutoSizing: payload.windowAutoSizing ?? true,
        });
      })
      .catch(() => undefined);
    void ipc
      .backend("notes.getCurrentWindowData", {}, { module: "backend" })
      .then((response) => {
        if (cancelled) return;
        const payload = (response as { currentNote: NoteEntry | null }).currentNote;
        if (payload) {
          setNote(payload);
          serverUpdatedAt.current = payload.updatedAt;
          renderEditor(payload);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [renderEditor]);

  // The host opens a specific note (or a fresh one) — the confirmed `showNotesWindow({noteId})`
  // and the `create` command with its fallback text.
  useEffect(() => {
    return onNotification("notes.openNote", (raw) => {
      const payload = raw as { noteId?: string | null; create?: boolean; text?: string } | null;
      if (!payload) return;
      if (payload.create) {
        void ipc
          .backend("notes.create", { text: payload.text ?? "" }, { module: "backend" })
          .then((response) => {
            const created = (response as { note: NoteEntry }).note;
            setNote(created);
            serverUpdatedAt.current = created.updatedAt;
            renderEditor(created);
            editorRef.current?.focus();
          })
          .catch(() => undefined);
        return;
      }
      if (payload.noteId) {
        setNote((previous) => {
          if (previous) {
            backStack.current.push(previous.id);
            forwardStack.current = [];
          }
          return previous;
        });
        loadNote(payload.noteId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadNote]);

  const refreshLists = useCallback(() => {
    void ipc
      .backend("notes.list", {}, { module: "backend" })
      .then((response) => setAllNotes((response as { notes: NoteEntry[] }).notes ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshLists();
    return onNotification("notes.updated", refreshLists);
  }, [refreshLists]);

  const loadTrash = useCallback(() => {
    void ipc
      .backend("notes.listDeleted", {}, { module: "backend" })
      .then((response) => setTrashNotes((response as { notes: NoteEntry[] }).notes ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (trashOpen) loadTrash();
  }, [trashOpen, loadTrash]);

  // ---- formatting (execCommand over the contentEditable) --------------------------------------

  const withEditorSelection = useCallback((run: () => void) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    if (savedRange.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange.current);
    }
    run();
    savedRange.current = null;
    if (note) serializeSoon(note.id);
  }, [note, serializeSoon]);

  const exec = useCallback(
    (command: string, value?: string) => {
      withEditorSelection(() => document.execCommand(command, false, value));
      setOpenFormatMenu(null);
    },
    [withEditorSelection],
  );

  const wrapInline = useCallback(
    (html: string) => {
      withEditorSelection(() => {
        const selection = window.getSelection();
        const selected = selection && !selection.isCollapsed ? escapeHtml(selection.toString()) : "";
        document.execCommand("insertHTML", false, html.replace("$", selected));
      });
      setOpenFormatMenu(null);
    },
    [withEditorSelection],
  );

  const openLinkPopover = useCallback(() => {
    const selection = window.getSelection();
    savedRange.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinkUrl("https://");
    setLinkPopoverOpen(true);
    setOpenFormatMenu(null);
    window.setTimeout(() => linkInputRef.current?.focus(), 0);
  }, []);

  const applyLink = useCallback(() => {
    if (!linkUrl.trim() || linkUrl.trim() === "https://") {
      setLinkPopoverOpen(false);
      return;
    }
    withEditorSelection(() => document.execCommand("createLink", false, linkUrl.trim()));
    setLinkPopoverOpen(false);
  }, [linkUrl, withEditorSelection]);

  // Markdown-style input rules: `# `, `- `, `1. `, `> ` at the start of a block convert.
  const onEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== " ") return;
      const editor = editorRef.current;
      if (!editor) return;
      const block = blockAtCaret(editor);
      if (!block) return;
      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);
      if (!block || !range) return;
      const probe = range.cloneRange();
      probe.selectNodeContents(block);
      probe.setEnd(range.startContainer, range.startOffset);
      const before = probe.toString();
      const rule = /^(#{1,6}|-|\*|1\.|>|- \[ \]|\[ \])$/.exec(before.trim());
      if (!rule) return;
      event.preventDefault();
      const marker = rule[1];
      block.innerHTML = "";
      const apply = () => {
        if (/^#{1,6}$/.test(marker)) {
          document.execCommand("formatBlock", false, `<h${marker.length}>`);
        } else if (marker === ">" ) {
          document.execCommand("formatBlock", false, "<blockquote>");
        } else if (marker === "1.") {
          document.execCommand("insertOrderedList");
        } else {
          document.execCommand("insertUnorderedList");
        }
      };
      apply();
      if (note) serializeSoon(note.id);
    },
    [note, serializeSoon],
  );

  const onEditorPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      void ipc
        .backend("notes.markdownToHtml", { text }, { module: "backend" })
        .then((response) => {
          const html = (response as { html: string }).html;
          document.execCommand("insertHTML", false, html);
          if (note) serializeSoon(note.id);
        })
        .catch(() => {
          document.execCommand("insertText", false, text);
        });
    },
    [note, serializeSoon],
  );

  // ---- window auto-sizing --------------------------------------------------------------------

  useEffect(() => {
    if (!prefs?.windowAutoSizing) return;
    const report = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const natural = editor.scrollHeight + 38 + 34 + (findOpen ? 44 : 0);
      const key = `${Math.round(natural)}:${panelOpen}`;
      if (key === lastReportedSize.current) return;
      lastReportedSize.current = key;
      void ipcRequest("notes.setSize", { height: natural, panelOpen }, { module: "frontend" }).catch(() => undefined);
    };
    report();
    const interval = window.setInterval(report, 300);
    return () => window.clearInterval(interval);
  }, [prefs?.windowAutoSizing, panelOpen, findOpen, note?.id, note?.text]);

  // ---- find bar ------------------------------------------------------------------------------

  const editorText = note?.text ?? "";

  const matches = useMemo(() => {
    if (!findQuery.trim()) return [] as number[];
    const haystack = editorText.toLowerCase();
    const needle = findQuery.trim().toLowerCase();
    const found: number[] = [];
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      found.push(index);
      index = haystack.indexOf(needle, index + needle.length);
    }
    return found;
  }, [editorText, findQuery]);

  /** Selects the nth occurrence of the find query inside the contentEditable via DOM ranges. */
  const selectOccurrence = useCallback(
    (index: number) => {
      const editor = editorRef.current;
      if (!editor || matches.length === 0) return;
      const wrapped = ((index % matches.length) + matches.length) % matches.length;
      setMatchIndex(wrapped);
      const needle = findQuery.trim().toLowerCase();
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let occurrence = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const value = (node.nodeValue ?? "").toLowerCase();
        let at = value.indexOf(needle);
        while (at !== -1) {
          if (occurrence === wrapped) {
            const selection = window.getSelection();
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + needle.length);
            selection?.removeAllRanges();
            selection?.addRange(range);
            const rect = range.getBoundingClientRect();
            if (rect.height > 0) {
              const containerRect = editor.getBoundingClientRect();
              editor.scrollTop += rect.top - containerRect.top - containerRect.height / 2;
            }
            return;
          }
          occurrence += 1;
          at = value.indexOf(needle, at + needle.length);
        }
      }
    },
    [matches, findQuery],
  );

  const replaceCurrent = useCallback(() => {
    if (!note || matches.length === 0) return;
    const start = matches[Math.min(matchIndex, matches.length - 1)];
    const end = start + findQuery.trim().length;
    const next = note.text.slice(0, start) + replaceText + note.text.slice(end);
    const updated = { ...note, text: next, title: firstLineTitle(next) };
    setNote(updated);
    flushSave(updated);
    renderEditor(updated);
    setMatchIndex(Math.max(0, Math.min(matchIndex, matches.length - 2)));
  }, [note, matches, matchIndex, findQuery, replaceText, flushSave, renderEditor]);

  const replaceAll = useCallback(() => {
    if (!note || !findQuery.trim()) return;
    const parts = note.text.split(findQuery.trim());
    const next = parts.join(replaceText);
    const updated = { ...note, text: next, title: firstLineTitle(next) };
    setNote(updated);
    flushSave(updated);
    renderEditor(updated);
  }, [note, findQuery, replaceText, flushSave, renderEditor]);

  const openFind = useCallback(() => {
    setFindOpen(true);
    setMatchIndex(0);
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      setFindQuery(selection.toString());
    }
    window.setTimeout(() => findInputRef.current?.focus(), 0);
  }, []);

  // ---- note operations -----------------------------------------------------------------------

  const openNoteId = useCallback(
    (id: string) => {
      setNote((previous) => {
        if (previous && previous.id !== id) {
          backStack.current.push(previous.id);
          forwardStack.current = [];
        }
        return previous;
      });
      setBrowseOpen(false);
      loadNote(id);
    },
    [loadNote],
  );

  const goBack = useCallback(() => {
    const id = backStack.current.pop();
    if (!id) return;
    setNote((previous) => {
      if (previous) forwardStack.current.push(previous.id);
      return previous;
    });
    loadNote(id);
  }, [loadNote]);

  const goForward = useCallback(() => {
    const id = forwardStack.current.pop();
    if (!id) return;
    setNote((previous) => {
      if (previous) backStack.current.push(previous.id);
      return previous;
    });
    loadNote(id);
  }, [loadNote]);

  const newNote = useCallback(() => {
    void ipc
      .backend("notes.create", { text: "" }, { module: "backend" })
      .then((response) => {
        const created = (response as { note: NoteEntry }).note;
        setNote((previous) => {
          if (previous) backStack.current.push(previous.id);
          return previous;
        });
        forwardStack.current = [];
        setNote(created);
        serverUpdatedAt.current = created.updatedAt;
        setBrowseOpen(false);
        renderEditor(created);
        editorRef.current?.focus();
      })
      .catch(() => undefined);
  }, [renderEditor]);

  const duplicateNote = useCallback(() => {
    if (!note) return;
    void ipc
      .backend("notes.create", { text: note.text, title: `${note.title} (Copy)` }, { module: "backend" })
      .then(() => showToast("Duplicated Note"))
      .catch(() => showToast("Could not duplicate note"));
  }, [note, showToast]);

  const pinCurrent = useCallback(
    (pinned: boolean) => {
      if (!note) return;
      void ipc
        .backend(pinned ? "notes.pin" : "notes.unpin", { id: note.id }, { module: "backend" })
        .then(() => {
          showToast(pinned ? "Pinned Note" : "Unpinned Note");
          return ipc.backend("notes.getOne", { id: note.id }, { module: "backend" });
        })
        .then((response) => {
          const updated = (response as { note: NoteEntry | null }).note;
          if (updated) setNote((previous) => (previous && previous.id === updated.id ? updated : previous));
        })
        .catch(() => showToast(pinned ? "Could not pin note" : "Could not unpin note"));
    },
    [note, showToast],
  );

  const deleteCurrent = useCallback(() => {
    if (!note) return;
    void ipc
      .backend("notes.delete", { id: note.id }, { module: "backend" })
      .then(() => {
        showToast("Note moved to Recently Deleted");
        backStack.current = [];
        forwardStack.current = [];
        return ipc.backend("notes.getCurrentWindowData", {}, { module: "backend" });
      })
      .then((response) => {
        const payload = (response as { currentNote: NoteEntry | null }).currentNote;
        setNote(payload);
        serverUpdatedAt.current = payload?.updatedAt ?? 0;
        if (payload) renderEditor(payload);
      })
      .catch(() => showToast("Could not delete note"));
  }, [note, renderEditor, showToast]);

  const copyAs = useCallback(
    async (format: "markdown" | "html" | "plain") => {
      if (!note) return;
      try {
        let content = note.text;
        if (format === "html") {
          content = ((await ipc.backend("notes.markdownToHtml", { text: note.text }, { module: "backend" })) as { html: string }).html;
        } else if (format === "plain") {
          content = ((await ipc.backend("notes.toPlainText", { text: note.text }, { module: "backend" })) as { text: string }).text;
        }
        await navigator.clipboard.writeText(content);
        showToast(format === "markdown" ? "Copied as Markdown" : format === "html" ? "Copied as HTML" : "Copied as Plain Text");
      } catch {
        showToast("Copy failed");
      }
    },
    [note, showToast],
  );

  const exportAs = useCallback(
    async (format: "md" | "html" | "txt") => {
      if (!note) return;
      try {
        let content = note.text;
        if (format === "html") {
          content = ((await ipc.backend("notes.markdownToHtml", { text: note.text }, { module: "backend" })) as { html: string }).html;
        } else if (format === "txt") {
          content = ((await ipc.backend("notes.toPlainText", { text: note.text }, { module: "backend" })) as { text: string }).text;
        }
        const response = (await ipcRequest(
          "fileSystem.showSaveFileDialog",
          { title: "Export Note", fileName: `${note.title}.${format}` },
          { module: "frontend" },
        )) as { path?: string | null };
        if (!response.path) return;
        await ipcRequest("fileSystem.writeFile", { path: response.path, content }, { module: "frontend" });
        showToast(`Exported as ${format === "md" ? "Markdown" : format === "html" ? "HTML" : "Plain Text"}`);
      } catch (cause) {
        showToast("Export failed", cause instanceof Error ? cause.message : String(cause));
      }
    },
    [note, showToast],
  );

  const setZoom = useCallback(
    (next: number, toast: string | null) => {
      void ipc
        .backend("notes.setPreference", { key: "zoom", value: next }, { module: "backend" })
        .then(() => {
          setPrefs((previous) => (previous ? { ...previous, zoom: next } : previous));
          if (toast) showToast(toast, `${Math.round(next * 100)}%`);
        })
        .catch(() => undefined);
    },
    [showToast],
  );

  const setAutoSizing = useCallback(
    (enabled: boolean) => {
      void ipc
        .backend("notes.setPreference", { key: "windowAutoSizing", value: enabled }, { module: "backend" })
        .then(() => {
          setPrefs((previous) => (previous ? { ...previous, windowAutoSizing: enabled } : previous));
          showToast(enabled ? "Window Auto-Sizing enabled" : "Window Auto-Sizing disabled");
        })
        .catch(() => undefined);
    },
    [showToast],
  );

  const toggleFormatBar = useCallback(() => {
    setFormatBarVisible((previous) => {
      const next = !previous;
      writePersisted(FORMAT_BAR_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const createQuicklink = useCallback(() => {
    if (!note) return;
    void ipcRequest(
      "window.showQuicklinkCreate",
      { link: noteDeeplink(note.id), name: note.title },
      { module: "frontend" },
    ).catch(() => undefined);
  }, [note]);

  // ---- keyboard ------------------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (linkPopoverOpen) return;
      if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPanelOpen((open) => !open);
        return;
      }
      if (event.key.toLowerCase() === "f" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        openFind();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmPermanent) {
          setConfirmPermanent(null);
          return;
        }
        if (panelOpen) {
          setPanelOpen(false);
          return;
        }
        if (openFormatMenu || linkPopoverOpen) {
          setOpenFormatMenu(null);
          setLinkPopoverOpen(false);
          return;
        }
        if (browseOpen || trashOpen) {
          setBrowseOpen(false);
          setTrashOpen(false);
          return;
        }
        if (findOpen) {
          setFindOpen(false);
          setReplaceOpen(false);
          return;
        }
        if (prefs?.escapeKeyBehavior === "losesFocus") {
          (document.activeElement as HTMLElement | null)?.blur?.();
          return;
        }
        void ipcRequest("window.hideNotes", {}, { module: "frontend" }).catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen, browseOpen, trashOpen, findOpen, openFormatMenu, linkPopoverOpen, prefs?.escapeKeyBehavior, confirmPermanent, openFind]);

  // ---- action panel --------------------------------------------------------------------------

  const actionGroups = useMemo<ActionGroup[]>(() => {
    return [
      {
        name: "general",
        actions: [
          { id: "notes:new", title: "New Note", itemId: "" },
          { id: "notes:duplicate", title: "Duplicate Note", itemId: "" },
          note?.pinned === null || note?.pinned === undefined
            ? { id: "notes:pin", title: "Pin Note", itemId: "" }
            : { id: "notes:unpin", title: "Unpin Note", itemId: "" },
          { id: "notes:browse", title: "Browse Notes", itemId: "" },
          { id: "notes:back", title: "Go Back", itemId: "" },
          { id: "notes:forward", title: "Go Forward", itemId: "" },
          { id: "notes:find", title: "Find in Note", itemId: "" },
        ],
      },
      {
        name: "copy",
        actions: [
          { id: "notes:copyMarkdown", title: "Copy as Markdown", itemId: "" },
          { id: "notes:copyHtml", title: "Copy as HTML", itemId: "" },
          { id: "notes:copyPlainText", title: "Copy as Plain Text", itemId: "" },
          { id: "notes:copyDeeplink", title: "Copy Deeplink", itemId: "" },
          { id: "notes:createQuicklink", title: "Create Quicklink", itemId: "" },
          { id: "notes:exportMarkdown", title: "Export as Markdown", itemId: "" },
          { id: "notes:exportHtml", title: "Export as HTML", itemId: "" },
          { id: "notes:exportPlainText", title: "Export as Plain Text", itemId: "" },
        ],
      },
      {
        name: "window",
        actions: [
          { id: "notes:formatBar", title: formatBarVisible ? "Hide Format Buttons" : "Show Format Buttons", itemId: "" },
          {
            id: "notes:autoSizing",
            title: prefs?.windowAutoSizing ? "Disable Window Auto-Sizing" : "Enable Window Auto-Sizing",
            itemId: "",
          },
          { id: "notes:zoomReset", title: "Reset Zoom", itemId: "" },
          { id: "notes:zoomIn", title: "Zoom In", itemId: "" },
          { id: "notes:zoomOut", title: "Zoom Out", itemId: "" },
          { id: "notes:settings", title: "Open Raycast Notes Settings", itemId: "" },
        ],
      },
      {
        name: "trash",
        actions: [
          { id: "notes:recentlyDeleted", title: "Show Recently Deleted Notes", itemId: "" },
          { id: "notes:delete", title: "Delete Note", itemId: "" },
        ],
      },
    ];
  }, [note?.pinned, prefs?.windowAutoSizing, formatBarVisible]);

  const runAction = useCallback(
    (actionId: string) => {
      setPanelOpen(false);
      switch (actionId) {
        case "notes:new":
          newNote();
          return;
        case "notes:duplicate":
          duplicateNote();
          return;
        case "notes:pin":
          pinCurrent(true);
          return;
        case "notes:unpin":
          pinCurrent(false);
          return;
        case "notes:browse":
          setBrowseOpen(true);
          window.setTimeout(() => browseInputRef.current?.focus(), 0);
          return;
        case "notes:back":
          goBack();
          return;
        case "notes:forward":
          goForward();
          return;
        case "notes:find":
          openFind();
          return;
        case "notes:copyMarkdown":
          void copyAs("markdown");
          return;
        case "notes:copyHtml":
          void copyAs("html");
          return;
        case "notes:copyPlainText":
          void copyAs("plain");
          return;
        case "notes:copyDeeplink":
          if (note) {
            void navigator.clipboard.writeText(noteDeeplink(note.id)).then(() => showToast("Copied Deeplink"));
          }
          return;
        case "notes:createQuicklink":
          createQuicklink();
          return;
        case "notes:exportMarkdown":
          void exportAs("md");
          return;
        case "notes:exportHtml":
          void exportAs("html");
          return;
        case "notes:exportPlainText":
          void exportAs("txt");
          return;
        case "notes:formatBar":
          toggleFormatBar();
          return;
        case "notes:autoSizing":
          setAutoSizing(!prefs?.windowAutoSizing);
          return;
        case "notes:zoomReset":
          setZoom(1, "Zoom reset to default");
          return;
        case "notes:zoomIn":
          setZoom(Math.min(2, Math.round(((prefs?.zoom ?? 1) + 0.05) * 100) / 100), "Zoomed to");
          return;
        case "notes:zoomOut":
          setZoom(Math.max(0.75, Math.round(((prefs?.zoom ?? 1) - 0.05) * 100) / 100), "Zoomed to");
          return;
        case "notes:settings":
          void ipcRequest("window.openSettings", {}, { module: "frontend" }).catch(() => undefined);
          return;
        case "notes:recentlyDeleted":
          setTrashOpen(true);
          return;
        case "notes:delete":
          deleteCurrent();
          return;
        default:
          return;
      }
    },
    [
      newNote,
      duplicateNote,
      pinCurrent,
      goBack,
      goForward,
      openFind,
      copyAs,
      note,
      createQuicklink,
      exportAs,
      toggleFormatBar,
      setAutoSizing,
      prefs?.windowAutoSizing,
      prefs?.zoom,
      setZoom,
      deleteCurrent,
      showToast,
    ],
  );

  // ---- browse / trash views ------------------------------------------------------------------

  const browseFiltered = useMemo(() => {
    const query = browseQuery.trim().toLowerCase();
    const matching = query
      ? allNotes.filter((entry) => `${entry.title}\n${entry.text}`.toLowerCase().includes(query))
      : allNotes;
    return {
      pinned: matching.filter((entry) => entry.pinned !== null),
      rest: matching.filter((entry) => entry.pinned === null),
    };
  }, [allNotes, browseQuery]);

  const trashFiltered = useMemo(() => {
    const query = trashQuery.trim().toLowerCase();
    return query ? trashNotes.filter((entry) => `${entry.title}\n${entry.text}`.toLowerCase().includes(query)) : trashNotes;
  }, [trashNotes, trashQuery]);

  const title = note ? firstLineTitle(note.text) : UNTITLED;
  const words = countWords(note?.text ?? "");
  const characters = note?.text.length ?? 0;

  return (
    <div className="notes-root" ref={rootRef}>
      <header
        className="notes-topbar"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          postToHost({ type: "notes:drag" });
        }}
      >
        <span className="notes-topbar__cluster">
          <button type="button" className="notes-icon-button" onClick={() => setPanelOpen((open) => !open)} title="Action Panel (Ctrl K)" aria-label="Action Panel">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11-7.2c.6-.4.6-1.4 0-1.8l-11-7.2c-.7-.4-1.6.1-1.6.9z" />
            </svg>
          </button>
          <button
            type="button"
            className="notes-icon-button"
            onClick={() => {
              setBrowseOpen(true);
              window.setTimeout(() => browseInputRef.current?.focus(), 0);
            }}
            title="Browse Notes (Ctrl P)"
            aria-label="Browse Notes"
          >
            <RaycastIcon name="folder-search" size={15} />
          </button>
          <button type="button" className="notes-icon-button" onClick={newNote} title="Create Note (Ctrl N)" aria-label="Create Note">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </span>
        <span className="notes-topbar__title" title={title}>
          {title}
        </span>
        <span className="notes-topbar__cluster notes-topbar__cluster--right">
          <button
            type="button"
            className="notes-icon-button"
            onClick={() => void ipcRequest("window.hideNotes", {}, { module: "frontend" }).catch(() => undefined)}
            title="Close"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      </header>

      {findOpen ? (
        <div className="notes-findbar">
          <div className="notes-findbar__row">
            <input
              ref={findInputRef}
              className="notes-findbar__input"
              placeholder="Find"
              value={findQuery}
              onChange={(event) => {
                setFindQuery(event.target.value);
                setMatchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  selectOccurrence(event.shiftKey ? matchIndex - 1 : matchIndex + 1);
                }
              }}
            />
            <span className="notes-findbar__counter">
              {matches.length === 0 ? "0/0" : `${matchIndex + 1}/${matches.length}`}
            </span>
            <button type="button" className="notes-icon-button" onClick={() => selectOccurrence(matchIndex - 1)} aria-label="Previous match">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="notes-icon-button" onClick={() => selectOccurrence(matchIndex + 1)} aria-label="Next match">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="notes-icon-button"
              data-active={replaceOpen || undefined}
              onClick={() => setReplaceOpen((open) => !open)}
              aria-label="Toggle replace"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {replaceOpen ? (
            <div className="notes-findbar__row">
              <input
                className="notes-findbar__input"
                placeholder="Replace with"
                value={replaceText}
                onChange={(event) => setReplaceText(event.target.value)}
              />
              <button type="button" className="notes-findbar__button" onClick={replaceCurrent}>
                Replace
              </button>
              <button type="button" className="notes-findbar__button" onClick={replaceAll}>
                Replace All
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <main className="notes-editor-wrap">
        <div
          ref={editorRef}
          className="notes-editor"
          style={{ fontSize: `${14 * (prefs?.zoom ?? 1)}px` }}
          contentEditable
          suppressContentEditableWarning
          data-placeholder={note ? "Start writing…" : ""}
          onInput={() => note && serializeSoon(note.id)}
          onKeyDown={onEditorKeyDown}
          onPaste={onEditorPaste}
          onMouseUp={(event) => {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
              savedRange.current = selection.getRangeAt(0).cloneRange();
            } else if (event.target === editorRef.current) {
              savedRange.current = null;
            }
          }}
          spellCheck={false}
        />
      </main>

      <footer className="notes-bottombar">
        {formatBarVisible ? (
          <span className="notes-formatbar">
            <button type="button" className="notes-format-button" onClick={() => setOpenFormatMenu(openFormatMenu === "heading" ? null : "heading")} title="Heading">
              H <span className="notes-format-caret">⌄</span>
            </button>
            <button type="button" className="notes-format-button" onClick={() => setOpenFormatMenu(openFormatMenu === "format" ? null : "format")} title="Format">
              <span style={{ fontStyle: "italic" }}>I</span> <span className="notes-format-caret">⌄</span>
            </button>
            <button type="button" className="notes-format-button" onClick={openLinkPopover} title="Link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" strokeLinecap="round" />
                <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" strokeLinecap="round" />
              </svg>
            </button>
            <button type="button" className="notes-format-button" onClick={() => wrapInline("<code>$</code>")} title="Inline Code">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="notes-format-button" onClick={() => exec("formatBlock", "<pre>")} title="Code Block">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M8 9l-2 3 2 3M16 9l2 3-2 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="notes-format-button" onClick={() => wrapInline('<ul data-type="taskList"><li data-checked="false">$</li></ul>')} title="Task List">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6l2 2 3-3M3 15l2 2 3-3M12 7h9M12 17h9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="notes-format-button" onClick={() => setOpenFormatMenu(openFormatMenu === "list" ? null : "list")} title="List">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeLinecap="round" />
              </svg>
              <span className="notes-format-caret">⌄</span>
            </button>

            {openFormatMenu === "heading" ? (
              <div className="notes-format-menu" role="menu">
                {[
                  { label: "Paragraph", value: "p" },
                  { label: "Heading 1", value: "h1" },
                  { label: "Heading 2", value: "h2" },
                  { label: "Heading 3", value: "h3" },
                  { label: "Blockquote", value: "blockquote" },
                ].map((item) => (
                  <button key={item.value} type="button" className="notes-format-menu__item" onClick={() => exec("formatBlock", `<${item.value}>`)}>
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            {openFormatMenu === "format" ? (
              <div className="notes-format-menu" role="menu">
                <button type="button" className="notes-format-menu__item" onClick={() => exec("bold")}>
                  Bold
                </button>
                <button type="button" className="notes-format-menu__item" onClick={() => exec("italic")}>
                  Italic
                </button>
                <button type="button" className="notes-format-menu__item" onClick={() => exec("underline")}>
                  Underline
                </button>
                <button type="button" className="notes-format-menu__item" onClick={() => exec("strikeThrough")}>
                  Strikethrough
                </button>
              </div>
            ) : null}
            {openFormatMenu === "list" ? (
              <div className="notes-format-menu" role="menu">
                <button type="button" className="notes-format-menu__item" onClick={() => exec("insertUnorderedList")}>
                  Bullet List
                </button>
                <button type="button" className="notes-format-menu__item" onClick={() => exec("insertOrderedList")}>
                  Ordered List
                </button>
              </div>
            ) : null}

            {linkPopoverOpen ? (
              <div className="notes-format-menu notes-format-menu--link">
                <input
                  ref={linkInputRef}
                  className="notes-findbar__input"
                  placeholder="Paste a link…"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyLink();
                    }
                  }}
                />
                <button type="button" className="notes-findbar__button" onClick={applyLink}>
                  Insert
                </button>
              </div>
            ) : null}
          </span>
        ) : null}
        <span className="notes-bottombar__spacer" />
        <button
          type="button"
          className="notes-bottombar__counter"
          onClick={() => {
            const next = counterMode === "words" ? "characters" : "words";
            setCounterMode(next);
            writePersisted(COUNTER_MODE_KEY, next);
          }}
          title="Toggle counter"
        >
          {counterMode === "words" ? `${words} words` : `${characters} characters`}
        </button>
        <button
          type="button"
          className="notes-icon-button"
          onClick={toggleFormatBar}
          title={formatBarVisible ? "Hide Format Buttons" : "Show Format Buttons"}
          aria-label="Toggle format buttons"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 9l6 6M15 9l-6 6" strokeLinecap="round" />
          </svg>
        </button>
      </footer>

      {browseOpen ? (
        <div className="notes-overlay" role="dialog" aria-label="Browse Notes">
          <div className="notes-overlay__panel">
            <input
              ref={browseInputRef}
              className="notes-overlay__search"
              placeholder="Search for notes…"
              value={browseQuery}
              onChange={(event) => setBrowseQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const first = [...browseFiltered.pinned, ...browseFiltered.rest][0];
                  if (first) openNoteId(first.id);
                }
              }}
            />
            <ul className="notes-overlay__list">
              {browseFiltered.pinned.length > 0 ? <li className="notes-overlay__section">Pinned</li> : null}
              {browseFiltered.pinned.map((entry) => (
                <BrowseRow key={entry.id} entry={entry} currentId={note?.id ?? null} onOpen={openNoteId} showToast={showToast} onRefresh={refreshLists} />
              ))}
              {browseFiltered.pinned.length > 0 && browseFiltered.rest.length > 0 ? (
                <li className="notes-overlay__section">Notes</li>
              ) : null}
              {browseFiltered.rest.map((entry) => (
                <BrowseRow key={entry.id} entry={entry} currentId={note?.id ?? null} onOpen={openNoteId} showToast={showToast} onRefresh={refreshLists} />
              ))}
              {browseFiltered.pinned.length === 0 && browseFiltered.rest.length === 0 ? (
                <li className="notes-overlay__empty">No notes found</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {trashOpen ? (
        <div className="notes-overlay" role="dialog" aria-label="Recently Deleted">
          <div className="notes-overlay__panel notes-overlay__panel--wide">
            <div className="notes-overlay__banner">Notes in Recently Deleted will be permanently removed after 60 days.</div>
            <input
              className="notes-overlay__search"
              placeholder="Search for deleted notes…"
              value={trashQuery}
              onChange={(event) => setTrashQuery(event.target.value)}
            />
            <ul className="notes-overlay__list">
              {trashFiltered.map((entry) => (
                <li key={entry.id} className="notes-overlay__row">
                  <button type="button" className="notes-overlay__main" onClick={() => undefined} disabled>
                    <span className="notes-overlay__title">{entry.title}</span>
                    <span className="notes-overlay__subtitle">
                      Deleted {formatDate(entry.deletedAt ?? entry.updatedAt)} • {entry.charCount} characters
                    </span>
                  </button>
                  <span className="notes-overlay__actions">
                    <button
                      type="button"
                      className="notes-overlay__action"
                      onClick={() => {
                        void ipc
                          .backend("notes.recoverNote", { id: entry.id }, { module: "backend" })
                          .then(() => {
                            showToast("Note Recovered");
                            loadTrash();
                            refreshLists();
                          })
                          .catch(() => showToast("Could not recover note"));
                      }}
                    >
                      Restore note
                    </button>
                    <button type="button" className="notes-overlay__action notes-overlay__action--danger" onClick={() => setConfirmPermanent(entry)}>
                      Permanently delete
                    </button>
                  </span>
                </li>
              ))}
              {trashFiltered.length === 0 ? <li className="notes-overlay__empty">Recently Deleted is empty</li> : null}
            </ul>
            <div className="notes-overlay__footer">
              <button
                type="button"
                className="notes-findbar__button"
                onClick={() => {
                  void ipc
                    .backend("notes.emptyTrash", {}, { module: "backend" })
                    .then(() => {
                      loadTrash();
                      refreshLists();
                    })
                    .catch(() => undefined);
                }}
              >
                Empty Trash
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmPermanent ? (
        <div className="notes-overlay" role="alertdialog" aria-label="Permanently Delete Note?">
          <div className="notes-overlay__panel notes-overlay__panel--dialog">
            <div className="notes-overlay__confirm-title">Permanently Delete Note?</div>
            <div className="notes-overlay__confirm-body">This note will be permanently deleted. This action cannot be undone.</div>
            <div className="notes-overlay__confirm-actions">
              <button type="button" className="notes-findbar__button" onClick={() => setConfirmPermanent(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="notes-findbar__button notes-findbar__button--danger"
                onClick={() => {
                  const entry = confirmPermanent;
                  setConfirmPermanent(null);
                  void ipc
                    .backend("notes.permanentlyDelete", { id: entry.id }, { module: "backend" })
                    .then(() => {
                      showToast("Permanently deleted note");
                      loadTrash();
                      refreshLists();
                    })
                    .catch(() => showToast("Could not delete note"));
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ActionPanel
        open={panelOpen}
        title="Notes"
        groups={actionGroups}
        onClose={() => setPanelOpen(false)}
        onRun={(action) => runAction(action.id)}
      />
      <AlertHost />
    </div>
  );
}

/** One Browse Notes row: the confirmed subtitle, hover Pin/Unpin and Delete actions. */
function BrowseRow({
  entry,
  currentId,
  onOpen,
  showToast,
  onRefresh,
}: {
  entry: NoteEntry;
  currentId: string | null;
  showToast: (title: string, message?: string) => void;
  onRefresh: () => void;
  onOpen: (id: string) => void;
}) {
  const subtitle =
    entry.id === currentId
      ? `Current • ${entry.charCount} characters`
      : `Opened ${relativeOpened(entry.accessedAt, Date.now())} • ${entry.charCount} characters`;
  const pinned = entry.pinned !== null;
  return (
    <li className="notes-overlay__row">
      <button type="button" className="notes-overlay__main" onClick={() => onOpen(entry.id)}>
        <span className="notes-overlay__title">{entry.title}</span>
        <span className="notes-overlay__subtitle">{subtitle}</span>
      </button>
      <span className="notes-overlay__actions">
        <button
          type="button"
          className="notes-overlay__action"
          onClick={() => {
            void ipc
              .backend(pinned ? "notes.unpin" : "notes.pin", { id: entry.id }, { module: "backend" })
              .then(() => {
                showToast(pinned ? "Unpinned Note" : "Pinned Note");
                onRefresh();
              })
              .catch(() => showToast(pinned ? "Could not unpin note" : "Could not pin note"));
          }}
        >
          {pinned ? "Unpin" : "Pin"}
        </button>
        <button
          type="button"
          className="notes-overlay__action notes-overlay__action--danger"
          onClick={() => {
            void ipc
              .backend("notes.delete", { id: entry.id }, { module: "backend" })
              .then(() => {
                showToast("Note deleted");
                onRefresh();
              })
              .catch(() => showToast("Could not delete note"));
          }}
        >
          Delete
        </button>
      </span>
    </li>
  );
}
