// Persora Docs — Google Docs-inspired document editor:
// Top bar (Back, editable title, Star, Saving/Saved/Save failed + Retry, Print,
// Export PDF, Share), full formatting toolbar, and centered white page writing area.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CloudOff,
  Copy,
  Eye,
  FileDown,
  Printer,
  RefreshCw,
  Share2,
  Star,
  Users,
} from "lucide-react";
import {
  cleanDocTitle,
  renderDocPrintableHtml,
  sanitizeDocContent,
  type DocContent,
} from "../../../cloudflare/docs-rules.js";
import type { AppUser } from "../../types";
import {
  createDoc,
  docErrorMessage,
  docShareAdapter,
  getDoc,
  isDocGoneError,
  saveDocContent,
  updateDocInfo,
  type DocSummary,
} from "../../lib/docs-api";
import { DocSaver, type DocSaveState } from "../../lib/docs-sync";
import { deleteDocDraft, loadDocDraft, saveDocDraft, type DocDraftBackup } from "../../lib/docs-drafts";
import { downloadDocAsPdf } from "../../lib/docs-pdf";
import { clearDocPreviewCache } from "./DocCardPreview";
import DocFormattingToolbar from "./DocFormattingToolbar";
import { createPersoraDocExtensions } from "./docs-extensions";
import ShareTableDialog from "../table/ShareTableDialog";
import { LauncherModuleIcon } from "../launcher/LauncherIcons";
import { PersoraEmptyState } from "@/design-system";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";

const DRAFT_THROTTLE_MS = 900;

export function triggerCleanDocPrint(title: string, content: DocContent) {
  const html = renderDocPrintableHtml(title, content);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1500);
  };

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    window.print();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const runPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      window.print();
    } finally {
      cleanup();
    }
  };

  if (doc.readyState === "complete") {
    window.setTimeout(runPrint, 60);
  } else {
    iframe.onload = () => window.setTimeout(runPrint, 60);
  }
}

export function DocSaveBadge({
  state,
  onRetry,
}: {
  state: DocSaveState;
  onRetry: () => void;
}) {
  if (state.status === "saving") {
    return (
      <span className="pd-save-status is-saving" role="status" aria-live="polite">
        <Spinner className="size-3" />
        <span>Saving</span>
      </span>
    );
  }
  if (state.status === "failed" || state.status === "conflict") {
    return (
      <span className="pd-save-status is-failed" role="status" aria-live="assertive">
        <CloudOff size={13} />
        <span>Save failed</span>
        {state.status === "failed" && (
          <button type="button" className="pd-save-retry-btn" onClick={onRetry}>
            Retry
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="pd-save-status is-saved" role="status" aria-live="polite">
      <Check size={13} />
      <span>Saved</span>
    </span>
  );
}

export default function DocEditor({
  docId,
  user,
  notify,
  onClose,
  onOpen,
}: {
  docId: string;
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [summary, setSummary] = useState<DocSummary | null>(null);
  const [titleInput, setTitleInput] = useState("Untitled document");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saveState, setSaveState] = useState<DocSaveState>({
    status: "saved",
    revision: 1,
    message: null,
    lastSavedAt: null,
  });
  const [draftOffer, setDraftOffer] = useState<DocDraftBackup | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [savingCopy, setSavingCopy] = useState(false);
  const [linkTriggerNonce, setLinkTriggerNonce] = useState(0);

  const saverRef = useRef<DocSaver | null>(null);
  const contentRef = useRef<DocContent | null>(null);
  const titleRef = useRef<string>("Untitled document");
  const suppressEditorUpdateRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const permission = summary?.permission || "owner";
  const isOwner = permission === "owner" && !summary?.shared;
  const canEdit = isOwner || permission === "edit";

  const extensions = useMemo(() => createPersoraDocExtensions(), []);

  const persistDraftBackup = useCallback(() => {
    if (!canEdit) return;
    const saver = saverRef.current;
    const currentContent = contentRef.current;
    if (!saver || !currentContent) return;
    if (saver.hasUnsaved) {
      void saveDocDraft({
        docId,
        userId: user.id,
        title: titleRef.current,
        baseRevision: saver.currentRevision,
        savedAt: Date.now(),
        content: currentContent,
      });
    } else {
      void deleteDocDraft(user.id, docId);
    }
  }, [canEdit, docId, user.id]);

  const scheduleDraftBackup = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(persistDraftBackup, DRAFT_THROTTLE_MS);
  }, [persistDraftBackup]);

  const editor = useEditor({
    extensions,
    editable: canEdit,
    content: { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class: "pd-prosemirror",
        "aria-label": "Document body",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setLinkTriggerNonce((n) => n + 1);
          return true;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saverRef.current?.flush();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressEditorUpdateRef.current || !canEdit) return;
      const nextJson = sanitizeDocContent(ed.getJSON());
      contentRef.current = nextJson;
      saverRef.current?.update({
        title: titleRef.current,
        content: nextJson,
      });
      scheduleDraftBackup();
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(canEdit);
    }
  }, [editor, canEdit]);

  // Load document from backend (updates opened_at automatically via GET /api/docs/:id)
  useEffect(() => {
    if (!editor) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setDraftOffer(null);

    getDoc(docId, controller.signal)
      .then(async (detail) => {
        if (controller.signal.aborted) return;
        const safeContent = sanitizeDocContent(detail.content);
        const editable =
          (detail.permission || "owner") === "owner" || detail.permission === "edit";

        saverRef.current?.dispose();
        const saver = new DocSaver({
          revision: detail.revision,
          initial: { title: detail.title, content: safeContent },
          debounceMs: 650,
          send: (batch) => saveDocContent(docId, batch),
          onState: (nextState) => setSaveState(nextState),
          onSaved: (updatedSummary) => {
            clearDocPreviewCache(docId);
            setSummary((prev) =>
              prev ? { ...prev, ...updatedSummary } : updatedSummary,
            );
          },
        });
        saverRef.current = saver;
        contentRef.current = safeContent;
        titleRef.current = detail.title;

        suppressEditorUpdateRef.current = true;
        editor.commands.setContent(safeContent, false);
        suppressEditorUpdateRef.current = false;

        setSummary(detail);
        setTitleInput(detail.title);
        setSaveState(saver.snapshot);
        setLoading(false);

        if (editable) {
          const backup = await loadDocDraft(user.id, docId).catch(() => null);
          if (controller.signal.aborted || !backup) return;
          const sameAsServer =
            backup.title === detail.title &&
            JSON.stringify(backup.content) === JSON.stringify(safeContent);
          if (!sameAsServer) {
            setDraftOffer(backup);
          } else {
            void deleteDocDraft(user.id, docId);
          }
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setLoadError(
          isDocGoneError(error)
            ? "This document isn't available in your account. It may have been moved to Trash or unshared."
            : docErrorMessage(
                error,
                "This document couldn't be loaded. Check your connection and try again.",
              ),
        );
      });

    return () => {
      controller.abort();
    };
  }, [docId, editor, reloadKey, user.id]);

  useEffect(() => {
    return () => {
      saverRef.current?.dispose();
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!canEdit) return;
    if (saveState.status === "saved" && saverRef.current && !saverRef.current.hasUnsaved) {
      void deleteDocDraft(user.id, docId);
    } else if (saveState.status === "failed" || saveState.status === "conflict") {
      persistDraftBackup();
    }
  }, [canEdit, docId, persistDraftBackup, saveState.status, user.id]);

  // Warn before closing browser tab if edits haven't reached server yet
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saverRef.current?.hasUnsaved) {
        persistDraftBackup();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persistDraftBackup]);

  const handleBack = async () => {
    if (saverRef.current?.hasUnsaved && saveState.status !== "failed" && saveState.status !== "conflict") {
      await saverRef.current.flush().catch(() => {});
    } else if (saverRef.current?.hasUnsaved) {
      persistDraftBackup();
    }
    onClose();
  };

  const commitTitleChange = (raw: string) => {
    if (!canEdit) return;
    const cleaned = cleanDocTitle(raw, { allowEmptyDefault: true });
    setTitleInput(cleaned);
    titleRef.current = cleaned;
    setSummary((prev) => (prev ? { ...prev, title: cleaned } : prev));
    if (contentRef.current) {
      saverRef.current?.update({
        title: cleaned,
        content: contentRef.current,
      });
      scheduleDraftBackup();
    }
  };

  const toggleStar = async () => {
    if (!summary || !isOwner) return;
    const nextStarred = !summary.starred;
    setSummary({ ...summary, starred: nextStarred });
    try {
      const updated = await updateDocInfo(summary.id, { starred: nextStarred });
      setSummary((prev) => (prev ? { ...prev, starred: updated.starred } : prev));
    } catch (error) {
      setSummary((prev) => (prev ? { ...prev, starred: !nextStarred } : prev));
      notify(docErrorMessage(error, "Could not update starred status."), "error");
    }
  };

  const handlePrint = async () => {
    await saverRef.current?.flush().catch(() => {});
    const current = contentRef.current || sanitizeDocContent(editor?.getJSON());
    triggerCleanDocPrint(titleRef.current, current);
  };

  const handleExportPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      await saverRef.current?.flush().catch(() => {});
      const current = contentRef.current || sanitizeDocContent(editor?.getJSON());
      await downloadDocAsPdf(titleRef.current, current);
      notify("Exported PDF.");
    } catch (error) {
      notify(docErrorMessage(error, "Could not generate PDF."), "error");
    } finally {
      setExportingPdf(false);
    }
  };

  const restoreUnsavedBackup = () => {
    if (!draftOffer || !editor || !canEdit) return;
    const restoredContent = sanitizeDocContent(draftOffer.content);
    const restoredTitle = cleanDocTitle(draftOffer.title, { allowEmptyDefault: true });
    suppressEditorUpdateRef.current = true;
    editor.commands.setContent(restoredContent, false);
    suppressEditorUpdateRef.current = false;
    contentRef.current = restoredContent;
    titleRef.current = restoredTitle;
    setTitleInput(restoredTitle);
    setDraftOffer(null);
    saverRef.current?.update({ title: restoredTitle, content: restoredContent });
  };

  const discardUnsavedBackup = () => {
    setDraftOffer(null);
    void deleteDocDraft(user.id, docId);
  };

  const saveConflictAsCopy = async () => {
    if (savingCopy || !contentRef.current) return;
    setSavingCopy(true);
    try {
      const copy = await createDoc({
        id: crypto.randomUUID(),
        title: cleanDocTitle(`${titleRef.current} (My copy)`, { allowEmptyDefault: true }),
        content: contentRef.current,
      });
      await deleteDocDraft(user.id, docId);
      notify("Saved your edits as a new document.");
      onOpen(copy.id);
    } catch (error) {
      notify(docErrorMessage(error, "Could not save a copy."), "error");
    } finally {
      setSavingCopy(false);
    }
  };

  if (loading) {
    return (
      <div className="pd-editor pd-editor-state" role="status">
        <Spinner className="size-4 text-primary" />
        <span>Opening document…</span>
      </div>
    );
  }

  if (loadError || !summary) {
    return (
      <div className="pd-editor pd-editor-empty-wrap">
        <PersoraEmptyState
          moduleId="docs"
          tone="blue"
          title="Document unavailable"
          description={loadError || "This document could not be opened."}
          action={
            <div className="pd-error-actions">
              <button
                type="button"
                className="pd-btn-secondary"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                <RefreshCw size={14} /> Try again
              </button>
              <button type="button" className="pd-btn-primary" onClick={onClose}>
                <ArrowLeft size={14} /> Back to Persora Docs
              </button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="pd-editor">
      {/* Top Bar */}
      <header className="pd-topbar">
        <div className="pd-topbar-left">
          <button
            type="button"
            className="pd-icon-btn"
            onClick={() => void handleBack()}
            aria-label="Back to Persora Docs"
            title="Back to Persora Docs"
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            className="pd-doc-brand-btn"
            onClick={() => void handleBack()}
            aria-label="Persora Docs home"
            title="Persora Docs home"
          >
            <LauncherModuleIcon id="docs" size={24} />
          </button>

          <div className="pd-title-cluster">
            {canEdit ? (
              <input
                type="text"
                className="pd-title-input"
                aria-label="Document title"
                value={titleInput}
                maxLength={160}
                onChange={(e) => {
                  const raw = e.target.value;
                  setTitleInput(raw);
                  const nextClean = raw.trim() ? raw.trim().slice(0, 160) : "Untitled document";
                  titleRef.current = nextClean;
                  if (contentRef.current) {
                    saverRef.current?.update({
                      title: nextClean,
                      content: contentRef.current,
                    });
                    scheduleDraftBackup();
                  }
                }}
                onBlur={() => commitTitleChange(titleInput)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setTitleInput(summary.title);
                    titleRef.current = summary.title;
                    e.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <h2 className="pd-title-readonly">{summary.title}</h2>
            )}

            {isOwner && (
              <button
                type="button"
                className={`pd-icon-btn pd-star-btn ${summary.starred ? "is-starred" : ""}`}
                onClick={() => void toggleStar()}
                aria-label={summary.starred ? "Remove star" : "Star document"}
                aria-pressed={summary.starred}
                title={summary.starred ? "Starred" : "Star document"}
              >
                <Star size={15} fill={summary.starred ? "currentColor" : "none"} />
              </button>
            )}

            {canEdit ? (
              <DocSaveBadge
                state={saveState}
                onRetry={() => saverRef.current?.retry()}
              />
            ) : (
              <Badge variant="secondary" size="xs" radius="full">
                <Eye size={11} /> View only
              </Badge>
            )}
          </div>
        </div>

        <div className="pd-topbar-right">
          <button
            type="button"
            className="pd-btn-secondary"
            onClick={() => void handlePrint()}
            title="Print document"
          >
            <Printer size={14} />
            <span className="pd-action-label">Print</span>
          </button>

          <button
            type="button"
            className="pd-btn-secondary"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf}
            title="Export as PDF"
          >
            {exportingPdf ? <Spinner className="size-3.5" /> : <FileDown size={14} />}
            <span className="pd-action-label">Export PDF</span>
          </button>

          {isOwner ? (
            <button
              type="button"
              className="pd-btn-primary"
              onClick={() => setShareOpen(true)}
            >
              {summary.hasShares ? <Users size={14} /> : <Share2 size={14} />}
              <span>Share</span>
            </button>
          ) : (
            <Badge variant="primary-light" size="sm" radius="full">
              <Users size={12} />
              <span>Shared by {summary.ownerName || "Member"}</span>
            </Badge>
          )}
        </div>
      </header>

      {/* Formatting Toolbar (Editable mode) */}
      {canEdit && (
        <div className="pd-toolbar-bar">
          <DocFormattingToolbar editor={editor} linkTriggerNonce={linkTriggerNonce} />
        </div>
      )}

      {/* Recovery / Error / Conflict Banners */}
      {draftOffer && (
        <div className="pd-banner is-info" role="status">
          <AlertCircle size={15} />
          <span>
            Unsaved edits from an interrupted session were preserved locally. Restore them into this document?
          </span>
          <div className="pd-banner-actions">
            <button type="button" className="pd-banner-btn is-primary" onClick={restoreUnsavedBackup}>
              Restore edits
            </button>
            <button type="button" className="pd-banner-btn" onClick={discardUnsavedBackup}>
              Discard
            </button>
          </div>
        </div>
      )}

      {saveState.status === "failed" && (
        <div className="pd-banner is-warn" role="alert">
          <CloudOff size={15} />
          <span>
            {saveState.message ||
              "Could not reach the server. Your unsaved edits remain safe in the editor."}
          </span>
          <div className="pd-banner-actions">
            <button
              type="button"
              className="pd-banner-btn is-primary"
              onClick={() => saverRef.current?.retry()}
            >
              <RefreshCw size={13} /> Retry save
            </button>
          </div>
        </div>
      )}

      {saveState.status === "conflict" && (
        <div className="pd-banner is-error" role="alert">
          <AlertCircle size={15} />
          <span>
            This document was updated in another window. Save your edits as a separate copy or reload the latest server version.
          </span>
          <div className="pd-banner-actions">
            <button
              type="button"
              className="pd-banner-btn is-primary"
              disabled={savingCopy}
              onClick={() => void saveConflictAsCopy()}
            >
              <Copy size={13} /> Save as copy
            </button>
            <button
              type="button"
              className="pd-banner-btn"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshCw size={13} /> Reload latest
            </button>
          </div>
        </div>
      )}

      {/* Centered White Page Writing Canvas */}
      <div
        className="pd-canvas"
        onMouseDown={(e) => {
          // Clicking in the bottom margin of the white page focuses the end of the document naturally
          if (e.target === e.currentTarget && editor && canEdit) {
            editor.commands.focus("end");
          }
        }}
      >
        <article
          className={`pd-page-sheet ${!canEdit ? "is-readonly" : ""}`}
          onClick={(e) => {
            if (e.target === e.currentTarget && editor && canEdit) {
              editor.commands.focus("end");
            }
          }}
        >
          <EditorContent editor={editor} />
        </article>
      </div>

      {/* Reused Share Modal */}
      {shareOpen && isOwner && (
        <ShareTableDialog
          tableId={summary.id}
          tableName={summary.title}
          resourceLabel="document"
          allowComment={false}
          adapter={docShareAdapter}
          notify={notify}
          onSharingChanged={(hasActive) =>
            setSummary((prev) => (prev ? { ...prev, hasShares: hasActive } : prev))
          }
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
