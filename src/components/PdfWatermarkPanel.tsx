import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Image as ImageIcon, Loader2, Stamp, Trash2, Type, Upload, X } from "lucide-react";
import {
  IMAGE_ACCEPT, OVERLAY_COLORS, WATERMARK_FONTS, WATERMARK_LIMITS, cleanTextForPdf, defaultTextWatermark, describePages, isWinAnsi, normalizeWatermark, resolveWatermarkPages, watermarkIsEmpty,
  type ImageWatermark, type TextWatermark, type Watermark, type WatermarkFont, type WatermarkPages, type WatermarkPosition,
} from "../lib/pdf-studio";

type PageChoice = "all" | "current" | "range";

interface Props {
  /** The watermark being edited (shown live on the pages). */
  draft: Watermark;
  /** The watermark currently part of the document, if any. */
  applied: Watermark | null;
  pages: readonly { id: string }[];
  currentIndex: number;
  imageUrl: (id: string) => string | undefined;
  onChange: (draft: Watermark) => void;
  /** Prepares an uploaded image; resolves with its id and pixel size. */
  onChooseImage: (file: File) => Promise<{ imageId: string; width: number; height: number }>;
  onApply: (spec: Watermark) => void;
  onRemove: () => void;
  onClose: () => void;
}

const POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: "center", label: "Center" },
  { id: "diagonal", label: "Diagonal" },
  { id: "tiled", label: "Tiled" },
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
  { id: "custom", label: "Custom" },
];
const CORNERS: WatermarkPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Restores the page choice shown for a stored page selection. */
function initialChoice(pages: WatermarkPages, all: readonly { id: string }[], currentIndex: number): { choice: PageChoice; range: string } {
  if (pages.mode === "all") return { choice: "all", range: "" };
  const indexes = pages.pageIds.map((id) => all.findIndex((page) => page.id === id)).filter((index) => index >= 0);
  if (indexes.length === 1 && indexes[0] === currentIndex) return { choice: "current", range: "" };
  return { choice: "range", range: describePages(indexes) };
}

function sameSpec(a: Watermark | null, b: Watermark | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function Slider({ label, value, min, max, step = 1, suffix, onChange, disabled, note }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void; disabled?: boolean; note?: ReactNode }) {
  const id = useId();
  return <div className={`pdfs-wm-slider ${disabled ? "is-disabled" : ""}`}>
    <label htmlFor={id}><span>{label}</span><output htmlFor={id}>{Math.round(value * 100) / 100}{suffix}</output></label>
    <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}/>
    {note && <small>{note}</small>}
  </div>;
}

/**
 * Watermark settings for Edit PDF → Annotate → Watermark. Changes preview live
 * on the pages; Apply adds the watermark to the document (undoable), and it is
 * drawn into the PDF when downloading or saving.
 */
export default function PdfWatermarkPanel({ draft, applied, pages, currentIndex, imageUrl, onChange, onChooseImage, onApply, onRemove, onClose }: Props) {
  const titleId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState(() => initialChoice(draft.pages, pages, currentIndex));
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const resolved = resolveWatermarkPages(scope.choice, scope.range, pages, currentIndex);
  const rangeError = scope.choice === "range" && scope.range.trim() ? resolved.error : "";

  // Keep the preview's page selection in step with the choice (and the current page).
  useEffect(() => {
    if (resolved.pages && !sameSpec({ ...draft, pages: resolved.pages }, draft)) onChange({ ...draft, pages: resolved.pages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.choice, scope.range, currentIndex, pages.length]);

  const update = (patch: Partial<TextWatermark> | Partial<ImageWatermark>) => onChange(normalizeWatermark({ ...draft, ...patch } as Watermark));
  const switchKind = (kind: "text" | "image") => {
    if (kind === draft.kind) return;
    const common = { opacity: draft.opacity, rotation: draft.rotation, position: draft.position, customX: draft.customX, customY: draft.customY, margin: draft.margin, tileGap: draft.tileGap, pages: draft.pages };
    if (kind === "image") onChange({ ...common, kind: "image", imageId: "", imageWidth: 0, imageHeight: 0, scale: 40 });
    else { const text = defaultTextWatermark(); onChange({ ...common, kind: "text", text: text.text, font: text.font, color: text.color, sizeMode: text.sizeMode, fontSize: text.fontSize, scale: text.scale }); }
  };

  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || draft.kind !== "image") return;
    setImageBusy(true); setImageError("");
    try {
      const image = await onChooseImage(file);
      update({ imageId: image.imageId, imageWidth: image.width, imageHeight: image.height });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "That image couldn't be used.");
    } finally { setImageBusy(false); }
  };

  const empty = watermarkIsEmpty(draft);
  const pagesReady = Boolean(resolved.pages);
  const finalSpec = resolved.pages ? normalizeWatermark({ ...draft, pages: resolved.pages }) : null;
  const changed = !sameSpec(finalSpec, applied);
  const canApply = !empty && pagesReady && changed;
  const blocker = empty ? (draft.kind === "text" ? "Enter the watermark text." : "Choose an image for the watermark.") : !pagesReady ? (resolved.error || "Choose the pages.") : "";
  const imageSrc = draft.kind === "image" && draft.imageId ? imageUrl(draft.imageId) : undefined;

  return <aside className="pdfs-wm-panel" role="region" aria-labelledby={titleId}>
    <header className="pdfs-wm-head">
      <span className="pdfs-wm-icon" aria-hidden="true"><Stamp size={16}/></span>
      <div>
        <h3 id={titleId}>Watermark</h3>
        <p>{applied ? "Applied to this document. Changes preview on the pages." : "Previewed on the pages until you apply it."}</p>
      </div>
      <button type="button" className="pdfs-icon-button" onClick={onClose} aria-label="Close watermark settings"><X size={16}/></button>
    </header>

    <div className="pdfs-wm-body">
      <div className="pdfs-wm-kinds" role="radiogroup" aria-label="Watermark type">
        {([["text", "Text", Type], ["image", "Image", ImageIcon]] as const).map(([kind, label, Icon]) => <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} className={`pdfs-wm-kind ${draft.kind === kind ? "is-active" : ""}`} onClick={() => switchKind(kind)}><Icon size={14}/>{label}</button>)}
      </div>

      {draft.kind === "text" ? <section className="pdfs-wm-section" aria-label="Text">
        <label className="pdfs-wm-field">
          <span>Text</span>
          <input type="text" value={draft.text} maxLength={WATERMARK_LIMITS.textMax} onChange={(event) => update({ text: event.target.value })} placeholder="e.g. CONFIDENTIAL" aria-invalid={!draft.text.trim()}/>
        </label>
        <div className="pdfs-wm-row">
          <label className="pdfs-wm-field">
            <span>Font</span>
            <select value={draft.font} onChange={(event) => update({ font: event.target.value as WatermarkFont })}>
              {(Object.keys(WATERMARK_FONTS) as WatermarkFont[]).map((font) => <option key={font} value={font}>{WATERMARK_FONTS[font].label}</option>)}
            </select>
          </label>
          <label className="pdfs-wm-field">
            <span>Size</span>
            <select value={draft.sizeMode} onChange={(event) => update({ sizeMode: event.target.value as "fixed" | "fit" })}>
              <option value="fit">Scale to page</option>
              <option value="fixed">Fixed size</option>
            </select>
          </label>
        </div>
        {draft.sizeMode === "fit"
          ? <Slider label="Scale" value={draft.scale} min={WATERMARK_LIMITS.scaleMin} max={WATERMARK_LIMITS.scaleMax} suffix="% of page width" onChange={(scale) => update({ scale })}/>
          : <Slider label="Font size" value={draft.fontSize} min={WATERMARK_LIMITS.fontMin} max={WATERMARK_LIMITS.fontMax} suffix=" pt" onChange={(fontSize) => update({ fontSize })}/>}
        <div className="pdfs-wm-field">
          <span>Colour</span>
          <div className="pdfs-wm-colors">
            <div className="pdfs-swatches" role="radiogroup" aria-label="Watermark colour">
              {OVERLAY_COLORS.map((color) => <button key={color} type="button" role="radio" aria-checked={draft.color === color} aria-label={`Colour ${color}`} className={`pdfs-swatch ${draft.color === color ? "is-selected" : ""}`} style={{ background: color }} onClick={() => update({ color })}/>)}
            </div>
            <input type="color" value={draft.color} onChange={(event) => update({ color: event.target.value })} aria-label="Custom colour"/>
          </div>
        </div>
        {draft.text.trim() && !isWinAnsi(cleanTextForPdf(draft.text)) && <p className="pdfs-wm-note">This text uses characters outside the PDF standard fonts, so it's drawn with your device's fonts as an image (not selectable text).</p>}
      </section> : <section className="pdfs-wm-section" aria-label="Image">
        <div className="pdfs-wm-image">
          <span className="pdfs-wm-image-frame">{imageSrc ? <img src={imageSrc} alt="Watermark image"/> : <ImageIcon size={20} aria-hidden="true"/>}</span>
          <div>
            <button type="button" className="quiet-button" onClick={() => fileInput.current?.click()} disabled={imageBusy}>{imageBusy ? <Loader2 size={14} className="pdfs-spin"/> : <Upload size={14}/>}{draft.imageId ? "Replace image" : "Choose image"}</button>
            <small>PNG, JPG, WebP, GIF or BMP. The aspect ratio is kept; transparent PNGs work best.</small>
            {imageError && <span className="pdfs-field-error" role="alert">{imageError}</span>}
          </div>
        </div>
        <input ref={fileInput} className="hidden-file-input" type="file" accept={IMAGE_ACCEPT} onChange={(event) => void chooseImage(event)} aria-label="Choose a watermark image"/>
        <Slider label="Size" value={draft.scale} min={WATERMARK_LIMITS.scaleMin} max={WATERMARK_LIMITS.scaleMax} suffix="% of page width" onChange={(scale) => update({ scale })}/>
      </section>}

      <section className="pdfs-wm-section" aria-label="Appearance">
        <Slider label="Opacity" value={Math.round(draft.opacity * 100)} min={Math.round(WATERMARK_LIMITS.opacityMin * 100)} max={100} suffix="%" onChange={(value) => update({ opacity: value / 100 })}/>
        <Slider label="Rotation" value={draft.rotation} min={-180} max={180} suffix="°" onChange={(rotation) => update({ rotation })} disabled={draft.position === "diagonal"} note={draft.position === "diagonal" ? "Diagonal follows each page's corner-to-corner angle." : undefined}/>
      </section>

      <section className="pdfs-wm-section" aria-label="Position">
        <span className="pdfs-wm-label">Position</span>
        <div className="pdfs-wm-positions" role="radiogroup" aria-label="Watermark position">
          {POSITIONS.map((position) => <button key={position.id} type="button" role="radio" aria-checked={draft.position === position.id} className={`pdfs-wm-position ${draft.position === position.id ? "is-active" : ""}`} onClick={() => update({ position: position.id })}>{position.label}</button>)}
        </div>
        {draft.position === "custom" && <>
          <p className="pdfs-wm-note">Click or drag on a page to place the watermark.</p>
          <div className="pdfs-wm-row">
            <Slider label="Across" value={Math.round(draft.customX * 100)} min={0} max={100} suffix="%" onChange={(value) => update({ customX: value / 100 })}/>
            <Slider label="Down" value={Math.round(draft.customY * 100)} min={0} max={100} suffix="%" onChange={(value) => update({ customY: value / 100 })}/>
          </div>
        </>}
        {CORNERS.includes(draft.position) && <Slider label="Distance from edges" value={draft.margin} min={0} max={WATERMARK_LIMITS.marginMax} suffix=" pt" onChange={(margin) => update({ margin })}/>}
        {draft.position === "tiled" && <Slider label="Spacing" value={draft.tileGap} min={0} max={WATERMARK_LIMITS.gapMax} suffix=" pt" onChange={(tileGap) => update({ tileGap })}/>}
      </section>

      <section className="pdfs-wm-section" aria-label="Pages">
        <span className="pdfs-wm-label">Pages</span>
        <div className="pdfs-wm-scope" role="radiogroup" aria-label="Pages to watermark">
          {([["all", "All pages"], ["current", `Current page (${currentIndex + 1})`], ["range", "Page range"]] as const).map(([choice, label]) => <label key={choice} className={`pdfs-wm-scope-option ${scope.choice === choice ? "is-active" : ""}`}>
            <input type="radio" name={`${titleId}-scope`} checked={scope.choice === choice} onChange={() => setScope((current) => ({ ...current, choice }))}/>{label}
          </label>)}
        </div>
        {scope.choice === "range" && <label className="pdfs-wm-field">
          <input type="text" inputMode="numeric" aria-label="Page range" value={scope.range} placeholder={`e.g. 1-3, 5 (of ${pages.length})`} onChange={(event) => setScope((current) => ({ ...current, range: event.target.value }))} aria-invalid={Boolean(rangeError)} autoFocus/>
          {rangeError && <span className="pdfs-field-error" role="alert">{rangeError}</span>}
        </label>}
      </section>
    </div>

    <footer className="pdfs-wm-foot">
      {blocker && <span className="pdfs-wm-blocker">{blocker}</span>}
      <div className="pdfs-wm-actions">
        {applied && <button type="button" className="quiet-button pdfs-danger" onClick={onRemove}><Trash2 size={14}/> Remove</button>}
        <button type="button" className="quiet-button" onClick={onClose}>{changed ? "Cancel" : "Done"}</button>
        <button type="button" className="editor-submit" disabled={!canApply} onClick={() => finalSpec && onApply(finalSpec)}>{applied ? "Update watermark" : "Apply watermark"}</button>
      </div>
    </footer>
  </aside>;
}
