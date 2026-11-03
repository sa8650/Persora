// Persora Docs — Interactive Multi-Page Geometric Shapes Layer.
// Supports rectangle, roundedRect, circle, oval, triangle, diamond, pentagon,
// star, callout, line, and arrow — with drag repositioning (including across pages),
// 8-direction resizing, rotation handle, fill & border color pickers, border width,
// and inline editable text inside shapes.
import { useEffect, useState } from "react";
import {
  Copy,
  PaintBucket,
  PenLine,
  RotateCw,
  Trash2,
  Type,
} from "lucide-react";
import {
  DOC_PAGE_COLORS,
  DOC_TEXT_COLORS,
  type DocPageDimensions,
  type DocShape,
  type DocShapeType,
} from "../../../cloudflare/docs-rules.js";
import { PAGE_GAP_PX } from "./docs-extensions";

const PX_PER_PT = 96 / 72;
const PT_PER_PX = 72 / 96;

export const DOC_SHAPE_CATALOG: Array<{
  type: DocShapeType;
  label: string;
}> = [
  { type: "rectangle", label: "Rectangle" },
  { type: "roundedRect", label: "Rounded rectangle" },
  { type: "circle", label: "Circle" },
  { type: "oval", label: "Oval" },
  { type: "triangle", label: "Triangle" },
  { type: "diamond", label: "Diamond" },
  { type: "pentagon", label: "Pentagon" },
  { type: "star", label: "Star" },
  { type: "callout", label: "Callout" },
  { type: "line", label: "Line" },
  { type: "arrow", label: "Arrow" },
];

export function createDefaultDocShape(
  shapeType: DocShapeType,
  pageIndex: number,
  dims: DocPageDimensions,
  existingCount = 0,
): DocShape {
  const cascade = (existingCount % 5) * 14;
  const isLinear = shapeType === "line" || shapeType === "arrow";
  const isSquare = shapeType === "circle" || shapeType === "star" || shapeType === "diamond";
  const width = isLinear ? 160 : isSquare ? 96 : 144;
  const height = isLinear ? 28 : isSquare ? 96 : 86;
  const x = Math.min(
    Math.max(36, Math.round(dims.widthPt / 2 - width / 2 + cascade)),
    dims.widthPt - width - 24,
  );
  const y = Math.min(Math.max(72, 110 + cascade), dims.heightPt - height - 48);

  return {
    id: `shape_${crypto.randomUUID().slice(0, 8)}`,
    shapeType,
    pageIndex: Math.max(0, pageIndex),
    x,
    y,
    width,
    height,
    rotation: 0,
    fillColor: isLinear ? "transparent" : "#e8f0fe",
    strokeColor: "#1a73e8",
    strokeWidth: 2,
    textColor: "#0f172a",
    fontSize: 11,
    zIndex: existingCount + 2,
  };
}

function renderShapeSvgElement(shape: DocShape, wPx: number, hPx: number) {
  const fill =
    shape.fillColor === "transparent" || shape.shapeType === "line" || shape.shapeType === "arrow"
      ? "none"
      : shape.fillColor || "#e8f0fe";
  const stroke =
    shape.strokeColor === "transparent" ? "none" : shape.strokeColor || "#1a73e8";
  const sw = Math.max(0, (shape.strokeWidth ?? 2) * PX_PER_PT);
  const pad = Math.ceil(sw / 2) + 2;
  const iw = Math.max(4, wPx - pad * 2);
  const ih = Math.max(4, hPx - pad * 2);

  switch (shape.shapeType) {
    case "roundedRect":
      return (
        <rect
          x={pad}
          y={pad}
          width={iw}
          height={ih}
          rx={Math.min(20, iw / 4, ih / 4)}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case "circle": {
      const r = Math.min(iw, ih) / 2;
      return (
        <circle
          cx={wPx / 2}
          cy={hPx / 2}
          r={r}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    }
    case "oval":
      return (
        <ellipse
          cx={wPx / 2}
          cy={hPx / 2}
          rx={iw / 2}
          ry={ih / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
    case "triangle":
      return (
        <polygon
          points={`${wPx / 2},${pad} ${wPx - pad},${hPx - pad} ${pad},${hPx - pad}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      );
    case "diamond":
      return (
        <polygon
          points={`${wPx / 2},${pad} ${wPx - pad},${hPx / 2} ${wPx / 2},${hPx - pad} ${pad},${hPx / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      );
    case "pentagon":
      return (
        <polygon
          points={`${wPx * 0.5},${pad} ${wPx - pad},${hPx * 0.38} ${wPx * 0.81},${hPx - pad} ${wPx * 0.19},${hPx - pad} ${pad},${hPx * 0.38}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      );
    case "star": {
      const cx = wPx / 2;
      const cy = hPx / 2;
      const outerR = Math.min(iw, ih) / 2;
      const innerR = outerR * 0.42;
      const pts: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
      }
      return (
        <polygon
          points={pts.join(" ")}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      );
    }
    case "callout": {
      const bodyBottom = Math.max(pad + 12, hPx - pad - Math.min(22, ih * 0.24));
      return (
        <polygon
          points={`${pad},${pad} ${wPx - pad},${pad} ${wPx - pad},${bodyBottom} ${wPx * 0.42},${bodyBottom} ${wPx * 0.24},${hPx - pad} ${wPx * 0.28},${bodyBottom} ${pad},${bodyBottom}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      );
    }
    case "line": {
      const lineStroke = stroke === "none" ? "#1a73e8" : stroke;
      return (
        <line
          x1={pad}
          y1={hPx / 2}
          x2={wPx - pad}
          y2={hPx / 2}
          stroke={lineStroke}
          strokeWidth={Math.max(2, sw)}
          strokeLinecap="round"
        />
      );
    }
    case "arrow": {
      const lineStroke = stroke === "none" ? "#1a73e8" : stroke;
      const headLen = Math.min(20, Math.max(10, sw * 3.5));
      const cy = hPx / 2;
      const endX = wPx - pad;
      return (
        <>
          <line
            x1={pad}
            y1={cy}
            x2={Math.max(pad, endX - headLen * 0.7)}
            y2={cy}
            stroke={lineStroke}
            strokeWidth={Math.max(2, sw)}
            strokeLinecap="round"
          />
          <polygon
            points={`${endX},${cy} ${endX - headLen},${cy - headLen * 0.58} ${endX - headLen},${cy + headLen * 0.58}`}
            fill={lineStroke}
          />
        </>
      );
    }
    default:
      return (
        <rect
          x={pad}
          y={pad}
          width={iw}
          height={ih}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
        />
      );
  }
}

type ResizeDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const RESIZE_DIRS: ResizeDir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export default function DocShapesLayer({
  shapes,
  dims,
  pageCount,
  zoomScale,
  canEdit,
  selectedShapeId,
  onSelectShape,
  onChangeShapes,
}: {
  shapes: DocShape[];
  dims: DocPageDimensions;
  pageCount: number;
  zoomScale: number;
  canEdit: boolean;
  selectedShapeId: string | null;
  onSelectShape: (id: string | null) => void;
  onChangeShapes: (next: DocShape[]) => void;
}) {
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [openColorMenu, setOpenColorMenu] = useState<null | "fill" | "stroke" | "text">(null);

  useEffect(() => {
    if (!selectedShapeId) {
      setEditingTextId(null);
      setOpenColorMenu(null);
    }
  }, [selectedShapeId]);

  // Keyboard delete / nudge when a shape is selected (and not editing text inside it)
  useEffect(() => {
    if (!canEdit || !selectedShapeId || editingTextId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onChangeShapes(shapes.filter((s) => s.id !== selectedShapeId));
        onSelectShape(null);
      } else if (e.key === "Escape") {
        onSelectShape(null);
      } else if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        onChangeShapes(
          shapes.map((s) =>
            s.id === selectedShapeId
              ? {
                  ...s,
                  x: Math.max(0, Math.min(dims.widthPt - s.width, s.x + dx)),
                  y: Math.max(0, Math.min(dims.heightPt - s.height, s.y + dy)),
                }
              : s,
          ),
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, dims.heightPt, dims.widthPt, editingTextId, onChangeShapes, onSelectShape, selectedShapeId, shapes]);

  const updateOne = (id: string, patch: Partial<DocShape>) => {
    onChangeShapes(shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const pageStridePx = dims.heightPx + PAGE_GAP_PX;

  const startMove = (shape: DocShape, e: React.PointerEvent) => {
    if (!canEdit || editingTextId === shape.id) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectShape(shape.id);
    setOpenColorMenu(null);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startGlobalXPt = shape.x;
    const startGlobalYPx = shape.pageIndex * pageStridePx + shape.y * PX_PER_PT;

    let latestPatch: Partial<DocShape> | null = null;

    const onMove = (ev: PointerEvent) => {
      const dxPx = (ev.clientX - startClientX) / zoomScale;
      const dyPx = (ev.clientY - startClientY) / zoomScale;
      const nextXPt = Math.round(
        Math.max(0, Math.min(dims.widthPt - shape.width, startGlobalXPt + dxPx * PT_PER_PX)) * 10,
      ) / 10;

      const rawGlobalYPx = Math.max(0, startGlobalYPx + dyPx);
      const nextPageIdx = Math.max(
        0,
        Math.min(Math.max(0, pageCount - 1), Math.floor(rawGlobalYPx / pageStridePx)),
      );
      const localYPx = rawGlobalYPx - nextPageIdx * pageStridePx;
      const clampedLocalYPt =
        Math.round(
          Math.max(0, Math.min(dims.heightPt - shape.height, localYPx * PT_PER_PX)) * 10,
        ) / 10;

      latestPatch = {
        pageIndex: nextPageIdx,
        x: nextXPt,
        y: clampedLocalYPt,
      };
      updateOne(shape.id, latestPatch);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (latestPatch) updateOne(shape.id, latestPatch);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startResize = (shape: DocShape, dir: ResizeDir, e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const { x: sx, y: sy, width: sw, height: sh } = shape;

    const onMove = (ev: PointerEvent) => {
      const dxPt = ((ev.clientX - startClientX) / zoomScale) * PT_PER_PX;
      const dyPt = ((ev.clientY - startClientY) / zoomScale) * PT_PER_PX;

      let nx = sx;
      let ny = sy;
      let nw = sw;
      let nh = sh;

      if (dir.includes("e")) nw = Math.max(20, Math.min(dims.widthPt - sx, sw + dxPt));
      if (dir.includes("s")) nh = Math.max(16, Math.min(dims.heightPt - sy, sh + dyPt));
      if (dir.includes("w")) {
        const delta = Math.min(sw - 20, Math.max(-sx, dxPt));
        nx = sx + delta;
        nw = sw - delta;
      }
      if (dir.includes("n")) {
        const delta = Math.min(sh - 16, Math.max(-sy, dyPt));
        ny = sy + delta;
        nh = sh - delta;
      }

      updateOne(shape.id, {
        x: Math.round(nx * 10) / 10,
        y: Math.round(ny * 10) / 10,
        width: Math.round(nw * 10) / 10,
        height: Math.round(nh * 10) / 10,
      });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startRotate = (shape: DocShape, boxEl: HTMLElement, e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = boxEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const onMove = (ev: PointerEvent) => {
      const rad = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let deg = Math.round(((rad * 180) / Math.PI) + 90);
      if (deg > 180) deg -= 360;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      updateOne(shape.id, { rotation: deg });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const duplicateShape = (shape: DocShape) => {
    const copy: DocShape = {
      ...shape,
      id: `shape_${crypto.randomUUID().slice(0, 8)}`,
      x: Math.min(dims.widthPt - shape.width - 12, shape.x + 16),
      y: Math.min(dims.heightPt - shape.height - 12, shape.y + 16),
      zIndex: shapes.length + 3,
    };
    onChangeShapes([...shapes, copy]);
    onSelectShape(copy.id);
  };

  return (
    <div className="pd-shapes-stage-layer" aria-label="Document shapes">
      {shapes.map((shape) => {
        const isSelected = selectedShapeId === shape.id;
        const isEditingText = editingTextId === shape.id;
        const isLinear = shape.shapeType === "line" || shape.shapeType === "arrow";
        const leftPx = shape.x * PX_PER_PT;
        const topPx = shape.pageIndex * pageStridePx + shape.y * PX_PER_PT;
        const widthPx = Math.max(20, shape.width * PX_PER_PT);
        const heightPx = Math.max(16, shape.height * PX_PER_PT);

        return (
          <div
            key={shape.id}
            className={`pd-shape-item ${isSelected ? "is-selected" : ""} ${canEdit ? "is-editable" : ""}`}
            data-shape-id={shape.id}
            data-shape-type={shape.shapeType}
            data-shape-page={shape.pageIndex}
            style={{
              left: `${leftPx}px`,
              top: `${topPx}px`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              zIndex: isSelected ? 40 : shape.zIndex || 5,
            }}
            onPointerDown={(e) => startMove(shape, e)}
            onDoubleClick={(e) => {
              if (!canEdit || isLinear) return;
              e.stopPropagation();
              onSelectShape(shape.id);
              setEditingTextId(shape.id);
            }}
          >
            <div
              className="pd-shape-rotatable"
              style={{
                transform: `rotate(${shape.rotation || 0}deg)`,
              }}
            >
              <svg
                className="pd-shape-svg"
                width="100%"
                height="100%"
                viewBox={`0 0 ${widthPx} ${heightPx}`}
                preserveAspectRatio="none"
              >
                {renderShapeSvgElement(shape, widthPx, heightPx)}
              </svg>

              {!isLinear && (isEditingText || shape.text) && (
                <div className="pd-shape-text-wrap">
                  {isEditingText ? (
                    <textarea
                      className="pd-shape-textarea"
                      aria-label="Shape text"
                      value={shape.text || ""}
                      style={{
                        color: shape.textColor || "#0f172a",
                        fontSize: `${shape.fontSize || 11}pt`,
                      }}
                      autoFocus
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => updateOne(shape.id, { text: e.target.value })}
                      onBlur={() => setEditingTextId(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditingTextId(null);
                        }
                      }}
                    />
                  ) : (
                    <span
                      className="pd-shape-text-label"
                      style={{
                        color: shape.textColor || "#0f172a",
                        fontSize: `${shape.fontSize || 11}pt`,
                      }}
                    >
                      {shape.text}
                    </span>
                  )}
                </div>
              )}

              {isSelected && canEdit && !isEditingText && (
                <>
                  <button
                    type="button"
                    className="pd-shape-rotate-handle"
                    aria-label={`Rotate shape (${shape.rotation || 0} degrees)`}
                    title={`Drag to rotate (${shape.rotation || 0}°)`}
                    onPointerDown={(e) => {
                      const host = e.currentTarget.closest(".pd-shape-item") as HTMLElement | null;
                      if (host) startRotate(shape, host, e);
                    }}
                  >
                    <RotateCw size={11} />
                  </button>

                  {RESIZE_DIRS.map((dir) => (
                    <span
                      key={dir}
                      className={`pd-shape-handle is-${dir}`}
                      role="slider"
                      aria-label={`Resize shape ${dir}`}
                      aria-valuenow={Math.round(shape.width)}
                      onPointerDown={(e) => startResize(shape, dir, e)}
                    />
                  ))}
                </>
              )}
            </div>

            {isSelected && canEdit && (
              <div
                className="pd-shape-toolbar"
                role="toolbar"
                aria-label="Shape properties"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {!isLinear && (
                  <div className="pd-shape-pop-anchor">
                    <button
                      type="button"
                      className="pd-shape-tb-btn"
                      onClick={() => setOpenColorMenu(openColorMenu === "fill" ? null : "fill")}
                      title="Fill color"
                      aria-label="Shape fill color"
                    >
                      <PaintBucket size={13} />
                      <span
                        className="pd-shape-color-dot"
                        style={{
                          background:
                            shape.fillColor === "transparent"
                              ? "repeating-conic-gradient(#cbd5e1 0% 25%, #fff 0% 50%) 50% / 6px 6px"
                              : shape.fillColor,
                        }}
                      />
                    </button>
                    {openColorMenu === "fill" && (
                      <div className="pd-shape-color-popover" role="dialog" aria-label="Shape fill color">
                        <div className="pd-tb-swatch-grid">
                          {DOC_PAGE_COLORS.map((sw) => (
                            <button
                              key={sw.id}
                              type="button"
                              className="pd-tb-swatch"
                              style={{ backgroundColor: sw.hex }}
                              title={sw.label}
                              aria-label={`Fill ${sw.label}`}
                              onClick={() => {
                                updateOne(shape.id, { fillColor: sw.hex });
                                setOpenColorMenu(null);
                              }}
                            />
                          ))}
                          {DOC_TEXT_COLORS.slice(2, 7).map((sw) => (
                            <button
                              key={sw.id}
                              type="button"
                              className="pd-tb-swatch"
                              style={{ backgroundColor: sw.hex }}
                              title={sw.label}
                              aria-label={`Fill ${sw.label}`}
                              onClick={() => {
                                updateOne(shape.id, { fillColor: sw.hex });
                                setOpenColorMenu(null);
                              }}
                            />
                          ))}
                        </div>
                        <div className="pd-custom-color-row">
                          <label className="pd-custom-color-label">
                            <span>Custom</span>
                            <input
                              type="color"
                              aria-label="Custom shape fill color"
                              value={shape.fillColor === "transparent" ? "#e8f0fe" : shape.fillColor}
                              onChange={(e) => updateOne(shape.id, { fillColor: e.target.value })}
                            />
                          </label>
                          <button
                            type="button"
                            className="pd-tb-swatch-reset"
                            onClick={() => {
                              updateOne(shape.id, { fillColor: "transparent" });
                              setOpenColorMenu(null);
                            }}
                          >
                            Transparent
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="pd-shape-pop-anchor">
                  <button
                    type="button"
                    className="pd-shape-tb-btn"
                    onClick={() => setOpenColorMenu(openColorMenu === "stroke" ? null : "stroke")}
                    title="Border color & weight"
                    aria-label="Shape border color"
                  >
                    <PenLine size={13} />
                    <span
                      className="pd-shape-color-dot"
                      style={{
                        background:
                          shape.strokeColor === "transparent" ? "transparent" : shape.strokeColor,
                      }}
                    />
                  </button>
                  {openColorMenu === "stroke" && (
                    <div className="pd-shape-color-popover" role="dialog" aria-label="Shape border">
                      <div className="pd-tb-swatch-grid">
                        {DOC_TEXT_COLORS.map((sw) => (
                          <button
                            key={sw.id}
                            type="button"
                            className="pd-tb-swatch"
                            style={{ backgroundColor: sw.hex }}
                            title={sw.label}
                            aria-label={`Border ${sw.label}`}
                            onClick={() => {
                              updateOne(shape.id, { strokeColor: sw.hex });
                              setOpenColorMenu(null);
                            }}
                          />
                        ))}
                      </div>
                      <div className="pd-stroke-weight-row">
                        {[1, 2, 3, 4, 6].map((w) => (
                          <button
                            key={w}
                            type="button"
                            className={`pd-stroke-w-btn ${shape.strokeWidth === w ? "is-on" : ""}`}
                            onClick={() => updateOne(shape.id, { strokeWidth: w })}
                          >
                            {w}pt
                          </button>
                        ))}
                      </div>
                      <div className="pd-custom-color-row">
                        <label className="pd-custom-color-label">
                          <span>Custom</span>
                          <input
                            type="color"
                            aria-label="Custom shape border color"
                            value={shape.strokeColor === "transparent" ? "#1a73e8" : shape.strokeColor}
                            onChange={(e) => updateOne(shape.id, { strokeColor: e.target.value })}
                          />
                        </label>
                        {!isLinear && (
                          <button
                            type="button"
                            className="pd-tb-swatch-reset"
                            onClick={() => {
                              updateOne(shape.id, { strokeColor: "transparent" });
                              setOpenColorMenu(null);
                            }}
                          >
                            No border
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {!isLinear && (
                  <button
                    type="button"
                    className={`pd-shape-tb-btn ${isEditingText ? "is-on" : ""}`}
                    onClick={() => setEditingTextId(isEditingText ? null : shape.id)}
                    title="Edit text inside shape"
                    aria-label="Edit shape text"
                  >
                    <Type size={13} />
                  </button>
                )}

                <button
                  type="button"
                  className="pd-shape-tb-btn"
                  onClick={() => updateOne(shape.id, { rotation: ((shape.rotation || 0) + 45) % 360 })}
                  title="Rotate 45°"
                  aria-label="Rotate shape 45 degrees"
                >
                  <RotateCw size={13} />
                </button>

                <button
                  type="button"
                  className="pd-shape-tb-btn"
                  onClick={() => duplicateShape(shape)}
                  title="Duplicate shape"
                  aria-label="Duplicate shape"
                >
                  <Copy size={13} />
                </button>

                <button
                  type="button"
                  className="pd-shape-tb-btn is-danger"
                  onClick={() => {
                    onChangeShapes(shapes.filter((s) => s.id !== shape.id));
                    onSelectShape(null);
                  }}
                  title="Delete shape"
                  aria-label="Delete shape"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
