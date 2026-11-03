// Persora Docs — Full-screen public shared document view (/SharedDoc/:token).
// Supports read-only Viewer links and live-editable Editor links with multi-page
// pagination, per-page colors, shapes, headers/footers, Print Preview & Download.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import "./docs.css";
import {
  ChevronDown,
  Download,
  Eye,
  FileCode2,
  FileDown,
  FileSpreadsheet,
  FileText,
  Pencil,
  Printer,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  DEFAULT_DOC_PAGE_SETUP,
  cleanDocTitle,
  formatDocPageNumber,
  getDocPageSetup,
  getPageDimensions,
  normalizeDocPageSetup,
  normalizeHexColor,
  sanitizeDocComments,
  sanitizeDocContent,
  sanitizeDocShapes,
  type DocBlockNode,
  type DocCommentThread,
  type DocContent,
  type DocPageSetup,
  type DocShape,
  type DocShapeType,
} from "../../../cloudflare/docs-rules.js";
import type { AppUser } from "../../types";
import {
  docErrorMessage,
  getPublicSharedDoc,
  savePublicDocContent,
  type DocPublicLinkPermission,
} from "../../lib/docs-api";
import { DocSaver, type DocSaveState } from "../../lib/docs-sync";
import { downloadDocAsPdf } from "../../lib/docs-pdf";
import { downloadDocAsEditable, type DocDownloadFormat } from "../../lib/docs-export";
import { AutoWidthDocTitle, DocSaveBadge } from "./DocEditor";
import DocFormattingToolbar, { type DocZoomSetting } from "./DocFormattingToolbar";
import {
  PAGE_GAP_PX,
  createPersoraDocExtensions,
  recomputeEditorPagination,
} from "./docs-extensions";
import DocShapesLayer, { createDefaultDocShape } from "./DocShapesLayer";
import DocPrintModal from "./DocPrintModal";
import { LauncherModuleIcon } from "../launcher/LauncherIcons";
import { PersoraEmptyState, ThemeToggleButton } from "@/design-system";
import { Badge } from "@/components/reui/badge";
import { Spinner } from "@/components/ui/spinner";

export default function PublicSharedDocPage({
  token,
  signedInUser,
  notify,
  onSignIn,
  onCreateAccount,
  onOpenWorkspace,
}: {
  token: string;
  signedInUser: AppUser | null;
  notify: (message: string, kind?: "success" | "error") => void;
  onSignIn: () => void;
  onCreateAccount: () => void;
  onOpenWorkspace: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [permission, setPermission] = useState<DocPublicLinkPermission>("view");
  const [ownerName, setOwnerName] = useState("Persora Member");
  const [title, setTitle] = useState("Untitled document");
  const [saveState, setSaveState] = useState<DocSaveState>({
    status: "saved",
    revision: 1,
    message: null,
    lastSavedAt: null,
  });
  const [exportingPdf, setExportingPdf] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [linkTriggerNonce, setLinkTriggerNonce] = useState(0);

  const [pageSetup, setPageSetup] = useState<DocPageSetup>(() =>
    normalizeDocPageSetup(DEFAULT_DOC_PAGE_SETUP),
  );
  const [shapes, setShapes] = useState<DocShape[]>([]);
  const [comments, setComments] = useState<DocCommentThread[]>([]);
  const [zoomSetting, setZoomSetting] = useState<DocZoomSetting>(100);
  const [flowPageCount, setFlowPageCount] = useState<number>(1);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [livePageBlocks, setLivePageBlocks] = useState<DocBlockNode[][]>([[]]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const saverRef = useRef<DocSaver | null>(null);
  const contentRef = useRef<DocContent | null>(null);
  const titleRef = useRef("Untitled document");
  const pageSetupRef = useRef<DocPageSetup>(pageSetup);
  const shapesRef = useRef<DocShape[]>(shapes);
  const commentsRef = useRef<DocCommentThread[]>(comments);
  const suppressUpdateRef = useRef(false);

  pageSetupRef.current = pageSetup;
  shapesRef.current = shapes;
  commentsRef.current = comments;

  const canEdit = permission === "edit";
  const dims = useMemo(() => getPageDimensions(pageSetup), [pageSetup]);
  const zoomScale = useMemo(
    () => (zoomSetting === "fit" ? 1 : Math.max(0.5, Math.min(2, zoomSetting / 100))),
    [zoomSetting],
  );
  const pageCount = useMemo(() => {
    let maxIdx = Math.max(0, flowPageCount - 1);
    for (const s of shapes) {
      if (s.pageIndex > maxIdx) maxIdx = s.pageIndex;
    }
    return maxIdx + 1;
  }, [flowPageCount, shapes]);

  const extensions = useMemo(() => createPersoraDocExtensions(), []);

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
      return sanitizeDocContent({
        type: "doc",
        content: Array.isArray(bodyObj.content) ? bodyObj.content : [{ type: "paragraph" }],
        attrs: { pageSetup: overrides?.pageSetup ?? pageSetupRef.current },
        shapes: overrides?.shapes ?? shapesRef.current,
        comments: overrides?.comments ?? commentsRef.current,
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
        "aria-label": "Shared document body",
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
          event.preventDefault();
          setPrintModalOpen(true);
          return true;
        }
        if (!canEdit) return false;
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
    onSelectionUpdate: () => setLayoutTick((t) => t + 1),
    onUpdate: ({ editor: ed }) => {
      setLayoutTick((t) => t + 1);
      if (suppressUpdateRef.current || !canEdit) return;
      const nextJson = composeSanitizedDoc(ed.getJSON());
      contentRef.current = nextJson;
      saverRef.current?.update({
        title: titleRef.current,
        content: nextJson,
      });
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(canEdit);
  }, [editor, canEdit]);

  useLayoutEffect(() => {
    if (!editor || loading) return;
    const res = recomputeEditorPagination(editor, dims, zoomScale, contentRef.current?.content);
    setFlowPageCount((prev) => (prev === res.pageCount ? prev : res.pageCount));
    setActivePageIndex((prev) => (prev === res.activePageIndex ? prev : res.activePageIndex));
    setLivePageBlocks(res.pageBlocks);
  }, [dims, editor, layoutTick, loading, zoomScale]);

  useEffect(() => {
    if (!editor) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    getPublicSharedDoc(token, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        const safeContent = sanitizeDocContent(res.doc.content);
        const loadedSetup = getDocPageSetup(safeContent);
        const loadedShapes = sanitizeDocShapes(safeContent.shapes);
        const loadedComments = sanitizeDocComments(safeContent.comments);
        const editable = res.permission === "edit";

        pageSetupRef.current = loadedSetup;
        shapesRef.current = loadedShapes;
        commentsRef.current = loadedComments;
        setPageSetup(loadedSetup);
        setShapes(loadedShapes);
        setComments(loadedComments);

        saverRef.current?.dispose();
        if (editable) {
          const saver = new DocSaver({
            revision: res.doc.revision,
            initial: { title: res.doc.title, content: safeContent },
            debounceMs: 650,
            send: (batch) => savePublicDocContent(token, batch),
            onState: (next) => setSaveState(next),
          });
          saverRef.current = saver;
          setSaveState(saver.snapshot);
        }

        contentRef.current = safeContent;
        titleRef.current = res.doc.title;
        suppressUpdateRef.current = true;
        editor.commands.setContent({ type: "doc", content: safeContent.content }, false);
        suppressUpdateRef.current = false;

        setPermission(res.permission);
        setOwnerName(res.ownerName || "Persora Member");
        setTitle(res.doc.title);
        setLoading(false);
        setLayoutTick((t) => t + 1);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setLoadError(
          docErrorMessage(
            err,
            "This shared document link is unavailable, disabled, or has been revoked.",
          ),
        );
      });

    return () => controller.abort();
  }, [editor, reloadKey, token]);

  useEffect(() => () => saverRef.current?.dispose(), []);

  const commitSharedMeta = (overrides: {
    pageSetup?: DocPageSetup;
    shapes?: DocShape[];
  }) => {
    if (!canEdit) return;
    const nextSetup = overrides.pageSetup
      ? normalizeDocPageSetup(overrides.pageSetup)
      : pageSetupRef.current;
    const nextShapes = overrides.shapes
      ? sanitizeDocShapes(overrides.shapes)
      : shapesRef.current;
    pageSetupRef.current = nextSetup;
    shapesRef.current = nextShapes;
    setPageSetup(nextSetup);
    setShapes(nextShapes);
    const merged = composeSanitizedDoc(editor?.getJSON() ?? contentRef.current, {
      pageSetup: nextSetup,
      shapes: nextShapes,
    });
    contentRef.current = merged;
    saverRef.current?.update({ title: titleRef.current, content: merged });
  };

  const handleUpdatePageSetup = (patch: Partial<DocPageSetup>) => {
    commitSharedMeta({
      pageSetup: normalizeDocPageSetup({
        ...pageSetupRef.current,
        ...patch,
        margins: patch.margins
          ? { ...pageSetupRef.current.margins, ...patch.margins }
          : pageSetupRef.current.margins,
        pageColors: patch.pageColors ?? pageSetupRef.current.pageColors,
      }),
    });
  };

  const handleSetPageColor = (pageIndex: number, hexColor: string) => {
    const norm = normalizeHexColor(hexColor) || "#ffffff";
    const nextMap = { ...pageSetupRef.current.pageColors };
    if (norm === "#ffffff") delete nextMap[String(pageIndex)];
    else nextMap[String(pageIndex)] = norm;
    handleUpdatePageSetup({ pageColors: nextMap });
  };

  const handleInsertShape = (shapeType: DocShapeType) => {
    if (!canEdit) return;
    const nextShape = createDefaultDocShape(shapeType, activePageIndex, dims, shapes.length);
    const nextShapes = [...shapesRef.current, nextShape];
    commitSharedMeta({ shapes: nextShapes });
    setSelectedShapeId(nextShape.id);
  };

  const handleDownload = async (format: DocDownloadFormat) => {
    setDownloadMenuOpen(false);
    await saverRef.current?.flush().catch(() => {});
    const current = contentRef.current || composeSanitizedDoc(editor?.getJSON());
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
      notify(`Downloaded .${format}`);
    } catch (error) {
      notify(docErrorMessage(error, "Could not download document."), "error");
    }
  };

  if (loading) {
    return (
      <main className="pd-public-screen pd-public-centered" role="status">
        <div className="pd-loading">
          <Spinner className="size-4 text-primary" />
          <span>Opening shared document…</span>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="pd-public-screen pd-public-centered">
        <div className="pd-public-unavailable-card">
          <div className="pd-public-brand-row">
            <a href="/" className="pd-public-brand">
              <ShieldCheck size={18} className="text-primary" />
              <span>Persora Docs</span>
            </a>
            <ThemeToggleButton />
          </div>
          <PersoraEmptyState
            moduleId="docs"
            tone="blue"
            title="Shared document unavailable"
            description={loadError}
            action={
              <div className="pd-error-actions">
                <button
                  type="button"
                  className="pd-btn-secondary"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  <RefreshCw size={14} /> Try again
                </button>
                {signedInUser ? (
                  <button
                    type="button"
                    className="pd-btn-primary"
                    onClick={onOpenWorkspace}
                  >
                    Open workspace
                  </button>
                ) : (
                  <button type="button" className="pd-btn-primary" onClick={onSignIn}>
                    Sign in
                  </button>
                )}
              </div>
            }
          />
        </div>
      </main>
    );
  }

  const stageHeightPx =
    pageCount * dims.heightPx + Math.max(0, pageCount - 1) * PAGE_GAP_PX;

  return (
    <main className="pd-public-screen">
      <header className="pd-topbar">
        <div className="pd-topbar-left">
          <LauncherModuleIcon id="docs" size={24} />
          <div className="pd-title-cluster">
            {canEdit ? (
              <AutoWidthDocTitle
                value={title}
                onChange={(raw) => {
                  setTitle(raw);
                  const cleaned = raw.trim() ? raw.trim().slice(0, 160) : "Untitled document";
                  titleRef.current = cleaned;
                  if (contentRef.current) {
                    saverRef.current?.update({
                      title: cleaned,
                      content: contentRef.current,
                    });
                  }
                }}
                onBlur={() => {
                  const cleaned = cleanDocTitle(title, { allowEmptyDefault: true });
                  setTitle(cleaned);
                  titleRef.current = cleaned;
                }}
              />
            ) : (
              <h1 className="pd-title-readonly">{title}</h1>
            )}

            <Badge variant={canEdit ? "primary-light" : "secondary"} size="xs" radius="full">
              {canEdit ? <Pencil size={11} /> : <Eye size={11} />}
              <span>{canEdit ? "Can edit" : `Shared by ${ownerName} · View only`}</span>
            </Badge>

            {canEdit && (
              <DocSaveBadge
                state={saveState}
                onRetry={() => saverRef.current?.retry()}
              />
            )}
          </div>
        </div>

        <div className="pd-topbar-right">
          <button
            type="button"
            className="pd-btn-secondary"
            onClick={async () => {
              await saverRef.current?.flush().catch(() => {});
              setPrintModalOpen(true);
            }}
            title="Print preview & settings"
          >
            <Printer size={14} />
            <span className="pd-action-label">Print</span>
          </button>

          <div className="pd-tb-dropdown-wrap">
            <button
              type="button"
              className="pd-btn-secondary"
              onClick={() => setDownloadMenuOpen((v) => !v)}
              disabled={exportingPdf}
              title="Download document"
            >
              {exportingPdf ? <Spinner className="size-3.5" /> : <Download size={14} />}
              <span className="pd-action-label">Download</span>
              <ChevronDown size={12} />
            </button>
            {downloadMenuOpen && (
              <div className="pd-tb-popover pd-download-menu" role="menu">
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
              </div>
            )}
          </div>

          <ThemeToggleButton />
          {signedInUser ? (
            <button type="button" className="pd-btn-primary" onClick={onOpenWorkspace}>
              Workspace
            </button>
          ) : (
            <div className="pd-public-auth">
              <button type="button" className="pd-btn-secondary" onClick={onSignIn}>
                Sign in
              </button>
              <button type="button" className="pd-btn-primary" onClick={onCreateAccount}>
                Get started
              </button>
            </div>
          )}
        </div>
      </header>

      {canEdit && (
        <div className="pd-toolbar-bar">
          <DocFormattingToolbar
            editor={editor}
            linkTriggerNonce={linkTriggerNonce}
            zoomSetting={zoomSetting}
            effectiveZoomPercent={Math.round(zoomScale * 100)}
            onChangeZoom={setZoomSetting}
            pageSetup={pageSetup}
            activePageIndex={activePageIndex}
            pageCount={pageCount}
            onUpdatePageSetup={handleUpdatePageSetup}
            onSetPageColor={handleSetPageColor}
            onInsertShape={handleInsertShape}
            onFocusHeaderFooter={() => {}}
            onRequestAddComment={() => {}}
            notify={notify}
          />
        </div>
      )}

      <div className="pd-canvas">
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
          >
            <div className="pd-pages-backdrop" style={{ gap: `${PAGE_GAP_PX}px` }}>
              {Array.from({ length: pageCount }, (_, pIdx) => {
                const pageBg = pageSetup.pageColors[String(pIdx)] || "#ffffff";
                const hideFirst = pageSetup.differentFirstPage && pIdx === 0;
                const pageNumLabel = formatDocPageNumber(pageSetup, pIdx, pageCount);
                return (
                  <section
                    key={pIdx}
                    className="pd-page-card"
                    data-page-index={pIdx}
                    style={{
                      width: `${dims.widthPx}px`,
                      height: `${dims.heightPx}px`,
                      backgroundColor: pageBg,
                    }}
                  >
                    <div
                      className="pd-hf-zone is-header"
                      style={{
                        height: `${dims.marginTopPx}px`,
                        paddingLeft: `${dims.marginLeftPx}px`,
                        paddingRight: `${dims.marginRightPx}px`,
                      }}
                    >
                      <div className="pd-hf-display">
                        <span
                          className="pd-hf-display-text"
                          style={{ textAlign: pageSetup.headerAlign }}
                        >
                          {!hideFirst ? pageSetup.headerText : ""}
                        </span>
                        {pageNumLabel && pageSetup.pageNumberPosition.startsWith("header-") && (
                          <span className="pd-hf-pagenum-live">{pageNumLabel}</span>
                        )}
                      </div>
                    </div>

                    <div
                      className="pd-hf-zone is-footer"
                      style={{
                        height: `${dims.marginBottomPx}px`,
                        paddingLeft: `${dims.marginLeftPx}px`,
                        paddingRight: `${dims.marginRightPx}px`,
                      }}
                    >
                      <div className="pd-hf-display">
                        <span
                          className="pd-hf-display-text"
                          style={{ textAlign: pageSetup.footerAlign }}
                        >
                          {!hideFirst ? pageSetup.footerText : ""}
                        </span>
                        {pageNumLabel && pageSetup.pageNumberPosition.startsWith("footer-") && (
                          <span className="pd-hf-pagenum-live">{pageNumLabel}</span>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>

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

            <DocShapesLayer
              shapes={shapes}
              dims={dims}
              pageCount={pageCount}
              zoomScale={zoomScale}
              canEdit={canEdit}
              selectedShapeId={selectedShapeId}
              onSelectShape={setSelectedShapeId}
              onChangeShapes={(nextShapes) => commitSharedMeta({ shapes: nextShapes })}
            />
          </div>
        </div>
      </div>

      {printModalOpen && (
        <DocPrintModal
          title={titleRef.current}
          doc={contentRef.current || composeSanitizedDoc(editor?.getJSON())}
          livePageBlocks={livePageBlocks}
          onExportPdf={() => {
            setPrintModalOpen(false);
            void handleDownload("pdf");
          }}
          onClose={() => setPrintModalOpen(false)}
        />
      )}
    </main>
  );
}
