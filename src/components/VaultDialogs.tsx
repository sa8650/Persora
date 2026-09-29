import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, CalendarDays, Check, Download, FileImage, FileText, LockKeyhole, Paperclip, ShieldCheck, UploadCloud, X } from "lucide-react";
import { SECTION_BY_ID } from "../data";
import QRPreview from "./QRPreview";
import type { FieldDefinition, SectionId, VaultFile, VaultFilePreview, VaultItem } from "../types";
import { daysUntil, formatDate, formatRelativeDate, humanSize, makeVCard } from "../lib/utils";

interface ItemEditorDialogProps {
  sectionId: SectionId;
  item?: VaultItem;
  documentTypes?: string[];
  maxUploadMb?: number;
  onClose: () => void;
  onSave: (value: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string; fileUpload?: File | null }) => Promise<void>;
}

const detailColors: Record<SectionId, string> = { documents: "tag-blue", academics: "tag-violet", subscriptions: "tag-orange", family: "tag-rose", purchases: "tag-teal", accounts: "tag-indigo", memberships: "tag-green", study: "tag-sky", "business-card": "tag-slate", urls: "tag-cyan" };

export function ItemEditorDialog({ sectionId, item, documentTypes = [], maxUploadMb = 25, onClose, onSave }: ItemEditorDialogProps) {
  const section = SECTION_BY_ID[sectionId];
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const previewUrl = useMemo(() => selectedFile && selectedFile.type.startsWith("image/") ? URL.createObjectURL(selectedFile) : "", [selectedFile]);

  useEffect(() => {
    const initial: Record<string, string> = {};
    section.fields.forEach((field) => { initial[field.key] = field.key === "title" ? item?.title || "" : item?.metadata[field.key] || ""; });
    setValues(initial);
  }, [item, section]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const setValue = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const acceptFile = (file?: File) => {
    if (!file) return;
    const maxFileSize = Math.max(1, Number(maxUploadMb) || 25) * 1024 * 1024;
    if (file.size > maxFileSize) { setError(`Files must be ${maxUploadMb} MB or smaller.`); return; }
    setError("");
    setSelectedFile(file);
    setRemoveFile(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = values.title?.trim();
    if (!title) { setError(`${section.titleLabel} is required.`); return; }
    setSaving(true);
    setError("");
    const metadata: Record<string, string> = {};
    Object.entries(values).forEach(([key, value]) => { if (key !== "title" && value.trim()) metadata[key] = value.trim(); });
    const file: VaultFile | undefined = selectedFile ? { name: selectedFile.name, size: selectedFile.size, type: selectedFile.type, localOnly: true } : removeFile ? undefined : item?.file;
    try {
      await onSave({
        ...(item?.id ? { id: item.id } : {}),
        section: sectionId,
        title,
        metadata,
        file,
        favorite: item?.favorite,
        fileUpload: selectedFile,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We couldn't save this record. Please try again.");
      setSaving(false);
    }
  };

  const fields = section.fields;
  const renderInput = (field: FieldDefinition) => {
    const value = values[field.key] || "";
    const common = { id: `field-${field.key}`, value, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValue(field.key, event.target.value), required: field.required };
    if (field.kind === "select") {
      const options = sectionId === "documents" && field.key === "type" ? documentTypes : field.options || [];
      return <select {...common}><option value="">Choose one…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
    }
    if (field.kind === "textarea") return <textarea {...common} rows={3} placeholder={field.placeholder || "Add a few helpful details…"} />;
    const type = field.kind === "number" ? "number" : field.kind;
    return <input {...common} type={type} placeholder={field.placeholder || ""} />;
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="editor-dialog-head"><div className={`editor-icon ${section.id}`}><section.icon size={19} /></div><div><span className="section-eyebrow">{item ? "Edit your record" : `Add to ${section.label.toLowerCase()}`}</span><h2 id="editor-title">{item ? "Make a quick update." : `Add a ${section.singular}.`}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18} /></button></div>
      <p className="editor-intro">A few details now make it easier to find later. Everything you add is just for you.</p>
      <form className="editor-form" onSubmit={submit}>
        <div className="editor-fields-grid">{fields.map((field) => <label key={field.key} className={`field-label ${field.wide || field.kind === "textarea" ? "field-wide" : ""}`} htmlFor={`field-${field.key}`}>{field.label}{field.required && <span className="required-star">*</span>}{renderInput(field)}</label>)}</div>
        <div className="upload-field-block"><div className="upload-field-title"><span>Attach a file <small>Optional · PDF, photo or document</small></span><span className="upload-lock"><LockKeyhole size={12} /> Private</span></div>
          {selectedFile ? <div className="upload-preview-row">{previewUrl ? <img src={previewUrl} alt="Selected file preview" className="upload-image-preview" /> : <span className="upload-file-icon"><FileText size={20} /></span>}<span className="upload-preview-name"><b>{selectedFile.name}</b><small>{humanSize(selectedFile.size)} · Ready to upload</small></span><button type="button" className="plain-icon upload-remove" onClick={() => setSelectedFile(null)} aria-label="Remove selected file"><X size={16} /></button></div> : item?.file && !removeFile ? <div className="upload-preview-row existing-file-row"><span className="upload-file-icon">{item.file.type?.startsWith("image/") ? <FileImage size={19} /> : <FileText size={19} />}</span><span className="upload-preview-name"><b>{item.file.name}</b><small>{humanSize(item.file.size)} · Saved in your vault</small></span><button type="button" className="upload-replace" onClick={() => document.getElementById("vault-file-input")?.click()}>Replace</button><button type="button" className="plain-icon upload-remove" onClick={() => setRemoveFile(true)} aria-label="Remove attachment"><X size={16} /></button></div> : <label htmlFor="vault-file-input" className={`file-dropzone ${dragging ? "file-dropzone-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); }}>
            <span className="upload-circle"><UploadCloud size={19} /></span><span className="dropzone-copy"><b>Choose a file or drop it here</b><small>PDF, PNG, JPG or document · up to {maxUploadMb} MB</small></span><span className="browse-button">Browse files</span></label>}
          <input className="hidden-file-input" id="vault-file-input" type="file" onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ""; }} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt" />
        </div>
        {error && <div className="form-alert error-alert editor-error" role="alert">{error}</div>}
        <div className="editor-form-footer"><div className="editor-footnote"><ShieldCheck size={14} /><span>Private to your Persora account</span></div><div className="editor-actions"><button type="button" className="quiet-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="editor-submit" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : <>{item ? "Save changes" : "Save to vault"}<Check size={15} /></>}</button></div></div>
      </form>
    </section>
  </div>;
}

export function ItemDetailDialog({ item, filePreview, onClose, onEdit, onDownloadFile }: { item: VaultItem; filePreview?: VaultFilePreview | null; onClose: () => void; onEdit: () => void; onDownloadFile: () => void }) {
  const section = SECTION_BY_ID[item.section];
  const dateKey = section.dateKey;
  const dateValue = dateKey ? item.metadata[dateKey] : undefined;
  const days = daysUntil(dateValue);
  const displayEntries = Object.entries(item.metadata).filter(([key, value]) => Boolean(value) && key !== "notes");
  const formattedKey = (value: string) => value.replace(/([A-Z])/g, " $1").replace(/^\w/, (letter) => letter.toUpperCase());
  const note = item.metadata.notes;
  const qrValue = item.section === "memberships"
    ? [`PERSORA MEMBERSHIP`, item.title, item.metadata.organization, `Member ID: ${item.metadata.memberId || "not provided"}`, `Level: ${item.metadata.level || "not provided"}`, `Expires: ${item.metadata.expiryDate || "not provided"}`].filter(Boolean).join("\n")
    : item.section === "business-card"
      ? makeVCard(item)
      : item.section === "urls" && item.metadata.url
        ? (item.metadata.url.startsWith("http") ? item.metadata.url : `https://${item.metadata.url}`)
        : "";
  const qrHeading = item.section === "memberships" ? "Digital membership card" : item.section === "business-card" ? "Contact card QR" : "Quick-access QR";
  const qrNote = item.section === "memberships" ? "Scan to read the card details shown here." : item.section === "business-card" ? "Scan to save these details as a contact." : "Scan to open this saved link.";
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="detail-banner"><div className="detail-banner-pattern"/><div className={`detail-icon ${detailColors[item.section]}`}><section.icon size={22} /></div><button className="icon-button detail-close" onClick={onClose} aria-label="Close details"><X size={18} /></button><div className="detail-banner-title"><span>{section.eyebrow}</span><h2 id="detail-title">{item.title}</h2>{item.subtitle && <p>{item.subtitle}</p>}</div><div className="detail-private-pill"><LockKeyhole size={12} /> YOUR PRIVATE VAULT</div></div>
      <div className="detail-body"><div className="detail-meta-strip"><span><CalendarDays size={13} /> Added {formatDate(item.createdAt)}</span><span className="detail-updated">Updated {formatRelativeDate(item.updatedAt.slice(0, 10))}</span>{dateValue && <span className={`detail-date-status ${days !== null && days >= 0 && days <= 30 ? "detail-date-soon" : ""}`}><span />{days !== null && days >= 0 && days <= 30 ? `${days === 0 ? "Due today" : `Due in ${days} days`} · ` : ""}{formatDate(dateValue)}</span>}</div>
        {displayEntries.length ? <div className="detail-fields-grid">{displayEntries.map(([key, value]) => <div className="detail-field" key={key}><span>{formattedKey(key)}</span><b>{key.toLowerCase().includes("date") || key.toLowerCase().includes("expiry") || key.toLowerCase().includes("renewal") ? formatDate(value) : value}</b></div>)}</div> : <div className="detail-no-meta">No extra details have been added.</div>}
        {note && <div className="detail-notes"><span>Notes</span><p>{note}</p></div>}
        {qrValue && <div className="detail-qr-card"><div className="detail-qr-copy"><span className="qr-card-label"><span /> ON-DEVICE QR</span><h3>{qrHeading}</h3><p>{qrNote}</p><small><LockKeyhole size={12} /> Generated on this device</small></div><div className="detail-qr-image"><QRPreview value={qrValue} size={76} /></div></div>}
        {item.file && <section className="detail-attachment-preview"><div className="detail-file"><div className="detail-file-icon">{item.file.type?.startsWith("image/") ? <FileImage size={20} /> : <FileText size={20} />}</div><div className="detail-file-copy"><b>{filePreview?.name || item.file.name}</b><small>{humanSize(item.file.size)} · {item.file.localOnly ? "This device" : "Stored privately in Cloudflare R2"}</small></div><button className="outline-action-button" onClick={onDownloadFile}><Download size={15} /> Download</button></div><div className="detail-preview-stage">
          {!filePreview || filePreview.status === "loading" ? <div className="detail-preview-message"><span className="spinner dark-spinner"/><b>Opening private attachment…</b></div> : filePreview.status === "unavailable" || filePreview.status === "error" ? <div className="detail-preview-message"><FileText size={25}/><b>{filePreview.message || "This attachment could not be previewed."}</b></div> : filePreview.type?.startsWith("image/") && filePreview.src ? <img className="detail-preview-image" src={filePreview.src} alt={filePreview.name} /> : (filePreview.type === "application/pdf" || filePreview.name.toLowerCase().endsWith(".pdf")) && filePreview.src ? <iframe className="detail-preview-pdf" src={filePreview.src} title={`Preview of ${filePreview.name}`} /> : filePreview.type?.startsWith("video/") && filePreview.src ? <video className="detail-preview-media" src={filePreview.src} controls /> : filePreview.type?.startsWith("audio/") && filePreview.src ? <audio className="detail-preview-audio" src={filePreview.src} controls /> : <div className="detail-preview-message"><FileText size={25}/><b>Preview isn’t supported for this file type in your browser.</b><span>Use Download to open it with a compatible app. Your file remains private.</span></div>}
        </div></section>}
      </div><div className="detail-footer"><span><ShieldCheck size={14} /> Your data belongs to you.</span><div><button className="quiet-button" onClick={onClose}>Close</button><button className="editor-submit" onClick={onEdit}>Edit details <ArrowUpRight size={14} /></button></div></div>
    </section>
  </div>;
}

export function ConfirmDialog({ title, children, confirmLabel = "Delete record", danger = true, onCancel, onConfirm }: { title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><section className="confirm-dialog" role="alertdialog" aria-modal="true"><div className={`confirm-icon ${danger ? "confirm-danger" : "confirm-neutral"}`}>{danger ? <X size={19} /> : <Paperclip size={19} />}</div><button className="icon-button confirm-close" onClick={onCancel} aria-label="Close"><X size={17} /></button><h2>{title}</h2><div className="confirm-copy">{children}</div><div className="confirm-actions"><button className="quiet-button" onClick={onCancel}>Keep it</button><button className={danger ? "confirm-danger-button" : "editor-submit"} onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

export function ToastNotice({ message, kind = "success", onClose }: { message: string; kind?: "success" | "error"; onClose: () => void }) {
  return <div className={`toast-notice ${kind === "error" ? "toast-error" : ""}`} role="status"><span className="toast-icon">{kind === "error" ? <X size={14} /> : <Check size={14} />}</span><span>{message}</span><button className="plain-icon" onClick={onClose} aria-label="Dismiss"><X size={15} /></button></div>;
}
