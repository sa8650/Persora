// Persora Docs — Resizable & wrappable inline/floating document image NodeView
// plus client-side device image reader.
import { useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  PanelLeft,
  PanelRight,
  Rows3,
  Square,
  Trash2,
} from "lucide-react";
import type { DocImageWrap } from "../../../cloudflare/docs-rules.js";

const MAX_UPLOAD_DIMENSION = 1400;

export async function readDeviceImageAsDataUrl(file: File): Promise<{
  src: string;
  width: number;
  height: number;
  alt: string;
}> {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Choose a PNG, JPEG, WebP, or GIF image file.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Image file must be under 15 MB.");
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read image file."));
    };
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });

  const loaded = await new Promise<{ width: number; height: number; img: HTMLImageElement }>(
    (resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        resolve({
          width: Math.max(48, img.naturalWidth || 360),
          height: Math.max(36, img.naturalHeight || 240),
          img,
        });
      img.onerror = () => reject(new Error("Selected image could not be decoded."));
      img.src = rawDataUrl;
    },
  );

  const needsRasterizeOrResize =
    file.type === "image/svg+xml" ||
    loaded.width > MAX_UPLOAD_DIMENSION ||
    loaded.height > MAX_UPLOAD_DIMENSION ||
    rawDataUrl.length > 1_600_000;

  let finalSrc = rawDataUrl;
  let naturalW = loaded.width;
  let naturalH = loaded.height;

  if (needsRasterizeOrResize) {
    const scale = Math.min(
      1,
      MAX_UPLOAD_DIMENSION / Math.max(1, loaded.width),
      MAX_UPLOAD_DIMENSION / Math.max(1, loaded.height),
    );
    naturalW = Math.max(48, Math.round(loaded.width * scale));
    naturalH = Math.max(36, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(loaded.img, 0, 0, naturalW, naturalH);
      const isOpaquePhoto = file.type === "image/jpeg" || file.type === "image/jpg";
      finalSrc = isOpaquePhoto
        ? canvas.toDataURL("image/jpeg", 0.86)
        : canvas.toDataURL("image/png");
    }
  }

  // Fit comfortably inside standard document body width (~620px) on initial insert
  const displayScale = Math.min(1, 440 / naturalW);
  const displayW = Math.max(64, Math.round(naturalW * displayScale));
  const displayH = Math.max(40, Math.round(naturalH * displayScale));
  const alt = file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Inserted image";

  return {
    src: finalSrc,
    width: displayW,
    height: displayH,
    alt,
  };
}

function readZoomScale(el: HTMLElement | null): number {
  const stage = el?.closest("[data-zoom-scale]") as HTMLElement | null;
  const val = Number(stage?.dataset.zoomScale || 1);
  return Number.isFinite(val) && val > 0.1 ? val : 1;
}

export default function DocImageNodeView({
  node,
  selected,
  editor,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);

  const src = String(node.attrs.src || "");
  const alt = String(node.attrs.alt || "");
  const width = Math.max(48, Number(node.attrs.width) || 320);
  const height = typeof node.attrs.height === "number" ? node.attrs.height : undefined;
  const wrap = (node.attrs.wrap as DocImageWrap) || "inline";
  const align = (node.attrs.align as "left" | "center" | "right") || "left";
  const canEdit = editor.isEditable;

  const effectiveWidth = resizingWidth ?? width;
  const aspectRatio =
    height && width > 0
      ? height / width
      : imgRef.current && imgRef.current.naturalWidth > 0
        ? imgRef.current.naturalHeight / imgRef.current.naturalWidth
        : undefined;
  const effectiveHeight =
    resizingWidth !== null && aspectRatio
      ? Math.max(32, Math.round(resizingWidth * aspectRatio))
      : height;

  const startCornerResize = (corner: "nw" | "ne" | "sw" | "se", e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startW = width;
    const ratio =
      aspectRatio ||
      (imgRef.current && imgRef.current.clientWidth > 0
        ? imgRef.current.clientHeight / imgRef.current.clientWidth
        : 0.75);
    const zoom = readZoomScale(wrapRef.current);
    const sign = corner === "nw" || corner === "sw" ? -1 : 1;

    let latestW = startW;

    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - startX) / zoom) * sign;
      latestW = Math.max(56, Math.min(880, Math.round(startW + dx)));
      setResizingWidth(latestW);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizingWidth(null);
      updateAttributes({
        width: latestW,
        height: Math.max(32, Math.round(latestW * ratio)),
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const applyPresetPercent = (pct: number) => {
    const stageEl = wrapRef.current?.closest(".pd-prosemirror") as HTMLElement | null;
    const baseMax = stageEl ? Math.max(240, stageEl.clientWidth) : 640;
    const nextW = Math.max(64, Math.round((baseMax * pct) / 100));
    const ratio = aspectRatio || 0.75;
    updateAttributes({
      width: nextW,
      height: Math.max(32, Math.round(nextW * ratio)),
    });
  };

  return (
    <NodeViewWrapper
      ref={wrapRef}
      className={`pd-image-node wrap-${wrap} align-${align} ${selected ? "is-selected" : ""}`}
      data-doc-image="true"
      data-wrap={wrap}
      data-align={align}
    >
      <div
        className="pd-image-frame"
        style={{
          width: `${effectiveWidth}px`,
          maxWidth: "100%",
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          style={{
            width: "100%",
            height: effectiveHeight ? `${effectiveHeight}px` : "auto",
            display: "block",
          }}
        />

        {selected && canEdit && (
          <>
            <span
              className="pd-img-handle is-nw"
              role="slider"
              aria-label="Resize image top-left"
              aria-valuenow={effectiveWidth}
              onPointerDown={(e) => startCornerResize("nw", e)}
            />
            <span
              className="pd-img-handle is-ne"
              role="slider"
              aria-label="Resize image top-right"
              aria-valuenow={effectiveWidth}
              onPointerDown={(e) => startCornerResize("ne", e)}
            />
            <span
              className="pd-img-handle is-sw"
              role="slider"
              aria-label="Resize image bottom-left"
              aria-valuenow={effectiveWidth}
              onPointerDown={(e) => startCornerResize("sw", e)}
            />
            <span
              className="pd-img-handle is-se"
              role="slider"
              aria-label="Resize image bottom-right"
              aria-valuenow={effectiveWidth}
              onPointerDown={(e) => startCornerResize("se", e)}
            />

            <div
              className="pd-image-Popover"
              role="toolbar"
              aria-label="Image wrapping and size"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`pd-img-opt-btn ${wrap === "inline" ? "is-on" : ""}`}
                onClick={() => updateAttributes({ wrap: "inline" })}
                title="In line with text"
                aria-label="In line"
              >
                <Square size={13} />
              </button>
              <button
                type="button"
                className={`pd-img-opt-btn ${wrap === "wrap-left" ? "is-on" : ""}`}
                onClick={() => updateAttributes({ wrap: "wrap-left" })}
                title="Wrap text (float left)"
                aria-label="Wrap left"
              >
                <PanelLeft size={13} />
              </button>
              <button
                type="button"
                className={`pd-img-opt-btn ${wrap === "wrap-right" ? "is-on" : ""}`}
                onClick={() => updateAttributes({ wrap: "wrap-right" })}
                title="Wrap text (float right)"
                aria-label="Wrap right"
              >
                <PanelRight size={13} />
              </button>
              <button
                type="button"
                className={`pd-img-opt-btn ${wrap === "break-text" ? "is-on" : ""}`}
                onClick={() => updateAttributes({ wrap: "break-text" })}
                title="Break text"
                aria-label="Break text"
              >
                <Rows3 size={13} />
              </button>

              {(wrap === "inline" || wrap === "break-text") && (
                <>
                  <span className="pd-img-opt-sep" />
                  <button
                    type="button"
                    className={`pd-img-opt-btn ${align === "left" ? "is-on" : ""}`}
                    onClick={() => updateAttributes({ align: "left" })}
                    title="Align image left"
                    aria-label="Align image left"
                  >
                    <AlignLeft size={13} />
                  </button>
                  <button
                    type="button"
                    className={`pd-img-opt-btn ${align === "center" ? "is-on" : ""}`}
                    onClick={() => updateAttributes({ align: "center" })}
                    title="Center image"
                    aria-label="Center image"
                  >
                    <AlignCenter size={13} />
                  </button>
                  <button
                    type="button"
                    className={`pd-img-opt-btn ${align === "right" ? "is-on" : ""}`}
                    onClick={() => updateAttributes({ align: "right" })}
                    title="Align image right"
                    aria-label="Align image right"
                  >
                    <AlignRight size={13} />
                  </button>
                </>
              )}

              <span className="pd-img-opt-sep" />
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className="pd-img-opt-pct"
                  onClick={() => applyPresetPercent(pct)}
                  title={`Resize to ${pct}% width`}
                >
                  {pct}%
                </button>
              ))}
              <span className="pd-img-opt-sep" />
              <button
                type="button"
                className="pd-img-opt-btn is-danger"
                onClick={() => deleteNode()}
                title="Remove image"
                aria-label="Remove image"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}
