import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Download, Eraser, FileImage, ImagePlus, PenLine, Scissors, Signature, Type, Upload } from "lucide-react";
import { IMAGE_ACCEPT, chunkPages, describePages, flattenGroups, pageCountLabel, parsePageRanges } from "../lib/pdf-studio";
import ModalPortal from "./ModalPortal";
import ItemModalShell from "./ItemModalShell";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";

/** Escape closes only the top dialog (capture phase, before the editor's own handler). */
function useEscape(onClose: () => void, disabled: boolean) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (!disabled) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, disabled]);
}

function Footer({ busy, label, icon, onCancel, disabled, note }: { busy: boolean; label: string; icon: React.ReactNode; onCancel: () => void; disabled?: boolean; note: string }) {
  return <div className="editor-form-footer">
    <div className="editor-footnote"><span>{note}</span></div>
    <div className="editor-actions">
      <button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" className="editor-submit" disabled={busy || disabled}>{busy ? <><Spinner className="size-3.5"/> Working…</> : <>{icon} {label}</>}</button>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Extract & split
// ---------------------------------------------------------------------------
export interface SplitRequest { groups: number[][]; label: string }

export function SplitDialog({ pageCount, selected, currentIndex, busy, onCancel, onRun }: { pageCount: number; selected: number[]; currentIndex: number; busy: boolean; onCancel: () => void; onRun: (request: SplitRequest) => void }) {
  const titleId = useId();
  const [mode, setMode] = useState<"selected" | "ranges" | "every">(selected.length ? "selected" : "ranges");
  const [ranges, setRanges] = useState(selected.length ? describePages(selected) : `${currentIndex + 1}`);
  const [separate, setSeparate] = useState(false);
  const [every, setEvery] = useState(1);
  useEscape(onCancel, busy);

  const parsed = parsePageRanges(ranges, pageCount);
  let groups: number[][] = [];
  let error = "";
  if (mode === "selected") groups = selected.length ? [selected] : [];
  else if (mode === "ranges") { error = parsed.error; groups = error ? [] : separate ? parsed.groups : [flattenGroups(parsed.groups)]; }
  else groups = chunkPages(pageCount, every);
  const files = groups.length;
  const summary = !files ? "" : files === 1 ? `1 PDF with ${pageCountLabel(groups[0].length)}` : `${files} PDFs, downloaded together as a ZIP file`;

  return <ModalPortal>
    <ItemModalShell labelledBy={titleId} className="pdfs-dialog" backdropClassName="pdfs-dialog-backdrop" icon={<Scissors size={18}/>} eyebrow="Extract & split" title="Save pages as separate PDFs" onClose={onCancel} closeDisabled={busy} dismissable={!busy}>
      <form className="editor-form" onSubmit={(event) => { event.preventDefault(); if (files && !error) onRun({ groups, label: mode === "every" ? `every ${every}` : "" }); }}>
        <div className="vault-modal-scroll">
          <div className="pdfs-choice-list" role="radiogroup" aria-label="What to extract">
            <label className={`pdfs-choice ${mode === "selected" ? "is-selected" : ""} ${selected.length ? "" : "is-disabled"}`}>
              <input type="radio" name="split-mode" checked={mode === "selected"} onChange={() => setMode("selected")} disabled={!selected.length || busy}/>
              <span><b>Selected pages</b><small>{selected.length ? `Pages ${describePages(selected)} as one PDF` : "Tick pages in the page list first (Shift-click selects a range)."}</small></span>
            </label>
            <label className={`pdfs-choice ${mode === "ranges" ? "is-selected" : ""}`}>
              <input type="radio" name="split-mode" checked={mode === "ranges"} onChange={() => setMode("ranges")} disabled={busy}/>
              <span><b>Page ranges</b><small>For example 1-3, 5, 8-</small></span>
            </label>
            {mode === "ranges" && <div className="pdfs-choice-detail">
              <label className="field-label">Pages
                <input value={ranges} onChange={(event) => setRanges(event.target.value)} aria-invalid={Boolean(error)} placeholder="1-3, 5, 8-" disabled={busy} autoFocus/>
              </label>
              <label className="pdfs-check"><Checkbox checked={separate} onCheckedChange={(checked) => setSeparate(checked === true)} disabled={busy}/> One PDF for each range (split)</label>
              {error && <small className="pdfs-field-error" role="alert">{error}</small>}
            </div>}
            <label className={`pdfs-choice ${mode === "every" ? "is-selected" : ""}`}>
              <input type="radio" name="split-mode" checked={mode === "every"} onChange={() => setMode("every")} disabled={busy}/>
              <span><b>Split every few pages</b><small>Cut the document into equal parts</small></span>
            </label>
            {mode === "every" && <div className="pdfs-choice-detail">
              <label className="field-label">Pages per PDF
                <input type="number" min={1} max={pageCount} value={every} onChange={(event) => setEvery(Math.max(1, Math.min(pageCount, Number(event.target.value) || 1)))} disabled={busy}/>
              </label>
            </div>}
          </div>
          {summary && <p className="pdfs-dialog-summary">{summary}. Annotations are included. Your open document isn't changed.</p>}
        </div>
        <Footer busy={busy} label="Download" icon={<Download size={14}/>} onCancel={onCancel} disabled={!files || Boolean(error)} note="Created on this device."/>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}

// ---------------------------------------------------------------------------
// Export pages as images
// ---------------------------------------------------------------------------
export interface ExportImagesRequest { pages: number[]; format: "image/png" | "image/jpeg"; dpi: number; overlays: boolean }

export function ExportImagesDialog({ pageCount, selected, currentIndex, pageSize, busy, progress, onCancel, onRun }: { pageCount: number; selected: number[]; currentIndex: number; pageSize: { width: number; height: number }; busy: boolean; progress: string; onCancel: () => void; onRun: (request: ExportImagesRequest) => void }) {
  const titleId = useId();
  const [which, setWhich] = useState<"current" | "selected" | "all" | "ranges">(selected.length > 1 ? "selected" : "current");
  const [ranges, setRanges] = useState("1-");
  const [format, setFormat] = useState<"image/png" | "image/jpeg">("image/png");
  const [dpi, setDpi] = useState(150);
  const [overlays, setOverlays] = useState(true);
  useEscape(onCancel, busy);
  const parsed = parsePageRanges(ranges, pageCount);
  const pages = which === "current" ? [currentIndex] : which === "selected" ? selected : which === "all" ? Array.from({ length: pageCount }, (_, i) => i) : parsed.error ? [] : flattenGroups(parsed.groups);
  const pixels = { width: Math.round(pageSize.width / 72 * dpi), height: Math.round(pageSize.height / 72 * dpi) };
  const error = which === "ranges" ? parsed.error : "";

  return <ModalPortal>
    <ItemModalShell labelledBy={titleId} className="pdfs-dialog" backdropClassName="pdfs-dialog-backdrop" icon={<FileImage size={18}/>} eyebrow="Export" title="Export pages as images" onClose={onCancel} closeDisabled={busy} dismissable={!busy}>
      <form className="editor-form" onSubmit={(event) => { event.preventDefault(); if (pages.length && !error) onRun({ pages, format, dpi, overlays }); }}>
        <div className="vault-modal-scroll">
          <div className="editor-fields-grid">
            <label className="field-label">Pages
              <select value={which} onChange={(event) => setWhich(event.target.value as typeof which)} disabled={busy}>
                <option value="current">Current page ({currentIndex + 1})</option>
                {selected.length > 0 && <option value="selected">Selected pages ({selected.length})</option>}
                <option value="all">All pages ({pageCount})</option>
                <option value="ranges">Page ranges…</option>
              </select>
            </label>
            {which === "ranges" ? <label className="field-label">Ranges
              <input value={ranges} onChange={(event) => setRanges(event.target.value)} aria-invalid={Boolean(error)} disabled={busy}/>
              {error && <small className="pdfs-field-error" role="alert">{error}</small>}
            </label> : <span/>}
            <label className="field-label">Format
              <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)} disabled={busy}><option value="image/png">PNG — sharp, larger</option><option value="image/jpeg">JPG — smaller files</option></select>
            </label>
            <label className="field-label">Resolution
              <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))} disabled={busy}><option value={72}>72 DPI — screen</option><option value={150}>150 DPI — standard</option><option value={300}>300 DPI — print</option></select>
            </label>
            <label className="pdfs-check field-wide"><Checkbox checked={overlays} onCheckedChange={(checked) => setOverlays(checked === true)} disabled={busy}/> Include annotations and signatures</label>
          </div>
          <p className="pdfs-dialog-summary">{pages.length ? `${pageCountLabel(pages.length)} · about ${pixels.width} × ${pixels.height} px for the current page size${pages.length > 1 ? " · downloaded together as a ZIP file" : ""}.` : "Choose at least one page."}</p>
          {busy && progress && <p className="pdfs-dialog-progress" role="status">{progress}</p>}
        </div>
        <Footer busy={busy} label="Export" icon={<Download size={14}/>} onCancel={onCancel} disabled={!pages.length || Boolean(error)} note="Rendered on this device."/>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------
export interface SignatureResult { png: Uint8Array; width: number; height: number }

const SIGNATURE_FONTS = [
  { id: "script", label: "Script", family: "\"Segoe Script\", \"Brush Script MT\", \"Snell Roundhand\", cursive" },
  { id: "hand", label: "Handwritten", family: "\"Bradley Hand\", \"Comic Sans MS\", \"Segoe Print\", cursive" },
  { id: "classic", label: "Classic", family: "Georgia, \"Times New Roman\", serif" },
];
const INK_COLORS = [{ value: "#111827", label: "Black" }, { value: "#1d4ed8", label: "Blue" }];

export function SignatureDialog({ recent, onUseRecent, onCancel, onCreate }: { recent: { id: string; url: string }[]; onUseRecent: (id: string) => void; onCancel: () => void; onCreate: (result: SignatureResult) => Promise<void> }) {
  const titleId = useId();
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [ink, setInk] = useState(INK_COLORS[0].value);
  const [typed, setTyped] = useState("");
  const [font, setFont] = useState(SIGNATURE_FONTS[0].id);
  const [uploadUrl, setUploadUrl] = useState("");
  const [removeWhite, setRemoveWhite] = useState(true);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const padRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  useEscape(onCancel, busy);
  useEffect(() => () => { if (uploadUrl) URL.revokeObjectURL(uploadUrl); }, [uploadUrl]);

  // Size the drawing pad to its CSS box at device resolution.
  useEffect(() => {
    if (tab !== "draw") return;
    const canvas = padRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    const context = canvas.getContext("2d");
    context?.scale(dpr, dpr);
    setHasStrokes(false);
  }, [tab]);

  const padPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drawing.current = padPoint(event); };
  const moveStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const last = drawing.current; const context = padRef.current?.getContext("2d");
    if (!last || !context) return;
    const point = padPoint(event);
    context.strokeStyle = ink; context.lineWidth = 2.4; context.lineCap = "round"; context.lineJoin = "round";
    context.beginPath(); context.moveTo(last.x, last.y); context.lineTo(point.x, point.y); context.stroke();
    drawing.current = point; setHasStrokes(true);
  };
  const clearPad = () => { const canvas = padRef.current; canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); setHasStrokes(false); };

  const finish = async () => {
    setError(""); setBusy(true);
    try {
      const { canvasToBytes, trimTransparent, releaseCanvas } = await import("../lib/pdf-canvas");
      let canvas: HTMLCanvasElement | null = null;
      if (tab === "draw") {
        if (!hasStrokes || !padRef.current) throw new Error("Draw your signature in the box first.");
        canvas = trimTransparent(padRef.current, 4);
      } else if (tab === "type") {
        if (!typed.trim()) throw new Error("Type your name first.");
        const family = SIGNATURE_FONTS.find((entry) => entry.id === font)?.family || "cursive";
        const draft = document.createElement("canvas"); draft.width = 1400; draft.height = 300;
        const context = draft.getContext("2d");
        if (!context) throw new Error("Your browser couldn't draw the signature.");
        context.font = `120px ${family}`; context.fillStyle = ink; context.textBaseline = "middle";
        context.fillText(typed.trim(), 20, 150, 1360);
        canvas = trimTransparent(draft, 8);
        releaseCanvas(draft);
      } else {
        if (!uploadUrl) throw new Error("Choose an image of your signature first.");
        const image = new Image(); image.src = uploadUrl; await image.decode();
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        const draft = document.createElement("canvas"); draft.width = Math.max(1, Math.round(image.naturalWidth * scale)); draft.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = draft.getContext("2d");
        if (!context) throw new Error("Your browser couldn't read the image.");
        context.drawImage(image, 0, 0, draft.width, draft.height);
        if (removeWhite) { // make a scanned paper background transparent
          const data = context.getImageData(0, 0, draft.width, draft.height);
          for (let i = 0; i < data.data.length; i += 4) {
            const light = Math.min(data.data[i], data.data[i + 1], data.data[i + 2]);
            if (light > 215) data.data[i + 3] = 0;
            else if (light > 170) data.data[i + 3] = Math.round(data.data[i + 3] * (215 - light) / 45);
          }
          context.putImageData(data, 0, 0);
        }
        canvas = trimTransparent(draft, 4);
        releaseCanvas(draft);
      }
      if (!canvas) throw new Error("The signature is empty — try again.");
      const png = await canvasToBytes(canvas, "image/png");
      await onCreate({ png, width: canvas.width, height: canvas.height });
      releaseCanvas(canvas);
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "The signature couldn't be created.");
      setBusy(false);
    }
  };

  return <ModalPortal>
    <ItemModalShell labelledBy={titleId} className="pdfs-dialog pdfs-signature-dialog" backdropClassName="pdfs-dialog-backdrop" icon={<Signature size={18}/>} eyebrow="Signature" title="Add your signature" onClose={onCancel} closeDisabled={busy} dismissable={!busy}>
      <form className="editor-form" onSubmit={(event) => { event.preventDefault(); void finish(); }}>
        <div className="vault-modal-scroll">
          {recent.length > 0 && <div className="pdfs-recent-signatures"><small>Use one from this session</small><div>{recent.map((entry) => <button key={entry.id} type="button" className="pdfs-recent-signature" onClick={() => onUseRecent(entry.id)} aria-label="Use this signature"><img src={entry.url} alt=""/></button>)}</div></div>}
          <div className="pdfs-tabs" role="tablist" aria-label="Signature method">
            {([["draw", "Draw", PenLine], ["type", "Type", Type], ["upload", "Upload", Upload]] as const).map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => { setTab(id); setError(""); }} disabled={busy}><Icon size={13}/> {label}</button>)}
          </div>
          {tab !== "upload" && <div className="pdfs-ink-row" role="radiogroup" aria-label="Ink colour">{INK_COLORS.map((color) => <button key={color.value} type="button" role="radio" aria-checked={ink === color.value} aria-label={color.label} title={color.label} className={`pdfs-swatch ${ink === color.value ? "is-selected" : ""}`} style={{ background: color.value }} onClick={() => setInk(color.value)}/>)}</div>}
          {tab === "draw" && <div className="pdfs-signature-pad-wrap">
            <canvas ref={padRef} className="pdfs-signature-pad" onPointerDown={startStroke} onPointerMove={moveStroke} onPointerUp={() => { drawing.current = null; }} onPointerCancel={() => { drawing.current = null; }} aria-label="Signature drawing area" role="img"/>
            <span className="pdfs-signature-line" aria-hidden="true">Sign above</span>
            <button type="button" className="quiet-button pdfs-pad-clear" onClick={clearPad} disabled={!hasStrokes || busy}><Eraser size={13}/> Clear</button>
          </div>}
          {tab === "type" && <div className="pdfs-signature-type">
            <label className="field-label">Your name<input value={typed} onChange={(event) => setTyped(event.target.value)} maxLength={60} placeholder="e.g. Ayesha Rahman" autoFocus disabled={busy}/></label>
            <div className="pdfs-font-options" role="radiogroup" aria-label="Signature style">{SIGNATURE_FONTS.map((entry) => <button key={entry.id} type="button" role="radio" aria-checked={font === entry.id} className={`pdfs-font-option ${font === entry.id ? "is-selected" : ""}`} onClick={() => setFont(entry.id)} style={{ fontFamily: entry.family, color: ink }}>{typed.trim() || "Your signature"}<small>{entry.label}</small></button>)}</div>
          </div>}
          {tab === "upload" && <div className="pdfs-signature-upload">
            <input ref={uploadInput} className="hidden-file-input" type="file" accept={IMAGE_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (uploadUrl) URL.revokeObjectURL(uploadUrl); setUploadUrl(URL.createObjectURL(file)); }} aria-label="Choose a signature image"/>
            {uploadUrl ? <img src={uploadUrl} alt="Signature preview" className="pdfs-signature-preview"/> : <div className="pdfs-create-empty"><ImagePlus size={22}/><span>A photo or scan of your signature on white paper works best.</span></div>}
            <div className="pdfs-dropzone-actions"><button type="button" className="quiet-button" onClick={() => uploadInput.current?.click()} disabled={busy}><Upload size={14}/> {uploadUrl ? "Choose another" : "Choose image"}</button></div>
            <label className="pdfs-check"><Checkbox checked={removeWhite} onCheckedChange={(checked) => setRemoveWhite(checked === true)} disabled={busy}/> Make the white paper background transparent</label>
          </div>}
          {error && <div className="form-alert error-alert" role="alert">{error}</div>}
          <p className="pdfs-muted-note">After you continue, click on the page where the signature should go. It's added as an image on top of the page; it isn't a certificate-based digital signature. Signatures are kept only for this editing session.</p>
        </div>
        <Footer busy={busy} label="Place on page" icon={<PenLine size={14}/>} onCancel={onCancel} note="Stays on this device."/>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}
