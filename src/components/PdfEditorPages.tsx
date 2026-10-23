import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Check, Loader2 } from "lucide-react";
import {
  TEXT_ASCENT, TEXT_LINE_HEIGHT, WATERMARK_FONTS, arrowHead, makeId, markupSegments, viewSize, watermarkOnPage,
  type BoxOverlay, type ImageOverlay, type LineOverlay, type MarkupOverlay, type Overlay, type TextOverlay, type TextRun, type Watermark, type WorkingPage,
} from "../lib/pdf-studio";
import { isRenderCancelled, readTextRuns, renderPage } from "../lib/pdf-render";
import { OVERLAY_FONT_FAMILY, layoutWatermark, measureTextOverlay } from "../lib/pdf-canvas";

export type Tool = "select" | "text" | "highlight" | "underline" | "strike" | "rect" | "ellipse" | "line" | "arrow" | "ink" | "place" | "watermark";
export interface ToolStyle { color: string; highlightColor: string; markupColor: string; strokeWidth: number; fontSize: number; bold: boolean; fill: boolean }
export interface EditingText { pageId: string; overlay: TextOverlay; isNew: boolean }
export interface SourceRef { id: string; name: string; bytes: Uint8Array; pdf: PDFDocumentProxy }

type Point = [number, number];
type Drag =
  | { mode: "create"; overlay: Overlay; start: Point }
  | { mode: "move"; original: Overlay; current: Overlay; start: Point; moved: boolean }
  | { mode: "resize"; original: BoxOverlay | ImageOverlay; current: BoxOverlay | ImageOverlay; corner: "nw" | "ne" | "sw" | "se" }
  | { mode: "endpoint"; original: LineOverlay; current: LineOverlay; which: 1 | 2 }
  | { mode: "markup"; kind: "underline" | "strike"; start: Point; end: Point }
  | { mode: "watermark" };

const MIN_SIZE = 3;

export function translateOverlay(overlay: Overlay, dx: number, dy: number): Overlay {
  switch (overlay.type) {
    case "line": case "arrow": case "underline": case "strike": return { ...overlay, x1: overlay.x1 + dx, y1: overlay.y1 + dy, x2: overlay.x2 + dx, y2: overlay.y2 + dy };
    case "ink": return { ...overlay, points: overlay.points.map((value, index) => value + (index % 2 ? dy : dx)) };
    default: return { ...overlay, x: overlay.x + dx, y: overlay.y + dy };
  }
}

export function cloneOverlay(overlay: Overlay, offset = 0): Overlay {
  return { ...translateOverlay(overlay, offset, offset), id: makeId("ov") } as Overlay;
}

/** Visual bounds used for selection outlines (text measured with the overlay font). */
export function selectionBounds(overlay: Overlay) {
  switch (overlay.type) {
    case "text": { const size = measureTextOverlay(overlay); return { x: overlay.x, y: overlay.y, w: size.width, h: size.height }; }
    case "line": case "arrow": return { x: Math.min(overlay.x1, overlay.x2), y: Math.min(overlay.y1, overlay.y2), w: Math.abs(overlay.x2 - overlay.x1), h: Math.abs(overlay.y2 - overlay.y1) };
    case "underline": case "strike": {
      const half = overlay.strokeWidth / 2;
      return { x: Math.min(overlay.x1, overlay.x2), y: Math.min(overlay.y1, overlay.y2) - half, w: Math.abs(overlay.x2 - overlay.x1), h: Math.abs(overlay.y2 - overlay.y1) + half * 2 };
    }
    case "ink": {
      const xs = overlay.points.filter((_, i) => i % 2 === 0); const ys = overlay.points.filter((_, i) => i % 2 === 1);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    default: return { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h };
  }
}

/** Renders overlays as SVG (view space, points). Shared by pages and thumbnails. */
export const OverlayShapes = memo(function OverlayShapes({ overlays, imageUrl, interactive = false, hiddenId = null }: { overlays: Overlay[]; imageUrl: (id: string) => string | undefined; interactive?: boolean; hiddenId?: string | null }) {
  return <>{overlays.map((overlay) => {
    if (overlay.id === hiddenId) return null;
    const hit = interactive ? { "data-overlay-id": overlay.id, className: "pdfs-ov" } : {};
    switch (overlay.type) {
      case "text":
        return <text key={overlay.id} {...hit} x={overlay.x} y={overlay.y + overlay.fontSize * TEXT_ASCENT} fill={overlay.color} fontSize={overlay.fontSize} fontWeight={overlay.bold ? 700 : 400} fontFamily={OVERLAY_FONT_FAMILY} style={{ whiteSpace: "pre" }}>
          {overlay.text.split("\n").map((line, index) => <tspan key={index} x={overlay.x} dy={index ? overlay.fontSize * TEXT_LINE_HEIGHT : 0}>{line || " "}</tspan>)}
        </text>;
      case "highlight":
        return <rect key={overlay.id} {...hit} x={overlay.x} y={overlay.y} width={overlay.w} height={overlay.h} fill={overlay.color} fillOpacity={0.4} style={{ mixBlendMode: "multiply" }}/>;
      case "rect":
        return <rect key={overlay.id} {...hit} x={overlay.x} y={overlay.y} width={overlay.w} height={overlay.h} fill={overlay.fill || "transparent"} fillOpacity={overlay.fill ? 0.35 : 0} stroke={overlay.color} strokeWidth={overlay.strokeWidth} pointerEvents={interactive ? "all" : "none"}/>;
      case "ellipse":
        return <ellipse key={overlay.id} {...hit} cx={overlay.x + overlay.w / 2} cy={overlay.y + overlay.h / 2} rx={Math.max(0.5, overlay.w / 2)} ry={Math.max(0.5, overlay.h / 2)} fill={overlay.fill || "transparent"} fillOpacity={overlay.fill ? 0.35 : 0} stroke={overlay.color} strokeWidth={overlay.strokeWidth} pointerEvents={interactive ? "all" : "none"}/>;
      case "line": case "arrow": {
        const head = overlay.type === "arrow" ? arrowHead(overlay.x1, overlay.y1, overlay.x2, overlay.y2, overlay.strokeWidth) : null;
        const end = head ? head.base : [overlay.x2, overlay.y2];
        return <g key={overlay.id} {...hit}>
          {interactive && <line x1={overlay.x1} y1={overlay.y1} x2={overlay.x2} y2={overlay.y2} stroke="transparent" strokeWidth={Math.max(10, overlay.strokeWidth + 8)}/>}
          <line x1={overlay.x1} y1={overlay.y1} x2={end[0]} y2={end[1]} stroke={overlay.color} strokeWidth={overlay.strokeWidth} strokeLinecap="round"/>
          {head && <polygon points={`${overlay.x2},${overlay.y2} ${head.left.join(",")} ${head.right.join(",")}`} fill={overlay.color}/>}
        </g>;
      }
      case "underline": case "strike":
        return <g key={overlay.id} {...hit}>
          {interactive && <line x1={overlay.x1} y1={overlay.y1} x2={overlay.x2} y2={overlay.y2} stroke="transparent" strokeWidth={Math.max(10, overlay.strokeWidth + 8)}/>}
          <line x1={overlay.x1} y1={overlay.y1} x2={overlay.x2} y2={overlay.y2} stroke={overlay.color} strokeWidth={overlay.strokeWidth} strokeLinecap="butt"/>
        </g>;
      case "ink": {
        const points = [];
        for (let i = 0; i < overlay.points.length; i += 2) points.push(`${overlay.points[i]},${overlay.points[i + 1]}`);
        return <g key={overlay.id} {...hit}>
          {interactive && <polyline points={points.join(" ")} fill="none" stroke="transparent" strokeWidth={Math.max(10, overlay.strokeWidth + 8)}/>}
          <polyline points={points.join(" ")} fill="none" stroke={overlay.color} strokeWidth={overlay.strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
        </g>;
      }
      case "image": {
        const url = imageUrl(overlay.imageId);
        return url ? <image key={overlay.id} {...hit} href={url} x={overlay.x} y={overlay.y} width={overlay.w} height={overlay.h} preserveAspectRatio="none"/> : null;
      }
    }
  })}</>;
});

/**
 * Renders a watermark as SVG (view space). Uses the same layout as the PDF
 * export; PDF-font text is stretched to the exact PDF text width.
 */
export const WatermarkShapes = memo(function WatermarkShapes({ spec, width, height, imageUrl }: { spec: Watermark; width: number; height: number; imageUrl: (id: string) => string | undefined }) {
  const layout = useMemo(() => layoutWatermark(spec, { width, height }), [spec, width, height]);
  if (!layout || !layout.placements.length) return null;
  const url = spec.kind === "image" ? imageUrl(spec.imageId) : undefined;
  if (spec.kind === "image" && !url) return null;
  const font = spec.kind === "text" ? WATERMARK_FONTS[spec.font] : null;
  const fontFamily = font ? `${font.css}, ${OVERLAY_FONT_FAMILY}` : undefined;
  const fill = spec.kind === "text" ? spec.color : undefined;
  return <g className="pdfs-watermark" pointerEvents="none" aria-hidden="true">
    {layout.placements.map((placement, index) => <g key={index} opacity={spec.opacity} transform={`translate(${placement.cx} ${placement.cy}) rotate(${-placement.angle})`}>
      {layout.mode === "image"
        ? <image href={url} x={-layout.width / 2} y={-layout.height / 2} width={layout.width} height={layout.height} preserveAspectRatio="none"/>
        : layout.mode === "pdf"
          ? <text x={-layout.width / 2} y={layout.height / 2} fontSize={layout.fontSize} fontFamily={fontFamily} fontWeight={font?.weight} fill={fill} textLength={layout.width} lengthAdjust="spacingAndGlyphs" style={{ whiteSpace: "pre" }}>{layout.text}</text>
          : <text x={0} y={0} fontSize={layout.fontSize} fontFamily={fontFamily} fontWeight={font?.weight} fill={fill} textAnchor="middle" dominantBaseline="central" style={{ whiteSpace: "pre" }}>{layout.text}</text>}
    </g>)}
  </g>;
});

interface PageProps {
  page: WorkingPage;
  index: number;
  total: number;
  zoom: number;
  source: SourceRef | undefined;
  scrollRoot: HTMLElement | null;
  tool: Tool;
  style: ToolStyle;
  selectedId: string | null;
  editing: EditingText | null;
  imageUrl: (id: string) => string | undefined;
  /** The document watermark (draft while the panel is open); drawn only on the pages it applies to. */
  watermark: Watermark | null;
  onSelect: (pageId: string, overlayId: string | null) => void;
  onCommit: (pageId: string, overlays: Overlay[], selectId?: string | null) => void;
  onEditText: (editing: EditingText | null) => void;
  onFinishText: (editing: EditingText, text: string) => void;
  onPlace: (pageId: string, point: Point) => void;
  /** Adds overlays to a page using the latest document state (for results computed asynchronously). */
  onAppend: (pageId: string, overlays: Overlay[]) => void;
  /** Watermark tool: the clicked/dragged point as a fraction of the page (0–1). */
  onWatermarkPoint: (pageId: string, point: Point) => void;
  register: (pageId: string, element: HTMLElement | null) => void;
}

/** One page of the editor: a lazily rendered PDF.js canvas plus the interactive overlay layer. */
export const PdfPageView = memo(function PdfPageView({ page, index, total, zoom, source, scrollRoot, tool, style, selectedId, editing, imageUrl, watermark, onSelect, onCommit, onEditText, onFinishText, onPlace, onAppend, onWatermarkPoint, register }: PageProps) {
  const view = viewSize(page);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [near, setNear] = useState(index < 3);
  const [rendered, setRendered] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  // The page's own text, read once per rotation, for snapping underline / strike-through.
  const runsRef = useRef<{ key: string; runs: Promise<TextRun[]> } | null>(null);
  const textRuns = (): Promise<TextRun[]> => {
    const key = `${page.sourceId}:${page.sourceIndex}:${page.rotation}`;
    if (!source) return Promise.resolve([]);
    if (runsRef.current?.key !== key) {
      runsRef.current = { key, runs: source.pdf.getPage(page.sourceIndex + 1).then((pdfPage) => readTextRuns(pdfPage, page.rotation)).catch(() => []) };
    }
    return runsRef.current.runs;
  };

  useEffect(() => { register(page.id, wrapRef.current); return () => register(page.id, null); }, [page.id, register]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: scrollRoot, rootMargin: "900px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Render (or re-render) the page bitmap when it is near the viewport.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !source || !canvas) { if (!near && canvas) { canvas.width = 0; canvas.height = 0; setRendered(false); } return; }
    let cancelled = false;
    let task: ReturnType<typeof renderPage> | null = null;
    const timer = window.setTimeout(async () => {
      try {
        const pdfPage = await source.pdf.getPage(page.sourceIndex + 1);
        if (cancelled) return;
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const maxScale = Math.sqrt(16_000_000 / Math.max(1, view.width * view.height));
        const scale = Math.min(zoom * dpr, maxScale);
        const offscreen = document.createElement("canvas");
        task = renderPage(pdfPage, offscreen, scale, page.rotation);
        await task.promise;
        if (cancelled) { offscreen.width = 0; return; }
        // Swap in the finished bitmap at once so zooming never flashes blank.
        canvas.width = offscreen.width; canvas.height = offscreen.height;
        canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
        offscreen.width = 0; offscreen.height = 0;
        setRendered(true); setRenderError("");
      } catch (error) {
        if (!cancelled && !isRenderCancelled(error)) setRenderError("This page couldn't be displayed.");
      }
    }, rendered ? 140 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, source, page.sourceIndex, page.rotation, zoom]);

  const toPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return [0, 0];
    return [
      Math.max(0, Math.min(view.width, (event.clientX - rect.left) / rect.width * view.width)),
      Math.max(0, Math.min(view.height, (event.clientY - rect.top) / rect.height * view.height)),
    ];
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || editing) return;
    const point = toPoint(event);
    const target = event.target as Element;
    const handle = target.closest("[data-handle]")?.getAttribute("data-handle");
    const overlayId = target.closest("[data-overlay-id]")?.getAttribute("data-overlay-id");
    const capture = () => { try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* ignore */ } };

    if (tool === "select") {
      const selected = page.overlays.find((overlay) => overlay.id === selectedId);
      if (handle && selected) {
        event.preventDefault(); capture();
        if ((selected.type === "line" || selected.type === "arrow") && (handle === "p1" || handle === "p2")) setDrag({ mode: "endpoint", original: selected, current: selected, which: handle === "p1" ? 1 : 2 });
        else if (selected.type === "highlight" || selected.type === "rect" || selected.type === "ellipse" || selected.type === "image") setDrag({ mode: "resize", original: selected, current: selected, corner: handle as "nw" | "ne" | "sw" | "se" });
        return;
      }
      if (overlayId) {
        const overlay = page.overlays.find((entry) => entry.id === overlayId);
        if (!overlay) return;
        event.preventDefault(); capture();
        onSelect(page.id, overlay.id);
        setDrag({ mode: "move", original: overlay, current: overlay, start: point, moved: false });
        return;
      }
      onSelect(page.id, null);
      return;
    }
    if (tool === "place") { event.preventDefault(); onPlace(page.id, point); return; }
    if (tool === "watermark") {
      event.preventDefault(); capture();
      onWatermarkPoint(page.id, [point[0] / view.width, point[1] / view.height]);
      setDrag({ mode: "watermark" });
      return;
    }
    if (tool === "underline" || tool === "strike") {
      event.preventDefault(); capture();
      void textRuns(); // start reading the text layer while the user drags
      setDrag({ mode: "markup", kind: tool, start: point, end: point });
      return;
    }
    if (tool === "text") {
      event.preventDefault();
      onEditText({ pageId: page.id, isNew: true, overlay: { id: makeId("ov"), type: "text", x: point[0], y: Math.max(0, point[1] - style.fontSize * 0.6), text: "", fontSize: style.fontSize, color: style.color, bold: style.bold } });
      return;
    }
    event.preventDefault(); capture();
    const id = makeId("ov");
    const [x, y] = point;
    let overlay: Overlay;
    if (tool === "highlight") overlay = { id, type: "highlight", x, y, w: 0, h: 0, color: style.highlightColor, strokeWidth: 0, fill: null };
    else if (tool === "rect" || tool === "ellipse") overlay = { id, type: tool, x, y, w: 0, h: 0, color: style.color, strokeWidth: style.strokeWidth, fill: style.fill ? style.color : null };
    else if (tool === "line" || tool === "arrow") overlay = { id, type: tool, x1: x, y1: y, x2: x, y2: y, color: style.color, strokeWidth: style.strokeWidth };
    else overlay = { id, type: "ink", points: [x, y], color: style.color, strokeWidth: style.strokeWidth };
    setDrag({ mode: "create", overlay, start: point });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const [x, y] = toPoint(event);
    if (current.mode === "watermark") { onWatermarkPoint(page.id, [x / view.width, y / view.height]); return; }
    if (current.mode === "markup") { setDrag({ ...current, end: [x, y] }); return; }
    if (current.mode === "create") {
      const [sx, sy] = current.start;
      const overlay = current.overlay;
      let next: Overlay = overlay;
      if (overlay.type === "highlight" || overlay.type === "rect" || overlay.type === "ellipse") {
        let w = Math.abs(x - sx); let h = Math.abs(y - sy);
        if (event.shiftKey && overlay.type !== "highlight") { const side = Math.max(w, h); w = side; h = side; }
        next = { ...overlay, x: x < sx ? sx - w : sx, y: y < sy ? sy - h : sy, w, h };
      } else if (overlay.type === "line" || overlay.type === "arrow") {
        let nx = x; let ny = y;
        if (event.shiftKey) { // snap to 45°
          const angle = Math.round(Math.atan2(y - sy, x - sx) / (Math.PI / 4)) * (Math.PI / 4);
          const length = Math.hypot(x - sx, y - sy);
          nx = sx + Math.cos(angle) * length; ny = sy + Math.sin(angle) * length;
        }
        next = { ...overlay, x2: nx, y2: ny };
      } else if (overlay.type === "ink") {
        const points = overlay.points;
        const lx = points[points.length - 2]; const ly = points[points.length - 1];
        if (Math.hypot(x - lx, y - ly) * zoom >= 1.5) next = { ...overlay, points: [...points, Math.round(x * 100) / 100, Math.round(y * 100) / 100] };
      }
      setDrag({ ...current, overlay: next });
    } else if (current.mode === "move") {
      const dx = x - current.start[0]; const dy = y - current.start[1];
      setDrag({ ...current, current: translateOverlay(current.original, dx, dy), moved: current.moved || Math.hypot(dx, dy) * zoom > 2 });
    } else if (current.mode === "resize") {
      const o = current.original;
      const left = current.corner.includes("w") ? Math.min(x, o.x + o.w - MIN_SIZE) : o.x;
      const top = current.corner.includes("n") ? Math.min(y, o.y + o.h - MIN_SIZE) : o.y;
      const right = current.corner.includes("e") ? Math.max(x, o.x + MIN_SIZE) : o.x + o.w;
      const bottom = current.corner.includes("s") ? Math.max(y, o.y + MIN_SIZE) : o.y + o.h;
      let next = { ...o, x: left, y: top, w: right - left, h: bottom - top };
      if (o.type === "image" && o.w > 0 && o.h > 0) { // keep the image's aspect ratio
        const ratio = o.w / o.h;
        const w = Math.max(next.w, next.h * ratio); const h = w / ratio;
        next = { ...next, w, h, x: current.corner.includes("w") ? o.x + o.w - w : o.x, y: current.corner.includes("n") ? o.y + o.h - h : o.y };
      }
      setDrag({ ...current, current: next });
    } else if (current.mode === "endpoint") {
      setDrag({ ...current, current: current.which === 1 ? { ...current.original, x1: x, y1: y } : { ...current.original, x2: x, y2: y } });
    }
  };

  const onPointerUp = () => {
    const current = dragRef.current;
    setDrag(null);
    if (!current || current.mode === "watermark") return;
    if (current.mode === "markup") { void commitMarkup(current); return; }
    if (current.mode === "create") {
      const overlay = current.overlay;
      let big = true;
      if (overlay.type === "ink") big = overlay.points.length >= 4;
      else if (overlay.type === "line" || overlay.type === "arrow") big = Math.hypot(overlay.x2 - overlay.x1, overlay.y2 - overlay.y1) >= MIN_SIZE;
      else if (overlay.type === "highlight" || overlay.type === "rect" || overlay.type === "ellipse") big = overlay.w >= MIN_SIZE && overlay.h >= MIN_SIZE;
      if (big) onCommit(page.id, [...page.overlays, overlay], overlay.id);
      return;
    }
    if (current.mode === "move" && !current.moved) return;
    const updated = current.current;
    onCommit(page.id, page.overlays.map((overlay) => overlay.id === updated.id ? updated : overlay), updated.id);
  };

  const commitMarkup = async (markup: Extract<Drag, { mode: "markup" }>) => {
    const runs = await textRuns();
    const [sx, sy] = markup.start; const [ex, ey] = markup.end;
    let rect = { x: Math.min(sx, ex), y: Math.min(sy, ey), w: Math.abs(ex - sx), h: Math.abs(ey - sy) };
    if (rect.w < MIN_SIZE) {
      // A click marks the whole text run under the pointer.
      const run = runs.find((entry) => sx >= entry.x && sx <= entry.x + entry.width && sy >= entry.baseline - entry.size * 0.78 && sy <= entry.baseline + entry.size * 0.22);
      if (!run) return;
      rect = { x: run.x, y: run.baseline - run.size * 0.5, w: run.width, h: 1 };
    }
    const segments = markupSegments(runs, rect, markup.kind);
    if (!segments.length) return;
    onAppend(page.id, segments.map((segment): MarkupOverlay => ({ id: makeId("ov"), type: markup.kind, ...segment, color: style.markupColor })));
  };

  const onDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "select") return;
    const overlayId = (event.target as Element).closest("[data-overlay-id]")?.getAttribute("data-overlay-id");
    const overlay = page.overlays.find((entry) => entry.id === overlayId);
    if (overlay?.type === "text") onEditText({ pageId: page.id, overlay, isNew: false });
  };

  // Overlays as drawn right now (including an in-progress drag).
  let shown = page.overlays;
  if (drag?.mode === "create") shown = [...page.overlays, drag.overlay];
  else if (drag && "current" in drag) shown = page.overlays.map((overlay) => overlay.id === drag.current.id ? drag.current : overlay);
  const selected = selectedId ? shown.find((overlay) => overlay.id === selectedId) : undefined;
  const markupBox = drag?.mode === "markup" ? { x: Math.min(drag.start[0], drag.end[0]), y: Math.min(drag.start[1], drag.end[1]), w: Math.abs(drag.end[0] - drag.start[0]), h: Math.abs(drag.end[1] - drag.start[1]) } : null;
  const pageWatermark = watermark && watermarkOnPage(watermark, page.id) ? watermark : null;
  const editingHere = editing && editing.pageId === page.id ? editing : null;
  const handleSize = 9 / zoom;

  return <div className="pdfs-page-shell" data-page-id={page.id}>
    <div ref={wrapRef} className={`pdfs-page pdfs-tool-${tool}`} style={{ width: view.width * zoom, height: view.height * zoom } as CSSProperties} aria-label={`Page ${index + 1} of ${total}`} role="group">
      <canvas ref={canvasRef} className="pdfs-page-canvas" aria-hidden="true"/>
      {!rendered && !renderError && <span className="pdfs-page-loading"><Loader2 size={18} className="pdfs-spin"/></span>}
      {renderError && <span className="pdfs-page-error">{renderError}</span>}
      <svg
        ref={svgRef}
        className="pdfs-overlay-layer"
        viewBox={`0 0 ${view.width} ${view.height}`}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onMouseDown={(event) => { if (!editing) event.preventDefault(); /* keep focus in the text editor and avoid text selection while drawing */ }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={onDoubleClick}
      >
        {pageWatermark && <WatermarkShapes spec={pageWatermark} width={view.width} height={view.height} imageUrl={imageUrl}/>}
        <OverlayShapes overlays={shown} imageUrl={imageUrl} interactive={tool === "select"} hiddenId={editingHere && !editingHere.isNew ? editingHere.overlay.id : null}/>
        {markupBox && markupBox.w > 0 && <rect className="pdfs-markup-drag" x={markupBox.x} y={markupBox.y} width={markupBox.w} height={Math.max(markupBox.h, 1 / zoom)} vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
        {selected && tool === "select" && !editingHere && (() => {
          const box = selectionBounds(selected);
          const pad = 3 / zoom;
          const outline = <rect className="pdfs-selection" x={box.x - pad} y={box.y - pad} width={box.w + pad * 2} height={box.h + pad * 2} vectorEffect="non-scaling-stroke" pointerEvents="none"/>;
          if (selected.type === "line" || selected.type === "arrow") {
            return <g>{[["p1", selected.x1, selected.y1], ["p2", selected.x2, selected.y2]].map(([key, cx, cy]) => <circle key={key as string} data-handle={key as string} className="pdfs-handle" cx={cx as number} cy={cy as number} r={handleSize / 1.4}/>)}</g>;
          }
          if (selected.type === "highlight" || selected.type === "rect" || selected.type === "ellipse" || selected.type === "image") {
            const corners: [string, number, number][] = [["nw", box.x, box.y], ["ne", box.x + box.w, box.y], ["sw", box.x, box.y + box.h], ["se", box.x + box.w, box.y + box.h]];
            return <g>{outline}{corners.map(([key, cx, cy]) => <rect key={key} data-handle={key} className={`pdfs-handle pdfs-handle-${key}`} x={cx - handleSize / 2} y={cy - handleSize / 2} width={handleSize} height={handleSize}/>)}</g>;
          }
          return outline;
        })()}
      </svg>
      {editingHere && <TextEditor key={editingHere.overlay.id} editing={editingHere} zoom={zoom} onFinish={onFinishText} onCancel={() => onEditText(null)}/>}
    </div>
    <span className="pdfs-page-number">{index + 1}</span>
  </div>;
});

function TextEditor({ editing, zoom, onFinish, onCancel }: { editing: EditingText; zoom: number; onFinish: (editing: EditingText, text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(editing.overlay.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => { const element = ref.current; if (element) { element.focus(); element.setSelectionRange(element.value.length, element.value.length); } }, []);
  const finish = () => { if (done.current) return; done.current = true; onFinish(editing, value); };
  const { overlay } = editing;
  const size = measureTextOverlay({ ...overlay, text: value || "Type here" });
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); if (editing.isNew && !value.trim()) { done.current = true; onCancel(); } else finish(); }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish(); }
  };
  return <textarea
    ref={ref}
    className="pdfs-text-editor"
    value={value}
    placeholder="Type here"
    aria-label="Text annotation"
    onChange={(event) => setValue(event.target.value)}
    onBlur={finish}
    onKeyDown={onKeyDown}
    onPointerDown={(event) => event.stopPropagation()}
    spellCheck
    style={{
      left: overlay.x * zoom - 4, top: overlay.y * zoom - 3,
      width: size.width * zoom + 22, height: size.height * zoom + 8,
      fontSize: overlay.fontSize * zoom, lineHeight: TEXT_LINE_HEIGHT, fontWeight: overlay.bold ? 700 : 400, color: overlay.color, fontFamily: OVERLAY_FONT_FAMILY,
    }}
  />;
}

interface ThumbProps {
  page: WorkingPage;
  index: number;
  source: SourceRef | undefined;
  current: boolean;
  selected: boolean;
  root: HTMLElement | null;
  dragging: boolean;
  dropTarget: boolean;
  imageUrl: (id: string) => string | undefined;
  watermark: Watermark | null;
  thumbnail: (page: WorkingPage, source: SourceRef) => Promise<string>;
  onOpen: (pageId: string) => void;
  onToggle: (pageId: string, range: boolean) => void;
  onDragStart: (pageId: string) => void;
  onDragOverPage: (pageId: string) => void;
  onDropPage: (pageId: string) => void;
  onDragEnd: () => void;
}

/** A page thumbnail in the rail: lazily rendered, selectable and draggable. */
export const PdfThumbnail = memo(function PdfThumbnail({ page, index, source, current, selected, root, dragging, dropTarget, imageUrl, watermark, thumbnail, onOpen, onToggle, onDragStart, onDragOverPage, onDropPage, onDragEnd }: ThumbProps) {
  const ref = useRef<HTMLLIElement>(null);
  const [visible, setVisible] = useState(index < 12);
  const [url, setUrl] = useState("");
  const view = viewSize(page);
  const thumbWatermark = watermark && watermarkOnPage(watermark, page.id) ? watermark : null;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { root, rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    if (!visible || !source) return;
    let active = true;
    thumbnail(page, source).then((value) => { if (active) setUrl(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [visible, source, page.sourceIndex, page.rotation, page.sourceId, thumbnail]);
  useEffect(() => { if (current) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [current]);

  return <li
    ref={ref}
    className={`pdfs-thumb ${current ? "is-current" : ""} ${selected ? "is-selected" : ""} ${dragging ? "is-dragging" : ""} ${dropTarget ? "is-drop-target" : ""}`}
    draggable
    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", page.id); onDragStart(page.id); }}
    onDragOver={(event) => { if (!Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); onDragOverPage(page.id); } }}
    onDrop={(event) => { if (Array.from(event.dataTransfer.types).includes("Files")) return; event.preventDefault(); onDropPage(page.id); }}
    onDragEnd={onDragEnd}
  >
    <button type="button" className="pdfs-thumb-button" onClick={(event) => { if (event.shiftKey || event.metaKey || event.ctrlKey) onToggle(page.id, event.shiftKey); else onOpen(page.id); }} aria-label={`Go to page ${index + 1}`} aria-current={current ? "page" : undefined}>
      <span className="pdfs-thumb-frame" style={{ aspectRatio: `${view.width} / ${view.height}` }}>
        {url ? <img src={url} alt="" draggable={false}/> : <span className="pdfs-thumb-loading"/>}
        {(page.overlays.length > 0 || thumbWatermark) && <svg className="pdfs-thumb-overlays" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="none" aria-hidden="true">
          {thumbWatermark && <WatermarkShapes spec={thumbWatermark} width={view.width} height={view.height} imageUrl={imageUrl}/>}
          <OverlayShapes overlays={page.overlays} imageUrl={imageUrl}/>
        </svg>}
      </span>
      <span className="pdfs-thumb-label">{index + 1}</span>
    </button>
    <label className="pdfs-thumb-check" title={selected ? "Deselect page" : "Select page"}>
      <input type="checkbox" checked={selected} onChange={(event) => onToggle(page.id, (event.nativeEvent as MouseEvent).shiftKey)} aria-label={`Select page ${index + 1}`}/>
      <span aria-hidden="true">{selected && <Check size={11}/>}</span>
    </label>
  </li>;
});
