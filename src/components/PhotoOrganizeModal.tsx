import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Check, FolderPlus, ImageIcon, Info, Lock, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { PhotoCategory, PhotoStudioPhoto, PhotoStudioSaveInput, VaultFolder, VaultFolderColor } from "../types";
import { VAULT_FOLDER_COLORS } from "../lib/folders";
import { PHOTO_CATEGORIES, formatBytes, formatDimensions, type PhotoAnalysis } from "../lib/photo-studio";
import ItemModalShell from "./ItemModalShell";
import ModalPortal from "./ModalPortal";

const NEW_FOLDER = "__new__";

export interface OrganizeDefaults {
  title: string;
  category: PhotoCategory;
  folderId: string | null;
  notes: string;
}

interface Props {
  /** upload = Upload & Organize, edited = Save & Organize from the editor, details = edit saved metadata. */
  mode: "upload" | "edited" | "details";
  previewUrl: string | null;
  analysis: PhotoAnalysis | null;
  /** Saved photo being described (details mode) — its stored metadata is shown. */
  photo?: PhotoStudioPhoto | null;
  folders: VaultFolder[];
  defaults: OrganizeDefaults;
  /** Edit summary lines shown for edited versions (e.g. "Background: white"). */
  editSummary?: string[];
  sourceTitle?: string | null;
  canSave: boolean;
  saveBlockedReason?: string;
  onUpgrade?: () => void;
  onCancel: () => void;
  /** Persists; throw to keep the modal open with the error shown. */
  onSave: (input: Pick<PhotoStudioSaveInput, "title" | "category" | "notes" | "folderId" | "newFolder">) => Promise<void>;
}

/**
 * The single organise modal shared by Upload & Organize, the editor's Save &
 * Organize and Edit details. It only collects fields; nothing is stored until
 * `onSave` runs from the final Save button.
 */
export default function PhotoOrganizeModal({ mode, previewUrl, analysis, photo, folders, defaults, editSummary, sourceTitle, canSave, saveBlockedReason, onUpgrade, onCancel, onSave }: Props) {
  const titleId = useId();
  const [title, setTitle] = useState(defaults.title);
  const [category, setCategory] = useState<PhotoCategory>(defaults.category);
  const [folderChoice, setFolderChoice] = useState<string>(defaults.folderId && folders.some((folder) => folder.id === defaults.folderId) ? defaults.folderId : "");
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState<VaultFolderColor>("blue");
  const [notes, setNotes] = useState(defaults.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) { event.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saving, onCancel]);

  const orderedFolders = useMemo(() => [...folders].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)), [folders]);
  const width = analysis?.width ?? photo?.width ?? 0;
  const height = analysis?.height ?? photo?.height ?? 0;
  const dpi = analysis ? analysis.dpi : photo?.dpi ?? null;
  const rows: [string, string][] = [
    ["Format", analysis?.format || (photo ? photo.fileType.replace("image/", "").toUpperCase() : "—")],
    ["Dimensions", formatDimensions(width, height)],
    ["Aspect ratio", analysis?.aspect || String(photo?.metadata.aspectRatio || "—")],
    ["Resolution", dpi ? `${Math.round(dpi)} DPI${analysis?.dpiSource ? ` · from ${analysis.dpiSource}` : ""}` : "Not stored in file"],
    ["Print size", analysis?.printSize || String(photo?.metadata.printSize || "—")],
    ["File size", formatBytes(analysis?.fileSize ?? photo?.fileSize ?? 0)],
  ];
  const presetText = analysis?.preset ? `${analysis.preset.label} · ${analysis.preset.detail}` : photo?.metadata.presetLabel ? String(photo.metadata.presetLabel) : "";
  const presetExact = analysis ? analysis.presetExact : Boolean(photo?.metadata.presetExact);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) { setError("Give the photo a title."); return; }
    if (folderChoice === NEW_FOLDER && !newFolderName.trim()) { setError("Name the new folder, or choose an existing one."); return; }
    if (!canSave) { setError(saveBlockedReason || "This photo can't be saved right now."); return; }
    setSaving(true); setError("");
    try {
      await onSave({
        title: cleanTitle.slice(0, 120),
        category,
        notes: notes.trim().slice(0, 1000),
        folderId: folderChoice && folderChoice !== NEW_FOLDER ? folderChoice : null,
        newFolder: folderChoice === NEW_FOLDER ? { name: newFolderName.trim().slice(0, 64), color: newFolderColor } : null,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The photo couldn't be saved. Try again.");
      setSaving(false);
    }
  };

  const eyebrow = mode === "upload" ? "Upload & organize" : mode === "edited" ? "Save & organize" : "Photo details";
  const heading = mode === "upload" ? "Review and organize your photo" : mode === "edited" ? "Save your edited photo" : "Edit photo details";
  const saveLabel = mode === "details" ? "Save changes" : "Save photo";

  return <ModalPortal>
    <ItemModalShell labelledBy={titleId} className="ps-organize-modal" backdropClassName="ps-organize-backdrop" icon={mode === "edited" ? <Sparkles size={18}/> : <ImageIcon size={18}/>} eyebrow={eyebrow} title={heading} onClose={onCancel} closeDisabled={saving} dismissable={!saving}>
      <form className="editor-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="vault-modal-scroll ps-organize-body">
          <div className="ps-organize-preview">
            <div className="ps-checker ps-organize-image">{previewUrl ? <img src={previewUrl} alt="Photo preview"/> : <span className="ps-thumb-loading" aria-label="Loading preview"/>}</div>
            {presetText && <div className={`ps-preset-match ${presetExact ? "is-exact" : ""}`}>{presetExact ? <Check size={13}/> : <Info size={13}/>}<span>{presetExact ? "Matches" : "Same shape as"} <b>{presetText}</b></span></div>}
            <dl className="ps-meta-list" aria-label="Detected photo details">
              {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            {mode !== "details" && <p className="ps-meta-note"><ShieldCheck size={12}/> Detected on this device from the file itself — no AI or upload involved.</p>}
            {analysis?.warnings.length ? <ul className="ps-warnings">{analysis.warnings.map((warning) => <li key={warning}><AlertTriangle size={12}/>{warning}</li>)}</ul> : null}
            {editSummary?.length ? <div className="ps-edit-summary"><b>Edits</b><ul>{editSummary.map((line) => <li key={line}>{line}</li>)}</ul>{sourceTitle && <small>New version of “{sourceTitle}”. The original stays unchanged.</small>}</div> : null}
          </div>
          <div className="editor-fields-grid ps-organize-fields">
            <label className="field-label field-wide"><span>Title<span className="required-star">*</span></span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} autoFocus placeholder="e.g. Passport photo 2026" disabled={saving}/>
            </label>
            <label className="field-label field-wide">Folder
              <select value={folderChoice} onChange={(event) => setFolderChoice(event.target.value)} disabled={saving}>
                <option value="">No folder</option>
                {orderedFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                {mode !== "details" && <option value={NEW_FOLDER}>+ Create a new folder…</option>}
              </select>
            </label>
            {folderChoice === NEW_FOLDER && <div className="field-wide ps-new-folder">
              <label className="field-label"><span className="ps-new-folder-title"><FolderPlus size={13}/> New folder name</span>
                <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={64} placeholder="e.g. Visa applications" disabled={saving}/>
              </label>
              <div className="ps-color-row" role="radiogroup" aria-label="Folder colour">
                {VAULT_FOLDER_COLORS.map((color) => <button key={color.value} type="button" role="radio" aria-checked={newFolderColor === color.value} aria-label={color.label} title={color.label} className={`ps-color-dot folder-color-${color.value} ${newFolderColor === color.value ? "is-selected" : ""}`} onClick={() => setNewFolderColor(color.value)} disabled={saving}>{newFolderColor === color.value && <Check size={11}/>}</button>)}
              </div>
              <small>The folder is created together with the photo when you press Save.</small>
            </div>}
            <fieldset className="field-wide ps-category-field" disabled={saving}>
              <legend>Category</legend>
              <div className="ps-category-grid">
                {PHOTO_CATEGORIES.map((entry) => <label key={entry.id} className={`ps-category-option ${category === entry.id ? "is-selected" : ""}`}>
                  <input type="radio" name="ps-category" value={entry.id} checked={category === entry.id} onChange={() => setCategory(entry.id)}/>
                  <b>{entry.label}</b><small>{entry.hint}</small>
                </label>)}
              </div>
            </fieldset>
            <label className="field-label field-wide"><span>Notes <small className="ps-optional">optional</small></span>
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Where it's used, requirements, expiry…" disabled={saving}/>
            </label>
            {!canSave && <div className="form-alert ps-plan-alert field-wide" role="note"><Lock size={13}/><span>{saveBlockedReason || "Saving is unavailable."}</span>{onUpgrade && <button type="button" className="quiet-button" onClick={onUpgrade}>View plans</button>}</div>}
          </div>
        </div>
        {error && <div className="form-alert error-alert editor-error" role="alert">{error}{saving ? null : <span className="ps-error-retry"> <RefreshCw size={11}/> Press {saveLabel} to try again.</span>}</div>}
        <div className="editor-form-footer">
          <div className="editor-footnote"><ShieldCheck size={14}/><span>{mode === "details" ? "Only the details change — the photo file stays as it is." : "Nothing is uploaded until you press Save."}</span></div>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="submit" className="editor-submit" disabled={saving || !canSave}>{saving ? <><span className="spinner"/> Saving…</> : saveLabel}</button>
          </div>
        </div>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}
