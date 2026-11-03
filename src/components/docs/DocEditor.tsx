// Persora Docs — Google Docs-inspired multi-page document editor.
// Preserves backend autosave, revision concurrency, IndexedDB crash recovery,
// sharing, and permissions while adding automatic multi-page pagination,
// configurable margins, horizontal & vertical rulers, Portrait/Landscape orientation,
// independent per-page background colors, inline auto-sizing title, Zoom + Fit,
// anchored Comments toggle & side panel, Tables, Images, Shapes, Headers/Footers
// with page numbers, Download menu (.pdf, .docx, .html, .md, .txt), and
// real DOM Print Preview & Settings.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlertCircle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Check,
  ChevronDown,
  CloudOff,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileDown,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Printer,
  RefreshCw,
  Share2,
  Star,
  Users,
} from "lucide-react";
import {
  DEFAULT_DOC_PAGE_SETUP,
  cleanDocTitle,
  formatDocPageNumber,
  getDocPageSetup,
  getPageDimensions,
  normalizeDocPageSetup,
  normalizeHexColor,
  renderDocPrintableHtml,
  sanitizeDocComments,
  sanitizeDocContent,
  sanitizeDocShapes,
  type DocBlockNode,
  type DocCommentThread,
  type DocContent,
  type DocPageNumberFormat,
  type DocPageNumberPosition,
  type DocPageSetup,
  type DocShape,
  type DocShapeType,
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
import {
  deleteDocDraft,
  loadDocDraft,
  saveDocDraft,
  type DocDraftBackup,
} from "../../lib/docs-drafts";
import { downloadDocAsPdf } from "../../lib/docs-pdf";
import { downloadDocAsEditable, type DocDownloadFormat } from "../../lib/docs-export";
import { clearDocPreviewCache } from "./DocCardPreview";
import DocFormattingToolbar, { type DocZoomSetting } from "./DocFormattingToolbar";
import {
  PAGE_GAP_PX,
  createPersoraDocExtensions,
  recomputeEditorPagination,
} from "./docs-extensions";
import { DocHorizontalRuler, DocVerticalRuler } from "./DocRulers";
import DocShapesLayer, { createDefaultDocShape } from "./DocShapesLayer";
import DocCommentsPanel from "./DocCommentsPanel";
import DocPrintModal, { launchHtmlIframePrint } from "./DocPrintModal";
import ShareTableDialog from "../table/ShareTableDialog";
import { LauncherModuleIcon } from "../launcher/LauncherIcons";
import { PersoraEmptyState } from "@/design-system";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";

const DRAFT_THROTTLE_MS = 900;
const CANVAS_TOP_PAD_PX = 24;

export function triggerCleanDocPrint(title: string, content: DocContent) {
  const html = renderDocPrintableHtml(title, content);
  launchHtmlIframePrint(html);
}

/**
 * Google Docs-style inline editable document title:
 * expands and shrinks automatically to match exact text width via an inline-grid
 * typography mirror, with no fixed-width box and no outer border chrome.
 */
export function AutoWidthDocTitle({
  value,
  onChange,
  onBlur,
  onEscape,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  onEscape?: () => void;
}) {
  const mirrorText = value.length > 0 ? value : "Untitled document";
  return (
    <span className="pd-title-autowrap">
      <span className="pd-title-sizer" aria-hidden="true">
        {mirrorText}
        {"\u200B"}
      </span>
      <input
        type="text"
        className="pd-title-input"
        aria-label="Document title"
        placeholder="Untitled document"
        value={value}
        maxLength={160}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            onEscape?.();
            e.currentTarget.blur();
          }
        }}
      />
    </span>
  );
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
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [savingCopy, setSavingCopy] = useState(false);
  const [linkTriggerNonce, setLinkTriggerNonce] = useState(0);

  // Document rich metadata states (persisted inside DocContent JSONB)
  const [pageSetup, setPageSetup] = useState<DocPageSetup>(() =>
    normalizeDocPageSetup(DEFAULT_DOC_PAGE_SETUP),
  );
  const [shapes, setShapes] = useState<DocShape[]>([]);
  const [comments, setComments] = useState<DocCommentThread[]>([]);

  // Editor viewport & pagination states
  const [zoomSetting, setZoomSetting] = useState<DocZoomSetting>(100);
  const [canvasAvailWidth, setCanvasAvailWidth] = useState<number>(980);
  const [canvasScrollTop, setCanvasScrollTop] = useState<number>(0);
  const [flowPageCount, setFlowPageCount] = useState<number>(1);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [livePageBlocks, setLivePageBlocks] = useState<DocBlockNode[][]>([[]]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [editingHF, setEditingHF] = useState<null | { zone: "header" | "footer"; pageIndex: number }>(
    null,
  );
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState("");
  const [layoutTick, setLayoutTick] = useState(0);

  const saverRef = useRef<DocSaver | null>(null);
  const contentRef = useRef<DocContent | null>(null);
  const titleRef = useRef<string>("Untitled document");
  const pageSetupRef = useRef<DocPageSetup>(pageSetup);
  const shapesRef = useRef<DocShape[]>(shapes);
  const commentsRef = useRef<DocCommentThread[]>(comments);
  const suppressEditorUpdateRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const downloadWrapRef = useRef<HTMLDivElement | null>(null);
  const headerInputRef = useRef<HTMLInputElement | null>(null);
  const footerInputRef = useRef<HTMLInputElement | null>(null);

  pageSetupRef.current = pageSetup;
  shapesRef.current = shapes;
  commentsRef.current = comments;

  const permission = summary?.permission || "owner";
  const isOwner = permission === "owner" && !summary?.shared;
  const canEdit = isOwner || permission === "edit";

  const dims = useMemo(() => getPageDimensions(pageSetup), [pageSetup]);

  const zoomScale = useMemo(() => {
    if (zoomSetting === "fit") {
      const rulerAllowance = pageSetup.showRuler ? 32 : 0;
      const usable = Math.max(280, canvasAvailWidth - 48 - rulerAllowance);
      const fit = usable / dims.widthPx;
      return Math.max(0.4, Math.min(1.6, Math.round(fit * 100) / 100));
    }
    return Math.max(0.5, Math.min(2, zoomSetting / 100));
  }, [canvasAvailWidth, dims.widthPx, pageSetup.showRuler, zoomSetting]);

  const effectiveZoomPercent = Math.round(zoomScale * 100);

  const pageCount = useMemo(() => {
    let maxIdx = Math.max(0, flowPageCount - 1);
    for (const s of shapes) {
      if (s.pageIndex > maxIdx) maxIdx = s.pageIndex;
    }
    return maxIdx + 1;
  }, [flowPageCount, shapes]);

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

  const composeSanitizedDoc = useCallback(
    (
      rawBodyJson: unknown,
      overrides?: {
        pageSetup?: DocPageSetup;
        shapes?: DocShape[];
        comments?: DocCommentThread[];
      },
    ): DocContent => {
      const bodyObj =
        rawBodyJson && typeof rawBodyJson === "object"
          ? (rawBodyJson as Record<string, unknown>)
          : { type: "doc", content: [{ type: "paragraph" }] };
      const nextSetup = overrides?.pageSetup ?? pageSetupRef.current;
      const nextShapes = overrides?.shapes ?? shapesRef.current;
      const nextComments = overrides?.comments ?? commentsRef.current;

      return sanitizeDocContent({
        type: "doc",
        content: Array.isArray(bodyObj.content) ? bodyObj.content : [{ type: "paragraph" }],
        attrs: { pageSetup: nextSetup },
        shapes: nextShapes,
        comments: nextComments,
      });
    },
    [],
  );

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
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
          event.preventDefault();
          setPrintModalOpen(true);
          return true;
        }
        return false;
      },
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        const target = event.target as HTMLElement | null;
        const commentSpan = target?.closest("[data-comment-id]") as HTMLElement | null;
        if (commentSpan && pageSetupRef.current.commentsEnabled) {
          const cid = commentSpan.getAttribute("data-comment-id");
          if (cid) setActiveCommentId(cid);
        }
        return false;
      },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      const quote =
        from !== to ? ed.state.doc.textBetween(from, to, " ").trim().slice(0, 200) : "";
      setSelectedQuote(quote);
      setLayoutTick((t) => t + 1);
    },
    onUpdate: ({ editor: ed }) => {
      setLayoutTick((t) => t + 1);
      if (suppressEditorUpdateRef.current || !canEdit) return;
      const nextJson = composeSanitizedDoc(ed.getJSON());
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

  const commitRichMetadataUpdate = useCallback(
    (overrides: {
      pageSetup?: DocPageSetup;
      shapes?: DocShape[];
      comments?: DocCommentThread[];
    }) => {
      const nextSetup = overrides.pageSetup
        ? normalizeDocPageSetup(overrides.pageSetup)
        : pageSetupRef.current;
      const nextShapes = overrides.shapes
        ? sanitizeDocShapes(overrides.shapes)
        : shapesRef.current;
      const nextComments = overrides.comments
        ? sanitizeDocComments(overrides.comments)
        : commentsRef.current;

      if (overrides.pageSetup) {
        pageSetupRef.current = nextSetup;
        setPageSetup(nextSetup);
      }
      if (overrides.shapes) {
        shapesRef.current = nextShapes;
        setShapes(nextShapes);
      }
      if (overrides.comments) {
        commentsRef.current = nextComments;
        setComments(nextComments);
      }

      if (!canEdit) return;
      const merged = composeSanitizedDoc(editor?.getJSON() ?? contentRef.current, {
        pageSetup: nextSetup,
        shapes: nextShapes,
        comments: nextComments,
      });
      contentRef.current = merged;
      saverRef.current?.update({
        title: titleRef.current,
        content: merged,
      });
      scheduleDraftBackup();
    },
    [canEdit, composeSanitizedDoc, editor, scheduleDraftBackup],
  );

  const handleUpdatePageSetup = useCallback(
    (patch: Partial<DocPageSetup>) => {
      const mergedSetup = normalizeDocPageSetup({
        ...pageSetupRef.current,
        ...patch,
        margins: patch.margins
          ? { ...pageSetupRef.current.margins, ...patch.margins }
          : pageSetupRef.current.margins,
        pageColors: patch.pageColors ?? pageSetupRef.current.pageColors,
      });
      commitRichMetadataUpdate({ pageSetup: mergedSetup });
    },
    [commitRichMetadataUpdate],
  );

  const handleSetPageColor = useCallback(
    (pageIndex: number, hexColor: string) => {
      const norm = normalizeHexColor(hexColor) || "#ffffff";
      const nextMap = { ...pageSetupRef.current.pageColors };
      if (norm === "#ffffff") {
        delete nextMap[String(pageIndex)];
      } else {
        nextMap[String(pageIndex)] = norm;
      }
      handleUpdatePageSetup({ pageColors: nextMap });
    },
    [handleUpdatePageSetup],
  );

  // Measure canvas width for Fit-to-Page zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasAvailWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setCanvasAvailWidth(el.clientWidth || 980);
    return () => ro.disconnect();
  }, [loading, pageSetup.commentsEnabled]);

  // Close Download menu on outside click / Escape
  useEffect(() => {
    if (!downloadMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (downloadWrapRef.current && !downloadWrapRef.current.contains(e.target as Node)) {
        setDownloadMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDownloadMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [downloadMenuOpen]);

  // Synchronously run multi-page pagination before paint whenever content, margins, orientation, or zoom change
  useLayoutEffect(() => {
    if (!editor || loading) return;
    let rafId: number | null = null;
    const run = () => {
      const blocks = contentRef.current?.content;
      const res = recomputeEditorPagination(editor, dims, zoomScale, blocks);
      setFlowPageCount((prev) => (prev === res.pageCount ? prev : res.pageCount));
      setActivePageIndex((prev) => (prev === res.activePageIndex ? prev : res.activePageIndex));
      setLivePageBlocks(res.pageBlocks);
    };
    run();
    rafId = window.requestAnimationFrame(run);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [dims, editor, layoutTick, loading, zoomScale]);

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
        const loadedSetup = getDocPageSetup(safeContent);
        const loadedShapes = sanitizeDocShapes(safeContent.shapes);
        const loadedComments = sanitizeDocComments(safeContent.comments);
        const editable =
          (detail.permission || "owner") === "owner" || detail.permission === "edit";

        pageSetupRef.current = loadedSetup;
        shapesRef.current = loadedShapes;
        commentsRef.current = loadedComments;
        setPageSetup(loadedSetup);
        setShapes(loadedShapes);
        setComments(loadedComments);
        setSelectedShapeId(null);
        setEditingHF(null);

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
        editor.commands.setContent(
          { type: "doc", content: safeContent.content },
          false,
        );
        suppressEditorUpdateRef.current = false;

        setSummary(detail);
        setTitleInput(detail.title);
        setSaveState(saver.snapshot);
        setLoading(false);
        setLayoutTick((t) => t + 1);

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
    if (
      saverRef.current?.hasUnsaved &&
      saveState.status !== "failed" &&
      saveState.status !== "conflict"
    ) {
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

  const currentSnapshotDoc = (): DocContent =>
    contentRef.current || composeSanitizedDoc(editor?.getJSON());

  const handleDownload = async (format: DocDownloadFormat) => {
    setDownloadMenuOpen(false);
    await saverRef.current?.flush().catch(() => {});
    const current = currentSnapshotDoc();

    if (format === "pdf") {
      if (exportingPdf) return;
      setExportingPdf(true);
      try {
        await downloadDocAsPdf(titleRef.current, current);
        notify("Downloaded PDF.");
      } catch (error) {
        notify(docErrorMessage(error, "Could not generate PDF."), "error");
      } finally {
        setExportingPdf(false);
      }
      return;
    }

    try {
      downloadDocAsEditable(format, titleRef.current, current);
      const label =
        format === "docx"
          ? "Word (.docx)"
          : format === "html"
            ? "HTML (.html)"
            : format === "md"
              ? "Markdown (.md)"
              : "Plain text (.txt)";
      notify(`Downloaded ${label}.`);
    } catch (error) {
      notify(docErrorMessage(error, "Could not download document."), "error");
    }
  };

  const handleInsertShape = (shapeType: DocShapeType) => {
    if (!canEdit) return;
    const nextShape = createDefaultDocShape(
      shapeType,
      activePageIndex,
      dims,
      shapesRef.current.length,
    );
    const nextShapes = [...shapesRef.current, nextShape];
    commitRichMetadataUpdate({ shapes: nextShapes });
    setSelectedShapeId(nextShape.id);
  };

  const handleFocusHeaderFooter = (zone: "header" | "footer", pageIdx = activePageIndex) => {
    if (!canEdit) return;
    setEditingHF({ zone, pageIndex: pageIdx });
    window.setTimeout(() => {
      if (zone === "header") headerInputRef.current?.focus();
      else footerInputRef.current?.focus();
    }, 30);
  };

  // ---- Comments Actions ---------------------------------------------------

  const handleRequestAddComment = () => {
    if (!pageSetup.commentsEnabled) {
      handleUpdatePageSetup({ commentsEnabled: true });
    }
    setCommentComposerOpen(true);
  };

  const handleCreateComment = (text: string) => {
    if (!editor || !canEdit) return;
    const id = `cmt_${crypto.randomUUID().slice(0, 8)}`;
    const { from, to } = editor.state.selection;
    const quote =
      from !== to ? editor.state.doc.textBetween(from, to, " ").trim().slice(0, 180) : selectedQuote;

    if (from !== to) {
      suppressEditorUpdateRef.current = true;
      editor.chain().focus().setMark("comment", { commentId: id }).run();
      suppressEditorUpdateRef.current = false;
    }

    const nextThread: DocCommentThread = {
      id,
      quote,
      authorName: user.fullName || user.email || "Member",
      text,
      createdAt: new Date().toISOString(),
    };
    const nextComments = [...commentsRef.current, nextThread];
    setCommentComposerOpen(false);
    setActiveCommentId(id);
    commitRichMetadataUpdate({ comments: nextComments });
  };

  const handleReplyComment = (commentId: string, replyText: string) => {
    const nextComments = commentsRef.current.map((c) =>
      c.id === commentId
        ? {
            ...c,
            replies: [
              ...(c.replies || []),
              {
                id: `rpl_${crypto.randomUUID().slice(0, 8)}`,
                authorName: user.fullName || user.email || "Member",
                text: replyText,
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : c,
    );
    commitRichMetadataUpdate({ comments: nextComments });
  };

  const handleToggleCommentResolved = (commentId: string) => {
    const nextComments = commentsRef.current.map((c) =>
      c.id === commentId ? { ...c, resolved: !c.resolved } : c,
    );
    commitRichMetadataUpdate({ comments: nextComments });
  };

  const handleDeleteComment = (commentId: string) => {
    if (editor && canEdit) {
      const { state, view } = editor;
      const commentType = state.schema.marks.comment;
      if (commentType) {
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          for (const m of node.marks) {
            if (m.type === commentType && m.attrs.commentId === commentId) {
              tr.removeMark(pos, pos + node.nodeSize, m);
            }
          }
        });
        suppressEditorUpdateRef.current = true;
        view.dispatch(tr);
        suppressEditorUpdateRef.current = false;
      }
    }
    const nextComments = commentsRef.current.filter((c) => c.id !== commentId);
    if (activeCommentId === commentId) setActiveCommentId(null);
    commitRichMetadataUpdate({ comments: nextComments });
  };

  const handleJumpToComment = (commentId: string) => {
    setActiveCommentId(commentId);
    if (!editor) return;
    const domEl = editor.view.dom.querySelector(
      `[data-comment-id="${CSS.escape(commentId)}"]`,
    ) as HTMLElement | null;
    domEl?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const restoreUnsavedBackup = () => {
    if (!draftOffer || !editor || !canEdit) return;
    const restoredContent = sanitizeDocContent(draftOffer.content);
    const restoredTitle = cleanDocTitle(draftOffer.title, { allowEmptyDefault: true });
    const restoredSetup = getDocPageSetup(restoredContent);
    const restoredShapes = sanitizeDocShapes(restoredContent.shapes);
    const restoredComments = sanitizeDocComments(restoredContent.comments);

    pageSetupRef.current = restoredSetup;
    shapesRef.current = restoredShapes;
    commentsRef.current = restoredComments;
    setPageSetup(restoredSetup);
    setShapes(restoredShapes);
    setComments(restoredComments);

    suppressEditorUpdateRef.current = true;
    editor.commands.setContent({ type: "doc", content: restoredContent.content }, false);
    suppressEditorUpdateRef.current = false;
    contentRef.current = restoredContent;
    titleRef.current = restoredTitle;
    setTitleInput(restoredTitle);
    setDraftOffer(null);
    setLayoutTick((t) => t + 1);
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

  const stageHeightPx =
    pageCount * dims.heightPx + Math.max(0, pageCount - 1) * PAGE_GAP_PX;
  const openCommentCount = comments.filter((c) => !c.resolved).length;

  return (
    <div
      className={`pd-editor ${pageSetup.commentsEnabled ? "has-comments-on" : ""}`}
      data-orientation={pageSetup.orientation}
    >
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
              <AutoWidthDocTitle
                value={titleInput}
                onChange={(raw) => {
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
                onEscape={() => {
                  setTitleInput(summary.title);
                  titleRef.current = summary.title;
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
          {/* Comments On/Off Toggle */}
          <button
            type="button"
            className={`pd-btn-secondary pd-comments-toggle ${pageSetup.commentsEnabled ? "is-active" : ""}`}
            onClick={() =>
              handleUpdatePageSetup({ commentsEnabled: !pageSetup.commentsEnabled })
            }
            aria-pressed={pageSetup.commentsEnabled}
            aria-label={pageSetup.commentsEnabled ? "Turn comments off" : "Turn comments on"}
            title={
              pageSetup.commentsEnabled
                ? "Comments on — click to hide comments UI"
                : "Turn comments on"
            }
          >
            <MessageSquare size={14} />
            <span className="pd-action-label">Comments</span>
            {openCommentCount > 0 && (
              <span className="pd-topbar-pill-count">{openCommentCount}</span>
            )}
          </button>

          {/* Print Preview & Settings Button */}
          <button
            type="button"
            className="pd-btn-secondary"
            onClick={async () => {
              await saverRef.current?.flush().catch(() => {});
              setPrintModalOpen(true);
            }}
            aria-label="Print document"
            title="Print preview & settings (Ctrl+P)"
          >
            <Printer size={14} />
            <span className="pd-action-label">Print</span>
          </button>

          {/* Download / Export Menu */}
          <div ref={downloadWrapRef} className="pd-tb-dropdown-wrap">
            <button
              type="button"
              className="pd-btn-secondary"
              onClick={() => setDownloadMenuOpen((v) => !v)}
              disabled={exportingPdf}
              aria-label="Download document"
              aria-haspopup="menu"
              aria-expanded={downloadMenuOpen}
              title="Download as PDF or editable document"
            >
              {exportingPdf ? <Spinner className="size-3.5" /> : <Download size={14} />}
              <span className="pd-action-label">Download</span>
              <ChevronDown size={12} />
            </button>

            {downloadMenuOpen && (
              <div
                className="pd-tb-popover pd-download-menu"
                role="menu"
                aria-label="Download formats"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => void handleDownload("pdf")}
                >
                  <FileDown size={14} />
                  <span>PDF Document (.pdf)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => void handleDownload("docx")}
                >
                  <FileSpreadsheet size={14} />
                  <span>Microsoft Word (.docx)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => void handleDownload("html")}
                >
                  <FileCode2 size={14} />
                  <span>Editable Web Page (.html)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => void handleDownload("md")}
                >
                  <FileText size={14} />
                  <span>Markdown (.md)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pd-tb-menu-row"
                  onClick={() => void handleDownload("txt")}
                >
                  <FileText size={14} />
                  <span>Plain Text (.txt)</span>
                </button>
              </div>
            )}
          </div>

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
          <DocFormattingToolbar
            editor={editor}
            linkTriggerNonce={linkTriggerNonce}
            zoomSetting={zoomSetting}
            effectiveZoomPercent={effectiveZoomPercent}
            onChangeZoom={setZoomSetting}
            pageSetup={pageSetup}
            activePageIndex={activePageIndex}
            pageCount={pageCount}
            onUpdatePageSetup={handleUpdatePageSetup}
            onSetPageColor={handleSetPageColor}
            onInsertShape={handleInsertShape}
            onFocusHeaderFooter={handleFocusHeaderFooter}
            onRequestAddComment={handleRequestAddComment}
            notify={notify}
          />
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
            <button
              type="button"
              className="pd-banner-btn is-primary"
              onClick={restoreUnsavedBackup}
            >
              Restore edits
            </button>
            <button
              type="button"
              className="pd-banner-btn"
              onClick={discardUnsavedBackup}
            >
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

      {/* Horizontal Ruler */}
      {pageSetup.showRuler && (
        <DocHorizontalRuler
          dims={dims}
          margins={pageSetup.margins}
          zoomScale={zoomScale}
          canEdit={canEdit}
          onChangeMargins={(patch) =>
            handleUpdatePageSetup({
              margins: { ...pageSetup.margins, ...patch },
            })
          }
        />
      )}

      {/* Main Workspace Row: Vertical Ruler + Multi-Page Canvas + Optional Comments Side Panel */}
      <div className="pd-workspace-body">
        {pageSetup.showRuler && (
          <DocVerticalRuler
            dims={dims}
            margins={pageSetup.margins}
            pageCount={pageCount}
            zoomScale={zoomScale}
            scrollTop={canvasScrollTop}
            canvasTopPaddingPx={CANVAS_TOP_PAD_PX}
            canEdit={canEdit}
            onChangeMargins={(patch) =>
              handleUpdatePageSetup({
                margins: { ...pageSetup.margins, ...patch },
              })
            }
          />
        )}

        <div
          ref={canvasRef}
          className="pd-canvas"
          onScroll={(e) => setCanvasScrollTop(e.currentTarget.scrollTop)}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedShapeId(null);
              setEditingHF(null);
              if (editor && canEdit) editor.commands.focus("end");
            }
          }}
        >
          <div
            className="pd-zoom-shell"
            style={{
              width: `${Math.round(dims.widthPx * zoomScale)}px`,
              height: `${Math.round(stageHeightPx * zoomScale)}px`,
            }}
          >
            <div
              className={`pd-pages-stage ${!canEdit ? "is-readonly" : ""}`}
              data-zoom-scale={zoomScale}
              style={{
                width: `${dims.widthPx}px`,
                minHeight: `${stageHeightPx}px`,
                transform: `scale(${zoomScale})`,
                transformOrigin: "top left",
              }}
              onMouseDown={(e) => {
                const target = e.target as HTMLElement;
                if (!target.closest(".pd-shape-item")) {
                  setSelectedShapeId(null);
                }
                if (!target.closest(".pd-hf-zone") && !target.closest(".pd-hf-editor-bar")) {
                  setEditingHF(null);
                }
                // Update activePageIndex when clicking anywhere on a page
                const stageRect = e.currentTarget.getBoundingClientRect();
                const localY = (e.clientY - stageRect.top) / zoomScale;
                const clickedPage = Math.max(
                  0,
                  Math.min(pageCount - 1, Math.floor(Math.max(0, localY) / (dims.heightPx + PAGE_GAP_PX))),
                );
                setActivePageIndex(clickedPage);
              }}
            >
              {/* Layer 1: Distinct Multi-Page Paper Sheets (independent per-page colors + headers/footers) */}
              <div
                className="pd-pages-backdrop"
                style={{ gap: `${PAGE_GAP_PX}px` }}
              >
                {Array.from({ length: pageCount }, (_, pIdx) => {
                  const pageBg = pageSetup.pageColors[String(pIdx)] || "#ffffff";
                  const hideFirst = pageSetup.differentFirstPage && pIdx === 0;
                  const pageNumLabel = formatDocPageNumber(pageSetup, pIdx, pageCount);
                  const headerPageNum =
                    pageNumLabel && pageSetup.pageNumberPosition.startsWith("header-")
                      ? pageNumLabel
                      : "";
                  const footerPageNum =
                    pageNumLabel && pageSetup.pageNumberPosition.startsWith("footer-")
                      ? pageNumLabel
                      : "";
                  const isEditingHeader =
                    editingHF?.zone === "header" && editingHF.pageIndex === pIdx;
                  const isEditingFooter =
                    editingHF?.zone === "footer" && editingHF.pageIndex === pIdx;

                  return (
                    <section
                      key={pIdx}
                      className={`pd-page-card ${activePageIndex === pIdx ? "is-active-page" : ""}`}
                      data-page-index={pIdx}
                      data-page-number={pIdx + 1}
                      style={{
                        width: `${dims.widthPx}px`,
                        height: `${dims.heightPx}px`,
                        backgroundColor: pageBg,
                      }}
                    >
                      {/* Editable Header Zone inside Top Margin */}
                      <div
                        className={`pd-hf-zone is-header ${isEditingHeader ? "is-editing" : ""}`}
                        style={{
                          height: `${dims.marginTopPx}px`,
                          paddingLeft: `${dims.marginLeftPx}px`,
                          paddingRight: `${dims.marginRightPx}px`,
                        }}
                        onDoubleClick={(e) => {
                          if (!canEdit) return;
                          e.stopPropagation();
                          handleFocusHeaderFooter("header", pIdx);
                        }}
                        onClick={(e) => {
                          if (isEditingHeader) e.stopPropagation();
                        }}
                        title={canEdit ? "Double-click to edit header" : undefined}
                      >
                        {isEditingHeader && canEdit ? (
                          <div
                            className="pd-hf-inline-editor"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <input
                              ref={headerInputRef}
                              type="text"
                              className="pd-hf-text-input"
                              aria-label="Header text"
                              placeholder="Enter header text…"
                              style={{ textAlign: pageSetup.headerAlign }}
                              value={pageSetup.headerText}
                              onChange={(e) =>
                                handleUpdatePageSetup({ headerText: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") {
                                  setEditingHF(null);
                                }
                              }}
                            />
                            {headerPageNum && (
                              <span className="pd-hf-pagenum-live">{headerPageNum}</span>
                            )}
                            <div className="pd-hf-editor-bar" role="toolbar" aria-label="Header options">
                              <span className="pd-hf-tag">Header</span>
                              <button
                                type="button"
                                className={`pd-hf-mini-btn ${pageSetup.headerAlign === "left" ? "is-on" : ""}`}
                                onClick={() => handleUpdatePageSetup({ headerAlign: "left" })}
                                aria-label="Align header left"
                              >
                                <AlignLeft size={12} />
                              </button>
                              <button
                                type="button"
                                className={`pd-hf-mini-btn ${pageSetup.headerAlign === "center" ? "is-on" : ""}`}
                                onClick={() => handleUpdatePageSetup({ headerAlign: "center" })}
                                aria-label="Align header center"
                              >
                                <AlignCenter size={12} />
                              </button>
                              <button
                                type="button"
                                className={`pd-hf-mini-btn ${pageSetup.headerAlign === "right" ? "is-on" : ""}`}
                                onClick={() => handleUpdatePageSetup({ headerAlign: "right" })}
                                aria-label="Align header right"
                              >
                                <AlignRight size={12} />
                              </button>

                              <label className="pd-hf-check">
                                <Checkbox
                                  checked={pageSetup.showPageNumbers}
                                  onCheckedChange={(v) =>
                                    handleUpdatePageSetup({ showPageNumbers: Boolean(v) })
                                  }
                                  aria-label="Show page numbers"
                                />
                                <span>Page #</span>
                              </label>

                              {pageSetup.showPageNumbers && (
                                <>
                                  <select
                                    aria-label="Page number position"
                                    value={pageSetup.pageNumberPosition}
                                    onChange={(e) =>
                                      handleUpdatePageSetup({
                                        pageNumberPosition: e.target.value as DocPageNumberPosition,
                                      })
                                    }
                                  >
                                    <option value="header-right">Header right</option>
                                    <option value="header-center">Header center</option>
                                    <option value="footer-right">Footer right</option>
                                    <option value="footer-center">Footer center</option>
                                    <option value="footer-left">Footer left</option>
                                  </select>
                                  <select
                                    aria-label="Page number format"
                                    value={pageSetup.pageNumberFormat}
                                    onChange={(e) =>
                                      handleUpdatePageSetup({
                                        pageNumberFormat: e.target.value as DocPageNumberFormat,
                                      })
                                    }
                                  >
                                    <option value="page-x-of-n">Page 1 of N</option>
                                    <option value="page-x">Page 1</option>
                                    <option value="number">1</option>
                                  </select>
                                </>
                              )}

                              <button
                                type="button"
                                className="pd-hf-done-btn"
                                onClick={() => setEditingHF(null)}
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="pd-hf-display">
                            <span
                              className="pd-hf-display-text"
                              style={{ textAlign: pageSetup.headerAlign }}
                            >
                              {!hideFirst ? pageSetup.headerText : ""}
                            </span>
                            {headerPageNum && (
                              <span className="pd-hf-pagenum-live">{headerPageNum}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Editable Footer Zone inside Bottom Margin */}
                      <div
                        className={`pd-hf-zone is-footer ${isEditingFooter ? "is-editing" : ""}`}
                        style={{
                          height: `${dims.marginBottomPx}px`,
                          paddingLeft: `${dims.marginLeftPx}px`,
                          paddingRight: `${dims.marginRightPx}px`,
                        }}
                        onDoubleClick={(e) => {
                          if (!canEdit) return;
                          e.stopPropagation();
                          handleFocusHeaderFooter("footer", pIdx);
                        }}
                        onClick={(e) => {
                          if (isEditingFooter) e.stopPropagation();
                        }}
                        title={canEdit ? "Double-click to edit footer" : undefined}
                      >
                        {isEditingFooter && canEdit ? (
                          <div
                            className="pd-hf-inline-editor"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <div className="pd-hf-editor-bar is-above" role="toolbar" aria-label="Footer options">
                              <span className="pd-hf-tag">Footer</span>
                              <button
                                type="button"
                                className={`pd-hf-mini-btn ${pageSetup.footerAlign === "left" ? "is-on" : ""}`}
                                onClick={() => handleUpdatePageSetup({ footerAlign: "left" })}
                                aria-label="Align footer left"
                              >
                                <AlignLeft size={12} />
                              </button>
                              <button
                                type="button"
                                className={`pd-hf-mini-btn ${pageSetup.footerAlign === "center" ? "is-on" : ""}`}
                                onClick={() => handleUpdatePageSetup({ footerAlign: "center" })}
                                aria-label="Align footer center"
                              >
                                <AlignCenter size={12} />
                              </button>
                              <button
                                type="button"
                                className={`pd-hf-mini-btn ${pageSetup.footerAlign === "right" ? "is-on" : ""}`}
                                onClick={() => handleUpdatePageSetup({ footerAlign: "right" })}
                                aria-label="Align footer right"
                              >
                                <AlignRight size={12} />
                              </button>

                              <label className="pd-hf-check">
                                <Checkbox
                                  checked={pageSetup.showPageNumbers}
                                  onCheckedChange={(v) =>
                                    handleUpdatePageSetup({ showPageNumbers: Boolean(v) })
                                  }
                                  aria-label="Show page numbers"
                                />
                                <span>Page #</span>
                              </label>

                              {pageSetup.showPageNumbers && (
                                <select
                                  aria-label="Page number format"
                                  value={pageSetup.pageNumberFormat}
                                  onChange={(e) =>
                                    handleUpdatePageSetup({
                                      pageNumberFormat: e.target.value as DocPageNumberFormat,
                                    })
                                  }
                                >
                                  <option value="page-x-of-n">Page 1 of N</option>
                                  <option value="page-x">Page 1</option>
                                  <option value="number">1</option>
                                </select>
                              )}

                              <label className="pd-hf-check">
                                <Checkbox
                                  checked={pageSetup.differentFirstPage}
                                  onCheckedChange={(v) =>
                                    handleUpdatePageSetup({ differentFirstPage: Boolean(v) })
                                  }
                                  aria-label="Different first page"
                                />
                                <span>Hide on p.1</span>
                              </label>

                              <button
                                type="button"
                                className="pd-hf-done-btn"
                                onClick={() => setEditingHF(null)}
                              >
                                Done
                              </button>
                            </div>
                            <input
                              ref={footerInputRef}
                              type="text"
                              className="pd-hf-text-input"
                              aria-label="Footer text"
                              placeholder="Enter footer text…"
                              style={{ textAlign: pageSetup.footerAlign }}
                              value={pageSetup.footerText}
                              onChange={(e) =>
                                handleUpdatePageSetup({ footerText: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") {
                                  setEditingHF(null);
                                }
                              }}
                            />
                            {footerPageNum && (
                              <span className="pd-hf-pagenum-live">{footerPageNum}</span>
                            )}
                          </div>
                        ) : (
                          <div className="pd-hf-display">
                            <span
                              className="pd-hf-display-text"
                              style={{ textAlign: pageSetup.footerAlign }}
                            >
                              {!hideFirst ? pageSetup.footerText : ""}
                            </span>
                            {footerPageNum && (
                              <span className="pd-hf-pagenum-live">{footerPageNum}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <span className="pd-page-corner-badge" aria-hidden="true">
                        {pIdx + 1} / {pageCount}
                      </span>
                    </section>
                  );
                })}
              </div>

              {/* Layer 2: Continuous Paginated ProseMirror Body */}
              <div
                className="pd-editor-flow-layer"
                style={
                  {
                    minHeight: `${stageHeightPx}px`,
                    "--pd-margin-top": `${dims.marginTopPx}px`,
                    "--pd-margin-right": `${dims.marginRightPx}px`,
                    "--pd-margin-bottom": `${dims.marginBottomPx}px`,
                    "--pd-margin-left": `${dims.marginLeftPx}px`,
                  } as React.CSSProperties
                }
              >
                <EditorContent editor={editor} />
              </div>

              {/* Layer 3: Interactive Geometric Shapes */}
              <DocShapesLayer
                shapes={shapes}
                dims={dims}
                pageCount={pageCount}
                zoomScale={zoomScale}
                canEdit={canEdit}
                selectedShapeId={selectedShapeId}
                onSelectShape={setSelectedShapeId}
                onChangeShapes={(nextShapes) => commitRichMetadataUpdate({ shapes: nextShapes })}
              />
            </div>
          </div>
        </div>

        {/* Organized Anchored Comments Side Panel (shown only when Comments toggle is ON) */}
        {pageSetup.commentsEnabled && (
          <DocCommentsPanel
            comments={comments}
            canEdit={canEdit}
            authorName={user.fullName || user.email || "Member"}
            selectedQuote={selectedQuote}
            activeCommentId={activeCommentId}
            composerOpen={commentComposerOpen}
            onOpenComposer={() => setCommentComposerOpen(true)}
            onCloseComposer={() => setCommentComposerOpen(false)}
            onSelectComment={handleJumpToComment}
            onCreateComment={handleCreateComment}
            onReplyComment={handleReplyComment}
            onToggleResolved={handleToggleCommentResolved}
            onDeleteComment={handleDeleteComment}
            onTurnOffComments={() => handleUpdatePageSetup({ commentsEnabled: false })}
          />
        )}
      </div>

      {/* Google Docs-style Real DOM Print Preview & Settings Dialog */}
      {printModalOpen && (
        <DocPrintModal
          title={titleRef.current}
          doc={currentSnapshotDoc()}
          livePageBlocks={livePageBlocks}
          onExportPdf={() => {
            setPrintModalOpen(false);
            void handleDownload("pdf");
          }}
          onClose={() => setPrintModalOpen(false)}
        />
      )}

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
