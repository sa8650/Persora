import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Download, FilePlus2, GripVertical, Info, Plus, ShieldCheck, Trash2, Type, Upload, WandSparkles, X } from "lucide-react";
import {
  CREATE_ACCEPT, IMAGE_MAX_BYTES, PAGE_SIZES, PDF_OPEN_MAX_BYTES, SUPPORTED_INPUTS_LABEL, TEXT_MAX_BYTES, decodeText, errorMessage, formatBytes, isWinAnsi, makeId, pdfDownloadName,
  sniffFileKind, titleFromFileName, unsupportedReason, type InputKind, type MarginId, type Orientation, type PageSizeId,
} from "../lib/pdf-studio";
import ModalPortal from "./ModalPortal";
import { ConfirmDialog } from "./VaultDialogs";
import { StageProgressIndicator } from "./ProgressIndicator";
import { FileType, getFileType } from "@/components/reui/file-type";
import { IconTile } from "@/components/reui/icon-tile";
import "./pdf-studio.css";

interface CreateItem {
  id: string;
  kind: "image" | "text" | "pdf";
  inputKind: InputKind;
  name: string;
  size: number;
  bytes?: Uint8Array;
  previewUrl?: string;
  text: string;
  title: string;
}

interface Props {
  initialFiles: File[];
  onClose: () => void;
  onOpenInEditor: (bytes: Uint8Array, title: string) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}

const MAX_ITEMS = 200;
const PAGE_SIZE_OPTIONS: { id: PageSizeId; label: string }[] = [{ id: "fit", label: "Fit to image" }, ...(Object.entries(PAGE_SIZES) as [PageSizeId, { label: string }][]).map(([id, size]) => ({ id, label: size.label }))];

export default function PdfCreateModal({ initialFiles, onClose, onOpenInEditor, notify }: Props) {
  const titleId = useId();
  const [items, setItems] = useState<CreateItem[]>([]);
  const [title, setTitle] = useState("");
  const [pageSize, setPageSize] = useState<PageSizeId>("a4");
  const [orientation, setOrientation] = useState<Orientation>("auto");
  const [margin, setMargin] = useState<MarginId>("small");
  const [fontSize, setFontSize] = useState(12);
  const [busy, setBusy] = useState<{ label: string; percent: number | null } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dragDepth = useRef(0);
  const started = useRef(false);

  // Revoke image previews when the modal closes.
  useEffect(() => () => { for (const item of itemsRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); }, []);

  const addFiles = useCallback(async (files: File[]) => {
    const problems: string[] = [];
    const added: CreateItem[] = [];
    for (const file of files) {
      if (itemsRef.current.length + added.length >= MAX_ITEMS) { problems.push(`Up to ${MAX_ITEMS} items can go into one PDF.`); break; }
      const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
      const kind = sniffFileKind(head, file.name, file.type);
      if (kind === "unsupported") { problems.push(unsupportedReason(file.name)); continue; }
      if (kind === "pdf" && file.size > PDF_OPEN_MAX_BYTES) { problems.push(`“${file.name}” is larger than ${PDF_OPEN_MAX_BYTES / 1024 / 1024} MB.`); continue; }
      if (kind === "text" && file.size > TEXT_MAX_BYTES) { problems.push(`“${file.name}” is larger than ${TEXT_MAX_BYTES / 1024 / 1024} MB of text.`); continue; }
      if (kind !== "pdf" && kind !== "text" && file.size > IMAGE_MAX_BYTES) { problems.push(`“${file.name}” is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`); continue; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (kind === "text") {
          added.push({ id: makeId("item"), kind: "text", inputKind: kind, name: file.name, size: file.size, text: decodeText(bytes), title: titleFromFileName(file.name) });
        } else if (kind === "pdf") {
          added.push({ id: makeId("item"), kind: "pdf", inputKind: kind, name: file.name, size: file.size, bytes, text: "", title: "" });
        } else {
          added.push({ id: makeId("item"), kind: "image", inputKind: kind, name: file.name, size: file.size, bytes, previewUrl: URL.createObjectURL(file), text: "", title: "" });
        }
      } catch {
        problems.push(`“${file.name}” couldn't be read from your device.`);
      }
    }
    if (added.length) {
      setItems((current) => [...current, ...added]);
      setTitle((current) => current || (added.length === 1 && !itemsRef.current.length ? titleFromFileName(added[0].name) : current));
    }
    setErrors(problems);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialFiles.length) void addFiles(initialFiles);
    else setItems([{ id: makeId("item"), kind: "text", inputKind: "text", name: "Text", size: 0, text: "", title: "" }]);
  }, [initialFiles, addFiles]);

  const hasContent = items.some((item) => item.kind !== "text" || item.text.trim() || item.title.trim());
  const requestClose = useCallback(() => {
    if (busy) return;
    if (hasContent) setConfirmClose(true); else onClose();
  }, [busy, hasContent, onClose]);

  useEffect(() => {
    if (confirmClose) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClose, requestClose]);

  const move = (id: string, delta: number) => setItems((current) => {
    const index = current.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return next;
  });
  /** Drag-and-drop: the dragged item takes the drop target's position. */
  const moveTo = (id: string, targetId: string) => setItems((current) => {
    const from = current.findIndex((entry) => entry.id === id);
    const to = current.findIndex((entry) => entry.id === targetId);
    if (from < 0 || to < 0 || from === to) return current;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });
  const remove = (id: string) => setItems((current) => {
    const item = current.find((entry) => entry.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    return current.filter((entry) => entry.id !== id);
  });
  const update = (id: string, patch: Partial<CreateItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addText = () => setItems((current) => [...current, { id: makeId("item"), kind: "text", inputKind: "text", name: "Text", size: 0, text: "", title: "" }]);

  const needsRaster = items.some((item) => item.kind === "text" && !(isWinAnsi(item.text) && isWinAnsi(item.title)));
  const imageCount = items.filter((item) => item.kind === "image").length;
  const textCount = items.filter((item) => item.kind === "text" && (item.text.trim() || item.title.trim())).length;
  const pdfCount = items.filter((item) => item.kind === "pdf").length;
  const summary = [imageCount && `${imageCount} image${imageCount === 1 ? "" : "s"}`, textCount && `${textCount} text block${textCount === 1 ? "" : "s"}`, pdfCount && `${pdfCount} PDF${pdfCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  const build = async (): Promise<Uint8Array | null> => {
    if (!hasContent) { setErrors(["Add at least one image, PDF or some text."]); return null; }
    setErrors([]);
    setBusy({ label: "Loading the PDF tools…", percent: null });
    try {
      const [{ buildPdf }, canvas] = await Promise.all([import("../lib/pdf-engine"), import("../lib/pdf-canvas")]);
      const prepared = [];
      const usable = items.filter((item) => item.kind !== "text" || item.text.trim() || item.title.trim());
      for (const [index, item] of usable.entries()) {
        setBusy({ label: `Preparing ${item.kind === "image" ? "image" : item.kind === "pdf" ? "PDF" : "text"} ${index + 1} of ${usable.length}…`, percent: Math.round(index / usable.length * 60) });
        if (item.kind === "image" && item.bytes) prepared.push({ kind: "image" as const, name: item.name, image: await canvas.prepareImage(item.bytes, item.name, item.inputKind) });
        else if (item.kind === "pdf" && item.bytes) prepared.push({ kind: "pdf" as const, name: item.name, bytes: item.bytes });
        else prepared.push({ kind: "text" as const, name: item.name, text: item.text, title: item.title });
      }
      setBusy({ label: "Building your PDF…", percent: 60 });
      const bytes = await buildPdf(prepared, { pageSize, orientation, margin, fontSize, title: title.trim() || "PDF" }, {
        rasterizeTextPages: canvas.rasterizeTextPages,
        onProgress: (done, total) => setBusy({ label: "Building your PDF…", percent: 60 + Math.round(done / total * 40) }),
      });
      return bytes;
    } catch (error) {
      setErrors([errorMessage(error, "The PDF couldn't be created.")]);
      return null;
    } finally { setBusy(null); }
  };

  const createAndEdit = async () => {
    const bytes = await build();
    if (bytes) onOpenInEditor(bytes, title.trim() || "Untitled PDF");
  };
  const createAndDownload = async () => {
    const bytes = await build();
    if (!bytes) return;
    const { downloadBytes } = await import("../lib/pdf-canvas");
    downloadBytes(bytes, pdfDownloadName(title.trim() || "document"));
    notify("PDF created and downloaded.");
  };

  const hasDraggedFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
  const kindIcon = (item: CreateItem) => (
    <FileType
      type={item.kind === "pdf" ? "pdf" : item.kind === "text" ? "txt" : getFileType(item.name || item.inputKind)}
      size="sm"
      variant="light"
      aria-hidden
    />
  );

  const sizeSelects = useMemo(() => <div className="pdfs-create-options" role="group" aria-label="Page options">
    <label className="field-label">Page size
      <select value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSizeId)} disabled={Boolean(busy)}>{PAGE_SIZE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
    </label>
    <label className="field-label">Orientation
      <select value={orientation} onChange={(event) => setOrientation(event.target.value as Orientation)} disabled={Boolean(busy) || pageSize === "fit"}><option value="auto">Automatic</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
    </label>
    <label className="field-label">Margins
      <select value={margin} onChange={(event) => setMargin(event.target.value as MarginId)} disabled={Boolean(busy)}><option value="none">None</option><option value="small">Small</option><option value="normal">Normal</option></select>
    </label>
    <label className="field-label">Text size
      <select value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} disabled={Boolean(busy)}>{[10, 11, 12, 14, 16, 18].map((size) => <option key={size} value={size}>{size} pt</option>)}</select>
    </label>
  </div>, [pageSize, orientation, margin, fontSize, busy]);

  return <ModalPortal>
    <div className="modal-backdrop pdfs-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section className="vault-modal pdfs-create-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onDragEnter={(event) => { if (!hasDraggedFiles(event)) return; event.preventDefault(); dragDepth.current += 1; setDragOver(true); }}
        onDragOver={(event) => { if (!hasDraggedFiles(event)) return; event.preventDefault(); }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); }}
        onDrop={(event) => { if (!hasDraggedFiles(event)) return; event.preventDefault(); dragDepth.current = 0; setDragOver(false); void addFiles(Array.from(event.dataTransfer.files || [])); }}
      >
        <header className="vault-modal-header">
          <IconTile variant="soft" size="sm" className="text-rose-600 dark:text-rose-300"><FilePlus2 size={18}/></IconTile>
          <div className="vault-modal-title"><small>Create PDF</small><h2 id={titleId}>Build a PDF from images, text and files</h2></div>
          <button type="button" className="vault-modal-close" onClick={requestClose} disabled={Boolean(busy)} aria-label="Close Create PDF"><X size={18}/></button>
        </header>
        <input ref={inputRef} className="hidden-file-input" type="file" accept={CREATE_ACCEPT} multiple onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ""; void addFiles(files); }} aria-label="Add files to the PDF"/>
        <div className="vault-modal-scroll pdfs-create-body">
          <div className="pdfs-create-main">
            <label className="field-label">Document title
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} placeholder="e.g. Visa application documents" disabled={Boolean(busy)}/>
            </label>
            <div className="pdfs-create-list-head">
              <b>Pages, in order</b>
              <span>{summary || "Nothing added yet"}</span>
            </div>
            {items.length ? <ol className="pdfs-create-list">
              {items.map((item, index) => <li key={item.id}
                className={`pdfs-create-item pdfs-create-${item.kind} ${dragItem === item.id ? "is-dragging" : ""}`}
                draggable={!busy}
                onDragStart={(event) => { setDragItem(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
                onDragEnd={() => setDragItem(null)}
                onDragOver={(event) => { if (dragItem) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
                onDrop={(event) => { if (!dragItem) return; event.preventDefault(); event.stopPropagation(); moveTo(dragItem, item.id); setDragItem(null); }}
              >
                <span className="pdfs-create-grip" title="Drag to reorder" aria-hidden="true"><GripVertical size={14}/></span>
                <span className="pdfs-create-thumb">{item.previewUrl ? <img src={item.previewUrl} alt=""/> : kindIcon(item)}</span>
                <div className="pdfs-create-item-body">
                  {item.kind === "text" ? <>
                    <input className="pdfs-create-text-title" value={item.title} onChange={(event) => update(item.id, { title: event.target.value })} placeholder="Heading (optional)" aria-label={`Heading for text block ${index + 1}`} maxLength={200} disabled={Boolean(busy)}/>
                    <textarea value={item.text} onChange={(event) => update(item.id, { text: event.target.value })} rows={item.text.length > 400 ? 8 : 4} placeholder="Type or paste text. Long text flows onto as many pages as needed." aria-label={`Text block ${index + 1}`} disabled={Boolean(busy)}/>
                    <small>{item.size ? `${item.name} · ` : ""}{item.text.length.toLocaleString("en-US")} characters</small>
                  </> : <>
                    <b title={item.name}>{item.name}</b>
                    <small>{item.kind === "pdf" ? "All pages of this PDF" : `${item.inputKind.toUpperCase()} image`} · {formatBytes(item.size)}</small>
                  </>}
                </div>
                <div className="pdfs-create-item-actions">
                  <button type="button" className="pdfs-icon-button" onClick={() => move(item.id, -1)} disabled={index === 0 || Boolean(busy)} aria-label={`Move ${item.name} up`} title="Move up"><ArrowUp size={14}/></button>
                  <button type="button" className="pdfs-icon-button" onClick={() => move(item.id, 1)} disabled={index === items.length - 1 || Boolean(busy)} aria-label={`Move ${item.name} down`} title="Move down"><ArrowDown size={14}/></button>
                  <button type="button" className="pdfs-icon-button pdfs-danger" onClick={() => remove(item.id)} disabled={Boolean(busy)} aria-label={`Remove ${item.name}`} title="Remove"><Trash2 size={14}/></button>
                </div>
              </li>)}
            </ol> : <div className="pdfs-create-empty"><FilePlus2 size={22}/><span>Add images, PDFs or text to start.</span></div>}
            <div className={`pdfs-dropzone ${dragOver ? "is-dragover" : ""}`}>
              <Upload size={18}/>
              <span><b>{dragOver ? "Release to add files" : "Drop files here"}</b><small>{SUPPORTED_INPUTS_LABEL}</small></span>
              <div className="pdfs-dropzone-actions">
                <button type="button" className="quiet-button" onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}><Plus size={14}/> Add files</button>
                <button type="button" className="quiet-button" onClick={addText} disabled={Boolean(busy)}><Type size={14}/> Add text</button>
              </div>
            </div>
          </div>
          <aside className="pdfs-create-side">
            {sizeSelects}
            <p className="pdfs-muted-note"><Info size={12}/> Images are scaled to fit the page and centred. “Fit to image” makes each page the image's own size. PDFs keep their original pages.</p>
            {needsRaster && <p className="pdfs-warning-note" role="note"><AlertTriangle size={12}/> Some text uses characters outside the basic Latin set (for example Bengali). It will be drawn with your device's fonts as an image — it looks right, but can't be selected or searched.</p>}
          </aside>
        </div>
        {errors.length > 0 && <div className="form-alert error-alert editor-error" role="alert">{errors.map((message) => <div key={message}>{message}</div>)}</div>}
        {busy && <div className="px-6 pt-2"><StageProgressIndicator label={busy.label} percent={busy.percent}/></div>}
        <div className="editor-form-footer">
          <div className="editor-footnote"><ShieldCheck size={14}/><span>Built on this device. Nothing is uploaded.</span></div>
          <div className="editor-actions">
            <button type="button" className="quiet-button" onClick={requestClose} disabled={Boolean(busy)}>Cancel</button>
            <button type="button" className="quiet-button" onClick={() => void createAndDownload()} disabled={Boolean(busy) || !hasContent}><Download size={14}/> Download PDF</button>
            <button type="button" className="editor-submit" onClick={() => void createAndEdit()} disabled={Boolean(busy) || !hasContent}><WandSparkles size={14}/> Create &amp; edit</button>
          </div>
        </div>
      </section>
    </div>
    {confirmClose && <ConfirmDialog title="Discard this PDF?" confirmLabel="Discard" onCancel={() => setConfirmClose(false)} onConfirm={onClose}>
      <p>The files and text you added haven't been turned into a PDF yet. Closing removes them from this screen — your original files aren't affected.</p>
    </ConfirmDialog>}
  </ModalPortal>;
}
