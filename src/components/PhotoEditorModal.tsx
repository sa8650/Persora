import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle, Check, Crop, Eraser, FlipHorizontal2, FlipVertical2, Loader2, Move, Palette, RefreshCw, RotateCcw, RotateCw, ScanFace, ShieldCheck, SlidersHorizontal, Sparkles, Undo2, Wand2, X,
} from "lucide-react";
import type { PhotoStudioPhoto } from "../types";
import {
  BACKGROUND_SWATCHES, NEUTRAL_ADJUSTMENTS, PHOTO_SIZE_PRESETS, analyzePhoto, convertSize, matchPreset, normalizeHexColor, outputPixels, printSizeLabel,
  type Adjustments, type PhotoAnalysis, type PhotoUnit,
} from "../lib/photo-studio";
import { decodeImage, exportPhoto, releaseCanvas, renderComposite, toWorkingCanvas, type EditState, type OutputFormat } from "../lib/photo-studio-render";
import { BackgroundRemovalError, removePhotoBackground, type BackgroundStatus } from "../lib/photo-background";
import { LOCAL_MODEL_NAME } from "../lib/local-matting";
import ModalPortal from "./ModalPortal";
import { ConfirmDialog } from "./VaultDialogs";

export interface EditorSource { blob: Blob; name: string; photo: PhotoStudioPhoto | null }

export interface EditedPhoto {
  blob: Blob;
  width: number;
  height: number;
  mime: OutputFormat;
  analysis: PhotoAnalysis;
  editSettings: Record<string, unknown>;
  editSummary: string[];
  presetCategory: string | null;
}

interface Props {
  source: EditorSource;
  cloudAvailable: boolean;
  /** True while the organise modal is open on top (editor keeps its session). */
  organizing: boolean;
  onClose: () => void;
  onSaveAndOrganize: (result: EditedPhoto) => void;
}

type Tab = "frame" | "background" | "adjust";
const PREVIEW_MAX = 640;
const UNITS: PhotoUnit[] = ["px", "mm", "cm", "in"];
const ADJUSTMENT_CONTROLS: { key: keyof Adjustments; label: string; min: number; max: number; step: number; format: (value: number) => string }[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, format: (value) => `${value > 0 ? "+" : ""}${value}` },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, format: (value) => `${value > 0 ? "+" : ""}${value}` },
  { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)} EV` },
  { key: "sharpness", label: "Sharpness", min: 0, max: 100, step: 1, format: (value) => `${value}` },
];

function initialState(width: number, height: number, photo: PhotoStudioPhoto | null): EditState {
  const storedPreset = typeof photo?.metadata.presetId === "string" ? PHOTO_SIZE_PRESETS.find((preset) => preset.id === photo.metadata.presetId) : undefined;
  const match = matchPreset(width, height, photo?.dpi ?? null);
  const preset = storedPreset || (match?.exact ? match.preset : PHOTO_SIZE_PRESETS[0]);
  return {
    presetId: preset.id, width: preset.width, height: preset.height, unit: preset.unit, dpi: preset.dpi,
    zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, quarterTurns: 0, flipH: false, flipV: false,
    adjustments: { ...NEUTRAL_ADJUSTMENTS }, background: "original", backgroundColor: "#ffffff", format: "image/jpeg", quality: 0.92,
  };
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

/**
 * Create & Edit editor. Works entirely on in-memory canvases; the only network
 * use is the optional background removal (cloud AI first, on-device fallback).
 * Closing discards everything and releases the canvases.
 */
export default function PhotoEditorModal({ source, cloudAvailable, organizing, onClose, onSaveAndOrganize }: Props) {
  const titleId = useId();
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const cutoutRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const initialRef = useRef<string>("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [state, setState] = useState<EditState | null>(null);
  const [tab, setTab] = useState<Tab>("frame");
  const [guide, setGuide] = useState(true);
  const [bgStatus, setBgStatus] = useState<BackgroundStatus | null>(null);
  const [bgError, setBgError] = useState<BackgroundRemovalError | null>(null);
  const [bgResult, setBgResult] = useState<{ source: "cloud" | "local"; runtime?: string; fallbackReason?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });

  // Decode the selected photo into an in-memory working canvas.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const image = await decodeImage(source.blob);
        if (!active) return;
        const canvas = toWorkingCanvas(image);
        sourceRef.current = canvas;
        const initial = initialState(image.naturalWidth, image.naturalHeight, source.photo);
        initialRef.current = JSON.stringify(initial);
        setSourceSize({ width: image.naturalWidth, height: image.naturalHeight });
        setState(initial);
        setReady(true);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : "This image couldn't be opened.");
      }
    })();
    return () => {
      active = false;
      abortRef.current?.abort();
      releaseCanvas(sourceRef.current); sourceRef.current = null;
      releaseCanvas(cutoutRef.current); cutoutRef.current = null;
    };
  }, [source.blob, source.photo]);

  const output = useMemo(() => state ? outputPixels(state) : { width: 0, height: 0, clamped: false }, [state]);
  const previewScale = output.width && output.height ? Math.min(1, PREVIEW_MAX / Math.max(output.width, output.height)) : 1;
  const previewW = Math.max(1, Math.round(output.width * previewScale));
  const previewH = Math.max(1, Math.round(output.height * previewScale));

  // Re-render the live preview (throttled to one frame).
  useEffect(() => {
    if (!ready || !state || !sourceRef.current || !previewRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (sourceRef.current && previewRef.current) renderComposite(previewRef.current, sourceRef.current, cutoutRef.current, state, previewW, previewH);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, state, previewW, previewH, bgResult]);

  const dirty = Boolean(state && (JSON.stringify(state) !== initialRef.current || bgResult));
  const busy = Boolean(bgStatus) || exporting;
  const requestClose = useCallback(() => {
    if (exporting) return;
    if (dirty || bgStatus) setConfirmDiscard(true);
    else onClose();
  }, [dirty, bgStatus, exporting, onClose]);

  useEffect(() => {
    if (organizing || confirmDiscard) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [organizing, confirmDiscard, requestClose]);

  const update = (patch: Partial<EditState>) => setState((current) => current ? { ...current, ...patch } : current);
  const choosePreset = (id: string) => {
    if (!state) return;
    if (id === "custom") { update({ presetId: "custom" }); return; }
    if (id === "original") {
      update({ presetId: "original", unit: "px", width: sourceSize.width, height: sourceSize.height, zoom: 1, offsetX: 0, offsetY: 0 });
      return;
    }
    const preset = PHOTO_SIZE_PRESETS.find((entry) => entry.id === id);
    if (preset) update({ presetId: preset.id, width: preset.width, height: preset.height, unit: preset.unit, dpi: preset.dpi, zoom: 1, offsetX: 0, offsetY: 0 });
  };
  const changeUnit = (unit: PhotoUnit) => {
    if (!state) return;
    const converted = convertSize(state, unit);
    update({ unit, width: converted.width, height: converted.height });
  };
  const resetFraming = () => update({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0, quarterTurns: 0, flipH: false, flipV: false });

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!state || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    update({ offsetX: clamp(drag.offsetX + (event.clientX - drag.x) / rect.width, -1, 1), offsetY: clamp(drag.offsetY + (event.clientY - drag.y) / rect.height, -1, 1) });
  };
  const onPointerUp = () => { dragRef.current = null; };
  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!state || busy) return;
    update({ zoom: clamp(Number((state.zoom * Math.exp(-event.deltaY * 0.0015)).toFixed(3)), 0.5, 4) });
  };
  const onStageKey = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!state) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, Partial<EditState>> = {
      ArrowLeft: { offsetX: clamp(state.offsetX - step, -1, 1) }, ArrowRight: { offsetX: clamp(state.offsetX + step, -1, 1) },
      ArrowUp: { offsetY: clamp(state.offsetY - step, -1, 1) }, ArrowDown: { offsetY: clamp(state.offsetY + step, -1, 1) },
      "+": { zoom: clamp(state.zoom * 1.05, 0.5, 4) }, "=": { zoom: clamp(state.zoom * 1.05, 0.5, 4) }, "-": { zoom: clamp(state.zoom / 1.05, 0.5, 4) },
    };
    if (moves[event.key]) { event.preventDefault(); update(moves[event.key]); }
  };

  const runBackgroundRemoval = async () => {
    if (!sourceRef.current || bgStatus) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBgError(null);
    try {
      const result = await removePhotoBackground(sourceRef.current, (status) => { if (!controller.signal.aborted) setBgStatus(status); }, controller.signal, { cloudAvailable });
      if (controller.signal.aborted) { releaseCanvas(result.cutout); return; }
      releaseCanvas(cutoutRef.current);
      cutoutRef.current = result.cutout;
      setBgResult({ source: result.source, runtime: result.runtime, fallbackReason: result.fallbackReason });
      setState((current) => current ? { ...current, background: current.background === "original" ? "color" : current.background } : current);
    } catch (error) {
      if (controller.signal.aborted) return;
      setBgError(error instanceof BackgroundRemovalError ? error : new BackgroundRemovalError("—", error instanceof Error ? error.message : "Background removal failed."));
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setBgStatus(null); }
    }
  };
  const cancelBackgroundRemoval = () => { abortRef.current?.abort(); abortRef.current = null; setBgStatus(null); };

  const editSummary = useCallback((current: EditState): string[] => {
    const lines: string[] = [];
    const preset = PHOTO_SIZE_PRESETS.find((entry) => entry.id === current.presetId);
    const print = printSizeLabel(output.width, output.height, current.dpi);
    lines.push(`Size: ${preset ? `${preset.label} · ${preset.detail}` : current.presetId === "original" ? "Original proportions" : "Custom"} — ${output.width} × ${output.height} px${print ? ` (${print} @ ${Math.round(current.dpi)} DPI)` : ""}`);
    if (bgResult && current.background !== "original") lines.push(`Background removed ${bgResult.source === "cloud" ? "with Persora AI" : `on this device${bgResult.runtime ? ` (${bgResult.runtime === "webgpu" ? "WebGPU" : "CPU"})` : ""}`}`);
    if (current.background === "color") lines.push(`Background colour ${current.backgroundColor.toUpperCase()}`);
    if (current.background === "transparent") lines.push("Transparent background");
    const turns = ((current.quarterTurns % 4) + 4) % 4;
    if (turns) lines.push(`Rotated ${turns * 90}°`);
    if (current.rotation) lines.push(`Straightened ${current.rotation > 0 ? "+" : ""}${current.rotation}°`);
    if (current.flipH || current.flipV) lines.push(`Flipped ${[current.flipH ? "horizontally" : "", current.flipV ? "vertically" : ""].filter(Boolean).join(" & ")}`);
    if (current.zoom !== 1 || current.offsetX || current.offsetY) lines.push(`Reframed (zoom ${Math.round(current.zoom * 100)}%)`);
    const adjust = ADJUSTMENT_CONTROLS.filter((control) => current.adjustments[control.key]).map((control) => `${control.label.toLowerCase()} ${control.format(current.adjustments[control.key])}`);
    if (adjust.length) lines.push(`Adjusted ${adjust.join(", ")}`);
    lines.push(`Format ${current.format === "image/png" ? "PNG" : "JPEG"}`);
    return lines;
  }, [bgResult, output.width, output.height]);

  const saveAndOrganize = async () => {
    if (!state || !sourceRef.current || exporting || bgStatus) return;
    setExporting(true); setExportError("");
    try {
      const result = await exportPhoto(sourceRef.current, cutoutRef.current, state, output.width, output.height);
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      const analysis = analyzePhoto(bytes, { width: result.width, height: result.height }, result.blob.size);
      if (!analysis) throw new Error("The edited photo couldn't be prepared. Try again.");
      const preset = PHOTO_SIZE_PRESETS.find((entry) => entry.id === state.presetId);
      onSaveAndOrganize({
        ...result,
        analysis,
        presetCategory: preset?.category || null,
        editSummary: editSummary(state),
        editSettings: {
          presetId: state.presetId, width: state.width, height: state.height, unit: state.unit, dpi: state.dpi,
          outputWidth: result.width, outputHeight: result.height, zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY,
          rotation: state.rotation, quarterTurns: state.quarterTurns, flipH: state.flipH, flipV: state.flipV,
          background: state.background, backgroundColor: state.background === "color" ? state.backgroundColor : null,
          backgroundRemoval: bgResult && state.background !== "original" ? bgResult.source : null,
          backgroundRuntime: bgResult?.runtime || null,
          adjustments: { ...state.adjustments }, format: state.format, sourceTitle: source.photo?.title || source.name,
        },
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "The edited photo couldn't be prepared.");
    } finally {
      setExporting(false);
    }
  };

  const presetValue = state ? (PHOTO_SIZE_PRESETS.some((preset) => preset.id === state.presetId) || state.presetId === "original" ? state.presetId : "custom") : "";
  const printSize = state ? printSizeLabel(output.width, output.height, state.dpi) : null;
  const bgProgress = bgStatus?.stage === "local" ? bgStatus.progress : undefined;

  return <ModalPortal>
    <div className="modal-backdrop ps-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section className="vault-modal ps-editor-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="vault-modal-header">
          <span className="vault-modal-icon"><Wand2 size={18}/></span>
          <div className="vault-modal-title"><small>Create &amp; edit</small><h2 id={titleId}>{source.photo ? `Edit a copy of “${source.photo.title}”` : "Edit your portrait"}</h2></div>
          <button type="button" className="vault-modal-close" onClick={requestClose} disabled={exporting} aria-label="Close editor"><X size={18}/></button>
        </header>
        {loadError ? <div className="ps-editor-error-state"><AlertTriangle size={22}/><h3>This image couldn't be opened</h3><p>{loadError}</p><button type="button" className="quiet-button" onClick={onClose}>Close</button></div>
        : !ready || !state ? <div className="ps-editor-loading" role="status"><Loader2 className="ps-spin" size={20}/> Preparing your photo…</div>
        : <div className="ps-editor-body">
          <div className="ps-stage">
            <div className="ps-stage-frame" style={{ aspectRatio: `${output.width} / ${output.height}`, ["--ps-ratio" as string]: output.width / output.height } as CSSProperties}>
              <canvas
                ref={previewRef}
                width={previewW}
                height={previewH}
                className={`ps-stage-canvas ${state.background === "transparent" ? "ps-checker" : ""}`}
                tabIndex={0}
                aria-label="Photo preview. Drag or use arrow keys to reposition; scroll or press plus and minus to zoom."
                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
                onWheel={onWheel} onKeyDown={onStageKey}
              />
              {guide && <svg className="ps-stage-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <ellipse cx="50" cy="44" rx="23" ry="31" />
                <line x1="50" y1="4" x2="50" y2="96" />
                <line x1="20" y1="40" x2="80" y2="40" />
              </svg>}
              {bgStatus && <div className="ps-stage-busy" role="status" aria-live="polite">
                <Loader2 className="ps-spin" size={22}/>
                <b>{bgStatus.stage === "switching" ? "Switching to on-device removal" : bgStatus.stage === "cloud" ? "Persora AI" : "On-device model"}</b>
                <span>{bgStatus.message}</span>
                {bgStatus.stage === "switching" && <small>{bgStatus.reason}</small>}
                {bgProgress !== undefined && <span className="ps-progress"><i style={{ width: `${bgProgress}%` }}/></span>}
                <button type="button" className="quiet-button" onClick={cancelBackgroundRemoval}>Cancel</button>
              </div>}
            </div>
            <div className="ps-stage-hint"><Move size={13}/> Drag to reposition · scroll to zoom
              <label className="ps-guide-toggle"><input type="checkbox" checked={guide} onChange={(event) => setGuide(event.target.checked)}/> <ScanFace size={13}/> Face guide</label>
            </div>
          </div>

          <div className="ps-panel">
            <div className="ps-tabs" role="tablist" aria-label="Editing tools">
              {([["frame", "Crop & size", Crop], ["background", "Background", Eraser], ["adjust", "Adjust", SlidersHorizontal]] as const).map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><Icon size={14}/>{label}</button>)}
            </div>

            {tab === "frame" && <div className="ps-tool-group" role="tabpanel" aria-label="Crop and size">
              <label className="field-label">Photo size
                <select value={presetValue} onChange={(event) => choosePreset(event.target.value)}>
                  {PHOTO_SIZE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} — {preset.detail}</option>)}
                  <option value="original">Original proportions</option>
                  <option value="custom">Custom size…</option>
                </select>
              </label>
              <div className="ps-size-grid">
                <label className="field-label">Width<input type="number" min={0.1} step={state.unit === "px" ? 1 : 0.1} value={state.width} onChange={(event) => update({ width: Number(event.target.value), presetId: "custom" })}/></label>
                <label className="field-label">Height<input type="number" min={0.1} step={state.unit === "px" ? 1 : 0.1} value={state.height} onChange={(event) => update({ height: Number(event.target.value), presetId: "custom" })}/></label>
                <label className="field-label">Unit<select value={state.unit} onChange={(event) => changeUnit(event.target.value as PhotoUnit)}>{UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
                <label className="field-label">DPI<input type="number" min={72} max={1200} step={1} value={state.dpi} onChange={(event) => update({ dpi: clamp(Math.round(Number(event.target.value) || 300), 1, 1200), presetId: state.unit === "px" ? state.presetId : "custom" })}/></label>
              </div>
              {output.clamped && <p className="ps-inline-warning"><AlertTriangle size={12}/> Output is limited to 16–6000 px per side.</p>}
              <label className="ps-slider"><span>Zoom <b>{Math.round(state.zoom * 100)}%</b></span><input type="range" min={0.5} max={4} step={0.01} value={state.zoom} onChange={(event) => update({ zoom: Number(event.target.value) })}/></label>
              <label className="ps-slider"><span>Straighten <b>{state.rotation > 0 ? "+" : ""}{state.rotation}°</b></span><input type="range" min={-45} max={45} step={0.5} value={state.rotation} onChange={(event) => update({ rotation: Number(event.target.value) })}/></label>
              <div className="ps-button-row">
                <button type="button" className="quiet-button" onClick={() => update({ quarterTurns: (state.quarterTurns + 3) % 4 })} title="Rotate left"><RotateCcw size={14}/> Left</button>
                <button type="button" className="quiet-button" onClick={() => update({ quarterTurns: (state.quarterTurns + 1) % 4 })} title="Rotate right"><RotateCw size={14}/> Right</button>
                <button type="button" className={`quiet-button ${state.flipH ? "is-on" : ""}`} aria-pressed={state.flipH} onClick={() => update({ flipH: !state.flipH })} title="Flip horizontally"><FlipHorizontal2 size={14}/> Flip</button>
                <button type="button" className={`quiet-button ${state.flipV ? "is-on" : ""}`} aria-pressed={state.flipV} onClick={() => update({ flipV: !state.flipV })} title="Flip vertically"><FlipVertical2 size={14}/> Flip</button>
              </div>
              <button type="button" className="ps-link-button" onClick={resetFraming}><Undo2 size={13}/> Reset framing</button>
            </div>}

            {tab === "background" && <div className="ps-tool-group" role="tabpanel" aria-label="Background">
              {!bgResult && !bgError && <div className="ps-bg-intro">
                <p>Remove the background, then choose a solid colour accepted for official photos.</p>
                <button type="button" className="section-add-button ps-wide" onClick={() => void runBackgroundRemoval()} disabled={Boolean(bgStatus)}><Sparkles size={15}/> Remove background</button>
                <small><ShieldCheck size={12}/> {cloudAvailable ? "Uses Persora AI first. If it's unavailable, an on-device model takes over automatically and your photo stays on this device." : "Runs on this device — your photo isn't uploaded."}</small>
              </div>}
              {bgError && !bgStatus && <div className="ps-bg-error" role="alert">
                <b><AlertTriangle size={14}/> Background removal didn't work</b>
                <span>Persora AI: {bgError.cloudReason}</span>
                <span>On-device model: {bgError.localReason}</span>
                <p>Your photo and edits are kept. You can retry, or continue with the original background.</p>
                <button type="button" className="quiet-button" onClick={() => void runBackgroundRemoval()}><RefreshCw size={14}/> Retry</button>
              </div>}
              {bgResult && <div className="ps-bg-done">
                <span className="ps-bg-badge"><Check size={13}/> {bgResult.source === "cloud" ? "Removed with Persora AI" : `Removed on this device${bgResult.runtime ? ` · ${bgResult.runtime === "webgpu" ? "WebGPU" : "CPU"}` : ""}`}</span>
                {bgResult.source === "local" && <small>{LOCAL_MODEL_NAME}. {bgResult.fallbackReason ? `Cloud AI wasn't used: ${bgResult.fallbackReason}` : ""}</small>}
              </div>}
              <div className="ps-bg-options" role="radiogroup" aria-label="Background">
                <button type="button" role="radio" aria-checked={state.background === "original"} className={`ps-bg-option ${state.background === "original" ? "is-selected" : ""}`} onClick={() => update({ background: "original" })}><span className="ps-bg-swatch ps-bg-original"/>Original</button>
                {BACKGROUND_SWATCHES.map((swatch) => <button key={swatch.id} type="button" role="radio" aria-checked={state.background === "color" && state.backgroundColor === swatch.color} disabled={!bgResult} className={`ps-bg-option ${state.background === "color" && state.backgroundColor === swatch.color ? "is-selected" : ""}`} onClick={() => update({ background: "color", backgroundColor: swatch.color })}><span className="ps-bg-swatch" style={{ background: swatch.color }}/>{swatch.label}</button>)}
                <label className={`ps-bg-option ${state.background === "color" && !BACKGROUND_SWATCHES.some((swatch) => swatch.color === state.backgroundColor) ? "is-selected" : ""} ${!bgResult ? "is-disabled" : ""}`}><input type="color" value={state.backgroundColor} disabled={!bgResult} onChange={(event) => update({ background: "color", backgroundColor: normalizeHexColor(event.target.value) })} aria-label="Custom background colour"/><Palette size={13}/>Custom</label>
                <button type="button" role="radio" aria-checked={state.background === "transparent"} disabled={!bgResult} className={`ps-bg-option ${state.background === "transparent" ? "is-selected" : ""}`} onClick={() => update({ background: "transparent", format: "image/png" })}><span className="ps-bg-swatch ps-checker"/>Transparent</button>
              </div>
              {!bgResult && <small className="ps-muted-note">Colour backgrounds become available after the background is removed.</small>}
            </div>}

            {tab === "adjust" && <div className="ps-tool-group" role="tabpanel" aria-label="Adjustments">
              {ADJUSTMENT_CONTROLS.map((control) => <label key={control.key} className="ps-slider"><span>{control.label} <b>{control.format(state.adjustments[control.key])}</b></span><input type="range" min={control.min} max={control.max} step={control.step} value={state.adjustments[control.key]} onChange={(event) => update({ adjustments: { ...state.adjustments, [control.key]: Number(event.target.value) } })}/></label>)}
              <button type="button" className="ps-link-button" onClick={() => update({ adjustments: { ...NEUTRAL_ADJUSTMENTS } })}><Undo2 size={13}/> Reset adjustments</button>
              <small className="ps-muted-note">Adjustments apply to the person only, so a solid background stays exactly its colour.</small>
            </div>}

            <div className="ps-output-card">
              <div><small>Final output</small><b>{output.width} × {output.height} px</b><span>{printSize ? `${printSize} @ ${Math.round(state.dpi)} DPI` : `${Math.round(state.dpi)} DPI`}</span></div>
              <label className="field-label">Format
                <select value={state.format} onChange={(event) => { const format = event.target.value as OutputFormat; update({ format, ...(format === "image/jpeg" && state.background === "transparent" ? { background: "color" as const } : {}) }); }}>
                  <option value="image/jpeg">JPEG</option>
                  <option value="image/png">PNG</option>
                </select>
              </label>
            </div>
          </div>
        </div>}
        {exportError && <div className="form-alert error-alert editor-error" role="alert">{exportError}</div>}
        <div className="editor-form-footer">
          <div className="editor-footnote"><ShieldCheck size={14}/><span>Edits happen on this device. Nothing is saved until you press Save in the next step.</span></div>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={requestClose} disabled={exporting}>Cancel</button>
            <button type="button" className="editor-submit" onClick={() => void saveAndOrganize()} disabled={!ready || busy || Boolean(loadError)}>{exporting ? <><span className="spinner"/> Preparing…</> : "Save & Organize"}</button>
          </div>
        </div>
      </section>
    </div>
    {confirmDiscard && <ConfirmDialog title="Discard this edit?" confirmLabel="Discard" onCancel={() => setConfirmDiscard(false)} onConfirm={() => { setConfirmDiscard(false); abortRef.current?.abort(); onClose(); }}><p>Your changes haven't been saved. Closing the editor discards them — nothing was uploaded.</p></ConfirmDialog>}
  </ModalPortal>;
}
