import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Check, CloudUpload, FilePlus2, FileText, FolderPlus, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import type { PdfStudioDocument, PdfStudioSaveInput, VaultFolder, VaultFolderColor } from "../types";
import { VAULT_FOLDER_COLORS } from "../lib/folders";
import { formatBytes, pageCountLabel } from "../lib/pdf-studio";
import ModalPortal from "./ModalPortal";
import ItemModalShell from "./ItemModalShell";

const NEW_FOLDER = "__new__";

export interface SaveChoice { target: "new" | "update"; input: PdfStudioSaveInput }
export interface SaveProgress { label: string; percent: number | null }

interface Props {
  /** "save" = Save to Persora from the editor; "details" = edit a saved PDF's title/folder/notes. */
  mode: "save" | "details";
  folders: VaultFolder[];
  defaults: { title: string; folderId: string | null; notes: string };
  /** The saved PDF this editor session came from (enables "Update"). */
  linkedDocument?: PdfStudioDocument | null;
  pageCount?: number;
  canSave: boolean;
  saveBlockedReason?: string;
  onUpgrade?: () => void;
  progress?: SaveProgress | null;
  onCancel: () => void;
  onSubmit: (choice: SaveChoice) => Promise<void>;
}

export default function PdfSaveModal({ mode, folders, defaults, linkedDocument = null, pageCount, canSave, saveBlockedReason, onUpgrade, progress = null, onCancel, onSubmit }: Props) {
  const titleId = useId();
  const [target, setTarget] = useState<"new" | "update">(mode === "save" && linkedDocument ? "update" : "new");
  const [title, setTitle] = useState(defaults.title);
  const [folderChoice, setFolderChoice] = useState(defaults.folderId || "");
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState<VaultFolderColor>("blue");
  const [notes, setNotes] = useState(defaults.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const orderedFolders = useMemo(() => [...folders].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)), [folders]);
  const updating = mode === "save" && target === "update" && Boolean(linkedDocument);

  // Escape closes this dialog only (not the editor underneath), unless saving.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (!saving) onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saving, onCancel]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const cleanTitle = title.trim();
    if (!updating && !cleanTitle) { setError("Give the PDF a title."); return; }
    if (!updating && folderChoice === NEW_FOLDER && !newFolderName.trim()) { setError("Name the new folder, or choose an existing one."); return; }
    if (!canSave) { setError(saveBlockedReason || "This PDF can't be saved right now."); return; }
    setSaving(true); setError("");
    try {
      await onSubmit({
        target: updating ? "update" : "new",
        input: {
          title: (updating ? linkedDocument?.title || cleanTitle : cleanTitle).slice(0, 150),
          notes: notes.trim().slice(0, 1000),
          folderId: folderChoice && folderChoice !== NEW_FOLDER ? folderChoice : null,
          newFolder: folderChoice === NEW_FOLDER ? { name: newFolderName.trim().slice(0, 64), color: newFolderColor } : null,
        },
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The PDF couldn't be saved. Try again.");
      setSaving(false);
    }
  };

  const saveLabel = mode === "details" ? "Save changes" : updating ? "Update saved PDF" : "Save PDF";
  return <ModalPortal>
    <ItemModalShell labelledBy={titleId} className="pdfs-save-modal" backdropClassName="pdfs-save-backdrop" icon={mode === "details" ? <FileText size={18}/> : <CloudUpload size={18}/>} eyebrow={mode === "details" ? "PDF details" : "Save to Persora"} title={mode === "details" ? "Edit PDF details" : "Save this PDF to your library"} onClose={onCancel} closeDisabled={saving} dismissable={!saving}>
      <form className="editor-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="vault-modal-scroll">
          <div className="editor-fields-grid">
            {mode === "save" && linkedDocument && <div className="field-wide pdfs-save-targets" role="radiogroup" aria-label="Where to save">
              <label className={`pdfs-save-target ${target === "update" ? "is-selected" : ""}`}>
                <input type="radio" name="pdfs-save-target" checked={target === "update"} onChange={() => setTarget("update")} disabled={saving}/>
                <RefreshCw size={16}/><span><b>Update “{linkedDocument.title}”</b><small>Replaces the saved file with this version. Title, folder and notes stay the same.</small></span>
              </label>
              <label className={`pdfs-save-target ${target === "new" ? "is-selected" : ""}`}>
                <input type="radio" name="pdfs-save-target" checked={target === "new"} onChange={() => setTarget("new")} disabled={saving}/>
                <FilePlus2 size={16}/><span><b>Save as a new PDF</b><small>Keeps the saved PDF unchanged and adds this version separately.</small></span>
              </label>
            </div>}
            {!updating && <>
              <label className="field-label field-wide"><span>Title<span className="required-star">*</span></span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} autoFocus placeholder="e.g. Lease agreement — signed" disabled={saving}/>
              </label>
              <label className="field-label field-wide">Folder
                <select value={folderChoice} onChange={(event) => setFolderChoice(event.target.value)} disabled={saving}>
                  <option value="">No folder</option>
                  {orderedFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                  {mode === "save" && <option value={NEW_FOLDER}>+ Create a new folder…</option>}
                </select>
              </label>
              {folderChoice === NEW_FOLDER && <div className="field-wide pdfs-new-folder">
                <label className="field-label"><span className="pdfs-new-folder-title"><FolderPlus size={13}/> New folder name</span>
                  <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={64} placeholder="e.g. Tax 2026" disabled={saving}/>
                </label>
                <div className="pdfs-color-row" role="radiogroup" aria-label="Folder colour">
                  {VAULT_FOLDER_COLORS.map((color) => <button key={color.value} type="button" role="radio" aria-checked={newFolderColor === color.value} aria-label={color.label} title={color.label} className={`pdfs-color-dot folder-color-${color.value} ${newFolderColor === color.value ? "is-selected" : ""}`} onClick={() => setNewFolderColor(color.value)} disabled={saving}>{newFolderColor === color.value && <Check size={12}/>}</button>)}
                </div>
                <small>The folder is created together with the PDF when you press Save.</small>
              </div>}
              <label className="field-label field-wide"><span>Notes <small className="pdfs-optional">optional</small></span>
                <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="What it is, who it's for, deadlines…" disabled={saving}/>
              </label>
            </>}
            {mode === "save" && <div className="field-wide pdfs-save-summary"><FileText size={14}/><span>{pageCount ? pageCountLabel(pageCount) : "Your PDF"} · built on this device{linkedDocument ? ` · saved version ${formatBytes(linkedDocument.fileSize)}` : ""}</span></div>}
            {!canSave && <div className="form-alert pdfs-plan-alert field-wide" role="note"><Lock size={13}/><span>{saveBlockedReason || "Saving is unavailable."}</span>{onUpgrade && <button type="button" className="quiet-button" onClick={onUpgrade}>View plans</button>}</div>}
            {saving && progress && <div className="field-wide pdfs-save-progress" role="status" aria-live="polite">
              <span>{progress.label}</span>
              <span className="pdfs-progress" aria-hidden="true"><i style={{ width: `${progress.percent ?? 30}%` }} className={progress.percent === null ? "is-indeterminate" : ""}/></span>
            </div>}
          </div>
        </div>
        {error && <div className="form-alert error-alert editor-error" role="alert">{error}{saving ? null : <span className="pdfs-error-retry"> Press {saveLabel} to try again.</span>}</div>}
        <div className="editor-form-footer">
          <div className="editor-footnote"><ShieldCheck size={14}/><span>{mode === "details" ? "Only the details change — the PDF file stays as it is." : "The PDF is uploaded only now, when you press Save."}</span></div>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="submit" className="editor-submit" disabled={saving || !canSave}>{saving ? <><span className="spinner"/> Saving…</> : saveLabel}</button>
          </div>
        </div>
      </form>
    </ItemModalShell>
  </ModalPortal>;
}
