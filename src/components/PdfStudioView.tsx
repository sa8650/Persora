import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowDownUp, Download, FilePlus2, FileStack, FileText, FolderOpen, FolderInput, Image as ImageIcon, Info, Lock, Pencil, RefreshCw, Search, ShieldCheck, Trash2, Upload, WandSparkles } from "lucide-react";
import type { AppUser, PdfStudioDocument, PdfStudioFileMeta, PdfStudioSaveInput, TransferProgress, VaultFolder } from "../types";
import { deletePdfStudioDocument, isPagesApiConfigured, listPdfStudioDocuments, loadPdfStudioFile, replacePdfStudioFile, savePdfStudioDocument, updatePdfStudioDocument } from "../lib/cloud";
import { CREATE_ACCEPT, PDF_ACCEPT, SUPPORTED_INPUTS_LABEL, filterDocuments, folderCounts, formatBytes, pageCountLabel, pdfDownloadName, type PdfSort } from "../lib/pdf-studio";
import VaultFolderShelf from "./VaultFolderShelf";
import MoreOptionsMenu from "./MoreOptionsMenu";
import ModalPortal from "./ModalPortal";
import { ConfirmDialog } from "./VaultDialogs";
import PdfSaveModal from "./PdfSaveModal";
import type { EditorRequest, PdfSaveHandlers } from "./PdfEditorModal";
import "./pdf-studio.css";

// The editor and Create PDF flows pull in PDF.js / pdf-lib, so they load only when opened.
const PdfEditorModal = lazy(() => import("./PdfEditorModal"));
const PdfCreateModal = lazy(() => import("./PdfCreateModal"));

interface Props {
  user: AppUser;
  canUpload: boolean;
  maxUploadMb: number;
  onUpgrade?: () => void;
  onTrashChanged?: () => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

const SORT_LABELS: Record<PdfSort, string> = { updated: "Recently updated", newest: "Newest first", title: "Title A–Z", size: "Largest first" };

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName; link.rel = "noopener";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function dateLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

/** A work-area card that accepts dropped files. */
function DropCard({ icon, tone, title, copy, chips, dropLabel, onFiles, children }: { icon: ReactNode; tone: string; title: string; copy: string; chips: string[]; dropLabel: string; onFiles: (files: File[]) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return <section
    className={`pdfs-workarea ${over ? "is-dragover" : ""}`}
    aria-label={title}
    onDragEnter={(event) => { if (!hasFiles(event)) return; event.preventDefault(); depth.current += 1; setOver(true); }}
    onDragOver={(event) => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
    onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
    onDrop={(event) => { if (!hasFiles(event)) return; event.preventDefault(); depth.current = 0; setOver(false); const files = Array.from(event.dataTransfer.files || []); if (files.length) onFiles(files); }}
  >
    <div className="pdfs-workarea-head">
      <span className={`pdfs-workarea-icon ${tone}`}>{icon}</span>
      <div><h3>{title}</h3><p>{copy}</p></div>
    </div>
    <div className="pdfs-workarea-drop" aria-hidden={!over}>
      <Upload size={16}/><span>{over ? "Release to add" : dropLabel}</span>
    </div>
    <div className="pdfs-workarea-chips">{chips.map((chip) => <span key={chip}>{chip}</span>)}</div>
    <div className="pdfs-workarea-actions">{children}</div>
  </section>;
}

export default function PdfStudioView({ user, canUpload, maxUploadMb, onUpgrade, onTrashChanged, notify }: Props) {
  const available = !user.demo && isPagesApiConfigured;
  const [documents, setDocuments] = useState<PdfStudioDocument[]>([]);
  const [loading, setLoading] = useState(available);
  const [loadError, setLoadError] = useState("");
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [folderReload, setFolderReload] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PdfSort>("updated");
  const [createFiles, setCreateFiles] = useState<File[] | null>(null);
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [opening, setOpening] = useState("");
  const [detailsFor, setDetailsFor] = useState<PdfStudioDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PdfStudioDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const openInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const saveBlockedReason = !available
    ? "Saving to Persora needs a signed-in Persora account. You can still download your PDF."
    : !canUpload ? "Saving PDFs uses your private storage and requires an active paid plan. You can still download your PDF." : undefined;

  const loadDocuments = useCallback(async () => {
    if (!available) return;
    setLoading(true); setLoadError("");
    try { setDocuments(await listPdfStudioDocuments()); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Your PDFs couldn't be loaded."); }
    finally { setLoading(false); }
  }, [available]);
  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  const counts = useMemo(() => folderCounts(documents), [documents]);
  const visible = useMemo(() => filterDocuments(documents, { query, folderId: selectedFolderId, sort }), [documents, query, selectedFolderId, sort]);
  const folderName = (id: string | null) => (id ? folders.find((folder) => folder.id === id)?.name : "") || "";

  // ----- Entry points ------------------------------------------------------
  const startCreate = (files: File[] = []) => setCreateFiles(files);
  const openFiles = (files: File[]) => {
    if (!files.length) return;
    const pdfs = files.filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    // Images or text dropped on "Edit PDF" belong in Create PDF.
    if (!pdfs.length) { startCreate(files); return; }
    if (pdfs.length < files.length) notify("Only the PDF files were opened. Use Create PDF to combine images or text.", "error");
    setEditor({ kind: "files", files: pdfs });
  };
  const onOpenSelected = (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files || []); event.target.value = ""; openFiles(files); };
  const onCreateSelected = (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) startCreate(files); };

  const openSaved = async (doc: PdfStudioDocument) => {
    if (opening) return;
    setOpening(doc.id);
    try {
      const blob = await loadPdfStudioFile(doc.id);
      setEditor({ kind: "saved", document: doc, bytes: new Uint8Array(await blob.arrayBuffer()) });
    } catch (error) {
      notify(error instanceof Error ? error.message : "That PDF couldn't be opened.", "error");
    } finally { setOpening(""); }
  };

  const downloadSaved = async (doc: PdfStudioDocument) => {
    try { downloadBlob(await loadPdfStudioFile(doc.id), pdfDownloadName(doc.title)); }
    catch (error) { notify(error instanceof Error ? error.message : "The PDF couldn't be downloaded.", "error"); }
  };

  // ----- Saving (only on explicit "Save to Persora") -----------------------
  const rememberFolder = (folder: VaultFolder | null) => {
    if (folder && !folders.some((entry) => entry.id === folder.id)) {
      setFolders((current) => [...current, folder]);
      setFolderReload((value) => value + 1);
    }
  };
  const saveHandlers: PdfSaveHandlers = {
    saveNew: async (file: Blob, input: PdfStudioSaveInput, meta: PdfStudioFileMeta, onProgress?: (progress: TransferProgress) => void) => {
      const result = await savePdfStudioDocument(file, input, meta, onProgress);
      setDocuments((current) => [result.document, ...current.filter((doc) => doc.id !== result.document.id)]);
      rememberFolder(result.folder);
      return result.document;
    },
    replace: async (id: string, file: Blob, meta: PdfStudioFileMeta, onProgress?: (progress: TransferProgress) => void) => {
      const updated = await replacePdfStudioFile(id, file, meta, onProgress);
      setDocuments((current) => [updated, ...current.filter((doc) => doc.id !== updated.id)]);
      return updated;
    },
  };

  const saveDetails = async (choice: { input: PdfStudioSaveInput }) => {
    if (!detailsFor) return;
    const updated = await updatePdfStudioDocument(detailsFor.id, { title: choice.input.title, notes: choice.input.notes, folderId: choice.input.folderId });
    setDocuments((current) => current.map((doc) => doc.id === updated.id ? updated : doc));
    setDetailsFor(null);
    notify("PDF details updated.");
  };
  const moveDocument = async (doc: PdfStudioDocument, folderId: string | null) => {
    try {
      const updated = await updatePdfStudioDocument(doc.id, { folderId });
      setDocuments((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      notify(folderId ? `Moved to “${folderName(folderId)}”.` : "Removed from its folder.");
    } catch (error) { notify(error instanceof Error ? error.message : "The PDF couldn't be moved.", "error"); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deletePdfStudioDocument(deleteTarget.id);
      setDocuments((current) => current.filter((doc) => doc.id !== deleteTarget.id));
      if (editor?.kind === "saved" && editor.document.id === deleteTarget.id) setEditor(null);
      notify(`“${deleteTarget.title}” moved to the Trash. You can restore it for 7 days.`);
      setDeleteTarget(null);
      onTrashChanged?.();
    } catch (error) { notify(error instanceof Error ? error.message : "The PDF couldn't be deleted.", "error"); }
    finally { setDeleting(false); }
  };

  const heading = <div className="section-page-heading">
    <div>
      <div className="section-page-eyebrow"><span className="section-mini-icon tag-rose"><FileStack size={13}/></span>Documents &amp; forms</div>
      <h2>PDF Studio</h2>
      <p>Create, merge, split, annotate and sign PDFs right in your browser. Files stay on this device while you work — nothing is uploaded until you choose Save to Persora.</p>
      <div className="pdfs-heading-actions">
        <button type="button" className="section-add-button" onClick={() => createInputRef.current?.click()}><FilePlus2 size={15}/> Create PDF</button>
        <button type="button" className="quiet-button pdfs-open-button" onClick={() => openInputRef.current?.click()}><FolderInput size={15}/> Open PDF</button>
      </div>
    </div>
    <div className="section-heading-aside"><div className="section-aside-art pdfs-aside-art"><div className="aside-orbit"/><FileStack size={44} strokeWidth={1.1}/><div className="aside-art-bottom"><span>PDFS</span><span>{String(documents.length).padStart(2, "0")}</span></div></div><div className="aside-note"><ShieldCheck size={13}/><span>Processed on this device · private library</span></div></div>
  </div>;

  return <div className="section-view pdfs-library-page">
    {heading}
    <input ref={openInputRef} className="hidden-file-input" type="file" accept={PDF_ACCEPT} multiple onChange={onOpenSelected} aria-label="Choose PDF files to open"/>
    <input ref={createInputRef} className="hidden-file-input" type="file" accept={CREATE_ACCEPT} multiple onChange={onCreateSelected} aria-label="Choose files to turn into a PDF"/>

    <div className="pdfs-workareas">
      <DropCard
        icon={<FilePlus2 size={18}/>} tone="tag-blue" title="Create PDF"
        copy="Combine photos, scans, text and other PDFs into one document. Reorder, choose a page size, then edit or download."
        chips={["Images", "Text", "PDF"]} dropLabel="Drop images, text files or PDFs here" onFiles={startCreate}
      >
        <button type="button" className="section-add-button" onClick={() => createInputRef.current?.click()}><Upload size={14}/> Choose files</button>
        <button type="button" className="quiet-button" onClick={() => startCreate([])}><FileText size={14}/> Start with text</button>
      </DropCard>
      <DropCard
        icon={<WandSparkles size={18}/>} tone="tag-rose" title="Edit PDF"
        copy="Reorder, rotate, delete, merge and split pages. Add text, highlights, shapes and signatures on top of any page."
        chips={["Pages", "Annotations", "Signatures"]} dropLabel="Drop PDFs here — several files are merged" onFiles={openFiles}
      >
        <button type="button" className="section-add-button" onClick={() => openInputRef.current?.click()}><FolderInput size={14}/> Open PDF</button>
        <span className="pdfs-workarea-hint"><Info size={12}/> Or open a saved PDF below</span>
      </DropCard>
    </div>
    <p className="pdfs-supported"><ImageIcon size={12}/> Supported: {SUPPORTED_INPUTS_LABEL}. Word and other office files need to be exported to PDF first.</p>

    <div className="pdfs-library-head"><h3>Saved PDFs</h3><span>Private to your account</span></div>
    {!available ? <div className="section-empty pdfs-empty"><div className="empty-icon-stack"><div className="empty-icon-circle tag-blue"><Lock size={21}/></div><span>✦</span></div>
      <h3>Your PDF library needs a Persora account</h3>
      <p>You can create, edit and download PDFs right now. Saving them to a private library is available after signing in to a connected Persora account.</p>
    </div> : <>
      <VaultFolderShelf userId={user.id} scope="pdf-studio" pageLabel="PDFs" demoMode={false} totalCount={documents.length} folderCounts={counts} selectedFolderId={selectedFolderId} onSelectFolder={setSelectedFolderId} onFoldersChange={setFolders} notify={notify} reloadToken={folderReload}/>
      <div className="section-toolbar pdfs-toolbar">
        <label className="pdfs-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search PDFs…" aria-label="Search PDFs"/></label>
        <label className="pdfs-sort" title="Sort PDFs"><ArrowDownUp size={14}/><select value={sort} onChange={(event) => setSort(event.target.value as PdfSort)} aria-label="Sort PDFs">{(Object.keys(SORT_LABELS) as PdfSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}</select></label>
      </div>
      <div className="section-list-meta"><span><b>{String(visible.length).padStart(2, "0")}</b> {visible.length === 1 ? "PDF" : "PDFs"}{selectedFolderId ? ` in ${folderName(selectedFolderId) || "this folder"}` : ""}</span><span className="list-meta-private"><ShieldCheck size={12}/> Nothing is uploaded until you press Save to Persora</span></div>

      {loading ? <div className="pdfs-grid" aria-busy="true" aria-label="Loading PDFs">{[0, 1, 2, 3].map((key) => <div key={key} className="pdfs-card pdfs-card-skeleton"><div className="pdfs-card-media"/><div className="pdfs-card-body"><span/><span/></div></div>)}</div>
      : loadError ? <div className="section-empty" role="alert"><div className="empty-icon-stack"><div className="empty-icon-circle tag-rose"><AlertTriangle size={21}/></div></div><h3>Your PDFs couldn't be loaded</h3><p>{loadError}</p><button type="button" className="quiet-button" onClick={() => void loadDocuments()}><RefreshCw size={15}/> Try again</button></div>
      : visible.length ? <div className="pdfs-grid">{visible.map((doc) => <article key={doc.id} className="pdfs-card">
        <button type="button" className="pdfs-card-media" onClick={() => void openSaved(doc)} aria-label={`Open ${doc.title} in the editor`} disabled={Boolean(opening)}>
          {doc.thumbnail ? <img src={doc.thumbnail} alt="" loading="lazy"/> : <span className="pdfs-thumb-fallback"><FileText size={26}/><small>PDF</small></span>}
          <span className="pdfs-card-pages">{pageCountLabel(doc.pageCount)}</span>
          {opening === doc.id && <span className="pdfs-card-opening" role="status"><span className="spinner"/> Opening…</span>}
        </button>
        <div className="pdfs-card-body">
          <div className="pdfs-card-title"><h3 title={doc.title}>{doc.title}</h3>
            <MoreOptionsMenu label={`${doc.title} options`} folders={folders} folderId={doc.folderId || ""} onMoveFolder={(folderId) => void moveDocument(doc, folderId || null)} actions={[
              { label: "Open in editor", icon: Pencil, onSelect: () => void openSaved(doc) },
              { label: "Download", icon: Download, onSelect: () => void downloadSaved(doc) },
              { label: "Edit details", icon: FileText, onSelect: () => setDetailsFor(doc) },
              { label: "Delete PDF", icon: Trash2, danger: true, onSelect: () => setDeleteTarget(doc) },
            ]}/>
          </div>
          {doc.folderId && folderName(doc.folderId) && <div className="pdfs-card-chips"><span className="pdfs-chip"><FolderOpen size={10}/>{folderName(doc.folderId)}</span></div>}
          <p className="pdfs-card-sub">{formatBytes(doc.fileSize)} · Updated {dateLabel(doc.updatedAt)}</p>
        </div>
      </article>)}</div>
      : <div className="section-empty pdfs-empty"><div className="empty-icon-stack"><div className="empty-icon-circle tag-rose"><FileStack size={21}/></div><span>✦</span></div>
        <h3>{documents.length ? "No PDFs match" : "No saved PDFs yet"}</h3>
        <p>{documents.length ? "Try another search or folder." : "Create a PDF or open one to edit. When you're happy with it, choose Save to Persora to keep it here."}</p>
      </div>}
    </>}

    {createFiles && <Suspense fallback={<div className="pdfs-lazy-fallback" role="status"><span className="spinner"/> Loading Create PDF…</div>}>
      <PdfCreateModal
        initialFiles={createFiles}
        onClose={() => setCreateFiles(null)}
        onOpenInEditor={(bytes, title) => { setCreateFiles(null); setEditor({ kind: "created", bytes, title }); }}
        notify={notify}
      />
    </Suspense>}
    {editor && <Suspense fallback={<div className="pdfs-lazy-fallback" role="status"><span className="spinner"/> Loading the PDF editor…</div>}>
      <PdfEditorModal
        request={editor}
        folders={folders}
        defaultFolderId={selectedFolderId || null}
        canSave={available && canUpload}
        saveBlockedReason={saveBlockedReason}
        maxUploadMb={maxUploadMb}
        onUpgrade={onUpgrade}
        handlers={saveHandlers}
        onClose={() => setEditor(null)}
        notify={notify}
      />
    </Suspense>}
    {detailsFor && <PdfSaveModal
      mode="details"
      folders={folders}
      defaults={{ title: detailsFor.title, folderId: detailsFor.folderId, notes: detailsFor.notes }}
      linkedDocument={detailsFor}
      canSave
      onCancel={() => setDetailsFor(null)}
      onSubmit={saveDetails}
    />}
    {deleteTarget && <ModalPortal><ConfirmDialog title={`Delete “${deleteTarget.title}”?`} confirmLabel={deleting ? "Deleting…" : "Move to Trash"} onCancel={() => { if (!deleting) setDeleteTarget(null); }} onConfirm={() => void confirmDelete()}>
      <p>The PDF moves to the Trash, where you can restore it for 7 days. After that it's permanently removed from your storage.</p>
    </ConfirmDialog></ModalPortal>}
  </div>;
}
