// Persora Docs — Interactive Horizontal & Vertical Rulers (inch graduations + draggable margins).
import { useRef } from "react";
import { PAGE_GAP_PX } from "./docs-extensions";
import type { DocMargins, DocPageDimensions } from "../../../cloudflare/docs-rules.js";

const PX_PER_INCH = 96;
const PT_PER_PX = 72 / 96;

export function DocHorizontalRuler({
  dims,
  margins,
  zoomScale,
  canEdit,
  onChangeMargins,
}: {
  dims: DocPageDimensions;
  margins: DocMargins;
  zoomScale: number;
  canEdit: boolean;
  onChangeMargins: (patch: Partial<DocMargins>) => void;
}) {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const scaledWidth = Math.round(dims.widthPx * zoomScale);
  const leftMarginScaled = dims.marginLeftPx * zoomScale;
  const rightMarginScaled = dims.marginRightPx * zoomScale;
  const totalInches = dims.widthPx / PX_PER_INCH;
  const eighthTicks = Math.floor(totalInches * 8);

  const startMarginDrag = (side: "left" | "right", e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startPt = side === "left" ? margins.left : margins.right;

    const onMove = (ev: PointerEvent) => {
      const dxPx = (ev.clientX - startX) / zoomScale;
      const deltaPt = (side === "left" ? dxPx : -dxPx) * PT_PER_PX;
      const nextPt = Math.round(Math.max(18, Math.min(180, startPt + deltaPt)));
      onChangeMargins(side === "left" ? { left: nextPt } : { right: nextPt });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="pd-hruler-bar" role="region" aria-label="Horizontal ruler">
      <div
        ref={rulerRef}
        className="pd-hruler-track"
        style={{ width: `${scaledWidth}px` }}
      >
        <div
          className="pd-ruler-margin-shade is-left"
          style={{ width: `${leftMarginScaled}px` }}
        />
        <div
          className="pd-ruler-margin-shade is-right"
          style={{ width: `${rightMarginScaled}px` }}
        />

        {Array.from({ length: eighthTicks + 1 }, (_, idx) => {
          const xScaled = (idx / 8) * PX_PER_INCH * zoomScale;
          const isInch = idx % 8 === 0;
          const isHalf = idx % 4 === 0 && !isInch;
          const isQuarter = idx % 2 === 0 && !isInch && !isHalf;
          const inchNum = idx / 8;
          return (
            <div
              key={idx}
              className={`pd-hruler-tick ${isInch ? "is-inch" : isHalf ? "is-half" : isQuarter ? "is-quarter" : "is-eighth"}`}
              style={{ left: `${xScaled}px` }}
            >
              {isInch && inchNum > 0 && inchNum < totalInches - 0.1 && (
                <span className="pd-ruler-num">{inchNum}</span>
              )}
            </div>
          );
        })}

        {canEdit && (
          <>
            <button
              type="button"
              className="pd-ruler-handle is-h-left"
              style={{ left: `${leftMarginScaled}px` }}
              aria-label={`Left margin ${(margins.left / 72).toFixed(2)} inches`}
              title={`Left margin: ${(margins.left / 72).toFixed(2)}" (drag to adjust)`}
              onPointerDown={(e) => startMarginDrag("left", e)}
            />
            <button
              type="button"
              className="pd-ruler-handle is-h-right"
              style={{ left: `${scaledWidth - rightMarginScaled}px` }}
              aria-label={`Right margin ${(margins.right / 72).toFixed(2)} inches`}
              title={`Right margin: ${(margins.right / 72).toFixed(2)}" (drag to adjust)`}
              onPointerDown={(e) => startMarginDrag("right", e)}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function DocVerticalRuler({
  dims,
  margins,
  pageCount,
  zoomScale,
  scrollTop,
  canvasTopPaddingPx,
  canEdit,
  onChangeMargins,
}: {
  dims: DocPageDimensions;
  margins: DocMargins;
  pageCount: number;
  zoomScale: number;
  scrollTop: number;
  canvasTopPaddingPx: number;
  canEdit: boolean;
  onChangeMargins: (patch: Partial<DocMargins>) => void;
}) {
  const pageHeightScaled = dims.heightPx * zoomScale;
  const pageGapScaled = PAGE_GAP_PX * zoomScale;
  const topMarginScaled = dims.marginTopPx * zoomScale;
  const bottomMarginScaled = dims.marginBottomPx * zoomScale;
  const totalInches = dims.heightPx / PX_PER_INCH;
  const quarterTicks = Math.floor(totalInches * 4);

  const startVerticalMarginDrag = (side: "top" | "bottom", e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();

    const startY = e.clientY;
    const startPt = side === "top" ? margins.top : margins.bottom;

    const onMove = (ev: PointerEvent) => {
      const dyPx = (ev.clientY - startY) / zoomScale;
      const deltaPt = (side === "top" ? dyPx : -dyPx) * PT_PER_PX;
      const nextPt = Math.round(Math.max(18, Math.min(180, startPt + deltaPt)));
      onChangeMargins(side === "top" ? { top: nextPt } : { bottom: nextPt });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="pd-vruler-rail" role="region" aria-label="Vertical ruler">
      <div
        className="pd-vruler-scroll-inner"
        style={{
          transform: `translateY(${canvasTopPaddingPx - scrollTop}px)`,
        }}
      >
        {Array.from({ length: pageCount }, (_, pIdx) => (
          <div
            key={pIdx}
            className="pd-vruler-page"
            style={{
              height: `${pageHeightScaled}px`,
              marginBottom: pIdx < pageCount - 1 ? `${pageGapScaled}px` : 0,
            }}
          >
            <div
              className="pd-vruler-margin-shade is-top"
              style={{ height: `${topMarginScaled}px` }}
            />
            <div
              className="pd-vruler-margin-shade is-bottom"
              style={{ height: `${bottomMarginScaled}px` }}
            />

            {Array.from({ length: quarterTicks + 1 }, (_, tIdx) => {
              const yScaled = (tIdx / 4) * PX_PER_INCH * zoomScale;
              const isInch = tIdx % 4 === 0;
              const isHalf = tIdx % 2 === 0 && !isInch;
              const inchNum = tIdx / 4;
              return (
                <div
                  key={tIdx}
                  className={`pd-vruler-tick ${isInch ? "is-inch" : isHalf ? "is-half" : "is-quarter"}`}
                  style={{ top: `${yScaled}px` }}
                >
                  {isInch && inchNum > 0 && inchNum < totalInches - 0.1 && (
                    <span className="pd-vruler-num">{inchNum}</span>
                  )}
                </div>
              );
            })}

            {canEdit && (
              <>
                <button
                  type="button"
                  className="pd-ruler-handle is-v-top"
                  style={{ top: `${topMarginScaled}px` }}
                  aria-label={`Top margin ${(margins.top / 72).toFixed(2)} inches`}
                  title={`Top margin: ${(margins.top / 72).toFixed(2)}" (drag to adjust)`}
                  onPointerDown={(e) => startVerticalMarginDrag("top", e)}
                />
                <button
                  type="button"
                  className="pd-ruler-handle is-v-bottom"
                  style={{ top: `${pageHeightScaled - bottomMarginScaled}px` }}
                  aria-label={`Bottom margin ${(margins.bottom / 72).toFixed(2)} inches`}
                  title={`Bottom margin: ${(margins.bottom / 72).toFixed(2)}" (drag to adjust)`}
                  onPointerDown={(e) => startVerticalMarginDrag("bottom", e)}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
