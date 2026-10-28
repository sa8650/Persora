import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle, Check, Cpu, Crop, Eraser, Eye, FlipHorizontal2, FlipVertical2, Move, Palette, RefreshCw, RotateCcw, RotateCw, ScanFace, ShieldCheck, SlidersHorizontal, Sparkles, Undo2, Wand2, X,
} from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { PhotoStudioPhoto } from "../types";
import {
  BACKGROUND_SWATCHES, NEUTRAL_ADJUSTMENTS, NEUTRAL_FILTER, PHOTO_FILTER_PRESETS, PHOTO_SIZE_PRESETS, analyzePhoto, convertSize, getPhotoFilterPreset, isFilterNeutral, matchPreset, normalizeHexColor, outputPixels, printSizeLabel,
  type Adjustments, type PhotoAnalysis, type PhotoFilterId, type PhotoFilterSelection, type PhotoUnit,
} from "../lib/photo-studio";
import { decodeImage, exportPhoto, releaseCanvas, renderComposite, renderFilterThumbnails, toWorkingCanvas, type BackgroundMode, type EditState, type OutputFormat } from "../lib/photo-studio-render";
import { BackgroundRemovalError, removePhotoBackground, type BackgroundEngine, type BackgroundStatus } from "../lib/photo-background";
import { LOCAL_MODEL_NAME } from "../lib/local-matting";
import ModalPortal from "./ModalPortal";
import { ConfirmDialog } from "./VaultDialogs";
import "./photo-studio.css";

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

type Tab = "frame" | "background" | "filters" | "adjust";
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
    adjustments: { ...NEUTRAL_ADJUSTMENTS }, filter: { ...NEUTRAL_FILTER },
    background: "original", backgroundColor: "#ffffff", format: "image/jpeg", quality: 0.92,
  };
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

interface BgResultInfo { source: "cloud" | "local"; runtime?: string; fallbackReason?: string }
/** One undo step: the cut-out and background settings before a removal. */
interface BgHistoryEntry { cutout: HTMLCanvasElement | null; result: BgResultInfo | null; background: BackgroundMode; backgroundColor: string; format: OutputFormat }
const BG_HISTORY_LIMIT = 4;

function resultLabel(result: BgResultInfo): string {
  return result.source === "cloud" ? "Persora AI" : `On this device${result.runtime ? ` · ${result.runtime === "webgpu" ? "WebGPU" : "CPU"}` : ""}`;
}

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
  const [bgResult, setBgResult] = useState<BgResultInfo | null>(null);
  const [bgEngine, setBgEngine] = useState<BackgroundEngine>("auto");
  const [comparing, setComparing] = useState(false);
  const [draftFilter, setDraftFilter] = useState<PhotoFilterSelection>({ ...NEUTRAL_FILTER });
  const [filterComparing, setFilterComparing] = useState(false);
  const [filterThumbs, setFilterThumbs] = useState<Partial<Record<PhotoFilterId, string>>>({});
  const [historyDepth, setHistoryDepth] = useState(0);
  const historyRef = useRef<BgHistoryEntry[]>([]);
  const latestRef = useRef<{ state: EditState | null; bgResult: BgResultInfo | null }>({ state: null, bgResult: null });
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
        setDraftFilter({ ...NEUTRAL_FILTER });
        setFilterThumbs(renderFilterThumbnails(canvas, 68));
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
      for (const entry of historyRef.current) releaseCanvas(entry.cutout);
      historyRef.current = [];
    };
  }, [source.blob, source.photo]);

  latestRef.current = { state, bgResult };
  const output = useMemo(() => state ? outputPixels(state) : { width: 0, height: 0, clamped: false }, [state]);
  const previewScale = output.width && output.height ? Math.min(1, PREVIEW_MAX / Math.max(output.width, output.height)) : 1;
  const previewW = Math.max(1, Math.round(output.width * previewScale));
  const previewH = Math.max(1, Math.round(output.height * previewScale));

  const committedFilter = state?.filter || NEUTRAL_FILTER;
  const filterHasPending =
    draftFilter.id !== committedFilter.id || Math.round(draftFilter.intensity) !== Math.round(committedFilter.intensity);
  const effectiveFilter = tab === "filters" ? draftFilter : committedFilter;

  // Re-render the live preview (throttled to one frame).
  useEffect(() => {
    if (!ready || !state || !sourceRef.current || !previewRef.current) return;
    const frame = requestAnimationFrame(() => {
      // "Compare" previews the untouched original; Before/After in Filters previews without filter.
      if (sourceRef.current && previewRef.current) {
        const previewState: EditState = comparing
          ? { ...state, background: "original", filter: NEUTRAL_FILTER }
          : filterComparing
            ? { ...state, filter: NEUTRAL_FILTER }
            : { ...state, filter: effectiveFilter };
        renderComposite(previewRef.current, sourceRef.current, cutoutRef.current, previewState, previewW, previewH);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, state, effectiveFilter, previewW, previewH, bgResult, comparing, filterComparing]);

  const dirty = Boolean(state && (JSON.stringify(state) !== initialRef.current || bgResult || filterHasPending));
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

  const runBackgroundRemoval = async (engine: BackgroundEngine = "auto") => {
    if (!sourceRef.current || bgStatus) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBgError(null);
    setBgEngine(engine);
    setComparing(false);
    try {
      // Always works from the untouched original — never from a previous cut-out.
      const result = await removePhotoBackground(sourceRef.current, (status) => { if (!controller.signal.aborted) setBgStatus(status); }, controller.signal, { cloudAvailable, engine });
      if (controller.signal.aborted) { releaseCanvas(result.cutout); return; }
      // Keep the previous result as an undo step.
      const latest = latestRef.current;
      if (latest.state) {
        historyRef.current.push({ cutout: cutoutRef.current, result: latest.bgResult, background: latest.state.background, backgroundColor: latest.state.backgroundColor, format: latest.state.format });
        while (historyRef.current.length > BG_HISTORY_LIMIT) releaseCanvas(historyRef.current.shift()?.cutout);
        setHistoryDepth(historyRef.current.length);
      } else {
        releaseCanvas(cutoutRef.current);
      }
      cutoutRef.current = result.cutout;
      setBgResult({ source: result.source, runtime: result.runtime, fallbackReason: result.fallbackReason });
      setState((current) => current ? { ...current, background: current.background === "original" ? "color" : current.background } : current);
    } catch (error) {
      if (controller.signal.aborted) return;
      setBgError(error instanceof BackgroundRemovalError ? error : new BackgroundRemovalError(null, error instanceof Error ? error.message : "Background removal failed."));
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setBgStatus(null); }
    }
  };
  const cancelBackgroundRemoval = () => { abortRef.current?.abort(); abortRef.current = null; setBgStatus(null); };
  /** Steps back to the result (or the original photo) before the last removal. */
  const undoBackgroundRemoval = () => {
    if (bgStatus) return;
    const previous = historyRef.current.pop();
    setHistoryDepth(historyRef.current.length);
    releaseCanvas(cutoutRef.current);
    cutoutRef.current = previous?.cutout || null;
    setBgResult(previous?.result || null);
    setBgError(null);
    setComparing(false);
    setState((current) => current ? {
      ...current,
      background: previous?.cutout ? previous.background : "original",
      backgroundColor: previous ? previous.backgroundColor : current.backgroundColor,
      format: previous ? previous.format : current.format,
    } : current);
  };

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
    const filterPreset = getPhotoFilterPreset(current.filter?.id);
    if (filterPreset && current.filter && !isFilterNeutral(current.filter)) {
      lines.push(`Filter: ${filterPreset.label} (${Math.round(current.filter.intensity)}%)`);
    }
    lines.push(`Format ${current.format === "image/png" ? "PNG" : "JPEG"}`);
    return lines;
  }, [bgResult, output.width, output.height]);

  const saveAndOrganize = async () => {
    if (!state || !sourceRef.current || exporting || bgStatus) return;
    const finalState: EditState = tab === "filters" ? { ...state, filter: { ...draftFilter } } : state;
    setExporting(true); setExportError("");
    try {
      const result = await exportPhoto(sourceRef.current, cutoutRef.current, finalState, output.width, output.height);
      const bytes = new Uint8Array(await result.blob.arrayBuffer());
      const analysis = analyzePhoto(bytes, { width: result.width, height: result.height }, result.blob.size);
      if (!analysis) throw new Error("The edited photo couldn't be prepared. Try again.");
      const preset = PHOTO_SIZE_PRESETS.find((entry) => entry.id === finalState.presetId);
      onSaveAndOrganize({
        ...result,
        analysis,
        presetCategory: preset?.category || null,
        editSummary: editSummary(finalState),
        editSettings: {
          presetId: finalState.presetId, width: finalState.width, height: finalState.height, unit: finalState.unit, dpi: finalState.dpi,
          outputWidth: result.width, outputHeight: result.height, zoom: finalState.zoom, offsetX: finalState.offsetX, offsetY: finalState.offsetY,
          rotation: finalState.rotation, quarterTurns: finalState.quarterTurns, flipH: finalState.flipH, flipV: finalState.flipV,
          background: finalState.background, backgroundColor: finalState.background === "color" ? finalState.backgroundColor : null,
          backgroundRemoval: bgResult && finalState.background !== "original" ? bgResult.source : null,
          backgroundRuntime: bgResult?.runtime || null,
          adjustments: { ...finalState.adjustments },
          filter: finalState.filter ? { ...finalState.filter } : null,
          format: finalState.format, sourceTitle: source.photo?.title || source.name,
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
          <IconTile variant="soft" size="sm" className="text-blue-600 dark:text-blue-300"><Wand2 size={18}/></IconTile>
          <div className="vault-modal-title"><small>Create &amp; edit</small><h2 id={titleId}>{source.photo ? `Edit a copy of “${source.photo.title}”` : "Edit your portrait"}</h2></div>
          <button type="button" className="vault-modal-close" onClick={requestClose} disabled={exporting} aria-label="Close editor"><X size={18}/></button>
        </header>
        {loadError ? <div className="ps-editor-error-state"><AlertTriangle size={22}/><h3>This image couldn't be opened</h3><p>{loadError}</p><button type="button" className="quiet-button" onClick={onClose}>Close</button></div>
        : !ready || !state ? <div className="ps-editor-loading" role="status"><Spinner className="size-5"/> Preparing your photo…</div>
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
              {(comparing || filterComparing) && (
                <span className="ps-compare-tag" aria-live="polite">
                  {comparing ? "Original photo" : "Before filter"}
                </span>
              )}
              {guide && !comparing && <svg className="ps-stage-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <ellipse cx="50" cy="44" rx="23" ry="31" />
                <line x1="50" y1="4" x2="50" y2="96" />
                <line x1="20" y1="40" x2="80" y2="40" />
              </svg>}
              {bgStatus && <div className="ps-stage-busy" role="status" aria-live="polite">
                <Spinner className="size-5"/>
                <b>{bgStatus.stage === "switching" ? "Switching to on-device removal" : bgStatus.stage === "cloud" ? "Persora AI" : bgStatus.stage === "refining" ? "Finishing" : "On-device model"}</b>
                <span>{bgStatus.message}</span>
                {bgStatus.stage === "switching" && <small>{bgStatus.reason}</small>}
                {bgProgress !== undefined && <Progress value={bgProgress} aria-label="Background removal progress" className="h-1.5 w-full max-w-[220px]"/>}
                <button type="button" className="quiet-button" onClick={cancelBackgroundRemoval}>Cancel</button>
              </div>}
            </div>
            <div className="ps-stage-hint"><Move size={13}/> Drag to reposition · scroll to zoom
              <label className="ps-guide-toggle"><Checkbox checked={guide} onCheckedChange={(checked) => setGuide(checked === true)}/> <ScanFace size={13}/> Face guide</label>
            </div>
          </div>

          <div className="ps-panel">
            <section className={`ps-remove-card ${bgResult ? "is-done" : ""}`} aria-label="Background removal">
              {!bgResult ? <>
                <button type="button" className="editor-submit ps-remove-button" onClick={() => void runBackgroundRemoval("auto")} disabled={Boolean(bgStatus) || exporting}>{bgStatus ? <><Spinner className="size-3.5"/> Removing background…</> : <><Sparkles size={15}/> Remove Background</>}</button>
                <small><ShieldCheck size={12}/> {cloudAvailable ? "Uses Persora AI first. If it's unavailable, an on-device model takes over and your photo stays on this device." : "Runs on this device — your photo isn't uploaded."}</small>
              </> : <>
                <div className="ps-remove-status">
                  <Badge variant="success-light" size="sm"><Check className="size-3.5"/> Background removed · {resultLabel(bgResult)}</Badge>
                  {bgResult.source === "local" && <small>{LOCAL_MODEL_NAME}.{bgResult.fallbackReason ? ` Persora AI wasn't used: ${bgResult.fallbackReason}` : ""}</small>}
                </div>
                <div className="ps-remove-actions">
                  <button type="button" className={`quiet-button ${comparing ? "is-on" : ""}`} aria-pressed={comparing} onClick={() => setComparing((value) => !value)} disabled={Boolean(bgStatus)} title="Preview the original photo"><Eye size={14}/> {comparing ? "Show result" : "Compare"}</button>
                  <button type="button" className="quiet-button" onClick={undoBackgroundRemoval} disabled={Boolean(bgStatus)} title={historyDepth ? "Go back to the previous result" : "Go back to the original photo"}><Undo2 size={14}/> Undo</button>
                </div>
                <div className="ps-remove-again" role="group" aria-label="Remove the background again">
                  <span>Not right? Remove again with</span>
                  <div>
                    <button type="button" className="quiet-button" onClick={() => void runBackgroundRemoval("cloud")} disabled={Boolean(bgStatus) || !cloudAvailable} title={cloudAvailable ? "Run Persora AI on the original photo" : "Cloud AI isn't available in this workspace"}><Sparkles size={14}/> Persora AI</button>
                    <button type="button" className="quiet-button" onClick={() => void runBackgroundRemoval("local")} disabled={Boolean(bgStatus)} title="Run the on-device model on the original photo"><Cpu size={14}/> On this device</button>
                  </div>
                </div>
              </>}
              {bgError && !bgStatus && <div className="ps-bg-error" role="alert">
                <b><AlertTriangle size={14}/> Background removal didn't work</b>
                {bgError.cloudReason !== null && <span>Persora AI: {bgError.cloudReason}</span>}
                {bgError.localReason !== null && <span>On-device model: {bgError.localReason}</span>}
                <p>{bgResult ? "Your previous result is still applied." : "Nothing was changed."} Your original photo is untouched.</p>
                <div className="ps-bg-error-actions">
                  <button type="button" className="quiet-button" onClick={() => void runBackgroundRemoval(bgEngine)}><RefreshCw size={14}/> Retry</button>
                  {bgError.localReason === null && <button type="button" className="quiet-button" onClick={() => void runBackgroundRemoval("local")}><Cpu size={14}/> Try on this device</button>}
                  {bgError.cloudReason === null && cloudAvailable && <button type="button" className="quiet-button" onClick={() => void runBackgroundRemoval("cloud")}><Sparkles size={14}/> Try Persora AI</button>}
                </div>
              </div>}
            </section>
            <div className="ps-tabs" role="tablist" aria-label="Editing tools">
              {([
                ["frame", "Crop & size", Crop],
                ["background", "Background", Eraser],
                ["filters", "Filters", Sparkles],
                ["adjust", "Adjust", SlidersHorizontal],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? "is-active" : ""}
                  onClick={() => {
                    if (id === "filters" && tab !== "filters") {
                      setDraftFilter(state.filter ? { ...state.filter } : { ...NEUTRAL_FILTER });
                    }
                    if (id !== "filters") setFilterComparing(false);
                    setTab(id);
                  }}
                >
                  <Icon size={14}/>{label}
                </button>
              ))}
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
              <p className="ps-muted-note ps-bg-tab-note">{bgResult ? "Choose the new background. Use Compare, Undo or Remove again above if the cut-out isn't right." : "Press Remove Background above. Colour backgrounds become available once the background is removed."}</p>
              <div className="ps-bg-options" role="radiogroup" aria-label="Background">
                <button type="button" role="radio" aria-checked={state.background === "original"} className={`ps-bg-option ${state.background === "original" ? "is-selected" : ""}`} onClick={() => update({ background: "original" })}><span className="ps-bg-swatch ps-bg-original"/>Original</button>
                {BACKGROUND_SWATCHES.map((swatch) => <button key={swatch.id} type="button" role="radio" aria-checked={state.background === "color" && state.backgroundColor === swatch.color} disabled={!bgResult} className={`ps-bg-option ${state.background === "color" && state.backgroundColor === swatch.color ? "is-selected" : ""}`} onClick={() => update({ background: "color", backgroundColor: swatch.color })}><span className="ps-bg-swatch" style={{ background: swatch.color }}/>{swatch.label}</button>)}
                <label className={`ps-bg-option ${state.background === "color" && !BACKGROUND_SWATCHES.some((swatch) => swatch.color === state.backgroundColor) ? "is-selected" : ""} ${!bgResult ? "is-disabled" : ""}`}><input type="color" value={state.backgroundColor} disabled={!bgResult} onChange={(event) => update({ background: "color", backgroundColor: normalizeHexColor(event.target.value) })} aria-label="Custom background colour"/><Palette size={13}/>Custom</label>
                <button type="button" role="radio" aria-checked={state.background === "transparent"} disabled={!bgResult} className={`ps-bg-option ${state.background === "transparent" ? "is-selected" : ""}`} onClick={() => update({ background: "transparent", format: "image/png" })}><span className="ps-bg-swatch ps-checker"/>Transparent</button>
              </div>
            </div>}

            {tab === "filters" && (
              <div className="ps-tool-group ps-filters-panel" role="tabpanel" aria-label="Filters">
                <div className="ps-filters-header">
                  <span className="ps-filters-caption">10 local color-grading presets · non-destructive</span>
                  <button
                    type="button"
                    className={`quiet-button ps-compare-btn ${filterComparing ? "is-on" : ""}`}
                    aria-pressed={filterComparing}
                    disabled={draftFilter.id === "none" || draftFilter.intensity <= 0}
                    onClick={() => setFilterComparing((prev) => !prev)}
                  >
                    <Eye size={13} /> {filterComparing ? "Show filtered" : "Before / After"}
                  </button>
                </div>

                <div className="ps-filter-grid" role="radiogroup" aria-label="Color filter presets">
                  {PHOTO_FILTER_PRESETS.map((preset) => {
                    const selected = draftFilter.id === preset.id;
                    const thumbSrc = filterThumbs[preset.id];
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-filter-preset={preset.id}
                        className={`ps-filter-card ${selected ? "is-selected" : ""}`}
                        title={preset.tagline}
                        onClick={() => {
                          setFilterComparing(false);
                          setDraftFilter((prev) => ({
                            id: preset.id,
                            intensity: prev.id === "none" || prev.intensity === 0 ? 100 : prev.intensity,
                          }));
                        }}
                      >
                        <span className="ps-filter-thumb">
                          {thumbSrc ? (
                            <img src={thumbSrc} alt="" aria-hidden="true" />
                          ) : (
                            <span className="ps-filter-thumb-fallback" aria-hidden="true" />
                          )}
                        </span>
                        <span className="ps-filter-name">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>

                <label className="ps-slider">
                  <span>
                    Filter intensity <b>{draftFilter.id === "none" ? "0%" : `${Math.round(draftFilter.intensity)}%`}</b>
                  </span>
                  <input
                    type="range"
                    aria-label="Filter intensity"
                    min={0}
                    max={100}
                    step={1}
                    disabled={draftFilter.id === "none"}
                    value={draftFilter.id === "none" ? 0 : draftFilter.intensity}
                    onChange={(event) => {
                      setFilterComparing(false);
                      setDraftFilter((prev) => ({ ...prev, intensity: Number(event.target.value) }));
                    }}
                  />
                </label>

                <div className="ps-filter-actions">
                  <button
                    type="button"
                    className="ps-link-button"
                    disabled={draftFilter.id === "none" && committedFilter.id === "none"}
                    onClick={() => {
                      setFilterComparing(false);
                      setDraftFilter({ ...NEUTRAL_FILTER });
                      update({ filter: { ...NEUTRAL_FILTER } });
                    }}
                  >
                    <Undo2 size={13} /> Reset
                  </button>
                  <div className="ps-filter-commit-btns">
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={!filterHasPending}
                      onClick={() => {
                        setFilterComparing(false);
                        setDraftFilter(state.filter ? { ...state.filter } : { ...NEUTRAL_FILTER });
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="editor-submit ps-filter-apply"
                      disabled={!filterHasPending}
                      onClick={() => {
                        setFilterComparing(false);
                        update({ filter: { ...draftFilter } });
                      }}
                    >
                      <Check size={13} /> Apply
                    </button>
                  </div>
                </div>
                <small className="ps-muted-note">
                  Filters run locally in memory. Nothing is uploaded until you save in the final step.
                </small>
              </div>
            )}

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
            <button type="button" className="editor-submit" onClick={() => void saveAndOrganize()} disabled={!ready || busy || Boolean(loadError)}>{exporting ? <><Spinner className="size-3.5"/> Preparing…</> : "Save & Organize"}</button>
          </div>
        </div>
      </section>
    </div>
    {confirmDiscard && <ConfirmDialog title="Discard this edit?" confirmLabel="Discard" onCancel={() => setConfirmDiscard(false)} onConfirm={() => { setConfirmDiscard(false); abortRef.current?.abort(); onClose(); }}><p>Your changes haven't been saved. Closing the editor discards them — nothing was uploaded.</p></ConfirmDialog>}
  </ModalPortal>;
}
