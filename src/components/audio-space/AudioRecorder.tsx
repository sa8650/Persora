// AudioSpace — integrated audio recorder (MediaRecorder + live waveform).
//
// Start / pause / resume / stop, live level visualization, duration, preview
// before saving, rename + description, save into AudioSpace, or cancel without
// saving. Microphone permission problems and unsupported browsers are handled
// with clear, actionable messages.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Circle, Loader2, Mic, Pause, Play, Square, Trash2 } from "lucide-react";
import type { AudioSpaceItem, AudioSpaceSaveInput, TransferProgress, VaultFolder, VaultFolderColor } from "../../types";
import { saveAudioSpaceItem } from "../../lib/cloud";
import { defaultAudioTitleFromFileName, formatDuration, tagsFromInput } from "../../lib/audio-space";
import { IconTile } from "../reui/icon-tile";
import { TransferProgressIndicator } from "../ProgressIndicator";
import ItemModalShell from "../ItemModalShell";
import { AudioDetailsFields } from "./AudioDialogs";
import "./audio-space.css";

type RecorderState = "idle" | "requesting" | "recording" | "paused" | "preview" | "saving" | "unsupported";

const MIME_PREFERENCES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of MIME_PREFERENCES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch { /* keep looking */ }
  }
  return "";
}

function recordedExtension(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  return "webm";
}

export function AudioRecordDialog({
  folders, defaultFolderId, maxUploadMb, canUpload, saveBlockedReason, onUpgrade, onClose, onSaved, notify,
}: {
  folders: VaultFolder[];
  defaultFolderId: string | null;
  maxUploadMb: number;
  canUpload: boolean;
  saveBlockedReason?: string;
  onUpgrade?: () => void;
  onClose: () => void;
  onSaved: (item: AudioSpaceItem, folder: VaultFolder | null, createdFolder: boolean) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const titleId = useId();
  const [state, setState] = useState<RecorderState>(() => (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia ? "unsupported" : "idle"));
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState<VaultFolderColor>("blue");
  const [favorite, setFavorite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  // Set when the member cancels: the "stop" listener must then discard chunks
  // instead of building a preview (recorder.on* = null doesn't detach
  // addEventListener handlers).
  const discardRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const maxSaveMb = Math.max(1, Math.min(100, maxUploadMb || 25));

  // Live waveform drawing.
  const drawWave = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = getComputedStyle(canvas).getPropertyValue("--as-wave-color").trim() || "#1a73e8";
    const bars = 48;
    const step = Math.floor(data.length / bars) || 1;
    for (let index = 0; index < bars; index++) {
      let peak = 0;
      for (let sample = 0; sample < step; sample++) {
        const value = Math.abs((data[index * step + sample] || 128) - 128) / 128;
        if (value > peak) peak = value;
      }
      const barHeight = Math.max(2, peak * height * 0.9);
      const x = (index / bars) * width + 1;
      context.fillRect(x, (height - barHeight) / 2, width / bars - 2, barHeight);
    }
    rafRef.current = requestAnimationFrame(drawWave);
  }, []);

  const stopVisuals = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const releaseStream = useCallback(() => {
    stopVisuals();
    for (const track of streamRef.current?.getTracks() || []) track.stop();
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    analyserRef.current = null;
  }, [stopVisuals]);

  useEffect(() => () => {
    releaseStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl, releaseStream]);

  const startRecording = async () => {
    setError("");
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      accumulatedRef.current = 0;
      discardRef.current = false;
      setSeconds(0);

      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const context = new AudioContextCtor();
        audioContextRef.current = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyserRef.current = analyser;
        rafRef.current = requestAnimationFrame(drawWave);
      }

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        stopVisuals();
        if (discardRef.current) { chunksRef.current = []; return; }
        setSeconds(accumulatedRef.current / 1000);
        const type = recorder.mimeType || mimeType || "audio/webm";
        const recorded = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (recorded.size > maxSaveMb * 1024 * 1024) {
          setError(`This recording is larger than ${maxSaveMb} MB. Record a shorter take or raise the upload limit.`);
          setState("idle");
          releaseStream();
          return;
        }
        setBlob(recorded);
        const recordedUrl = URL.createObjectURL(recorded);
        setPreviewUrl((previous) => {
          if (previous && previous !== recordedUrl) URL.revokeObjectURL(previous);
          return recordedUrl;
        });
        setState("preview");
        releaseStream();
      });

      startedAtRef.current = Date.now();
      recorder.start(250);
      setState("recording");
      timerRef.current = window.setInterval(() => {
        setSeconds((accumulatedRef.current + (Date.now() - startedAtRef.current)) / 1000);
      }, 200);
    } catch (err) {
      releaseStream();
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Microphone access was blocked. Allow microphone permission in your browser settings, then try again.");
      } else if (name === "NotFoundError") {
        setError("No microphone was found on this device. Connect a microphone or upload an audio file instead.");
      } else {
        setError("Recording couldn't start on this device. You can upload an audio file instead.");
      }
      setState("idle");
    }
  };

  const pauseRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    accumulatedRef.current += Date.now() - startedAtRef.current;
    stopVisuals();
    setState("paused");
  };

  const resumeRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    startedAtRef.current = Date.now();
    setState("recording");
    timerRef.current = window.setInterval(() => {
      setSeconds((accumulatedRef.current + (Date.now() - startedAtRef.current)) / 1000);
    }, 200);
    if (analyserRef.current) rafRef.current = requestAnimationFrame(drawWave);
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") accumulatedRef.current += Date.now() - startedAtRef.current;
    recorder.stop();
  };

  const cancelAll = () => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* already stopped */ }
    }
    recorderRef.current = null;
    releaseStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setBlob(null);
    onClose();
  };

  const restart = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setBlob(null);
    setSeconds(0);
    accumulatedRef.current = 0;
    setState("idle");
    setError("");
    void startRecording();
  };

  const togglePreview = () => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (audio.paused) { void audio.play().catch(() => undefined); setPreviewPlaying(true); }
    else { audio.pause(); setPreviewPlaying(false); }
  };

  const save = async () => {
    if (saving || !blob) return;
    if (!canUpload) return;
    setSaving(true);
    setError("");
    try {
      const mime = blob.type || "audio/webm";
      const extension = recordedExtension(mime);
      const input: AudioSpaceSaveInput = {
        title: title.trim() || `Recording ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
        description: description.trim(),
        folderId: newFolderName.trim() ? null : folderId,
        newFolder: newFolderName.trim() ? { name: newFolderName.trim(), color: newFolderColor } : null,
        tags: tagsFromInput(tagsInput),
        favorite,
        source: "recording",
        duration: Math.max(1, Math.round(seconds)),
        fileName: `recording.${extension}`,
      };
      const result = await saveAudioSpaceItem(blob, `recording.${extension}`, input, setProgress);
      onSaved(result.item, result.folder, result.createdFolder);
      notify(`Saved “${result.item.title}” to My Recordings.`);
      releaseStream();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recording couldn't be saved. Please try again.");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const busy = state === "recording" || state === "paused" || state === "requesting" || saving;
  const closeLabel = busy ? "Recording in progress — use Cancel to discard" : undefined;

  return <ItemModalShell labelledBy={titleId} className="as-dialog as-record-dialog" icon={<Mic size={18}/>} eyebrow="Add audio" title="Record audio" onClose={cancelAll} closeDisabled={busy} dismissable={!busy} closeLabel={closeLabel}>
    <div className="vault-modal-scroll as-dialog-body">
      {state === "unsupported" && <div className="as-record-panel" role="alert">
        <IconTile variant="soft" size="sm" className="ds-tone-amber"><AlertTriangle size={15}/></IconTile>
        <b>Recording isn't supported in this browser</b>
        <p>This browser can't record audio. Try a recent Chrome, Edge, Firefox or Safari — or upload an audio file instead.</p>
      </div>}

      {(state === "idle" || state === "requesting") && <div className="as-record-panel">
        <IconTile variant="soft" size="sm" className="ds-tone-blue"><Mic size={15}/></IconTile>
        <b>Record from your microphone</b>
        <p>Audio stays on this device until you press Save to AudioSpace.</p>
        <button type="button" className="section-add-button" onClick={() => void startRecording()} disabled={state === "requesting"}>
          {state === "requesting" ? <><Loader2 size={14} className="as-spin"/> Waiting for microphone…</> : <><Circle size={13} fill="currentColor"/> Start recording</>}
        </button>
      </div>}

      {(state === "recording" || state === "paused") && <>
        <div className={`as-record-live ${state === "paused" ? "is-paused" : ""}`}>
          <span className="as-record-dot" aria-hidden="true"/>
          <span className="as-record-time">{formatDuration(seconds)}</span>
          <span className="as-record-state">{state === "paused" ? "Paused" : "Recording"}</span>
        </div>
        <canvas ref={canvasRef} className="as-record-wave" width={560} height={96} aria-label="Live audio level"/>
        <div className="as-record-actions">
          {state === "recording"
            ? <button type="button" className="quiet-button" onClick={pauseRecording}><Pause size={14}/> Pause</button>
            : <button type="button" className="quiet-button" onClick={resumeRecording}><Play size={14}/> Resume</button>}
          <button type="button" className="editor-submit" onClick={stopRecording}><Square size={13} fill="currentColor"/> Stop</button>
        </div>
        <p className="as-muted-note">Pause and resume as often as you need. Nothing is uploaded until you save.</p>
      </>}

      {state === "preview" && blob && <>
        <div className="as-record-preview">
          <div className="as-record-preview-head">
            <IconTile variant="soft" size="sm" className="ds-tone-blue"><Mic size={15}/></IconTile>
            <div><b>Preview your recording</b><small>{formatDuration(seconds)} · {(blob.size / 1024 / 1024).toFixed(1)} MB</small></div>
            <button type="button" className="quiet-button as-preview-play" onClick={togglePreview}>
              {previewPlaying ? <><Pause size={13}/> Pause</> : <><Play size={13}/> Play</>}
            </button>
          </div>
          <audio ref={previewAudioRef} src={previewUrl || undefined} onEnded={() => setPreviewPlaying(false)} onPause={() => setPreviewPlaying(false)} preload="metadata"/>
        </div>
        <AudioDetailsFields
          title={title} onTitle={setTitle}
          description={description} onDescription={setDescription}
          tagsInput={tagsInput} onTagsInput={setTagsInput}
          folders={folders} folderId={folderId} onFolderId={setFolderId}
          newFolderName={newFolderName} onNewFolderName={setNewFolderName}
          newFolderColor={newFolderColor} onNewFolderColor={setNewFolderColor}
          favorite={favorite} onFavorite={setFavorite}
          titleLabel="Recording name"
        />
        {!title.trim() && <p className="as-muted-note"><Check size={12}/> Left empty, the recording is saved as “{defaultAudioTitleFromFileName(`Recording ${new Date().toLocaleDateString()}`)}”.</p>}
        {saving && progress && <TransferProgressIndicator label="Saving recording…" progress={progress}/>}
      </>}

      {error && <p className="as-inline-error" role="alert"><AlertTriangle size={12}/> {error}</p>}
      {saveBlockedReason && state === "preview" && <p className="as-inline-error" role="alert"><AlertTriangle size={12}/> {saveBlockedReason}</p>}
    </div>
    <div className="editor-form-footer">
      <button type="button" className="quiet-button as-danger" onClick={cancelAll} disabled={saving}>
        <Trash2 size={13}/> {state === "preview" ? "Discard" : "Cancel"}
      </button>
      <div className="editor-actions">
        {state === "preview" && !canUpload && onUpgrade && <button type="button" className="quiet-button" onClick={onUpgrade}>Upgrade plan</button>}
        {state === "preview" && <button type="button" className="quiet-button" onClick={restart} disabled={saving}>Record again</button>}
        {state === "preview" && <button type="button" className="editor-submit" onClick={() => void save()} disabled={saving || !canUpload || !blob}>
          {saving ? <><Loader2 size={14} className="as-spin"/> Saving…</> : <><Mic size={14}/> Save to AudioSpace</>}
        </button>}
      </div>
    </div>
  </ItemModalShell>;
}
