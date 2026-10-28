import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import type { PDFDocument } from "pdf-lib";
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpRight, ChevronLeft, ChevronRight, Circle, CloudUpload, Copy, Download, FileImage, FilePlus2, FileStack, Files, Highlighter,
  Image as ImageIcon, Info, Minus, MousePointer2, PenLine, Pencil, Plus, Redo2, RotateCcw, RotateCw, Scissors, Signature, Square, Stamp, Strikethrough, Trash2, Type, Underline, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { PdfStudioDocument, PdfStudioFileMeta, PdfStudioSaveInput, TransferProgress, VaultFolder } from "../types";
import {
  HIGHLIGHT_COLORS, IMAGE_ACCEPT, OVERLAY_COLORS, PDF_MAX_TOTAL_PAGES, PDF_OPEN_MAX_BYTES, CREATE_ACCEPT, buildZip, decodeText, describePages, errorMessage, formatBytes, makeId,
  defaultTextWatermark, normalizeWatermark, pageCountLabel, pdfDownloadName, pushHistory, redoHistory, rotatePage, sniffFileKind, titleFromFileName, totalRotation, undoHistory, unsupportedReason, viewSize,
  watermarkOnPage, type DocState, type History, type Overlay, type Watermark, type WorkingPage,
} from "../lib/pdf-studio";
import { buildPdf, createBlankPdf, exportDocument, loadPdfForEditing } from "../lib/pdf-engine";
import { createRenderQueue, openPdf, readPageInfo, renderPageToCanvas, renderThumbnailDataUrl } from "../lib/pdf-render";
import { canvasToBytes, downloadBytes, drawOverlaysOnCanvas, drawWatermarkOnCanvas, measureTextOverlay, prepareImage, rasterizeTextOverlay, rasterizeTextPages, rasterizeWatermarkText, releaseCanvas } from "../lib/pdf-canvas";
import { PdfPageView, PdfThumbnail, cloneOverlay, translateOverlay, type EditingText, type SourceRef, type Tool, type ToolStyle } from "./PdfEditorPages";
import { ExportImagesDialog, SignatureDialog, SplitDialog, type ExportImagesRequest, type SignatureResult, type SplitRequest } from "./PdfEditorDialogs";
import PdfSaveModal, { type SaveChoice, type SaveProgress } from "./PdfSaveModal";
import PdfWatermarkPanel from "./PdfWatermarkPanel";
import ModalPortal from "./ModalPortal";
import { ConfirmDialog } from "./VaultDialogs";
import "./pdf-studio.css";

export type EditorRequest =
  | { kind: "files"; files: File[] }
  | { kind: "created"; bytes: Uint8Array; title: string }
  | { kind: "saved"; document: PdfStudioDocument; bytes: Uint8Array };

export interface PdfSaveHandlers {
  saveNew: (file: Blob, input: PdfStudioSaveInput, meta: PdfStudioFileMeta, onProgress?: (progress: TransferProgress) => void) => Promise<PdfStudioDocument>;
  replace: (id: string, file: Blob, meta: PdfStudioFileMeta, onProgress?: (progress: TransferProgress) => void) => Promise<PdfStudioDocument>;
}

interface Props {
  request: EditorRequest;
  folders: VaultFolder[];
  defaultFolderId: string | null;
  canSave: boolean;
  saveBlockedReason?: string;
  maxUploadMb: number;
  onUpgrade?: () => void;
  handlers: PdfSaveHandlers;
  onClose: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

interface EditorImage { id: string; bytes: Uint8Array; mime: "image/jpeg" | "image/png"; url: string; width: number; height: number; signature: boolean }
interface ImportInput { name: string; file?: File; bytes?: Uint8Array }
type Dialog = null | "split" | "export" | "signature" | "save" | "close" | "delete";

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const STROKES = [1, 2, 3, 5, 8];
const FONT_SIZES = [8, 10, 12, 14, 16, 18, 24, 32, 48, 72];
const STICKY_TOOLS: Tool[] = ["highlight", "underline", "strike", "ink"];

/** Annotate tools in toolbar order (signature, image and watermark follow them). */
const TOOLS: { id: Tool; label: string; key: string; icon: typeof Type }[] = [
  { id: "select", label: "Select & move", key: "V", icon: MousePointer2 },
  { id: "text", label: "Add text", key: "T", icon: Type },
  { id: "highlight", label: "Highlight", key: "H", icon: Highlighter },
  { id: "underline", label: "Underline", key: "U", icon: Underline },
  { id: "strike", label: "Strike-through", key: "X", icon: Strikethrough },
  { id: "ink", label: "Freehand pen", key: "P", icon: Pencil },
  { id: "rect", label: "Rectangle", key: "R", icon: Square },
  { id: "ellipse", label: "Ellipse", key: "O", icon: Circle },
  { id: "line", label: "Line", key: "L", icon: Minus },
  { id: "arrow", label: "Arrow", key: "A", icon: ArrowUpRight },
];
type EditMode = "annotate" | "pages";

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)));
}

function ToolButton({ label, tip, icon, pressed, onClick, disabled, danger, showLabel }: { label: string; tip?: string; icon: ReactNode; pressed?: boolean; onClick: () => void; disabled?: boolean; danger?: boolean; showLabel?: boolean }) {
  return <button type="button" className={`pdfs-tool ${pressed ? "is-active" : ""} ${danger ? "pdfs-danger" : ""} ${showLabel ? "has-label" : ""}`} aria-label={label} aria-pressed={pressed === undefined ? undefined : pressed} data-tip={tip || label} onClick={onClick} disabled={disabled}>
    {icon}{showLabel && <span>{label}</span>}
  </button>;
}

/** Page number box: typing doesn't jump around; Enter or leaving the field goes to the page. */
function PageInput({ current, total, onGo }: { current: number; total: number; onGo: (page: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const value = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(value) && value >= 1) onGo(Math.min(total, value));
  };
  return <label className="pdfs-page-input">
    <input type="text" inputMode="numeric" value={draft ?? String(current)} onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, "").slice(0, 5))} onFocus={(event) => event.target.select()} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } if (event.key === "Escape") { event.stopPropagation(); setDraft(null); event.currentTarget.blur(); } }}
      aria-label={`Page number, 1 to ${total}`}/>
    <span>/ {total}</span>
  </label>;
}

export default function PdfEditorModal({ request, folders, defaultFolderId, canSave, saveBlockedReason, maxUploadMb, onUpgrade, handlers, onClose, notify }: Props) {
  const titleId = useId();
  const sources = useRef(new Map<string, SourceRef>());
  const libCache = useRef(new Map<string, Promise<PDFDocument>>());
  const images = useRef(new Map<string, EditorImage>());
  const thumbCache = useRef(new Map<string, Promise<string>>());
  const htmlImages = useRef(new Map<string, Promise<HTMLImageElement>>());
  const thumbQueue = useMemo(() => createRenderQueue(2), []);
  const revCounter = useRef(1);
  const [sourceVersion, setSourceVersion] = useState(0);
  const [imageVersion, setImageVersion] = useState(0);
  const [history, setHistory] = useState<History<DocState>>({ past: [], present: { pages: [], rev: 0, watermark: null }, future: [] });
  const [savedRev, setSavedRev] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadMessage, setLoadMessage] = useState("Loading the PDF tools…");
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState(request.kind === "saved" ? request.document.title : request.kind === "created" ? request.title : request.files.length === 1 ? titleFromFileName(request.files[0].name) : "Merged PDF");
  const [linked, setLinked] = useState<PdfStudioDocument | null>(request.kind === "saved" ? request.document : null);
  const [tool, setTool] = useState<Tool>("select");
  const [style, setStyle] = useState<ToolStyle>({ color: "#111827", highlightColor: HIGHLIGHT_COLORS[0], markupColor: "#dc2626", strokeWidth: 2, fontSize: 14, bold: false, fill: false });
  const [editMode, setEditMode] = useState<EditMode>("annotate");
  /** Watermark being edited in the panel (previewed live); null when the panel is closed. */
  const [wmDraft, setWmDraft] = useState<Watermark | null>(null);
  const [selection, setSelection] = useState<{ pageId: string; overlayId: string } | null>(null);
  const [editing, setEditing] = useState<EditingText | null>(null);
  const [placing, setPlacing] = useState<{ imageId: string; signature: boolean } | null>(null);
  const [currentId, setCurrentId] = useState("");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const [zoomMode, setZoomMode] = useState<"auto" | "fit-width" | "fit-page" | "custom">("auto");
  const [zoom, setZoom] = useState(1);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [rail, setRail] = useState<HTMLOListElement | null>(null);
  const pageEls = useRef(new Map<string, HTMLElement>());
  const [busy, setBusy] = useState<{ label: string; percent: number | null } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [dragPage, setDragPage] = useState<string | null>(null);
  const [dropPage, setDropPage] = useState<string | null>(null);
  const [fileDrag, setFileDrag] = useState(false);
  const fileDragDepth = useRef(0);
  const [insertOpen, setInsertOpen] = useState(false);
  const insertInput = useRef<HTMLInputElement>(null);
  const insertWhere = useRef<"after" | "end">("after");
  const imageInput = useRef<HTMLInputElement>(null);
  const pendingScroll = useRef<string | null>(null);

  const pages = history.present.pages;
  const watermark = history.present.watermark;
  const wmOpen = tool === "watermark" && wmDraft !== null;
  const shownWatermark = wmOpen ? wmDraft : watermark;
  const dirty = history.present.rev !== savedRev;
  const currentIndex = Math.max(0, pages.findIndex((page) => page.id === currentId));
  const currentPage = pages[currentIndex];
  const selectedIndexes = useMemo(() => pages.map((page, index) => selectedPages.has(page.id) ? index : -1).filter((index) => index >= 0), [pages, selectedPages]);
  const selectedOverlay = selection ? pages.find((page) => page.id === selection.pageId)?.overlays.find((overlay) => overlay.id === selection.overlayId) || null : null;
  const overlayCount = useMemo(() => pages.reduce((sum, page) => sum + page.overlays.length, 0), [pages]);

  // ----- History -----------------------------------------------------------
  /** Applies a change to the whole document (pages and watermark) as one undo step. */
  const commitDoc = useCallback((update: (doc: Omit<DocState, "rev">) => Omit<DocState, "rev">) => {
    setHistory((current) => {
      const next = update({ pages: current.present.pages, watermark: current.present.watermark });
      if (next.pages === current.present.pages && next.watermark === current.present.watermark) return current;
      revCounter.current += 1;
      return pushHistory(current, { pages: next.pages, watermark: next.watermark, rev: revCounter.current });
    });
  }, []);
  const commit = useCallback((update: (pages: WorkingPage[]) => WorkingPage[]) => {
    commitDoc((doc) => ({ ...doc, pages: update(doc.pages) }));
  }, [commitDoc]);
  const undo = useCallback(() => { setEditing(null); setSelection(null); setHistory(undoHistory); }, []);
  const redo = useCallback(() => { setEditing(null); setSelection(null); setHistory(redoHistory); }, []);

  // ----- Importing files into the working document --------------------------
  const importInputs = useCallback(async (inputs: ImportInput[], existingPages: number, report: (message: string) => void) => {
    const added: SourceRef[] = [];
    const newPages: WorkingPage[] = [];
    const errors: string[] = [];
    const caches = new Map<string, Promise<PDFDocument>>();
    for (const input of inputs) {
      let pdf: SourceRef["pdf"] | null = null;
      try {
        const size = input.file ? input.file.size : input.bytes?.byteLength || 0;
        if (size > PDF_OPEN_MAX_BYTES) throw new Error(`“${input.name}” is larger than ${PDF_OPEN_MAX_BYTES / 1024 / 1024} MB, which is more than PDF Studio can edit in the browser.`);
        report(`Reading “${input.name}”…`);
        let bytes = input.bytes || new Uint8Array(await (input.file as File).arrayBuffer());
        const kind = sniffFileKind(bytes.subarray(0, 1024), input.name, input.file?.type || "");
        if (kind === "unsupported") throw new Error(unsupportedReason(input.name));
        if (kind === "text") {
          bytes = await buildPdf([{ kind: "text", name: input.name, text: decodeText(bytes), title: titleFromFileName(input.name) }], { pageSize: "a4", orientation: "portrait", margin: "small", fontSize: 12, title: titleFromFileName(input.name) }, { rasterizeTextPages });
        } else if (kind !== "pdf") {
          const image = await prepareImage(bytes, input.name, kind);
          bytes = await buildPdf([{ kind: "image", name: input.name, image }], { pageSize: "fit", orientation: "auto", margin: "none", fontSize: 12, title: titleFromFileName(input.name) });
        }
        report(`Opening “${input.name}”…`);
        pdf = await openPdf(bytes, `“${input.name}”`);
        const id = makeId("src");
        const editable = loadPdfForEditing(bytes, `“${input.name}”`);
        const [info] = await Promise.all([readPageInfo(pdf, (done, total) => { if (total > 40) report(`Reading pages of “${input.name}” (${done}/${total})…`); }), editable]);
        if (existingPages + newPages.length + info.length > PDF_MAX_TOTAL_PAGES) {
          throw new Error(`Adding “${input.name}” would go over ${PDF_MAX_TOTAL_PAGES.toLocaleString("en-US")} pages, the most PDF Studio can edit at once. Split it first, then edit the parts.`);
        }
        caches.set(id, editable);
        added.push({ id, name: input.name, bytes, pdf });
        newPages.push(...info.map((entry, index) => ({ id: makeId("pg"), sourceId: id, sourceIndex: index, width: entry.width, height: entry.height, baseRotation: entry.rotation, rotation: 0 as const, overlays: [] })));
      } catch (error) {
        if (pdf) void pdf.destroy();
        errors.push(errorMessage(error, `“${input.name}” couldn't be opened.`));
      }
    }
    return { added, newPages, errors, caches };
  }, []);

  const adopt = useCallback((result: Awaited<ReturnType<typeof importInputs>>) => {
    for (const source of result.added) sources.current.set(source.id, source);
    for (const [id, cache] of result.caches) libCache.current.set(id, cache);
    if (result.added.length) setSourceVersion((value) => value + 1);
  }, []);

  // Initial load. Each run keeps its own results so a cancelled run (React
  // StrictMode re-mount, fast close) releases everything it opened.
  useEffect(() => {
    let cancelled = false;
    const inputs: ImportInput[] = request.kind === "files"
      ? request.files.map((file) => ({ name: file.name, file }))
      : [{ name: request.kind === "saved" ? request.document.fileName : `${request.title}.pdf`, bytes: request.bytes }];
    void importInputs(inputs, 0, (message) => { if (!cancelled) setLoadMessage(message); }).then((result) => {
      if (cancelled) { for (const source of result.added) void source.pdf.destroy(); return; }
      if (!result.newPages.length) { setLoadError(result.errors.join(" ") || "Nothing could be opened."); setPhase("error"); return; }
      adopt(result);
      revCounter.current = 1;
      setHistory({ past: [], present: { pages: result.newPages, rev: 1, watermark: null }, future: [] });
      // A single PDF opened as-is (or a saved PDF) starts clean; merged/converted/created documents are new work.
      const clean = request.kind === "saved" || (request.kind === "files" && request.files.length === 1 && result.added.length === 1 && /\.pdf$/i.test(request.files[0].name));
      setSavedRev(clean ? 1 : 0);
      setCurrentId(result.newPages[0].id);
      setPhase("ready");
      if (result.errors.length) notify(result.errors.join(" "), "error");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release PDF.js documents and image URLs when the editor closes.
  useEffect(() => () => {
    for (const source of sources.current.values()) void source.pdf.destroy();
    for (const image of images.current.values()) URL.revokeObjectURL(image.url);
    sources.current.clear(); images.current.clear(); libCache.current.clear(); thumbCache.current.clear(); htmlImages.current.clear();
  }, []);

  // Warn before leaving the page with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Keep page selection consistent with the document.
  useEffect(() => {
    if (!pages.length) return;
    if (!pages.some((page) => page.id === currentId)) setCurrentId(pages[Math.min(currentIndex, pages.length - 1)].id);
    setSelectedPages((current) => { const ids = new Set(pages.map((page) => page.id)); const next = new Set([...current].filter((id) => ids.has(id))); return next.size === current.size ? current : next; });
    if (selection && !pages.find((page) => page.id === selection.pageId)?.overlays.some((overlay) => overlay.id === selection.overlayId)) setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const source = useCallback((id: string) => sources.current.get(id), [sourceVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const imageUrl = useCallback((id: string) => images.current.get(id)?.url, [imageVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const register = useCallback((pageId: string, element: HTMLElement | null) => { if (element) pageEls.current.set(pageId, element); else pageEls.current.delete(pageId); }, []);

  // ----- Zoom & navigation ---------------------------------------------------
  // Fit width uses the widest page so mixed portrait/landscape documents never scroll sideways.
  const widest = useMemo(() => pages.reduce((max, page) => Math.max(max, viewSize(page).width), 0), [pages]);
  const fitZoom = useCallback((mode: "auto" | "fit-width" | "fit-page") => {
    if (!scroller || !currentPage) return 1;
    const view = viewSize(currentPage);
    const width = Math.max(120, scroller.clientWidth - 40);
    const height = Math.max(120, scroller.clientHeight - 40);
    const fitWidth = width / Math.max(widest, view.width);
    const value = mode === "fit-page" ? Math.min(width / view.width, height / view.height) : mode === "auto" ? Math.min(fitWidth, 1.5) : fitWidth;
    return Math.max(0.1, Math.min(4, value));
  }, [scroller, currentPage, widest]);

  useEffect(() => {
    if (zoomMode === "custom" || !scroller) return;
    const apply = () => setZoom(fitZoom(zoomMode));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [zoomMode, scroller, fitZoom]);

  const scrollToPage = useCallback((pageId: string, smooth = true) => {
    const element = pageEls.current.get(pageId);
    if (!element || !scroller) return;
    const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
    scroller.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }, [scroller]);

  const goToIndex = useCallback((index: number) => {
    const page = pages[Math.max(0, Math.min(pages.length - 1, index))];
    if (!page) return;
    setCurrentId(page.id);
    scrollToPage(page.id);
  }, [pages, scrollToPage]);

  // Keep the current page anchored when the zoom changes.
  const lastZoom = useRef(zoom);
  useLayoutEffect(() => {
    if (lastZoom.current !== zoom && currentId) scrollToPage(currentId, false);
    lastZoom.current = zoom;
  }, [zoom, currentId, scrollToPage]);

  // Scroll to pages inserted by an operation once they exist.
  useEffect(() => {
    const target = pendingScroll.current;
    if (target && pageEls.current.has(target)) { pendingScroll.current = null; scrollToPage(target); }
  });

  const scrollTick = useRef(0);
  const onScroll = () => {
    if (scrollTick.current) return;
    scrollTick.current = requestAnimationFrame(() => {
      scrollTick.current = 0;
      if (!scroller) return;
      const probe = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.35;
      let best = pages[0]?.id || "";
      for (const page of pages) {
        const element = pageEls.current.get(page.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top <= probe) best = page.id; else break;
      }
      if (best && best !== currentId) setCurrentId(best);
    });
  };

  const setZoomValue = (value: number) => { setZoomMode("custom"); setZoom(Math.max(0.1, Math.min(4, value))); };
  const zoomStep = (direction: 1 | -1) => {
    const next = direction > 0 ? ZOOM_STEPS.find((step) => step > zoom + 0.001) : [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001);
    setZoomValue(next ?? zoom);
  };

  // ----- Page operations -----------------------------------------------------
  const targetIds = () => selectedPages.size ? pages.filter((page) => selectedPages.has(page.id)).map((page) => page.id) : currentPage ? [currentPage.id] : [];
  const rotate = (delta: number) => {
    const ids = new Set(targetIds());
    commit((current) => current.map((page) => ids.has(page.id) ? rotatePage(page, delta, measureTextOverlay) : page));
    setSelection(null);
  };
  const deletePages = () => {
    const ids = new Set(targetIds());
    if (ids.size >= pages.length) { notify("A PDF needs at least one page. Select fewer pages to delete.", "error"); setDialog(null); return; }
    commit((current) => current.filter((page) => !ids.has(page.id)));
    setSelectedPages(new Set());
    setDialog(null);
    notify(`${ids.size === 1 ? "Page" : `${ids.size} pages`} deleted. Use Undo to bring ${ids.size === 1 ? "it" : "them"} back.`);
  };
  const duplicatePages = () => {
    const ids = new Set(targetIds());
    let firstCopy = "";
    const copies = new Map<string, string>();
    commitDoc((doc) => {
      const nextPages = doc.pages.flatMap((page) => {
        if (!ids.has(page.id)) return [page];
        const copy = { ...page, id: copies.get(page.id) || makeId("pg"), overlays: page.overlays.map((overlay) => cloneOverlay(overlay)) };
        copies.set(page.id, copy.id);
        firstCopy ||= copy.id;
        return [page, copy];
      });
      // A copy of a watermarked page keeps the watermark.
      const mark = doc.watermark;
      const nextWatermark = mark && mark.pages.mode === "pages"
        ? { ...mark, pages: { ...mark.pages, pageIds: mark.pages.pageIds.flatMap((id) => copies.has(id) ? [id, copies.get(id) as string] : [id]) } }
        : mark;
      return { pages: nextPages, watermark: nextWatermark };
    });
    if (firstCopy) { setCurrentId(firstCopy); pendingScroll.current = firstCopy; }
  };
  const movePage = (delta: number) => {
    if (!currentPage) return;
    const id = currentPage.id;
    commit((current) => {
      const index = current.findIndex((page) => page.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current]; const [page] = next.splice(index, 1); next.splice(target, 0, page);
      return next;
    });
    pendingScroll.current = id;
  };
  const dropOnPage = (targetId: string) => {
    const moving = dragPage;
    setDragPage(null); setDropPage(null);
    if (!moving || moving === targetId) return;
    const block = selectedPages.has(moving) && selectedPages.size > 1 ? pages.filter((page) => selectedPages.has(page.id)).map((page) => page.id) : [moving];
    if (block.includes(targetId)) return;
    commit((current) => {
      const movingPages = current.filter((page) => block.includes(page.id));
      const from = current.findIndex((page) => page.id === moving);
      const to = current.findIndex((page) => page.id === targetId);
      const rest = current.filter((page) => !block.includes(page.id));
      const anchor = rest.findIndex((page) => page.id === targetId);
      rest.splice(from < to ? anchor + 1 : anchor, 0, ...movingPages);
      return rest;
    });
    setCurrentId(moving);
  };
  const togglePage = (pageId: string, range: boolean) => {
    setSelectedPages((current) => {
      const next = new Set(current);
      if (range && anchorRef.current) {
        const a = pages.findIndex((page) => page.id === anchorRef.current); const b = pages.findIndex((page) => page.id === pageId);
        if (a >= 0 && b >= 0) { for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) next.add(pages[i].id); return next; }
      }
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      anchorRef.current = pageId;
      return next;
    });
  };

  const insertResult = (result: Awaited<ReturnType<typeof importInputs>>, where: "after" | "end") => {
    if (!result.newPages.length) { if (result.errors.length) notify(result.errors.join(" "), "error"); return; }
    adopt(result);
    const anchorId = currentPage?.id;
    commit((current) => {
      if (where === "end" || !anchorId) return [...current, ...result.newPages];
      const index = current.findIndex((page) => page.id === anchorId);
      return [...current.slice(0, index + 1), ...result.newPages, ...current.slice(index + 1)];
    });
    setCurrentId(result.newPages[0].id);
    pendingScroll.current = result.newPages[0].id;
    notify(`Added ${pageCountLabel(result.newPages.length)}.${result.errors.length ? ` ${result.errors.join(" ")}` : ""}`, result.errors.length ? "error" : "success");
  };
  const insertFiles = async (files: File[], where: "after" | "end") => {
    if (!files.length) return;
    setBusy({ label: "Adding pages…", percent: null });
    try {
      const result = await importInputs(files.map((file) => ({ name: file.name, file })), pages.length, (message) => setBusy({ label: message, percent: null }));
      insertResult(result, where);
    } finally { setBusy(null); }
  };
  const insertBlank = async () => {
    setInsertOpen(false);
    const view = currentPage ? viewSize(currentPage) : { width: 595.28, height: 841.89 };
    setBusy({ label: "Adding a blank page…", percent: null });
    try {
      const bytes = await createBlankPdf(view.width, view.height);
      insertResult(await importInputs([{ name: "Blank page.pdf", bytes }], pages.length, () => undefined), "after");
    } catch (error) { notify(errorMessage(error, "The blank page couldn't be added."), "error"); }
    finally { setBusy(null); }
  };

  // ----- Overlays ------------------------------------------------------------
  const setOverlays = useCallback((pageId: string, overlays: Overlay[], selectId?: string | null) => {
    commit((current) => current.map((page) => page.id === pageId ? { ...page, overlays } : page));
    if (selectId) setSelection({ pageId, overlayId: selectId });
    setCurrentId(pageId);
    setTool((current) => STICKY_TOOLS.includes(current) || current === "select" ? current : "select");
  }, [commit]);
  const appendOverlays = useCallback((pageId: string, overlays: Overlay[]) => {
    commit((current) => current.map((page) => page.id === pageId ? { ...page, overlays: [...page.overlays, ...overlays] } : page));
    setCurrentId(pageId);
  }, [commit]);
  const onSelectOverlay = useCallback((pageId: string, overlayId: string | null) => {
    setSelection(overlayId ? { pageId, overlayId } : null);
    setCurrentId(pageId);
  }, []);
  const updateOverlay = (patch: Partial<Overlay>) => {
    if (!selection || !selectedOverlay) return;
    const updated = { ...selectedOverlay, ...patch } as Overlay;
    commit((current) => current.map((page) => page.id === selection.pageId ? { ...page, overlays: page.overlays.map((overlay) => overlay.id === updated.id ? updated : overlay) } : page));
  };
  const removeOverlay = () => {
    if (!selection) return;
    commit((current) => current.map((page) => page.id === selection.pageId ? { ...page, overlays: page.overlays.filter((overlay) => overlay.id !== selection.overlayId) } : page));
    setSelection(null);
  };
  const duplicateOverlay = () => {
    if (!selection || !selectedOverlay) return;
    const copy = cloneOverlay(selectedOverlay, 12);
    commit((current) => current.map((page) => page.id === selection.pageId ? { ...page, overlays: [...page.overlays, copy] } : page));
    setSelection({ pageId: selection.pageId, overlayId: copy.id });
  };
  const nudge = (dx: number, dy: number) => {
    if (!selectedOverlay) return;
    updateOverlay(translateOverlay(selectedOverlay, dx, dy));
  };
  const finishText = useCallback((edit: EditingText, text: string) => {
    setEditing(null);
    const clean = text.replace(/\s+$/, "");
    commit((current) => current.map((page) => {
      if (page.id !== edit.pageId) return page;
      if (edit.isNew) return clean ? { ...page, overlays: [...page.overlays, { ...edit.overlay, text: clean }] } : page;
      return { ...page, overlays: clean ? page.overlays.map((overlay) => overlay.id === edit.overlay.id ? { ...edit.overlay, text: clean } : overlay) : page.overlays.filter((overlay) => overlay.id !== edit.overlay.id) };
    }));
    if (clean) setSelection({ pageId: edit.pageId, overlayId: edit.overlay.id });
    setTool("select");
  }, [commit]);

  const registerImage = (bytes: Uint8Array, mime: "image/jpeg" | "image/png", width: number, height: number, signature: boolean) => {
    const id = makeId("img");
    images.current.set(id, { id, bytes, mime, width, height, signature, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) });
    setImageVersion((value) => value + 1);
    return id;
  };
  const startPlacing = (imageId: string, signature: boolean) => {
    setPlacing({ imageId, signature }); setTool("place"); setSelection(null);
    notify(signature ? "Click on the page where your signature should go." : "Click on the page where the image should go.");
  };
  const onPlace = useCallback((pageId: string, [px, py]: [number, number]) => {
    const image = placing ? images.current.get(placing.imageId) : null;
    const page = pages.find((entry) => entry.id === pageId);
    if (!placing || !image || !page) return;
    const view = viewSize(page);
    let w = Math.min(placing.signature ? 170 : 220, view.width * (placing.signature ? 0.4 : 0.5));
    let h = w * image.height / image.width;
    if (h > view.height * 0.5) { h = view.height * 0.5; w = h * image.width / image.height; }
    const overlay: Overlay = { id: makeId("ov"), type: "image", imageId: image.id, signature: placing.signature, w, h, x: Math.max(0, Math.min(view.width - w, px - w / 2)), y: Math.max(0, Math.min(view.height - h, py - h / 2)) };
    setPlacing(null);
    setOverlays(pageId, [...page.overlays, overlay], overlay.id);
    setTool("select");
  }, [placing, pages, setOverlays]);

  const onImageChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const prepared = await prepareImage(bytes, file.name);
      startPlacing(registerImage(prepared.bytes, prepared.mime, prepared.width, prepared.height, false), false);
    } catch (error) { notify(errorMessage(error, "That image couldn't be added."), "error"); }
  };
  const onSignature = async (result: SignatureResult) => {
    const id = registerImage(result.png, "image/png", result.width, result.height, true);
    setDialog(null);
    startPlacing(id, true);
  };
  const recentSignatures = useMemo(() => [...images.current.values()].filter((image) => image.signature).slice(-4).map((image) => ({ id: image.id, url: image.url })), [imageVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Watermark ------------------------------------------------------------
  const chooseTool = (next: Tool) => {
    setEditMode("annotate");
    setTool(next); setPlacing(null);
    if (next !== "select") setSelection(null);
  };
  const openWatermark = () => {
    setEditMode("annotate");
    setWmDraft(watermark || defaultTextWatermark());
    setTool("watermark"); setPlacing(null); setSelection(null); setEditing(null);
  };
  const closeWatermark = () => { setWmDraft(null); setTool("select"); };
  // Choosing another tool closes the panel (unapplied changes are discarded).
  useEffect(() => { if (tool !== "watermark" && wmDraft) setWmDraft(null); }, [tool, wmDraft]);
  const applyWatermark = (spec: Watermark) => {
    const wasApplied = Boolean(watermark);
    commitDoc((doc) => ({ ...doc, watermark: spec }));
    setWmDraft(spec);
    const where = spec.pages.mode === "all" ? "every page" : spec.pages.label;
    notify(`${wasApplied ? "Watermark updated" : "Watermark applied"} on ${where}. It's built into the PDF when you download or save.`);
  };
  const removeWatermark = () => {
    commitDoc((doc) => ({ ...doc, watermark: null }));
    closeWatermark();
    notify("Watermark removed. Use Undo to bring it back.");
  };
  const onWatermarkPoint = useCallback((_pageId: string, [fx, fy]: [number, number]) => {
    setWmDraft((current) => current ? normalizeWatermark({ ...current, position: "custom", customX: fx, customY: fy }) : current);
  }, []);
  const chooseWatermarkImage = async (file: File) => {
    const prepared = await prepareImage(new Uint8Array(await file.arrayBuffer()), file.name);
    return { imageId: registerImage(prepared.bytes, prepared.mime, prepared.width, prepared.height, false), width: prepared.width, height: prepared.height };
  };
  const watermarkedPages = useMemo(() => watermark ? pages.filter((page) => watermarkOnPage(watermark, page.id)).length : 0, [watermark, pages]);

  // ----- Export, download & save -------------------------------------------
  const exportPages = useCallback(async (subset: WorkingPage[], onProgress?: (done: number, total: number) => void) => {
    const exportSources = new Map([...sources.current.values()].map((entry) => [entry.id, { id: entry.id, name: entry.name, bytes: entry.bytes }]));
    const exportImages = new Map([...images.current.values()].map((image) => [image.id, { bytes: image.bytes, mime: image.mime }]));
    return exportDocument({ sources: exportSources, pages: subset, images: exportImages, title: title.trim() || "PDF", watermark, cache: libCache.current }, { rasterizeText: rasterizeTextOverlay, rasterizeWatermarkText, onProgress });
  }, [title, watermark]);

  const download = async () => {
    if (busy) return;
    const rev = history.present.rev;
    setBusy({ label: "Building your PDF…", percent: 0 });
    try {
      const bytes = await exportPages(pages, (done, total) => setBusy({ label: `Building your PDF (${done}/${total})…`, percent: Math.round(done / total * 100) }));
      downloadBytes(bytes, pdfDownloadName(title));
      // A downloaded copy keeps the work safe, unless this is a saved PDF whose library copy is now out of date.
      if (!linked) setSavedRev(rev);
      notify(linked && dirty ? `Downloaded ${formatBytes(bytes.byteLength)}. Your saved copy in PDF Studio hasn't been updated — use Save to Persora for that.` : `Downloaded “${pdfDownloadName(title)}” (${formatBytes(bytes.byteLength)}).`);
    } catch (error) { notify(errorMessage(error, "The PDF couldn't be built."), "error"); }
    finally { setBusy(null); }
  };

  const runSave = async (choice: SaveChoice) => {
    const rev = history.present.rev;
    try {
      setSaveProgress({ label: "Building your PDF on this device…", percent: null });
      const bytes = await exportPages(pages, (done, total) => setSaveProgress({ label: `Building your PDF (${done}/${total})…`, percent: Math.round(done / total * 35) }));
      const limitMb = Math.max(1, Math.min(150, maxUploadMb || 25));
      if (bytes.byteLength > limitMb * 1024 * 1024) {
        throw new Error(`This PDF is ${formatBytes(bytes.byteLength)}, larger than your ${limitMb} MB upload limit. Download it instead, or remove pages or large images to make it smaller.`);
      }
      setSaveProgress({ label: "Creating a preview…", percent: 38 });
      const thumbnail = await renderThumbnailDataUrl(bytes);
      const first = pages[0] ? viewSize(pages[0]) : null;
      const fileTitle = choice.target === "update" && linked ? linked.title : choice.input.title;
      const meta: PdfStudioFileMeta = {
        pageCount: pages.length,
        thumbnail,
        fileName: pdfDownloadName(fileTitle),
        metadata: { madeWith: request.kind === "created" ? "create" : "edit", annotations: overlayCount, watermark: watermark && watermarkedPages ? watermark.kind : null, firstPageSize: first ? `${Math.round(first.width)}x${Math.round(first.height)}pt` : null },
      };
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const onProgress = (progress: TransferProgress) => setSaveProgress({ label: progress.percent >= 100 ? "Finishing up…" : `Uploading to your private storage… ${progress.percent}%`, percent: 40 + Math.round(progress.percent * 0.6) });
      setSaveProgress({ label: "Uploading to your private storage…", percent: 40 });
      const saved = choice.target === "update" && linked ? await handlers.replace(linked.id, blob, meta, onProgress) : await handlers.saveNew(blob, choice.input, meta, onProgress);
      setLinked(saved);
      setTitle(saved.title);
      setSavedRev(rev);
      setDialog(null);
      notify(choice.target === "update" ? `Updated “${saved.title}” in PDF Studio.` : `Saved “${saved.title}” to PDF Studio.`);
    } finally { setSaveProgress(null); }
  };

  const runSplit = async ({ groups }: SplitRequest) => {
    setDialogBusy(true);
    try {
      const files: { name: string; bytes: Uint8Array }[] = [];
      const used = new Set<string>();
      for (const [index, group] of groups.entries()) {
        setExportProgress(`Creating PDF ${index + 1} of ${groups.length}…`);
        const label = `${group.length === 1 ? "page" : "pages"} ${describePages(group)}`;
        let name = pdfDownloadName(title, ` (${label})`);
        for (let n = 2; used.has(name); n += 1) name = pdfDownloadName(title, ` (${label}) ${n}`);
        used.add(name);
        files.push({ name, bytes: await exportPages(group.map((pageIndex) => pages[pageIndex])) });
      }
      if (files.length === 1) downloadBytes(files[0].bytes, files[0].name);
      else downloadBytes(buildZip(files), `${pdfDownloadName(title).replace(/\.pdf$/, "")} (split).zip`, "application/zip");
      notify(files.length === 1 ? `Downloaded “${files[0].name}”.` : `Downloaded ${files.length} PDFs in one ZIP file.`);
      setDialog(null);
    } catch (error) { notify(errorMessage(error, "The pages couldn't be extracted."), "error"); }
    finally { setDialogBusy(false); setExportProgress(""); }
  };

  const loadHtmlImage = useCallback((imageId: string) => {
    let pending = htmlImages.current.get(imageId);
    if (!pending) {
      const url = images.current.get(imageId)?.url;
      if (!url) return Promise.resolve(null);
      pending = new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url; });
      htmlImages.current.set(imageId, pending);
    }
    return pending.catch(() => null);
  }, []);

  const runExportImages = async ({ pages: indexes, format, dpi, overlays }: ExportImagesRequest) => {
    setDialogBusy(true);
    const extension = format === "image/png" ? "png" : "jpg";
    const base = pdfDownloadName(title).replace(/\.pdf$/, "");
    try {
      const files: { name: string; bytes: Uint8Array }[] = [];
      let clamped = false;
      for (const [position, index] of indexes.entries()) {
        setExportProgress(`Rendering page ${index + 1} (${position + 1} of ${indexes.length})…`);
        const page = pages[index];
        const pageSource = sources.current.get(page.sourceId);
        if (!pageSource) continue;
        const view = viewSize(page);
        const maxScale = Math.sqrt(16_000_000 / Math.max(1, view.width * view.height));
        const scale = Math.min(dpi / 72, maxScale);
        if (scale < dpi / 72) clamped = true;
        const canvas = await renderPageToCanvas(await pageSource.pdf.getPage(page.sourceIndex + 1), scale, page.rotation);
        // The watermark is part of the document, so it's always included; annotations are optional.
        const pageWatermark = watermark && watermarkOnPage(watermark, page.id) ? watermark : null;
        if (pageWatermark || (overlays && page.overlays.length)) {
          const context = canvas.getContext("2d");
          if (context) {
            context.save(); context.scale(canvas.width / view.width, canvas.height / view.height);
            if (pageWatermark) await drawWatermarkOnCanvas(context, pageWatermark, view, loadHtmlImage);
            if (overlays) await drawOverlaysOnCanvas(context, page.overlays, loadHtmlImage);
            context.restore();
          }
        }
        files.push({ name: `${base} - page ${index + 1}.${extension}`, bytes: await canvasToBytes(canvas, format, 0.9) });
        releaseCanvas(canvas);
      }
      if (files.length === 1) downloadBytes(files[0].bytes, files[0].name, format);
      else downloadBytes(buildZip(files), `${base} (images).zip`, "application/zip");
      notify(`${files.length === 1 ? "Exported 1 image" : `Exported ${files.length} images in one ZIP file`}${clamped ? " — very large pages were capped to keep within your browser's limits" : ""}.`);
      setDialog(null);
    } catch (error) { notify(errorMessage(error, "The pages couldn't be exported."), "error"); }
    finally { setDialogBusy(false); setExportProgress(""); }
  };

  // ----- Closing -------------------------------------------------------------
  const requestClose = useCallback(() => {
    if (busy || saveProgress) return;
    if (dirty) setDialog("close"); else onClose();
  }, [busy, saveProgress, dirty, onClose]);

  // ----- Keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    if (phase !== "ready" || dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (mod && key === "y") { event.preventDefault(); redo(); return; }
      if (mod && key === "s") { event.preventDefault(); setDialog("save"); return; }
      if (mod && key === "d" && selectedOverlay) { event.preventDefault(); duplicateOverlay(); return; }
      if (mod || event.altKey) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedOverlay) { event.preventDefault(); removeOverlay(); return; }
      if (event.key === "Escape") {
        event.preventDefault();
        if (placing) { setPlacing(null); setTool("select"); }
        else if (wmOpen) closeWatermark();
        else if (selection) setSelection(null);
        else if (tool !== "select") setTool("select");
        else requestClose();
        return;
      }
      if (selectedOverlay && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        nudge(event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
        return;
      }
      if (event.key === "PageDown") { event.preventDefault(); goToIndex(currentIndex + 1); return; }
      if (event.key === "PageUp") { event.preventDefault(); goToIndex(currentIndex - 1); return; }
      if (key === "w") { if (wmOpen) closeWatermark(); else openWatermark(); return; }
      const shortcut = TOOLS.find((entry) => entry.key.toLowerCase() === key);
      if (shortcut) chooseTool(shortcut.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ----- Drag files onto the editor to insert them -----------------------------
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
  const stageDropHandlers = {
    onDragEnter: (event: DragEvent) => { if (!isFileDrag(event)) return; event.preventDefault(); fileDragDepth.current += 1; setFileDrag(true); },
    onDragOver: (event: DragEvent) => { if (!isFileDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; },
    onDragLeave: () => { fileDragDepth.current = Math.max(0, fileDragDepth.current - 1); if (!fileDragDepth.current) setFileDrag(false); },
    onDrop: (event: DragEvent) => { if (!isFileDrag(event)) return; event.preventDefault(); fileDragDepth.current = 0; setFileDrag(false); void insertFiles(Array.from(event.dataTransfer.files || []), "after"); },
  };

  // ----- Thumbnails --------------------------------------------------------------
  const thumbnail = useCallback((page: WorkingPage, pageSource: SourceRef) => {
    const key = `${pageSource.id}:${page.sourceIndex}:${totalRotation(page)}`;
    let pending = thumbCache.current.get(key);
    if (!pending) {
      pending = thumbQueue(async () => {
        const pdfPage = await pageSource.pdf.getPage(page.sourceIndex + 1);
        const view = viewSize(page);
        const canvas = await renderPageToCanvas(pdfPage, 220 / Math.max(view.width, view.height * 0.75), page.rotation);
        const url = canvas.toDataURL("image/jpeg", 0.72);
        releaseCanvas(canvas);
        return url;
      });
      pending.catch(() => thumbCache.current.delete(key));
      thumbCache.current.set(key, pending);
    }
    return pending;
  }, [thumbQueue]);

  // ----- Contextual properties ------------------------------------------------------
  const activeType = selectedOverlay?.type || (tool === "place" || tool === "select" || tool === "watermark" ? null : tool);
  const isMarkup = activeType === "underline" || activeType === "strike";
  const propColor = selectedOverlay
    ? selectedOverlay.type === "image" ? null : selectedOverlay.color
    : activeType === "highlight" ? style.highlightColor : isMarkup ? style.markupColor : activeType ? style.color : null;
  const setColor = (color: string) => {
    if (selectedOverlay && selectedOverlay.type !== "image") {
      updateOverlay(selectedOverlay.type === "rect" || selectedOverlay.type === "ellipse" ? { color, fill: selectedOverlay.fill ? color : null } as Partial<Overlay> : { color } as Partial<Overlay>);
    }
    setStyle((current) => activeType === "highlight" ? { ...current, highlightColor: color } : isMarkup ? { ...current, markupColor: color } : { ...current, color });
  };
  // Underline / strike-through take their thickness from the text when drawn; it can be changed once selected.
  const propStroke = selectedOverlay && "strokeWidth" in selectedOverlay && selectedOverlay.type !== "highlight" ? selectedOverlay.strokeWidth : ["rect", "ellipse", "line", "arrow", "ink"].includes(activeType || "") ? style.strokeWidth : null;
  const strokeOptions = propStroke !== null && !STROKES.includes(propStroke) ? [...STROKES, propStroke].sort((a, b) => a - b) : STROKES;
  const setStroke = (strokeWidth: number) => {
    if (selectedOverlay && "strokeWidth" in selectedOverlay) updateOverlay({ strokeWidth } as Partial<Overlay>);
    if (!(selectedOverlay?.type === "underline" || selectedOverlay?.type === "strike")) setStyle((current) => ({ ...current, strokeWidth }));
  };
  const textProps = selectedOverlay?.type === "text" ? { fontSize: selectedOverlay.fontSize, bold: selectedOverlay.bold } : activeType === "text" ? { fontSize: style.fontSize, bold: style.bold } : null;
  const setFont = (patch: { fontSize?: number; bold?: boolean }) => { if (selectedOverlay?.type === "text") updateOverlay(patch as Partial<Overlay>); setStyle((current) => ({ ...current, ...patch })); };
  const fillProp = selectedOverlay && (selectedOverlay.type === "rect" || selectedOverlay.type === "ellipse") ? Boolean(selectedOverlay.fill) : activeType === "rect" || activeType === "ellipse" ? style.fill : null;
  const setFill = (fill: boolean) => { if (selectedOverlay && (selectedOverlay.type === "rect" || selectedOverlay.type === "ellipse")) updateOverlay({ fill: fill ? selectedOverlay.color : null } as Partial<Overlay>); setStyle((current) => ({ ...current, fill })); };

  const hint = placing ? (placing.signature ? "Click on a page to place your signature. Press Esc to cancel." : "Click on a page to place the image. Press Esc to cancel.")
    : tool === "text" ? "Click on a page to add text. Ctrl+Enter or clicking elsewhere finishes."
    : tool === "highlight" ? "Drag over the area to highlight."
    : tool === "underline" ? "Drag across text to underline it, or click a line of text. Lines snap to the PDF's text where it has a text layer."
    : tool === "strike" ? "Drag across text to strike it through, or click a line of text. Lines snap to the PDF's text where it has a text layer."
    : tool === "watermark" ? "Adjust the watermark in the panel. With Custom position, click or drag on a page to place it."
    : tool === "ink" ? "Draw freely with your mouse, pen or finger."
    : tool === "rect" || tool === "ellipse" ? "Drag to draw. Hold Shift for a square or circle."
    : tool === "line" || tool === "arrow" ? "Drag to draw. Hold Shift to snap to 45°."
    : selectedOverlay ? "Drag to move, use the corner handles to resize, arrow keys to nudge, Delete to remove. Double-click text to edit it."
    : editMode === "pages" ? "Rotate, reorder, duplicate, insert, split or delete pages. Select several thumbnails to act on them together."
    : "Annotations sit on top of the page. The PDF's existing text and images can't be edited.";

  const targetCount = selectedPages.size || (currentPage ? 1 : 0);
  const targetLabel = selectedPages.size ? `${selectedPages.size} selected page${selectedPages.size === 1 ? "" : "s"}` : `page ${currentIndex + 1}`;
  const deleteTargetsAll = targetCount >= pages.length;
  const ready = phase === "ready";
  const working = Boolean(busy || saveProgress);

  return <ModalPortal>
    <div className="modal-backdrop pdfs-editor-backdrop" role="presentation">
      <section className="vault-modal pdfs-editor-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="vault-modal-header pdfs-editor-header">
          <span className="vault-modal-icon"><FileStack size={18}/></span>
          <div className="vault-modal-title pdfs-editor-title">
            <small>PDF Studio · {linked ? "Saved PDF" : "Not saved to Persora"}</small>
            <h2 id={titleId}><input className="pdfs-title-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} aria-label="Document title" disabled={!ready || working}/></h2>
          </div>
          {ready && <span className={`pdfs-dirty-pill ${dirty ? "is-dirty" : ""}`} role="status">{dirty ? "Unsaved changes" : linked ? "All changes saved" : "No unsaved changes"}</span>}
          <div className="pdfs-header-actions">
            <ToolButton label="Undo" tip="Undo (Ctrl+Z)" icon={<Undo2 size={16}/>} onClick={undo} disabled={!ready || !history.past.length || working}/>
            <ToolButton label="Redo" tip="Redo (Ctrl+Shift+Z)" icon={<Redo2 size={16}/>} onClick={redo} disabled={!ready || !history.future.length || working}/>
            <button type="button" className="quiet-button pdfs-header-button" onClick={() => void download()} disabled={!ready || working}><Download size={15}/><span>Download PDF</span></button>
            <button type="button" className="editor-submit pdfs-header-button" onClick={() => setDialog("save")} disabled={!ready || working} title={!canSave ? saveBlockedReason : undefined}><CloudUpload size={15}/><span>Save to Persora</span></button>
          </div>
          <button type="button" className="vault-modal-close" onClick={requestClose} disabled={working} aria-label="Close editor"><X size={18}/></button>
        </header>

        {phase === "loading" ? <div className="pdfs-editor-state" role="status"><Spinner className="size-6"/><b>Opening your PDF</b><span>{loadMessage}</span><small>Everything happens on this device.</small></div>
        : phase === "error" ? <div className="pdfs-editor-state is-error" role="alert"><AlertTriangle size={24}/><b>This file couldn't be opened</b><span>{loadError}</span><button type="button" className="quiet-button" onClick={onClose}>Close</button></div>
        : <>
          <div className="pdfs-toolbar-row" role="toolbar" aria-label="PDF editor tools">
            <div className="pdfs-edit-modes" role="tablist" aria-label="Editing mode">
              {([["annotate", "Annotate", PenLine], ["pages", "Pages", Files]] as const).map(([mode, label, Icon]) => <button key={mode} type="button" role="tab" id={`${titleId}-${mode}`} aria-selected={editMode === mode} aria-controls={`${titleId}-${mode}-tools`} className={`pdfs-edit-mode ${editMode === mode ? "is-active" : ""}`}
                onClick={() => { setEditMode(mode); if (mode === "pages") { setTool("select"); setPlacing(null); } }}><Icon size={14}/>{label}</button>)}
            </div>
            {editMode === "annotate" ? <div className="pdfs-tool-group" role="tabpanel" id={`${titleId}-annotate-tools`} aria-labelledby={`${titleId}-annotate`}>
              {TOOLS.map((entry) => <ToolButton key={entry.id} label={entry.label} tip={`${entry.label} (${entry.key})`} icon={<entry.icon size={16}/>} pressed={tool === entry.id} onClick={() => chooseTool(entry.id)}/>)}
              <span className="pdfs-divider" aria-hidden="true"/>
              <ToolButton label="Signature" tip="Add a signature" icon={<Signature size={16}/>} pressed={tool === "place" && placing?.signature} onClick={() => setDialog("signature")}/>
              <ToolButton label="Image" tip="Add an image" icon={<ImageIcon size={16}/>} pressed={tool === "place" && placing?.signature === false} onClick={() => imageInput.current?.click()}/>
              <ToolButton label="Watermark" tip={watermark ? "Edit the watermark (W)" : "Add a watermark (W)"} icon={<Stamp size={16}/>} pressed={wmOpen} onClick={() => wmOpen ? closeWatermark() : openWatermark()} showLabel/>
            </div>
            : <div className="pdfs-tool-group" role="tabpanel" id={`${titleId}-pages-tools`} aria-labelledby={`${titleId}-pages`}>
              <ToolButton label="Rotate left" tip={`Rotate ${targetLabel} left`} icon={<RotateCcw size={16}/>} onClick={() => rotate(-90)}/>
              <ToolButton label="Rotate right" tip={`Rotate ${targetLabel} right`} icon={<RotateCw size={16}/>} onClick={() => rotate(90)}/>
              <ToolButton label="Move page up" tip="Move current page earlier" icon={<ArrowUp size={16}/>} onClick={() => movePage(-1)} disabled={currentIndex === 0}/>
              <ToolButton label="Move page down" tip="Move current page later" icon={<ArrowDown size={16}/>} onClick={() => movePage(1)} disabled={currentIndex >= pages.length - 1}/>
              <ToolButton label="Duplicate" tip={`Duplicate ${targetLabel}`} icon={<Copy size={16}/>} onClick={duplicatePages}/>
              <div className="pdfs-menu-wrap">
                <ToolButton label="Insert pages" tip="Insert a blank page, PDFs or images" icon={<FilePlus2 size={16}/>} pressed={insertOpen} onClick={() => setInsertOpen((open) => !open)}/>
                {insertOpen && <div className="pdfs-menu" role="menu" onMouseLeave={() => setInsertOpen(false)}>
                  <button type="button" role="menuitem" onClick={() => void insertBlank()}><FilePlus2 size={14}/> Blank page after page {currentIndex + 1}</button>
                  <button type="button" role="menuitem" onClick={() => { insertWhere.current = "after"; setInsertOpen(false); insertInput.current?.click(); }}><Plus size={14}/> Files after page {currentIndex + 1}…</button>
                  <button type="button" role="menuitem" onClick={() => { insertWhere.current = "end"; setInsertOpen(false); insertInput.current?.click(); }}><FileStack size={14}/> Merge files at the end…</button>
                </div>}
              </div>
              <ToolButton label="Extract or split" tip="Extract or split pages into new PDFs" icon={<Scissors size={16}/>} onClick={() => setDialog("split")}/>
              <ToolButton label="Export images" tip="Export pages as PNG or JPG" icon={<FileImage size={16}/>} onClick={() => setDialog("export")}/>
              <ToolButton label="Delete pages" tip={`Delete ${targetLabel}`} icon={<Trash2 size={16}/>} danger onClick={() => setDialog("delete")}/>
            </div>}
            <div className="pdfs-tool-group pdfs-view-group" role="group" aria-label="View">
              <span className="pdfs-group-label">View</span>
              <ToolButton label="Zoom out" icon={<ZoomOut size={16}/>} onClick={() => zoomStep(-1)} disabled={zoom <= ZOOM_STEPS[0]}/>
              <select className="pdfs-zoom-select" value={zoomMode === "custom" ? String(zoom) : zoomMode} onChange={(event) => { const value = event.target.value; if (value === "auto" || value === "fit-width" || value === "fit-page") setZoomMode(value); else setZoomValue(Number(value)); }} aria-label="Zoom">
                <option value="auto">Automatic</option>
                <option value="fit-width">Fit width</option>
                <option value="fit-page">Fit page</option>
                {zoomMode === "custom" && !ZOOM_STEPS.includes(zoom) && <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>}
                {ZOOM_STEPS.map((step) => <option key={step} value={String(step)}>{Math.round(step * 100)}%</option>)}
              </select>
              <ToolButton label="Zoom in" icon={<ZoomIn size={16}/>} onClick={() => zoomStep(1)} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}/>
              <span className="pdfs-divider" aria-hidden="true"/>
              <ToolButton label="Previous page" icon={<ChevronLeft size={16}/>} onClick={() => goToIndex(currentIndex - 1)} disabled={currentIndex === 0}/>
              <PageInput current={currentIndex + 1} total={pages.length} onGo={(page) => goToIndex(page - 1)}/>
              <ToolButton label="Next page" icon={<ChevronRight size={16}/>} onClick={() => goToIndex(currentIndex + 1)} disabled={currentIndex >= pages.length - 1}/>
            </div>
          </div>

          <div className="pdfs-props-row" aria-live="polite">
            {propColor !== null && <div className="pdfs-swatches" role="radiogroup" aria-label="Colour">
              {(activeType === "highlight" ? HIGHLIGHT_COLORS : OVERLAY_COLORS).map((color) => <button key={color} type="button" role="radio" aria-checked={propColor === color} aria-label={`Colour ${color}`} className={`pdfs-swatch ${propColor === color ? "is-selected" : ""}`} style={{ background: color }} onClick={() => setColor(color)}/>)}
            </div>}
            {propStroke !== null && <label className="pdfs-prop">Line<select value={propStroke} onChange={(event) => setStroke(Number(event.target.value))} aria-label="Line width">{strokeOptions.map((value) => <option key={value} value={value}>{Math.round(value * 100) / 100} pt</option>)}</select></label>}
            {fillProp !== null && <label className="pdfs-prop pdfs-prop-check"><Checkbox checked={fillProp} onCheckedChange={(checked) => setFill(checked === true)}/> Fill</label>}
            {textProps && <>
              <label className="pdfs-prop">Size<select value={textProps.fontSize} onChange={(event) => setFont({ fontSize: Number(event.target.value) })} aria-label="Text size">{FONT_SIZES.map((value) => <option key={value} value={value}>{value} pt</option>)}</select></label>
              <button type="button" className={`pdfs-tool pdfs-bold ${textProps.bold ? "is-active" : ""}`} aria-pressed={textProps.bold} aria-label="Bold" data-tip="Bold" onClick={() => setFont({ bold: !textProps.bold })}><b>B</b></button>
            </>}
            {selectedOverlay && <>
              {selectedOverlay.type === "text" && <button type="button" className="quiet-button pdfs-prop-button" onClick={() => selection && setEditing({ pageId: selection.pageId, overlay: selectedOverlay, isNew: false })}><Type size={13}/> Edit text</button>}
              <button type="button" className="quiet-button pdfs-prop-button" onClick={duplicateOverlay}><Copy size={13}/> Duplicate</button>
              <button type="button" className="quiet-button pdfs-prop-button pdfs-danger" onClick={removeOverlay}><Trash2 size={13}/> Remove</button>
            </>}
            <span className="pdfs-hint"><Info size={13}/>{hint}</span>
          </div>

          <div className={`pdfs-editor-body ${wmOpen ? "has-panel" : ""}`}>
            <aside className="pdfs-rail" aria-label="Pages">
              <div className="pdfs-rail-head">
                <b>{pageCountLabel(pages.length)}</b>
                {selectedPages.size ? <button type="button" className="pdfs-link-button" onClick={() => setSelectedPages(new Set())}>Clear ({selectedPages.size})</button>
                  : <button type="button" className="pdfs-link-button" onClick={() => setSelectedPages(new Set(pages.map((page) => page.id)))}>Select all</button>}
              </div>
              <ol ref={setRail} className="pdfs-thumbs" aria-label="Page thumbnails. Drag to reorder.">
                {pages.map((page, index) => <PdfThumbnail
                  key={page.id} page={page} index={index} source={source(page.sourceId)} current={page.id === currentPage?.id} selected={selectedPages.has(page.id)} root={rail}
                  dragging={dragPage === page.id} dropTarget={dropPage === page.id && dragPage !== page.id} imageUrl={imageUrl} watermark={shownWatermark} thumbnail={thumbnail}
                  onOpen={(id) => { setCurrentId(id); scrollToPage(id); }} onToggle={togglePage}
                  onDragStart={setDragPage} onDragOverPage={setDropPage} onDropPage={dropOnPage} onDragEnd={() => { setDragPage(null); setDropPage(null); }}
                />)}
              </ol>
              <p className="pdfs-rail-tip">Drag to reorder · Shift-click to select a range</p>
            </aside>
            <div className="pdfs-stage-wrap" {...stageDropHandlers}>
              <div ref={setScroller} className={`pdfs-stage ${tool !== "select" ? "is-drawing" : ""}`} onScroll={onScroll} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelection(null); }}>
                <div className="pdfs-pages">
                  {pages.map((page, index) => <PdfPageView
                    key={page.id} page={page} index={index} total={pages.length} zoom={zoom} source={source(page.sourceId)} scrollRoot={scroller}
                    tool={tool} style={style} selectedId={selection?.pageId === page.id ? selection.overlayId : null} editing={editing} imageUrl={imageUrl} watermark={shownWatermark}
                    onSelect={onSelectOverlay} onCommit={setOverlays} onEditText={setEditing} onFinishText={finishText} onPlace={onPlace} onAppend={appendOverlays} onWatermarkPoint={onWatermarkPoint} register={register}
                  />)}
                </div>
              </div>
              {fileDrag && <div className="pdfs-file-drop" aria-hidden="true"><FilePlus2 size={26}/><b>Drop to insert after page {currentIndex + 1}</b><span>PDFs, images or text files</span></div>}
              {busy && <div className="pdfs-busy-overlay" role="status" aria-live="polite"><Spinner className="size-5"/><b>{busy.label}</b>{busy.percent !== null && <Progress value={busy.percent} aria-label={busy.label} className="h-1.5 w-full max-w-[200px]"/>}</div>}
            </div>
            {wmOpen && wmDraft && <PdfWatermarkPanel
              draft={wmDraft} applied={watermark} pages={pages} currentIndex={currentIndex} imageUrl={imageUrl}
              onChange={setWmDraft} onChooseImage={chooseWatermarkImage} onApply={applyWatermark} onRemove={removeWatermark} onClose={closeWatermark}
            />}
          </div>
          <footer className="pdfs-editor-status">
            <span>Page {currentIndex + 1} of {pages.length}</span>
            <span>{Math.round(zoom * 100)}%</span>
            {overlayCount > 0 && <span>{overlayCount} annotation{overlayCount === 1 ? "" : "s"}</span>}
            {watermark && <span>Watermark on {watermarkedPages === pages.length ? "all pages" : pageCountLabel(watermarkedPages)}</span>}
            <span className="pdfs-status-private">Processed on this device{linked ? "" : " · not uploaded"}</span>
          </footer>
        </>}
        <input ref={insertInput} className="hidden-file-input" type="file" accept={CREATE_ACCEPT} multiple onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void insertFiles(files, insertWhere.current); }} aria-label="Choose files to insert"/>
        <input ref={imageInput} className="hidden-file-input" type="file" accept={IMAGE_ACCEPT} onChange={(event) => void onImageChosen(event)} aria-label="Choose an image to add"/>
      </section>
    </div>

    {dialog === "save" && <PdfSaveModal
      mode="save"
      folders={folders}
      defaults={{ title: title.trim() || "Untitled PDF", folderId: linked?.folderId ?? defaultFolderId, notes: linked?.notes || "" }}
      linkedDocument={linked}
      pageCount={pages.length}
      canSave={canSave}
      saveBlockedReason={saveBlockedReason}
      onUpgrade={onUpgrade}
      progress={saveProgress}
      onCancel={() => setDialog(null)}
      onSubmit={runSave}
    />}
    {dialog === "split" && <SplitDialog pageCount={pages.length} selected={selectedIndexes} currentIndex={currentIndex} busy={dialogBusy} onCancel={() => setDialog(null)} onRun={(splitRequest) => void runSplit(splitRequest)}/>}
    {dialog === "export" && currentPage && <ExportImagesDialog pageCount={pages.length} selected={selectedIndexes} currentIndex={currentIndex} pageSize={viewSize(currentPage)} busy={dialogBusy} progress={exportProgress} onCancel={() => setDialog(null)} onRun={(exportRequest) => void runExportImages(exportRequest)}/>}
    {dialog === "signature" && <SignatureDialog recent={recentSignatures} onUseRecent={(id) => { setDialog(null); startPlacing(id, true); }} onCancel={() => setDialog(null)} onCreate={onSignature}/>}
    {dialog === "delete" && <ConfirmDialog title={deleteTargetsAll ? "Keep at least one page" : `Delete ${targetLabel}?`} confirmLabel={deleteTargetsAll ? "OK" : "Delete"} danger={!deleteTargetsAll} onCancel={() => setDialog(null)} onConfirm={() => deleteTargetsAll ? setDialog(null) : deletePages()}>
      <p>{deleteTargetsAll ? "A PDF needs at least one page, so you can't delete every page. Select fewer pages and try again." : `The page${targetCount === 1 ? "" : "s"} and any annotations on ${targetCount === 1 ? "it" : "them"} will be removed from this document. You can undo this until you close the editor.`}</p>
    </ConfirmDialog>}
    {dialog === "close" && <ConfirmDialog title="Discard unsaved changes?" confirmLabel="Discard changes" onCancel={() => setDialog(null)} onConfirm={onClose}>
      <p>Your edits to “{title.trim() || "this PDF"}” haven't been {linked ? "saved to Persora" : "downloaded or saved"}. Closing the editor discards them. {linked ? "The saved copy stays as it was." : "Your original files aren't affected."}</p>
    </ConfirmDialog>}
  </ModalPortal>;
}
