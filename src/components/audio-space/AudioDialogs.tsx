// AudioSpace — add & manage dialogs (upload, external link, edit details).
//
// Every dialog renders through the shared ItemModalShell, keeps the Persora
// Design System look, and never writes anything until the explicit Save.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ExternalLink, FolderPlus, Link2, Loader2, Mic, Pencil, ShieldCheck, Star, Upload, X } from "lucide-react";
import type { AudioSpaceItem, AudioSpaceSaveInput, TransferProgress, VaultFolder, VaultFolderColor } from "../../types";
import { saveAudioSpaceItem, saveAudioSpaceLink, saveVaultFolder, updateAudioSpaceItem, validateAudioSpaceLink } from "../../lib/cloud";
import {
  SUPPORTED_AUDIO_LABEL, checkAudioLinkInput, defaultAudioTitleFromFileName,
  detectAudioFormat, formatAudioBytes, formatDuration, tagsFromInput, tagsToInput,
} from "../../lib/audio-space";
import { Badge } from "../reui/badge";
import { IconTile } from "../reui/icon-tile";
import { TransferProgressIndicator } from "../ProgressIndicator";
import ItemModalShell from "../ItemModalShell";
import { VAULT_FOLDER_COLORS } from "../../lib/folders";
import "./audio-space.css";

const FOLDER_COLOR_VALUES: VaultFolderColor[] = VAULT_FOLDER_COLORS.map((entry) => entry.value);

/** Shared detail fields: title, description, tags, folder (+ inline new folder). */
export function AudioDetailsFields({
  title, onTitle, description, onDescription, tagsInput, onTagsInput, folders, folderId, onFolderId,
  newFolderName, onNewFolderName, newFolderColor, onNewFolderColor, favorite, onFavorite, titleLabel = "Title", hideTextFields = false,
}: {
  title: string; onTitle: (value: string) => void;
  description: string; onDescription: (value: string) => void;
  tagsInput: string; onTagsInput: (value: string) => void;
  folders: VaultFolder[]; folderId: string | null; onFolderId: (value: string | null) => void;
  newFolderName: string; onNewFolderName: (value: string) => void;
  newFolderColor: VaultFolderColor; onNewFolderColor: (value: VaultFolderColor) => void;
  favorite: boolean; onFavorite: (value: boolean) => void;
  titleLabel?: string;
  /** Hides title/description (upload rows carry their own). */
  hideTextFields?: boolean;
}) {
  return <div className="as-details-fields">
    {!hideTextFields && <label className="field-label as-field"><span>{titleLabel} <i className="as-required">*</i></span>
      <input value={title} maxLength={120} onChange={(event) => onTitle(event.target.value)} placeholder="Give the audio a clear name" />
    </label>}
    {!hideTextFields && <label className="field-label as-field"><span>Description <small className="as-optional">Optional</small></span>
      <textarea value={description} maxLength={1000} rows={2} onChange={(event) => onDescription(event.target.value)} placeholder="What is this audio about?" />
    </label>}
    <label className="field-label as-field"><span>Tags <small className="as-optional">Optional · comma separated</small></span>
      <input value={tagsInput} onChange={(event) => onTagsInput(event.target.value)} placeholder="meeting, idea, archive" />
    </label>
    <div className="as-folder-row">
      <label className="field-label as-field"><span>Folder</span>
        <select value={newFolderName ? "__new__" : (folderId || "")} onChange={(event) => {
          const value = event.target.value;
          if (value === "__new__") { onFolderId(null); onNewFolderName(" "); }
          else { onNewFolderName(""); onFolderId(value || null); }
        }}>
          <option value="">No folder</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          <option value="__new__">Create new folder…</option>
        </select>
      </label>
      {newFolderName ? <div className="as-new-folder">
        <input value={newFolderName === " " ? "" : newFolderName} maxLength={64} onChange={(event) => onNewFolderName(event.target.value || " ")} placeholder="New folder name" aria-label="New folder name" />
        <div className="as-color-row" role="radiogroup" aria-label="Folder color">
          {FOLDER_COLOR_VALUES.map((color) => (
            <button key={color} type="button" role="radio" aria-checked={newFolderColor === color} className={`as-color-swatch as-color-${color} ${newFolderColor === color ? "is-active" : ""}`} onClick={() => onNewFolderColor(color)} aria-label={color} />
          ))}
        </div>
      </div> : null}
    </div>
    <button type="button" className={favorite ? "as-favorite-toggle is-on" : "as-favorite-toggle"} onClick={() => onFavorite(!favorite)} aria-pressed={favorite}>
      <Star size={14} fill={favorite ? "currentColor" : "none"}/> {favorite ? "Pinned to Favorites" : "Pin to Favorites"}
    </button>
  </div>;
}

function useMeasuredDuration(file: File, onSettle?: (duration: number | null) => void): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (value: number | null) => {
      if (active) {
        setDuration(value);
        settleRef.current?.(value);
      }
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => finish(null), 2500);
    audio.addEventListener("loadedmetadata", () => {
      clearTimeout(timer);
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    }, { once: true });
    audio.addEventListener("error", () => { clearTimeout(timer); finish(null); }, { once: true });
    audio.src = url;
    return () => {
      active = false;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [file]);
  return duration;
}

interface UploadEntry {
  key: string;
  file: File;
  title: string;
  description: string;
  duration: number | null;
  /** "invalid" = wrong type/oversized (never retried); "error" = upload failed (retryable). */
  state: "pending" | "uploading" | "done" | "error" | "invalid";
  progress: TransferProgress | null;
  error: string;
}

function UploadRow({ entry, onTitle, onDescription, onSettle, onRemove }: {
  entry: UploadEntry;
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onSettle: (duration: number | null) => void;
  onRemove: () => void;
}) {
  const duration = useMeasuredDuration(entry.file, onSettle);
  const format = detectAudioFormat(entry.file.type || entry.file.name);
  return <div className={`as-upload-row is-${entry.state === "invalid" ? "error" : entry.state}`}>
    <div className="as-upload-row-head">
      <IconTile variant="soft" size="xs" className="ds-tone-blue"><Upload size={13}/></IconTile>
      <div className="as-upload-row-title">
        <input value={entry.title} maxLength={120} onChange={(event) => onTitle(event.target.value)} aria-label="Audio title" />
        <small>
          {format ? format.toUpperCase() : "AUDIO"} · {formatAudioBytes(entry.file.size)} · {formatDuration(duration ?? entry.duration)}
          {entry.state === "done" && <Badge variant="success-light" size="xs" radius="full">SAVED</Badge>}
          {entry.state === "invalid" && <Badge variant="destructive-light" size="xs" radius="full">UNSUPPORTED</Badge>}
          {entry.state === "error" && <Badge variant="destructive-light" size="xs" radius="full">FAILED</Badge>}
        </small>
      </div>
      <button type="button" className="quiet-button as-upload-row-remove" onClick={onRemove} disabled={entry.state === "uploading"} aria-label={`Remove ${entry.title} from this upload`}>
        <X size={13}/>
      </button>
    </div>
    <input className="as-upload-row-desc" value={entry.description} maxLength={1000} onChange={(event) => onDescription(event.target.value)} placeholder="Description (optional)" aria-label="Description" />
    {entry.state === "uploading" && entry.progress && <TransferProgressIndicator label={`Uploading “${entry.title}”…`} progress={entry.progress} />}
    {(entry.state === "error" || entry.state === "invalid") && <p className="as-inline-error" role="alert"><AlertTriangle size={12}/> {entry.error}</p>}
  </div>;
}

export function AudioUploadDialog({
  initialFiles, folders, defaultFolderId, maxUploadMb, canUpload, saveBlockedReason, onUpgrade, onClose, onSaved,
}: {
  initialFiles: File[];
  folders: VaultFolder[];
  defaultFolderId: string | null;
  maxUploadMb: number;
  canUpload: boolean;
  saveBlockedReason?: string;
  onUpgrade?: () => void;
  onClose: () => void;
  onSaved: (item: AudioSpaceItem, folder: VaultFolder | null, createdFolder: boolean) => void;
}) {
  const titleId = useId();
  const maxSaveMb = Math.max(1, Math.min(100, maxUploadMb || 25));
  const [entries, setEntries] = useState<UploadEntry[]>(() => initialFiles.map((file, index) => {
    const format = detectAudioFormat(file.type || file.name);
    const oversize = file.size > maxSaveMb * 1024 * 1024;
    return {
      key: `${index}-${file.name}`,
      file,
      title: defaultAudioTitleFromFileName(file.name),
      description: "",
      duration: null,
      state: (!format || oversize ? "invalid" : "pending") as UploadEntry["state"],
      progress: null,
      error: oversize ? `Audio files must be ${maxSaveMb} MB or smaller.` : !format ? "AudioSpace saves MP3, WAV, M4A, AAC, OGG, FLAC and WebM audio." : "",
    };
  }));
  const [tagsInput, setTagsInput] = useState("");
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState<VaultFolderColor>("blue");
  const [favorite, setFavorite] = useState(false);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef(false);

  const pendingCount = entries.filter((entry) => entry.state === "pending" || entry.state === "error").length;

  const patch = useCallback((key: string, values: Partial<UploadEntry>) => {
    setEntries((current) => current.map((entry) => entry.key === key ? { ...entry, ...values } : entry));
  }, []);

  const removeEntry = useCallback((key: string) => {
    setEntries((current) => current.filter((entry) => entry.key !== key));
  }, []);

  const uploadOne = useCallback(async (entry: UploadEntry): Promise<boolean> => {
    patch(entry.key, { state: "uploading", error: "", progress: { loaded: 0, total: entry.file.size, percent: 0, remainingSeconds: null } });
    try {
      const input: AudioSpaceSaveInput = {
        title: entry.title.trim() || defaultAudioTitleFromFileName(entry.file.name),
        description: entry.description.trim(),
        folderId: newFolderName.trim() ? null : folderId,
        newFolder: newFolderName.trim() ? { name: newFolderName.trim(), color: newFolderColor } : null,
        tags: tagsFromInput(tagsInput),
        favorite,
        source: "upload",
        duration: entry.duration,
        fileName: entry.file.name,
      };
      const result = await saveAudioSpaceItem(entry.file, entry.file.name, input, (progress) => patch(entry.key, { progress }));
      if (abortRef.current) return false;
      patch(entry.key, { state: "done", progress: null });
      onSaved(result.item, result.folder, result.createdFolder);
      return true;
    } catch (error) {
      if (abortRef.current) return false;
      patch(entry.key, { state: "error", progress: null, error: error instanceof Error ? error.message : "The upload failed. Try again." });
      return false;
    }
  }, [folderId, favorite, newFolderColor, newFolderName, onSaved, patch, tagsInput]);

  const saveAll = async () => {
    if (saving || !canUpload) return;
    setSaving(true);
    abortRef.current = false;
    let allDone = true;
    for (const entry of entries) {
      if (abortRef.current) { allDone = false; break; }
      if (entry.state !== "pending" && entry.state !== "error") continue; // saved rows and unsupported files are never re-sent
      const saved = await uploadOne(entry);
      if (!saved) allDone = false;
    }
    setSaving(false);
    // Close only when every remaining file was saved — failed or unsupported
    // rows stay visible so nothing is silently dropped.
    const hasInvalid = entries.some((entry) => entry.state === "invalid");
    if (allDone && !hasInvalid && !abortRef.current) onClose();
  };

  useEffect(() => () => { abortRef.current = true; }, []);

  return <ItemModalShell labelledBy={titleId} className="as-dialog" icon={<Upload size={18}/>} eyebrow="Add audio" title="Upload audio" onClose={onClose} closeDisabled={saving} dismissable={!saving}>
    <div className="vault-modal-scroll as-dialog-body">
      <p className="as-dialog-intro">Supported formats: {SUPPORTED_AUDIO_LABEL} (plus WebM where the browser records it). Files stay private to your account.</p>
      {entries.map((entry) => <UploadRow
        key={entry.key}
        entry={entry}
        onTitle={(value) => patch(entry.key, { title: value })}
        onDescription={(value) => patch(entry.key, { description: value })}
        onSettle={(duration) => patch(entry.key, { duration })}
        onRemove={() => removeEntry(entry.key)}
      />)}
      <AudioDetailsFields
        title="" onTitle={() => undefined}
        description="" onDescription={() => undefined}
        tagsInput={tagsInput} onTagsInput={setTagsInput}
        folders={folders} folderId={folderId} onFolderId={setFolderId}
        newFolderName={newFolderName} onNewFolderName={setNewFolderName}
        newFolderColor={newFolderColor} onNewFolderColor={setNewFolderColor}
        favorite={favorite} onFavorite={setFavorite}
        hideTextFields
      />
      <p className="as-muted-note"><ShieldCheck size={12}/> Folder, tags and favorites are applied to every file in this upload. You can edit each item later.</p>
      {saveBlockedReason && <p className="as-inline-error" role="alert"><AlertTriangle size={12}/> {saveBlockedReason}</p>}
    </div>
    <div className="editor-form-footer">
      <button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button>
      <div className="editor-actions">
        {!canUpload && onUpgrade && <button type="button" className="quiet-button" onClick={onUpgrade}>Upgrade plan</button>}
        <button type="button" className="editor-submit" onClick={() => void saveAll()} disabled={saving || !pendingCount || !canUpload}>
          {saving ? <><Loader2 size={14} className="as-spin"/> Uploading…</> : <><Upload size={14}/> Upload {pendingCount > 1 ? `${pendingCount} files` : "audio"}</>}
        </button>
      </div>
    </div>
  </ItemModalShell>;
}

export function AudioLinkDialog({
  folders, defaultFolderId, canUpload, saveBlockedReason, onUpgrade, onClose, onSaved,
}: {
  folders: VaultFolder[];
  defaultFolderId: string | null;
  canUpload: boolean;
  saveBlockedReason?: string;
  onUpgrade?: () => void;
  onClose: () => void;
  onSaved: (item: AudioSpaceItem, folder: VaultFolder | null, createdFolder: boolean) => void;
}) {
  const titleId = useId();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState<VaultFolderColor>("blue");
  const [favorite, setFavorite] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkOk, setCheckOk] = useState("");
  const [error, setError] = useState("");

  const runCheck = async () => {
    const local = checkAudioLinkInput(url);
    if (local) { setError(local); setCheckOk(""); return; }
    setChecking(true); setError(""); setCheckOk("");
    try {
      const result = await validateAudioSpaceLink(url);
      setCheckOk(`Playable audio found (${result.contentType || "audio"}${result.contentLength ? ` · ${formatAudioBytes(result.contentLength)}` : ""}).`);
      if (!title.trim()) {
        let lastSegment = "Audio link";
        try { lastSegment = new URL(url.trim()).pathname.split("/").pop() || "Audio link"; } catch { /* keep fallback */ }
        try { lastSegment = decodeURIComponent(lastSegment); } catch { /* malformed percent-encoding — keep raw */ }
        setTitle(defaultAudioTitleFromFileName(lastSegment));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "This link can't be checked right now.");
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (saving || !canUpload) return;
    const local = checkAudioLinkInput(url);
    if (local) { setError(local); return; }
    setSaving(true); setError("");
    try {
      const result = await saveAudioSpaceLink({
        title: title.trim() || "Audio link",
        description: description.trim(),
        folderId: newFolderName.trim() ? null : folderId,
        newFolder: newFolderName.trim() ? { name: newFolderName.trim(), color: newFolderColor } : null,
        tags: tagsFromInput(tagsInput),
        favorite,
        source: "link",
        url: url.trim(),
      });
      onSaved(result.item, result.folder, result.createdFolder);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The audio link couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <ItemModalShell labelledBy={titleId} className="as-dialog" icon={<Link2 size={18}/>} eyebrow="Add audio" title="Add audio link" onClose={onClose} closeDisabled={saving} dismissable={!saving}>
    <div className="vault-modal-scroll as-dialog-body">
      <p className="as-dialog-intro">Paste a direct audio URL (an .mp3, .wav, .m4a, .ogg … file). Webpage addresses are not playable audio and can't be saved.</p>
      <label className="field-label as-field"><span>Audio URL <i className="as-required">*</i></span>
        <div className="as-url-row">
          <input value={url} onChange={(event) => { setUrl(event.target.value); setCheckOk(""); }} placeholder="https://example.com/recordings/briefing.mp3" inputMode="url" />
          <button type="button" className="quiet-button as-check-button" onClick={() => void runCheck()} disabled={checking || !url.trim()}>
            {checking ? <><Loader2 size={13} className="as-spin"/> Checking…</> : <><ShieldCheck size={13}/> Check</>}
          </button>
        </div>
      </label>
      {checkOk && <p className="as-check-ok" role="status"><Check size={12}/> {checkOk}</p>}
      {error && <p className="as-inline-error" role="alert"><AlertTriangle size={12}/> {error}</p>}
      <AudioDetailsFields
        title={title} onTitle={setTitle}
        description={description} onDescription={setDescription}
        tagsInput={tagsInput} onTagsInput={setTagsInput}
        folders={folders} folderId={folderId} onFolderId={setFolderId}
        newFolderName={newFolderName} onNewFolderName={setNewFolderName}
        newFolderColor={newFolderColor} onNewFolderColor={setNewFolderColor}
        favorite={favorite} onFavorite={setFavorite}
      />
      <p className="as-muted-note"><ExternalLink size={12}/> Persora stores the original URL and checks it points at reachable audio. Playback of external sources can still depend on the provider allowing streaming.</p>
      {saveBlockedReason && <p className="as-inline-error" role="alert"><AlertTriangle size={12}/> {saveBlockedReason}</p>}
    </div>
    <div className="editor-form-footer">
      <button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button>
      <div className="editor-actions">
        {!canUpload && onUpgrade && <button type="button" className="quiet-button" onClick={onUpgrade}>Upgrade plan</button>}
        <button type="button" className="editor-submit" onClick={() => void save()} disabled={saving || !url.trim() || !canUpload}>
          {saving ? <><Loader2 size={14} className="as-spin"/> Saving…</> : <><Link2 size={14}/> Save audio link</>}
        </button>
      </div>
    </div>
  </ItemModalShell>;
}

export function AudioDetailsDialog({
  item, folders, onClose, onSaved, onFolderCreated, notify,
}: {
  item: AudioSpaceItem;
  folders: VaultFolder[];
  onClose: () => void;
  onSaved: (item: AudioSpaceItem) => void;
  onFolderCreated?: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [tagsInput, setTagsInput] = useState(tagsToInput(item.tags));
  const [folderId, setFolderId] = useState<string | null>(item.folderId);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState<VaultFolderColor>("blue");
  const [favorite, setFavorite] = useState(item.favorite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const metaRows = useMemo(() => [
    ["Source", item.source === "recording" ? "Recorded in AudioSpace" : item.source === "link" ? "External audio link" : "Uploaded"],
    ["Format", item.fileType ? `${detectAudioFormat(item.fileType)?.toUpperCase() || item.fileType.toUpperCase()}${item.fileSize ? ` · ${formatAudioBytes(item.fileSize)}` : ""}` : item.externalUrl ? new URL(item.externalUrl).host : "—"],
    ["Duration", formatDuration(item.durationSeconds)],
    ["Added", new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
  ] as [string, string][] , [item]);

  const save = async () => {
    if (saving) return;
    if (!title.trim()) { setError("Give the audio a title between 1 and 120 characters."); return; }
    setSaving(true); setError("");
    try {
      // PATCH has no inline new-folder step (unlike create routes), so create
      // the folder first and then file the item under it.
      let targetFolderId = folderId;
      if (newFolderName.trim()) {
        const created = await saveVaultFolder({ name: newFolderName.trim(), color: newFolderColor, pinned: false, scope: "audio-space" });
        targetFolderId = created.id;
        onFolderCreated?.();
      }
      const updated = await updateAudioSpaceItem(item.id, {
        title: title.trim(),
        description: description.trim(),
        tags: tagsFromInput(tagsInput),
        folderId: targetFolderId,
        favorite,
      });
      onSaved(updated);
      notify("Audio details updated.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The details couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <ItemModalShell labelledBy={titleId} className="as-dialog" icon={<Pencil size={18}/>} eyebrow="AudioSpace" title="Edit audio details" onClose={onClose} closeDisabled={saving} dismissable={!saving}>
    <div className="vault-modal-scroll as-dialog-body">
      <AudioDetailsFields
        title={title} onTitle={setTitle}
        description={description} onDescription={setDescription}
        tagsInput={tagsInput} onTagsInput={setTagsInput}
        folders={folders} folderId={folderId} onFolderId={setFolderId}
        newFolderName={newFolderName} onNewFolderName={setNewFolderName}
        newFolderColor={newFolderColor} onNewFolderColor={setNewFolderColor}
        favorite={favorite} onFavorite={setFavorite}
      />
      <dl className="as-meta-list">
        {metaRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {error && <p className="as-inline-error" role="alert"><AlertTriangle size={12}/> {error}</p>}
    </div>
    <div className="editor-form-footer">
      <button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button>
      <button type="button" className="editor-submit" onClick={() => void save()} disabled={saving}>
        {saving ? <><Loader2 size={14} className="as-spin"/> Saving…</> : <>Save changes</>}
      </button>
    </div>
  </ItemModalShell>;
}

/** Small dropdown menu used by the "Add audio" button. */
export function AddAudioMenu({ onUpload, onRecord, onLink, onFolder }: { onUpload: () => void; onRecord: () => void; onLink: () => void; onFolder: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return <div className="as-add-wrap" ref={wrapRef}>
    <button type="button" className="section-add-button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
      <Upload size={15}/> Add audio
    </button>
    {open && <div className="as-add-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onUpload(); }}><Upload size={14}/> Upload audio<small>MP3, WAV, M4A, AAC, OGG, FLAC</small></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onRecord(); }}><Mic size={14}/> Record audio<small>Use your device microphone</small></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onLink(); }}><Link2 size={14}/> Add audio link<small>Save a direct audio URL</small></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onFolder(); }}><FolderPlus size={14}/> Create folder<small>Organize your library</small></button>
    </div>}
  </div>;
}
