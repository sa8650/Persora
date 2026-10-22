import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, ArrowDownUp, Camera, Download, Eye, FolderOpen, GitBranch, ImagePlus, ImageIcon, Loader2, Lock, Pencil, RefreshCw, Search, ShieldCheck, Trash2, Upload, Wand2 } from "lucide-react";
import type { AppUser, PhotoCategory, PhotoStudioPhoto, PhotoStudioSaveInput, VaultFolder } from "../types";
import { deletePhotoStudioPhoto, isPagesApiConfigured, listPhotoStudioPhotos, loadPhotoStudioFile, savePhotoStudioPhoto, updatePhotoStudioPhoto } from "../lib/cloud";
import {
  PHOTO_CATEGORIES, PHOTO_EDITOR_ACCEPT, PHOTO_UPLOAD_ACCEPT, SAVEABLE_PHOTO_TYPES, analysisMetadata, analyzePhoto, categoryLabel, defaultTitleFromFileName, editedFileName,
  filterPhotos, folderCounts, formatBytes, formatDimensions, isPhotoCategory, printSizeLabel, type PhotoAnalysis, type PhotoSort,
} from "../lib/photo-studio";
import { decodeImage } from "../lib/photo-studio-render";
import VaultFolderShelf from "./VaultFolderShelf";
import MoreOptionsMenu from "./MoreOptionsMenu";
import ModalPortal from "./ModalPortal";
import ItemModalShell from "./ItemModalShell";
import { ConfirmDialog } from "./VaultDialogs";
import PhotoOrganizeModal, { type OrganizeDefaults } from "./PhotoOrganizeModal";
import PhotoEditorModal, { type EditedPhoto, type EditorSource } from "./PhotoEditorModal";
import "./photo-studio.css";

interface Props {
  user: AppUser;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
  onTrashChanged?: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

/** A pending (unsaved) photo held only in browser memory. */
interface PendingPhoto {
  mode: "upload" | "edited";
  blob: Blob;
  url: string;
  fileName: string;
  analysis: PhotoAnalysis;
  defaults: OrganizeDefaults;
  sourcePhoto: PhotoStudioPhoto | null;
  editSettings: Record<string, unknown>;
  editSummary: string[];
}

const EDITOR_MAX_BYTES = 40 * 1024 * 1024;
const SORT_LABELS: Record<PhotoSort, string> = { newest: "Newest first", oldest: "Oldest first", title: "Title A–Z" };

/** Lazily fetches saved photo files into object URLs (revoked when no longer needed). */
function usePhotoFiles(photos: PhotoStudioPhoto[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const cache = useRef(new Map<string, { url: string; blob: Blob }>());
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const entries = cache.current;
    const inFlight = pending.current;
    return () => {
      mounted.current = false;
      for (const entry of entries.values()) URL.revokeObjectURL(entry.url);
      entries.clear();
      inFlight.clear();
      setUrls({});
    };
  }, []);

  useEffect(() => {
    const ids = new Set(photos.map((photo) => photo.id));
    for (const [id, entry] of cache.current) {
      if (!ids.has(id)) { URL.revokeObjectURL(entry.url); cache.current.delete(id); }
    }
    const queue = photos.filter((photo) => !cache.current.has(photo.id) && !pending.current.has(photo.id) && !failed[photo.id]).map((photo) => photo.id);
    let index = 0;
    const worker = async () => {
      while (index < queue.length && mounted.current) {
        const id = queue[index++];
        pending.current.add(id);
        try {
          const blob = await loadPhotoStudioFile(id);
          if (!mounted.current) return;
          const url = URL.createObjectURL(blob);
          cache.current.set(id, { url, blob });
          setUrls((current) => ({ ...current, [id]: url }));
        } catch {
          if (mounted.current) setFailed((current) => ({ ...current, [id]: true }));
        } finally { pending.current.delete(id); }
      }
    };
    void Promise.all([worker(), worker(), worker()]);
  }, [photos, failed]);

  const getBlob = useCallback(async (id: string): Promise<Blob> => {
    const cached = cache.current.get(id);
    if (cached) return cached.blob;
    return loadPhotoStudioFile(id);
  }, []);
  const retry = useCallback((id: string) => setFailed((current) => { const next = { ...current }; delete next[id]; return next; }), []);
  return { urls, failed, getBlob, retry };
}

async function analyzeFile(file: Blob): Promise<PhotoAnalysis> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = await decodeImage(file);
  const analysis = analyzePhoto(bytes, { width: image.naturalWidth, height: image.naturalHeight }, file.size);
  if (!analysis) throw new Error("This file isn't a supported image. Choose a JPEG, PNG or WebP photo.");
  return analysis;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.rel = "noopener";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PhotoStudioView({ user, canUpload, maxUploadMb, onUpgrade, onTrashChanged, notify }: Props) {
  const available = !user.demo && isPagesApiConfigured;
  const [photos, setPhotos] = useState<PhotoStudioPhoto[]>([]);
  const [loading, setLoading] = useState(available);
  const [loadError, setLoadError] = useState("");
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [folderReload, setFolderReload] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PhotoCategory | "all">("all");
  const [sort, setSort] = useState<PhotoSort>("newest");
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [editorSource, setEditorSource] = useState<EditorSource | null>(null);
  const [viewing, setViewing] = useState<PhotoStudioPhoto | null>(null);
  const [detailsFor, setDetailsFor] = useState<PhotoStudioPhoto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PhotoStudioPhoto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const { urls, failed, getBlob, retry } = usePhotoFiles(photos);

  const maxSaveMb = Math.max(1, Math.min(30, maxUploadMb || 25));
  const saveBlockedReason = !canUpload ? "Saving photos uses your private storage and requires an active paid plan. You can still preview and edit." : undefined;

  const loadPhotos = useCallback(async () => {
    if (!available) return;
    setLoading(true); setLoadError("");
    try { setPhotos(await listPhotoStudioPhotos()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Your photos couldn't be loaded."); }
    finally { setLoading(false); }
  }, [available]);
  useEffect(() => { void loadPhotos(); }, [loadPhotos]);

  // Release the in-memory pending photo whenever it's replaced or discarded.
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending]);

  const photoById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const counts = useMemo(() => folderCounts(photos), [photos]);
  const categoryCounts = useMemo(() => {
    const scoped = selectedFolderId ? photos.filter((photo) => photo.folderId === selectedFolderId) : photos;
    const result: Record<string, number> = { all: scoped.length };
    for (const photo of scoped) result[photo.category] = (result[photo.category] || 0) + 1;
    return result;
  }, [photos, selectedFolderId]);
  const visible = useMemo(() => filterPhotos(photos, { query, category, folderId: selectedFolderId, sort }), [photos, query, category, selectedFolderId, sort]);
  const folderName = (id: string | null) => (id ? folders.find((folder) => folder.id === id)?.name : "") || "";

  // ----- Upload & Organize ---------------------------------------------------
  const startUpload = () => uploadInputRef.current?.click();
  const onUploadSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!SAVEABLE_PHOTO_TYPES.has(file.type)) { notify("Upload & Organize accepts JPEG, PNG or WebP photos. Use Create & Edit to convert other images.", "error"); return; }
    if (file.size > maxSaveMb * 1024 * 1024) { notify(`Photos must be ${maxSaveMb} MB or smaller.`, "error"); return; }
    setPreparing(true);
    try {
      const analysis = await analyzeFile(file);
      if (!SAVEABLE_PHOTO_TYPES.has(analysis.mime)) throw new Error("This file's contents aren't a JPEG, PNG or WebP photo.");
      setPending({
        mode: "upload", blob: file, url: URL.createObjectURL(file), fileName: file.name, analysis, sourcePhoto: null, editSettings: {}, editSummary: [],
        defaults: { title: defaultTitleFromFileName(file.name), category: (analysis.preset?.category as PhotoCategory) || "passport", folderId: selectedFolderId || null, notes: "" },
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "This photo couldn't be read.", "error");
    } finally { setPreparing(false); }
  };

  // ----- Create & Edit -------------------------------------------------------
  const openEditorWithFile = (file: File) => {
    if (file.size > EDITOR_MAX_BYTES) { notify("Choose an image of 40 MB or less.", "error"); return; }
    setChooserOpen(false);
    setEditorSource({ blob: file, name: file.name, photo: null });
  };
  const openEditorWithPhoto = async (photo: PhotoStudioPhoto) => {
    setPreparing(true);
    try {
      const blob = await getBlob(photo.id);
      setChooserOpen(false); setViewing(null);
      setEditorSource({ blob, name: photo.fileName, photo });
    } catch (error) {
      notify(error instanceof Error ? error.message : "That photo couldn't be opened.", "error");
    } finally { setPreparing(false); }
  };
  const onEditorResult = (result: EditedPhoto) => {
    const sourcePhoto = editorSource?.photo || null;
    const baseTitle = sourcePhoto ? `${sourcePhoto.title} (edited)` : defaultTitleFromFileName(editorSource?.name || "Portrait");
    const fallbackCategory = sourcePhoto?.category || (result.presetCategory && isPhotoCategory(result.presetCategory) ? result.presetCategory : "passport");
    setPending({
      mode: "edited", blob: result.blob, url: URL.createObjectURL(result.blob), fileName: editedFileName(baseTitle, result.mime), analysis: result.analysis,
      sourcePhoto, editSettings: result.editSettings, editSummary: result.editSummary,
      defaults: { title: baseTitle.slice(0, 120), category: fallbackCategory, folderId: sourcePhoto?.folderId || selectedFolderId || null, notes: "" },
    });
  };

  // ----- Final Save (the only write) ----------------------------------------
  const savePending = async (fields: Pick<PhotoStudioSaveInput, "title" | "category" | "notes" | "folderId" | "newFolder">) => {
    if (!pending) return;
    const input: PhotoStudioSaveInput = {
      ...fields,
      sourcePhotoId: pending.sourcePhoto?.id || null,
      dpi: pending.analysis.dpi,
      fileName: pending.fileName,
      metadata: analysisMetadata(pending.analysis),
      editSettings: pending.mode === "edited" ? pending.editSettings : {},
    };
    const result = await savePhotoStudioPhoto(pending.blob, pending.fileName, input);
    setPhotos((current) => [result.photo, ...current.filter((photo) => photo.id !== result.photo.id)]);
    if (result.folder && !folders.some((folder) => folder.id === result.folder?.id)) {
      setFolders((current) => [...current, result.folder as VaultFolder]);
      setFolderReload((value) => value + 1);
    }
    const wasEdit = pending.mode === "edited";
    setPending(null);
    if (wasEdit) setEditorSource(null);
    notify(wasEdit ? `Saved “${result.photo.title}” as a new photo${pending.sourcePhoto ? " — the original is unchanged" : ""}.` : `Saved “${result.photo.title}”.`);
  };

  const saveDetails = async (fields: Pick<PhotoStudioSaveInput, "title" | "category" | "notes" | "folderId" | "newFolder">) => {
    if (!detailsFor) return;
    const updated = await updatePhotoStudioPhoto(detailsFor.id, { title: fields.title, category: fields.category, notes: fields.notes, folderId: fields.folderId });
    setPhotos((current) => current.map((photo) => photo.id === updated.id ? updated : photo));
    if (viewing?.id === updated.id) setViewing(updated);
    setDetailsFor(null);
    notify("Photo details updated.");
  };

  const movePhoto = async (photo: PhotoStudioPhoto, folderId: string | null) => {
    try {
      const updated = await updatePhotoStudioPhoto(photo.id, { folderId });
      setPhotos((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      notify(folderId ? `Moved to “${folderName(folderId)}”.` : "Removed from its folder.");
    } catch (error) { notify(error instanceof Error ? error.message : "The photo couldn't be moved.", "error"); }
  };

  const downloadPhoto = async (photo: PhotoStudioPhoto) => {
    try { downloadBlob(await getBlob(photo.id), editedFileName(photo.title, photo.fileType)); }
    catch (error) { notify(error instanceof Error ? error.message : "The photo couldn't be downloaded.", "error"); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deletePhotoStudioPhoto(deleteTarget.id);
      setPhotos((current) => current.filter((photo) => photo.id !== deleteTarget.id));
      if (viewing?.id === deleteTarget.id) setViewing(null);
      notify(`“${deleteTarget.title}” moved to the Trash. You can restore it for 7 days.`);
      setDeleteTarget(null);
      onTrashChanged?.();
    } catch (error) { notify(error instanceof Error ? error.message : "The photo couldn't be deleted.", "error"); }
    finally { setDeleting(false); }
  };

  const heading = <div className="section-page-heading"><div><div className="section-page-eyebrow"><span className="section-mini-icon tag-blue"><Camera size={13}/></span>Official photos</div><h2>Photo Studio</h2><p>Keep passport, visa, ID and application photos ready — sized correctly and organized in one private place.</p></div><div className="section-heading-aside"><div className="section-aside-art"><div className="aside-orbit"/><Camera size={44} strokeWidth={1.1}/><div className="aside-art-bottom"><span>PHOTOS</span><span>{String(photos.length).padStart(2, "0")}</span></div></div><div className="aside-note"><ShieldCheck size={13}/><span>Private to your account · edits run on this device</span></div></div></div>;

  if (!available) {
    return <div className="section-view ps-page">{heading}<div className="section-empty"><div className="empty-icon-stack"><div className="empty-icon-circle tag-blue"><Lock size={21}/></div><span>✦</span></div><h3>Photo Studio needs a Persora account</h3><p>Saved photos live in your private cloud storage, so Photo Studio is available after signing in to a connected Persora account.</p></div></div>;
  }

  const primaryActions = <>
    <button type="button" className="section-add-button ps-upload-button" onClick={startUpload} disabled={preparing}><Upload size={15}/> Upload &amp; Organize</button>
    <button type="button" className="section-add-button" onClick={() => setChooserOpen(true)} disabled={preparing}><Wand2 size={15}/> Create &amp; Edit</button>
  </>;

  return <div className="section-view ps-page">
    {heading}
    <input ref={uploadInputRef} className="hidden-file-input" type="file" accept={PHOTO_UPLOAD_ACCEPT} onChange={(event) => void onUploadSelected(event)} aria-label="Choose a photo to upload"/>
    <VaultFolderShelf userId={user.id} scope="photo-studio" pageLabel="Photos" demoMode={false} totalCount={photos.length} folderCounts={counts} selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} onFoldersChange={setFolders} notify={notify} reloadToken={folderReload}/>
    <div className="section-toolbar ps-toolbar">
      <div className="filter-tabs" role="tablist" aria-label="Photo categories">
        <button type="button" role="tab" aria-selected={category === "all"} className={category === "all" ? "filter-active" : ""} onClick={() => setCategory("all")}>All<span>{categoryCounts.all || 0}</span></button>
        {PHOTO_CATEGORIES.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={category === entry.id} className={category === entry.id ? "filter-active" : ""} onClick={() => setCategory(entry.id)}>{entry.label}<span>{categoryCounts[entry.id] || 0}</span></button>)}
      </div>
      <div className="section-toolbar-actions ps-toolbar-actions">
        <label className="ps-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search photos…" aria-label="Search photos"/></label>
        <label className="ps-sort" title="Sort photos"><ArrowDownUp size={14}/><select value={sort} onChange={(event) => setSort(event.target.value as PhotoSort)} aria-label="Sort photos">{(Object.keys(SORT_LABELS) as PhotoSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}</select></label>
        {primaryActions}
      </div>
    </div>
    <div className="section-list-meta"><span><b>{String(visible.length).padStart(2, "0")}</b> {visible.length === 1 ? "photo" : "photos"}{selectedFolderId ? ` in ${folderName(selectedFolderId) || "this folder"}` : ""}</span><span className="list-meta-private"><ShieldCheck size={12}/> Nothing is uploaded until you press Save</span></div>
    {preparing && <div className="ps-preparing" role="status"><Loader2 className="ps-spin" size={15}/> Reading your photo on this device…</div>}

    {loading ? <div className="ps-grid" aria-busy="true" aria-label="Loading photos">{[0, 1, 2, 3].map((key) => <div key={key} className="ps-card ps-card-skeleton"><div className="ps-card-media"/><div className="ps-card-body"><span/><span/></div></div>)}</div>
    : loadError ? <div className="section-empty" role="alert"><div className="empty-icon-stack"><div className="empty-icon-circle tag-red"><AlertTriangle size={21}/></div></div><h3>Your photos couldn't be loaded</h3><p>{loadError}</p><button type="button" className="quiet-button" onClick={() => void loadPhotos()}><RefreshCw size={15}/> Try again</button></div>
    : visible.length ? <div className="ps-grid">{visible.map((photo) => {
      const source = photo.sourcePhotoId ? photoById.get(photo.sourcePhotoId) : null;
      const print = printSizeLabel(photo.width, photo.height, photo.dpi);
      return <article key={photo.id} className="ps-card">
        <button type="button" className="ps-card-media ps-checker" onClick={() => setViewing(photo)} aria-label={`View ${photo.title}`}>
          {urls[photo.id] ? <img src={urls[photo.id]} alt="" loading="lazy"/> : failed[photo.id] ? <span className="ps-thumb-failed"><ImageIcon size={20}/><small>Preview unavailable</small></span> : <span className="ps-thumb-loading" aria-label="Loading preview"/>}
          {photo.sourcePhotoId && <span className="ps-edited-badge"><GitBranch size={11}/> Edited</span>}
        </button>
        <div className="ps-card-body">
          <div className="ps-card-title"><h3 title={photo.title}>{photo.title}</h3>
            <MoreOptionsMenu label={`${photo.title} options`} folders={folders} folderId={photo.folderId || ""} onMoveFolder={(folderId) => void movePhoto(photo, folderId || null)} actions={[
              { label: "View photo", icon: Eye, onSelect: () => setViewing(photo) },
              { label: "Edit a copy", icon: Wand2, onSelect: () => void openEditorWithPhoto(photo) },
              { label: "Download", icon: Download, onSelect: () => void downloadPhoto(photo) },
              { label: "Edit details", icon: Pencil, onSelect: () => setDetailsFor(photo) },
              { label: "Delete photo", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(photo) },
            ]}/>
          </div>
          <div className="ps-card-chips"><span className={`ps-chip ps-chip-${photo.category}`}>{categoryLabel(photo.category)}</span>{photo.folderId && folderName(photo.folderId) && <span className="ps-chip ps-chip-folder"><FolderOpen size={10}/>{folderName(photo.folderId)}</span>}</div>
          <p className="ps-card-meta">{formatDimensions(photo.width, photo.height)}{print ? ` · ${print}` : ""}</p>
          <p className="ps-card-sub">{photo.fileType.replace("image/", "").toUpperCase()} · {formatBytes(photo.fileSize)}{photo.dpi ? ` · ${Math.round(photo.dpi)} DPI` : ""}{photo.sourcePhotoId ? ` · from ${source ? `“${source.title}”` : "a deleted original"}` : ""}</p>
          {failed[photo.id] && <button type="button" className="ps-link-button" onClick={() => retry(photo.id)}><RefreshCw size={12}/> Retry preview</button>}
        </div>
      </article>;
    })}</div>
    : <div className="section-empty ps-empty"><div className="empty-icon-stack"><div className="empty-icon-circle tag-blue"><ImagePlus size={21}/></div><span>✦</span></div>
      <h3>{photos.length ? "No photos match" : "No official photos yet"}</h3>
      <p>{photos.length ? "Try another search, category or folder." : "Upload a ready-made passport or ID photo, or create one from any portrait — crop to official sizes, remove the background and save."}</p>
      {!photos.length && <div className="ps-empty-actions">{primaryActions}</div>}
    </div>}

    {chooserOpen && <CreateChooser photos={photos} urls={urls} preparing={preparing} onClose={() => setChooserOpen(false)} onFile={openEditorWithFile} onPhoto={(photo) => void openEditorWithPhoto(photo)} notify={notify}/>}
    {editorSource && <PhotoEditorModal source={editorSource} cloudAvailable={isPagesApiConfigured && !user.demo} organizing={Boolean(pending && pending.mode === "edited")} onClose={() => { setEditorSource(null); setPending(null); }} onSaveAndOrganize={onEditorResult}/>}
    {pending && <PhotoOrganizeModal
      key={pending.url}
      mode={pending.mode}
      previewUrl={pending.url}
      analysis={pending.analysis}
      folders={folders}
      defaults={pending.defaults}
      editSummary={pending.editSummary}
      sourceTitle={pending.sourcePhoto?.title || null}
      canSave={canUpload}
      saveBlockedReason={saveBlockedReason}
      onUpgrade={onUpgrade}
      onCancel={() => setPending(null)}
      onSave={savePending}
    />}
    {detailsFor && <PhotoOrganizeModal
      mode="details"
      previewUrl={urls[detailsFor.id] || null}
      analysis={null}
      photo={detailsFor}
      folders={folders}
      defaults={{ title: detailsFor.title, category: detailsFor.category, folderId: detailsFor.folderId, notes: detailsFor.notes }}
      canSave
      onCancel={() => setDetailsFor(null)}
      onSave={saveDetails}
    />}
    {viewing && <PhotoViewer photo={viewing} url={urls[viewing.id] || null} source={viewing.sourcePhotoId ? photoById.get(viewing.sourcePhotoId) || null : null} versions={photos.filter((photo) => photo.sourcePhotoId === viewing.id)} folder={folderName(viewing.folderId)} onClose={() => setViewing(null)} onOpen={(photo) => setViewing(photo)} onDownload={() => void downloadPhoto(viewing)} onEdit={() => void openEditorWithPhoto(viewing)} onDetails={() => setDetailsFor(viewing)} onDelete={() => setDeleteTarget(viewing)}/>}
    {deleteTarget && <ModalPortal><ConfirmDialog title={`Delete “${deleteTarget.title}”?`} confirmLabel={deleting ? "Deleting…" : "Move to Trash"} onCancel={() => !deleting && setDeleteTarget(null)} onConfirm={() => void confirmDelete()}><p>The photo moves to the Trash and can be restored for 7 days. {photos.some((photo) => photo.sourcePhotoId === deleteTarget.id) ? "Edited versions made from it are kept." : ""}</p></ConfirmDialog></ModalPortal>}
  </div>;
}

function CreateChooser({ photos, urls, preparing, onClose, onFile, onPhoto, notify }: { photos: PhotoStudioPhoto[]; urls: Record<string, string>; preparing: boolean; onClose: () => void; onFile: (file: File) => void; onPhoto: (photo: PhotoStudioPhoto) => void; notify: (message: string, kind?: "success" | "error") => void }) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const list = useMemo(() => filterPhotos(photos, { query: search, category: "all", folderId: "", sort: "newest" }), [photos, search]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !preparing) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, preparing]);
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { notify("Choose an image file (JPEG, PNG, WebP, GIF or BMP).", "error"); return; }
    onFile(file);
  };
  return <ModalPortal>
    <ItemModalShell labelledBy={titleId} className="ps-chooser-modal" icon={<Wand2 size={18}/>} eyebrow="Create & edit" title="Choose a photo to edit" onClose={onClose} closeDisabled={preparing} dismissable={!preparing}>
      <div className="vault-modal-scroll ps-chooser-body">
        <button type="button" className="ps-chooser-upload" onClick={() => inputRef.current?.click()} disabled={preparing}>
          <span className="upload-circle"><Upload size={18}/></span>
          <span><b>Upload a new portrait</b><small>Any clear, front-facing photo — JPEG, PNG, WebP, GIF or BMP. It stays on this device while you edit.</small></span>
        </button>
        <input ref={inputRef} type="file" className="hidden-file-input" accept={PHOTO_EDITOR_ACCEPT} onChange={pick} aria-label="Choose a portrait to edit"/>
        <div className="ps-chooser-heading"><b>Or start from a saved photo</b><small>Edits are saved as a new photo; the original stays unchanged.</small></div>
        {photos.length ? <>
          <label className="ps-search ps-chooser-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved photos…" aria-label="Search saved photos"/></label>
          <div className="ps-chooser-grid">{list.map((photo) => <button key={photo.id} type="button" className="ps-chooser-item" onClick={() => onPhoto(photo)} disabled={preparing}>
            <span className="ps-checker">{urls[photo.id] ? <img src={urls[photo.id]} alt=""/> : <span className="ps-thumb-loading"/>}</span>
            <b>{photo.title}</b><small>{categoryLabel(photo.category)} · {formatDimensions(photo.width, photo.height)}</small>
          </button>)}</div>
          {!list.length && <p className="ps-muted-note">No saved photos match “{search}”.</p>}
        </> : <p className="ps-muted-note">You haven't saved any photos yet.</p>}
        {preparing && <div className="ps-preparing" role="status"><Loader2 className="ps-spin" size={15}/> Opening photo…</div>}
      </div>
    </ItemModalShell>
  </ModalPortal>;
}

function PhotoViewer({ photo, url, source, versions, folder, onClose, onOpen, onDownload, onEdit, onDetails, onDelete }: { photo: PhotoStudioPhoto; url: string | null; source: PhotoStudioPhoto | null; versions: PhotoStudioPhoto[]; folder: string; onClose: () => void; onOpen: (photo: PhotoStudioPhoto) => void; onDownload: () => void; onEdit: () => void; onDetails: () => void; onDelete: () => void }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const print = printSizeLabel(photo.width, photo.height, photo.dpi);
  const edit = photo.editSettings;
  const rows: [string, string][] = [
    ["Category", categoryLabel(photo.category)],
    ["Folder", folder || "No folder"],
    ["Dimensions", formatDimensions(photo.width, photo.height)],
    ["Aspect ratio", String(photo.metadata.aspectRatio || "—")],
    ["Resolution", photo.dpi ? `${Math.round(photo.dpi)} DPI` : "Not stored"],
    ["Print size", print || "—"],
    ["Format", `${photo.fileType.replace("image/", "").toUpperCase()} · ${formatBytes(photo.fileSize)}`],
    ["Saved", new Date(photo.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })],
  ];
  if (photo.metadata.presetLabel) rows.splice(6, 0, ["Size preset", String(photo.metadata.presetLabel)]);
  if (edit.backgroundRemoval) rows.push(["Background", `${edit.backgroundRemoval === "cloud" ? "Removed with Persora AI" : "Removed on device"}${edit.backgroundColor ? ` · ${String(edit.backgroundColor).toUpperCase()}` : ""}`]);
  return <ModalPortal>
    <ItemModalShell labelledBy={titleId} className="ps-viewer-modal" icon={<Camera size={18}/>} eyebrow="Photo Studio" title={photo.title} onClose={onClose}>
      <div className="vault-modal-scroll ps-viewer-body">
        <div className="ps-viewer-image ps-checker">{url ? <img src={url} alt={photo.title}/> : <span className="ps-thumb-loading"/>}</div>
        <div className="ps-viewer-side">
          <dl className="ps-meta-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {photo.notes && <p className="ps-viewer-notes">{photo.notes}</p>}
          {photo.sourcePhotoId && <p className="ps-version-line"><GitBranch size={12}/> Edited version of {source ? <button type="button" className="ps-link-button" onClick={() => onOpen(source)}>“{source.title}”</button> : "a photo that was deleted"}</p>}
          {versions.length > 0 && <div className="ps-version-list"><b>Edited versions</b>{versions.map((version) => <button key={version.id} type="button" className="ps-link-button" onClick={() => onOpen(version)}><GitBranch size={12}/> {version.title}</button>)}</div>}
        </div>
      </div>
      <div className="editor-form-footer ps-viewer-footer">
        <button type="button" className="quiet-button ps-danger" onClick={onDelete}><Trash2 size={14}/> Delete</button>
        <div className="editor-actions">
          <button type="button" className="quiet-button" onClick={onDetails}><Pencil size={14}/> Details</button>
          <button type="button" className="quiet-button" onClick={onDownload}><Download size={14}/> Download</button>
          <button type="button" className="editor-submit" onClick={onEdit}><Wand2 size={14}/> Edit a copy</button>
        </div>
      </div>
    </ItemModalShell>
  </ModalPortal>;
}
