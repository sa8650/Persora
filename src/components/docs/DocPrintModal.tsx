// Persora Docs — Google Docs-style Print Preview & Settings Dialog.
// Renders actual paginated semantic DOM pages (never a screenshot or raster capture),
// preserving per-page background colors, margins, orientation, headers, footers,
// page numbers, tables, images, and vector geometric shapes, then launches native browser print.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Printer, X } from "lucide-react";
import {
  DOC_PAPER_SIZES,
  formatDocPageNumber,
  getDocPageSetup,
  getPageDimensions,
  normalizeDocPageSetup,
  renderDocPrintableHtml,
  type DocBlockNode,
  type DocContent,
  type DocInlineNode,
  type DocMargins,
  type DocPageOrientation,
  type DocPaperSizeId,
  type DocShape,
} from "../../../cloudflare/docs-rules.js";
import { Checkbox } from "@/components/ui/checkbox";

export interface DocPrintSettingsState {
  rangeMode: "all" | "custom";
  customRange: string;
  paperSize: DocPaperSizeId;
  orientation: DocPageOrientation;
  marginPreset: "default" | "normal" | "narrow" | "minimal" | "custom";
  customMargins: DocMargins;
  scale: number;
  includeHeadersFooters: boolean;
  backgroundGraphics: boolean;
}

export function parsePrintPageRange(
  input: string,
  totalPages: number,
): { indices: number[]; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { indices: [], error: `Enter page numbers between 1 and ${totalPages}.` };
  const set = new Set<number>();
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) {
      return { indices: [], error: `Invalid range "${part}". Use e.g. 1-2, 4.` };
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (start < 1 || end < start || end > totalPages) {
      return { indices: [], error: `Page numbers must be between 1 and ${totalPages}.` };
    }
    for (let p = start; p <= end; p += 1) {
      set.add(p - 1);
    }
  }
  const indices = Array.from(set).sort((a, b) => a - b);
  return indices.length > 0
    ? { indices, error: null }
    : { indices: [], error: "Select at least one page." };
}

export function launchHtmlIframePrint(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("data-persora-print-frame", "true");
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
    }, 2000);
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
    window.setTimeout(runPrint, 80);
  } else {
    iframe.onload = () => window.setTimeout(runPrint, 80);
  }
}

function PreviewInlineNodes({ nodes }: { nodes?: DocInlineNode[] }) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === "hardBreak") return <br key={i} />;
        if (node.type !== "text") return null;
        let el: React.ReactNode = node.text;
        for (const m of node.marks || []) {
          if (m.type === "bold") el = <strong key={`b-${i}`}>{el}</strong>;
          else if (m.type === "italic") el = <em key={`i-${i}`}>{el}</em>;
          else if (m.type === "underline") el = <u key={`u-${i}`}>{el}</u>;
          else if (m.type === "strike") el = <s key={`s-${i}`}>{el}</s>;
          else if (m.type === "highlight") {
            el = (
              <mark
                key={`hl-${i}`}
                style={{
                  backgroundColor: m.attrs.color || "#fef08a",
                  color: "inherit",
                  padding: "0 2px",
                  borderRadius: 2,
                }}
              >
                {el}
              </mark>
            );
          } else if (m.type === "textStyle") {
            el = (
              <span
                key={`ts-${i}`}
                style={{
                  color: m.attrs.color,
                  fontSize: m.attrs.fontSize,
                }}
              >
                {el}
              </span>
            );
          } else if (m.type === "link") {
            el = (
              <a
                key={`lnk-${i}`}
                href={m.attrs.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {el}
              </a>
            );
          }
        }
        return <span key={i}>{el}</span>;
      })}
    </>
  );
}

function PreviewBlocks({
  blocks,
  backgroundGraphics,
}: {
  blocks: DocBlockNode[];
  backgroundGraphics: boolean;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "paragraph") {
          const variant = b.attrs?.variant;
          const cls =
            variant === "title"
              ? "pd-doc-title"
              : variant === "subtitle"
                ? "pd-doc-subtitle"
                : undefined;
          return (
            <p
              key={i}
              className={cls}
              style={{
                textAlign: b.attrs?.textAlign,
                lineHeight: b.attrs?.lineHeight,
              }}
            >
              {b.content && b.content.length > 0 ? (
                <PreviewInlineNodes nodes={b.content} />
              ) : (
                <br />
              )}
            </p>
          );
        }
        if (b.type === "heading") {
          const Tag = b.attrs.level === 2 ? "h2" : b.attrs.level === 3 ? "h3" : "h1";
          return (
            <Tag
              key={i}
              style={{
                textAlign: b.attrs.textAlign,
                lineHeight: b.attrs.lineHeight,
              }}
            >
              <PreviewInlineNodes nodes={b.content} />
            </Tag>
          );
        }
        if (b.type === "bulletList") {
          return (
            <ul key={i}>
              {b.content.map((li, lIdx) => (
                <li key={lIdx}>
                  <PreviewBlocks
                    blocks={li.content}
                    backgroundGraphics={backgroundGraphics}
                  />
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === "orderedList") {
          return (
            <ol key={i} start={b.attrs?.start || 1}>
              {b.content.map((li, lIdx) => (
                <li key={lIdx}>
                  <PreviewBlocks
                    blocks={li.content}
                    backgroundGraphics={backgroundGraphics}
                  />
                </li>
              ))}
            </ol>
          );
        }
        if (b.type === "blockquote") {
          return (
            <blockquote key={i}>
              <PreviewBlocks
                blocks={b.content}
                backgroundGraphics={backgroundGraphics}
              />
            </blockquote>
          );
        }
        if (b.type === "table") {
          return (
            <table key={i} className="pd-doc-table">
              <tbody>
                {b.content.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.content.map((cell, cIdx) => {
                      const CellTag = cell.type === "tableHeader" ? "th" : "td";
                      return (
                        <CellTag
                          key={cIdx}
                          colSpan={cell.attrs?.colspan}
                          rowSpan={cell.attrs?.rowspan}
                          style={{
                            backgroundColor: backgroundGraphics
                              ? cell.attrs?.backgroundColor ||
                                (cell.type === "tableHeader" ? "#f8fafc" : undefined)
                              : undefined,
                            borderColor: cell.attrs?.borderColor,
                          }}
                        >
                          <PreviewBlocks
                            blocks={cell.content}
                            backgroundGraphics={backgroundGraphics}
                          />
                        </CellTag>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (b.type === "docImage") {
          return (
            <img
              key={i}
              src={b.attrs.src}
              alt={b.attrs.alt}
              style={{
                maxWidth: "100%",
                width: `${b.attrs.width || 320}px`,
                height: b.attrs.height ? `${b.attrs.height}px` : "auto",
                display:
                  b.attrs.align === "center" || b.attrs.align === "right" ? "block" : undefined,
                margin:
                  b.attrs.align === "center"
                    ? "8px auto"
                    : b.attrs.align === "right"
                      ? "8px 0 8px auto"
                      : "6px 0",
                float:
                  b.attrs.wrap === "wrap-left"
                    ? "left"
                    : b.attrs.wrap === "wrap-right"
                      ? "right"
                      : undefined,
              }}
            />
          );
        }
        if (b.type === "horizontalRule") return <hr key={i} />;
        return null;
      })}
    </>
  );
}

function PreviewShapeItem({
  shape,
  backgroundGraphics,
}: {
  shape: DocShape;
  backgroundGraphics: boolean;
}) {
  const pxPerPt = 96 / 72;
  const wPx = Math.max(18, shape.width * pxPerPt);
  const hPx = Math.max(14, shape.height * pxPerPt);
  const isLinear = shape.shapeType === "line" || shape.shapeType === "arrow";
  const fill =
    !backgroundGraphics || shape.fillColor === "transparent" || isLinear
      ? "none"
      : shape.fillColor || "#e8f0fe";
  const stroke = shape.strokeColor === "transparent" ? "none" : shape.strokeColor || "#1a73e8";
  const sw = Math.max(1, (shape.strokeWidth ?? 2) * pxPerPt);
  const pad = Math.ceil(sw / 2) + 2;

  return (
    <div
      className="pd-print-preview-shape"
      style={{
        position: "absolute",
        left: `${shape.x * pxPerPt}px`,
        top: `${shape.y * pxPerPt}px`,
        width: `${wPx}px`,
        height: `${hPx}px`,
        transform: `rotate(${shape.rotation || 0}deg)`,
        pointerEvents: "none",
      }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${wPx} ${hPx}`} preserveAspectRatio="none">
        {shape.shapeType === "circle" || shape.shapeType === "oval" ? (
          <ellipse
            cx={wPx / 2}
            cy={hPx / 2}
            rx={shape.shapeType === "circle" ? Math.min(wPx, hPx) / 2 - pad : wPx / 2 - pad}
            ry={shape.shapeType === "circle" ? Math.min(wPx, hPx) / 2 - pad : hPx / 2 - pad}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        ) : shape.shapeType === "triangle" ? (
          <polygon
            points={`${wPx / 2},${pad} ${wPx - pad},${hPx - pad} ${pad},${hPx - pad}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        ) : isLinear ? (
          <line
            x1={pad}
            y1={hPx / 2}
            x2={wPx - pad}
            y2={hPx / 2}
            stroke={stroke === "none" ? "#1a73e8" : stroke}
            strokeWidth={sw}
          />
        ) : (
          <rect
            x={pad}
            y={pad}
            width={Math.max(4, wPx - pad * 2)}
            height={Math.max(4, hPx - pad * 2)}
            rx={shape.shapeType === "roundedRect" ? 12 : 0}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        )}
      </svg>
      {shape.text && !isLinear && (
        <div
          style={{
            position: "absolute",
            inset: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontSize: `${shape.fontSize || 11}pt`,
            color: shape.textColor || "#0f172a",
          }}
        >
          {shape.text}
        </div>
      )}
    </div>
  );
}

export default function DocPrintModal({
  title,
  doc,
  livePageBlocks,
  onExportPdf,
  onClose,
}: {
  title: string;
  doc: DocContent;
  livePageBlocks: DocBlockNode[][];
  onExportPdf: () => void;
  onClose: () => void;
}) {
  const baseSetup = useMemo(() => getDocPageSetup(doc), [doc]);
  const [settings, setSettings] = useState<DocPrintSettingsState>(() => ({
    rangeMode: "all",
    customRange: "1",
    paperSize: baseSetup.paperSize,
    orientation: baseSetup.orientation,
    marginPreset: "default",
    customMargins: { ...baseSetup.margins },
    scale: 100,
    includeHeadersFooters: true,
    backgroundGraphics: true,
  }));

  const resolvedMargins: DocMargins = useMemo(() => {
    switch (settings.marginPreset) {
      case "normal":
        return { top: 72, bottom: 72, left: 72, right: 72 };
      case "narrow":
        return { top: 36, bottom: 36, left: 36, right: 36 };
      case "minimal":
        return { top: 18, bottom: 18, left: 18, right: 18 };
      case "custom":
        return settings.customMargins;
      default:
        return baseSetup.margins;
    }
  }, [baseSetup.margins, settings.customMargins, settings.marginPreset]);

  const effectiveSetup = useMemo(
    () =>
      normalizeDocPageSetup({
        ...baseSetup,
        paperSize: settings.paperSize,
        orientation: settings.orientation,
        margins: resolvedMargins,
      }),
    [baseSetup, resolvedMargins, settings.orientation, settings.paperSize],
  );

  const dims = useMemo(() => getPageDimensions(effectiveSetup), [effectiveSetup]);
  const shapes = useMemo(() => (Array.isArray(doc.shapes) ? doc.shapes : []), [doc.shapes]);

  const pagesToRender = useMemo(() => {
    const copy = livePageBlocks.length > 0 ? [...livePageBlocks] : [doc.content];
    let maxIdx = copy.length - 1;
    for (const s of shapes) {
      if (s.pageIndex > maxIdx) maxIdx = s.pageIndex;
    }
    while (copy.length <= maxIdx) copy.push([]);
    return copy;
  }, [doc.content, livePageBlocks, shapes]);

  const totalPages = Math.max(1, pagesToRender.length);
  const rangeResult = useMemo(() => {
    if (settings.rangeMode === "all") {
      return {
        indices: Array.from({ length: totalPages }, (_, i) => i),
        error: null,
      };
    }
    return parsePrintPageRange(settings.customRange, totalPages);
  }, [settings.customRange, settings.rangeMode, totalPages]);

  const previewScale = Math.min(0.62, 520 / dims.widthPx);

  const executePrint = () => {
    if (rangeResult.error) return;
    const html = renderDocPrintableHtml(title, doc, {
      pageBlocks: pagesToRender,
      pageRangeIndices: rangeResult.indices,
      paperSize: settings.paperSize,
      orientation: settings.orientation,
      margins: resolvedMargins,
      scale: settings.scale,
      includeHeadersFooters: settings.includeHeadersFooters,
      backgroundGraphics: settings.backgroundGraphics,
    });
    launchHtmlIframePrint(html);
    onClose();
  };

  return createPortal(
    <div
      className="pd-modal-scrim pd-print-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Print preview and settings"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pd-print-modal">
        {/* Left: Live Multi-Page Document DOM Preview */}
        <div className="pd-print-preview-pane" aria-label="Document print preview">
          <div className="pd-print-preview-meta">
            <span>
              Print preview · {rangeResult.indices.length}{" "}
              {rangeResult.indices.length === 1 ? "sheet" : "sheets"} of paper
            </span>
            <span>{DOC_PAPER_SIZES[settings.paperSize].label}</span>
          </div>

          <div className="pd-print-preview-scroll">
            {rangeResult.indices.map((pageIdx) => {
              const pageBg = settings.backgroundGraphics
                ? effectiveSetup.pageColors[String(pageIdx)] || "#ffffff"
                : "#ffffff";
              const hideFirst = effectiveSetup.differentFirstPage && pageIdx === 0;
              const headerTxt =
                settings.includeHeadersFooters && !hideFirst ? effectiveSetup.headerText : "";
              const footerTxt =
                settings.includeHeadersFooters && !hideFirst ? effectiveSetup.footerText : "";
              const pageNum = settings.includeHeadersFooters
                ? formatDocPageNumber(effectiveSetup, pageIdx, totalPages)
                : "";
              const headerPageNum =
                pageNum && effectiveSetup.pageNumberPosition.startsWith("header-") ? pageNum : "";
              const footerPageNum =
                pageNum && effectiveSetup.pageNumberPosition.startsWith("footer-") ? pageNum : "";
              const pageShapes = shapes.filter((s) => (s.pageIndex || 0) === pageIdx);

              return (
                <div
                  key={pageIdx}
                  className="pd-print-preview-page-shell"
                  style={{
                    width: `${Math.round(dims.widthPx * previewScale)}px`,
                    height: `${Math.round(dims.heightPx * previewScale)}px`,
                  }}
                >
                  <section
                    className="pd-print-preview-sheet pd-prosemirror"
                    data-preview-page={pageIdx + 1}
                    style={{
                      width: `${dims.widthPx}px`,
                      height: `${dims.heightPx}px`,
                      backgroundColor: pageBg,
                      padding: `${dims.marginTopPx}px ${dims.marginRightPx}px ${dims.marginBottomPx}px ${dims.marginLeftPx}px`,
                      transform: `scale(${previewScale})`,
                      transformOrigin: "top left",
                    }}
                  >
                    {settings.includeHeadersFooters && (headerTxt || headerPageNum) && (
                      <header
                        className="pd-print-preview-hf is-header"
                        style={{
                          left: `${dims.marginLeftPx}px`,
                          right: `${dims.marginRightPx}px`,
                        }}
                      >
                        <span style={{ textAlign: effectiveSetup.headerAlign, flex: 1 }}>
                          {headerTxt}
                        </span>
                        {headerPageNum && <span>{headerPageNum}</span>}
                      </header>
                    )}

                    <div
                      className="pd-print-preview-body"
                      style={
                        settings.scale !== 100
                          ? {
                              transform: `scale(${settings.scale / 100})`,
                              transformOrigin: "top left",
                              width: `${100 / (settings.scale / 100)}%`,
                            }
                          : undefined
                      }
                    >
                      <PreviewBlocks
                        blocks={pagesToRender[pageIdx] || []}
                        backgroundGraphics={settings.backgroundGraphics}
                      />
                    </div>

                    {pageShapes.map((s) => (
                      <PreviewShapeItem
                        key={s.id}
                        shape={s}
                        backgroundGraphics={settings.backgroundGraphics}
                      />
                    ))}

                    {settings.includeHeadersFooters && (footerTxt || footerPageNum) && (
                      <footer
                        className="pd-print-preview-hf is-footer"
                        style={{
                          left: `${dims.marginLeftPx}px`,
                          right: `${dims.marginRightPx}px`,
                        }}
                      >
                        <span style={{ textAlign: effectiveSetup.footerAlign, flex: 1 }}>
                          {footerTxt}
                        </span>
                        {footerPageNum && <span>{footerPageNum}</span>}
                      </footer>
                    )}
                  </section>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Print Settings Controls */}
        <div className="pd-print-settings-pane">
          <div className="pd-print-settings-head">
            <h3>Print settings</h3>
            <button
              type="button"
              className="pd-icon-btn"
              onClick={onClose}
              aria-label="Close print preview"
            >
              <X size={16} />
            </button>
          </div>

          <div className="pd-print-settings-body">
            {/* Pages / Range */}
            <div className="pd-print-field">
              <label htmlFor="pd-print-range">Pages</label>
              <select
                id="pd-print-range"
                value={settings.rangeMode}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    rangeMode: e.target.value as "all" | "custom",
                  }))
                }
              >
                <option value="all">All ({totalPages} {totalPages === 1 ? "page" : "pages"})</option>
                <option value="custom">Custom</option>
              </select>
              {settings.rangeMode === "custom" && (
                <input
                  type="text"
                  aria-label="Custom page range"
                  placeholder={`e.g. 1-${totalPages}`}
                  value={settings.customRange}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, customRange: e.target.value }))
                  }
                />
              )}
              {rangeResult.error && (
                <span className="pd-print-error" role="alert">
                  {rangeResult.error}
                </span>
              )}
            </div>

            {/* Paper Size */}
            <div className="pd-print-field">
              <label htmlFor="pd-print-paper">Paper size</label>
              <select
                id="pd-print-paper"
                value={settings.paperSize}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    paperSize: e.target.value as DocPaperSizeId,
                  }))
                }
              >
                <option value="letter">{DOC_PAPER_SIZES.letter.label}</option>
                <option value="a4">{DOC_PAPER_SIZES.a4.label}</option>
                <option value="legal">{DOC_PAPER_SIZES.legal.label}</option>
              </select>
            </div>

            {/* Orientation */}
            <div className="pd-print-field">
              <label htmlFor="pd-print-orientation">Layout / Orientation</label>
              <select
                id="pd-print-orientation"
                value={settings.orientation}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    orientation: e.target.value as DocPageOrientation,
                  }))
                }
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>

            {/* Margins */}
            <div className="pd-print-field">
              <label htmlFor="pd-print-margins">Margins</label>
              <select
                id="pd-print-margins"
                value={settings.marginPreset}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    marginPreset: e.target.value as DocPrintSettingsState["marginPreset"],
                  }))
                }
              >
                <option value="default">Default (Document margins)</option>
                <option value="normal">Normal (1 in)</option>
                <option value="narrow">Narrow (0.5 in)</option>
                <option value="minimal">Minimal (0.25 in)</option>
                <option value="custom">Custom numbers</option>
              </select>

              {settings.marginPreset === "custom" && (
                <div className="pd-print-margins-grid">
                  {(["top", "bottom", "left", "right"] as const).map((side) => (
                    <label key={side} className="pd-print-mini-num">
                      <span>{side[0].toUpperCase() + side.slice(1)} (pt)</span>
                      <input
                        type="number"
                        min={18}
                        max={180}
                        value={settings.customMargins[side]}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            customMargins: {
                              ...s.customMargins,
                              [side]: Math.max(18, Math.min(180, Number(e.target.value) || 54)),
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Scale */}
            <div className="pd-print-field">
              <label htmlFor="pd-print-scale">Scale ({settings.scale}%)</label>
              <input
                id="pd-print-scale"
                type="range"
                min={50}
                max={175}
                step={5}
                value={settings.scale}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, scale: Number(e.target.value) || 100 }))
                }
              />
            </div>

            {/* Checkboxes (using Persora Design System Checkbox) */}
            <div className="pd-print-checks">
              <label className="pd-print-check-row">
                <Checkbox
                  checked={settings.includeHeadersFooters}
                  onCheckedChange={(v) =>
                    setSettings((s) => ({ ...s, includeHeadersFooters: Boolean(v) }))
                  }
                  aria-label="Headers and footers"
                />
                <span>Headers and footers</span>
              </label>

              <label className="pd-print-check-row">
                <Checkbox
                  checked={settings.backgroundGraphics}
                  onCheckedChange={(v) =>
                    setSettings((s) => ({ ...s, backgroundGraphics: Boolean(v) }))
                  }
                  aria-label="Background graphics"
                />
                <span>Background graphics (per-page colors, shading &amp; shapes)</span>
              </label>
            </div>
          </div>

          <div className="pd-print-settings-foot">
            <button type="button" className="pd-btn-secondary" onClick={onExportPdf}>
              <FileDown size={14} />
              <span>Save as PDF</span>
            </button>
            <div className="pd-print-foot-right">
              <button type="button" className="pd-btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="pd-btn-primary"
                disabled={Boolean(rangeResult.error)}
                onClick={executePrint}
              >
                <Printer size={14} />
                <span>Print</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
