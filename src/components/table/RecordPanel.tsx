// Persora Table — edit one record with every field visible. A side panel on
// desktop; on phones it replaces the list (in the page flow, never covering
// it), so every operation stays reachable with large touch targets.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Download, Paperclip, Trash2, Upload, X } from "lucide-react";
import {
  TABLE_LIMITS, coerceFieldInput, validateFieldValue,
  type AttachmentRef, type Choice, type Field, type FieldValue, type PersonRef, type TableRecord,
} from "../../../cloudflare/table-rules.js";
import type { TablePerson } from "../../lib/table/table-api";
import type { TransferProgress } from "../../types";
import { AttachmentThumb, downloadAttachment, formatBytes } from "./attachments";
import { ChoiceChip, choiceOf, editTextOf } from "./smart-cells";
import { TransferProgressIndicator } from "../ProgressIndicator";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Badge } from "@/components/reui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";

function TextValueEditor({ field, value, disabled, onCommit }: { field: Field; value: FieldValue | undefined; disabled: boolean; onCommit: (value: FieldValue, newChoices?: Choice[]) => void }) {
  const initial = editTextOf(field, value);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(initial); setError(null); }, [initial]);
  const commit = () => {
    if (text === initial) { setError(null); return; }
    const result = coerceFieldInput(field, text, { createChoices: field.type === "multiselect" });
    if (!result.ok) { setError(result.message || "This value doesn't fit the field."); return; }
    setError(null);
    onCommit(result.value, result.newChoices);
  };
  const type = field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text";
  const invalidStored = value !== undefined && value !== null && !validateFieldValue(field, value).valid;
  return <>
    {field.type === "text" && text.length > 60
      ? <textarea aria-label={field.name} value={text} disabled={disabled} maxLength={TABLE_LIMITS.cellText} rows={3} onChange={(event) => setText(event.target.value)} onBlur={commit} aria-invalid={Boolean(error)}/>
      : <input aria-label={field.name} type={type} value={type === "date" && text && !/^\d{4}-\d{2}-\d{2}$/u.test(text) ? "" : text} disabled={disabled} maxLength={TABLE_LIMITS.cellText} aria-invalid={Boolean(error) || invalidStored}
        inputMode={field.type === "number" || field.type === "currency" || field.type === "percent" ? "decimal" : undefined}
        placeholder={field.type === "percent" ? "e.g. 15" : field.type === "currency" ? field.currency || "BDT" : undefined}
        onChange={(event) => { setText(event.target.value); setError(null); }} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}/>}
    {invalidStored && !error && <small className="tb-hint">Kept as written: “{editTextOf(field, value)}” doesn't match this field's type. Enter a valid value to replace it.</small>}
    {error && <small className="tb-form-error" role="alert">{error}</small>}
  </>;
}

export default function RecordPanel({ record, fields, primaryField, people, tableId, readOnly, uploading, uploadProgress = null, onChange, onDuplicate, onDelete, onUpload, onClose, mobile }: {
  record: TableRecord;
  fields: Field[];
  primaryField: string;
  people: TablePerson[] | null;
  tableId: string;
  readOnly: boolean;
  uploading: string | null;
  uploadProgress?: TransferProgress | null;
  onChange: (fieldId: string, value: FieldValue, newChoices?: Choice[]) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUpload: (fieldId: string, files: FileList) => void;
  onClose: () => void;
  mobile: boolean;
}) {
  const primary = fields.find((field) => field.id === primaryField) || fields[0];
  const title = primary ? editTextOf(primary, record.values[primary.id]) : "";
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [record.id]);

  const editor = (field: Field) => {
    const value = record.values[field.id];
    switch (field.type) {
      case "checkbox":
        return <label className="tb-switch"><Checkbox aria-label={field.name} checked={value === true} disabled={readOnly} onCheckedChange={(checked) => onChange(field.id, checked === true)}/> {value === true ? "Yes" : "No"}</label>;
      case "select": case "status": {
        const known = typeof value === "string" && choiceOf(field, value);
        return <>
          <select aria-label={field.name} value={known ? (value as string) : ""} disabled={readOnly} onChange={(event) => onChange(field.id, event.target.value || null)}>
            <option value="">{value && !known ? `Kept as written: ${String(value)}` : "—"}</option>
            {(field.choices || []).map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
          </select>
        </>;
      }
      case "multiselect": {
        const ids = Array.isArray(value) ? (value as string[]) : [];
        return <div className="tb-multi-pick" role="group" aria-label={field.name}>
          {(field.choices || []).map((choice) => <label key={choice.id} className={ids.includes(choice.id) ? "is-on" : ""}>
            <Checkbox checked={ids.includes(choice.id)} disabled={readOnly}
              onCheckedChange={(checked) => onChange(field.id, checked === true ? [...ids, choice.id] : ids.filter((id) => id !== choice.id))}/>
            <ChoiceChip choice={choice}/>
          </label>)}
          {!(field.choices || []).length && <small className="tb-muted">No options yet — add them in the field settings.</small>}
        </div>;
      }
      case "person": {
        const current = value && typeof value === "object" && !Array.isArray(value) ? (value as PersonRef) : null;
        return <select aria-label={field.name} value={current?.id || ""} disabled={readOnly} onChange={(event) => { const person = people?.find((entry) => entry.id === event.target.value); onChange(field.id, person ? { id: person.id, name: person.name } : null); }}>
          <option value="">—</option>
          {current && !people?.some((entry) => entry.id === current.id) && <option value={current.id}>{current.name}</option>}
          {(people || []).map((person) => <option key={person.id} value={person.id}>{person.name}{person.me ? " (you)" : ""}</option>)}
        </select>;
      }
      case "attachment": {
        const files = Array.isArray(value) ? (value as AttachmentRef[]) : [];
        const inputId = `tb-upload-${record.id}-${field.id}`;
        return <div className="tb-attach-list">
          {files.map((file) => (
            <Attachment key={file.id} size="sm" className="w-full justify-between">
              <AttachmentMedia>
                <AttachmentThumb tableId={tableId} file={file}/>
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{file.name}</AttachmentTitle>
                <AttachmentDescription>{formatBytes(file.size)}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <AttachmentAction type="button" aria-label={`Download ${file.name}`} title="Download" onClick={() => void downloadAttachment(tableId, file).catch(() => undefined)}>
                  <Download className="size-3.5"/>
                </AttachmentAction>
                <AttachmentAction type="button" aria-label={`Remove ${file.name}`} title="Remove from this record (undo is available)" disabled={readOnly} onClick={() => onChange(field.id, files.filter((entry) => entry.id !== file.id))}>
                  <X className="size-3.5"/>
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          ))}
          {uploading === field.id && uploadProgress ? (
            <TransferProgressIndicator
              progress={uploadProgress}
              label="Uploading attachment…"
              detail={uploadProgress.total ? `${formatBytes(uploadProgress.loaded)} of ${formatBytes(uploadProgress.total)}` : undefined}
            />
          ) : null}
          <input id={inputId} type="file" className="tb-visually-hidden" multiple disabled={readOnly || Boolean(uploading)}
            onChange={(event) => { if (event.target.files?.length) onUpload(field.id, event.target.files); event.target.value = ""; }}/>
          <label htmlFor={inputId} className={`tb-secondary-button ${readOnly || uploading ? "is-disabled" : ""}`} aria-disabled={readOnly || Boolean(uploading)}>
            {uploading === field.id ? <><Spinner className="size-3.5"/> Uploading…</> : <><Upload size={14}/> Add file</>}
          </label>
          {files.length >= TABLE_LIMITS.attachmentsPerCell && <small className="tb-muted">Up to {TABLE_LIMITS.attachmentsPerCell} files per field.</small>}
        </div>;
      }
      default:
        return <TextValueEditor field={field} value={value} disabled={readOnly} onCommit={(next, newChoices) => onChange(field.id, next, newChoices)}/>;
    }
  };

  return <aside className={`tb-record-panel ${mobile ? "is-mobile" : ""}`} aria-label="Record details">
    <header className="tb-record-head">
      <button type="button" className="tb-icon-button" onClick={onClose} aria-label={mobile ? "Back to records" : "Close record"}>{mobile ? <ArrowLeft size={17}/> : <X size={17}/>}</button>
      <h3 ref={heading} tabIndex={-1}>{title || "Untitled record"}</h3>
      {record.example && <Badge variant="warning-light" size="xs" className="tb-example-badge">Example</Badge>}
      <button type="button" className="tb-icon-button" onClick={onDuplicate} disabled={readOnly} aria-label="Duplicate record" title="Duplicate record"><Copy size={15}/></button>
      <button type="button" className="tb-icon-button is-danger" onClick={onDelete} disabled={readOnly} aria-label="Delete record" title="Delete record"><Trash2 size={15}/></button>
    </header>
    <div className="tb-record-fields">
      {fields.map((field) => <div key={field.id} className={`tb-record-field is-${field.type}`}>
        <span className="tb-record-label">{field.type === "attachment" && <Paperclip size={12} aria-hidden="true"/>}{field.name}</span>
        <div className="tb-record-value">{editor(field)}</div>
      </div>)}
    </div>
  </aside>;
}
