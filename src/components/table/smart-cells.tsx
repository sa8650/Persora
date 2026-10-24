// Persora Table — Smart Table value rendering and inline editors per field type.
import { useEffect, useRef, useState } from "react";
import { Paperclip, TriangleAlert } from "lucide-react";
import {
  coerceFieldInput, displayValue, isEmptyValue, textOfValue, validateFieldValue,
  type AttachmentRef, type Choice, type Field, type FieldValue, type PersonRef,
} from "../../../cloudflare/table-rules.js";
import type { TablePerson } from "../../lib/table/table-api";

export const choiceOf = (field: Field, id: unknown): Choice | undefined => (field.choices || []).find((choice) => choice.id === id);

export function ChoiceChip({ choice }: { choice: Choice }) {
  return <span className={`tb-choice is-${/^[a-z]+$/u.test(String(choice.color)) ? choice.color : "gray"}`}>{choice.label}</span>;
}

/** Read-only rendering of a field value (used by the grid, cards and the record panel). */
export function ValueView({ field, value, compact = false }: { field: Field; value: FieldValue | undefined; compact?: boolean }) {
  if (isEmptyValue(value)) return field.type === "checkbox" ? <span className="tb-check is-off" aria-label="Not checked"/> : null;
  const check = validateFieldValue(field, value);
  if (!check.valid) {
    return <span className="tb-invalid" title={`${check.message || "This value doesn't match the field type."} It's kept as written.`}>
      <TriangleAlert size={12} aria-hidden="true"/>{textOfValue(field, value)}
      <span className="tb-visually-hidden"> (doesn't match the field type)</span>
    </span>;
  }
  switch (field.type) {
    case "checkbox": return value ? <span className="tb-check is-on" aria-label="Checked">✓</span> : <span className="tb-check is-off" aria-label="Not checked"/>;
    case "select": case "status": { const choice = choiceOf(field, value); return choice ? <ChoiceChip choice={choice}/> : null; }
    case "multiselect": return <span className="tb-chips-inline">{(value as string[]).map((id) => { const choice = choiceOf(field, id); return choice ? <ChoiceChip key={id} choice={choice}/> : null; })}</span>;
    case "url": return <a className="tb-cell-link" href={String(value)} target="_blank" rel="noopener noreferrer nofollow" onClick={(event) => event.stopPropagation()}>{String(value).replace(/^https?:\/\//u, "")}</a>;
    case "email": return <a className="tb-cell-link" href={`mailto:${String(value)}`} onClick={(event) => event.stopPropagation()}>{String(value)}</a>;
    case "person": return <span className="tb-person">{(value as PersonRef).name}</span>;
    case "attachment": {
      const files = value as AttachmentRef[];
      return <span className="tb-attach-summary"><Paperclip size={12} aria-hidden="true"/>{compact || files.length > 1 ? `${files.length} file${files.length === 1 ? "" : "s"}` : files[0].name}</span>;
    }
    default: return <>{displayValue(field, value)}</>;
  }
}

/** Text the inline editor starts with (raw-ish, round-trips through coerceFieldInput). */
export function editTextOf(field: Field, value: FieldValue | undefined): string {
  if (isEmptyValue(value)) return "";
  if (!validateFieldValue(field, value).valid) return textOfValue(field, value);
  if (field.type === "percent" && typeof value === "number") return String(Number((value * 100).toPrecision(12)));
  if ((field.type === "number" || field.type === "currency") && typeof value === "number") return String(value);
  return textOfValue(field, value);
}

export type CommitValue = (value: FieldValue, newChoices?: Choice[]) => void;

/**
 * Inline editor for one value. Text-like fields validate on commit and stay
 * open with a message when the input doesn't fit the type (nothing is lost).
 */
export function InlineEditor({ field, value, initialText, people, onCommit, onCancel, onMove }: {
  field: Field;
  value: FieldValue | undefined;
  initialText?: string;
  people: TablePerson[] | null;
  onCommit: CommitValue;
  onCancel: () => void;
  onMove?: (direction: "down" | "right" | "left" | "up") => void;
}) {
  const [text, setText] = useState(initialText ?? editTextOf(field, value));
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const inputRef = ref as React.MutableRefObject<HTMLInputElement | null>;
  const selectRef = ref as React.MutableRefObject<HTMLSelectElement | null>;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    if (element instanceof HTMLInputElement && initialText === undefined && element.type === "text") element.select();
  }, [initialText]);

  const commitText = (move?: "down" | "right" | "left" | "up") => {
    const result = coerceFieldInput(field, text, { createChoices: field.type === "multiselect" });
    if (!result.ok) { setError(result.message || "This value doesn't fit the field."); return; }
    onCommit(result.value, result.newChoices);
    if (move) onMove?.(move);
  };
  const keys = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    else if (event.key === "Enter") { event.preventDefault(); commitText(event.shiftKey ? "up" : "down"); }
    else if (event.key === "Tab") { event.preventDefault(); commitText(event.shiftKey ? "left" : "right"); }
  };

  if (field.type === "select" || field.type === "status") {
    return <select ref={selectRef} className="tb-inline-input" aria-label={field.name} value={typeof value === "string" && choiceOf(field, value) ? value : ""}
      onChange={(event) => onCommit(event.target.value || null)} onBlur={onCancel}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
      <option value="">—</option>
      {(field.choices || []).map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select>;
  }
  if (field.type === "person") {
    const current = value && typeof value === "object" && !Array.isArray(value) ? (value as PersonRef).id : "";
    return <select ref={selectRef} className="tb-inline-input" aria-label={field.name} value={current}
      onChange={(event) => { const person = people?.find((entry) => entry.id === event.target.value); onCommit(person ? { id: person.id, name: person.name } : null); }} onBlur={onCancel}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
      <option value="">—</option>
      {current && !people?.some((entry) => entry.id === current) && <option value={current}>{(value as PersonRef).name}</option>}
      {(people || []).map((person) => <option key={person.id} value={person.id}>{person.name}{person.me ? " (you)" : ""}</option>)}
    </select>;
  }
  const inputType = field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text";
  const inputMode = field.type === "number" || field.type === "currency" || field.type === "percent" ? "decimal" : undefined;
  return <span className="tb-inline-wrap">
    <input ref={inputRef} className={`tb-inline-input ${error ? "is-invalid" : ""}`} aria-label={field.name} aria-invalid={Boolean(error)} type={inputType} inputMode={inputMode}
      value={field.type === "date" && text && !/^\d{4}-\d{2}-\d{2}$/u.test(text) ? "" : text}
      placeholder={field.type === "multiselect" ? "Comma-separated options" : field.type === "percent" ? "e.g. 15" : undefined}
      onChange={(event) => { setText(event.target.value); setError(null); }} onKeyDown={keys}
      onBlur={() => { const result = coerceFieldInput(field, text, { createChoices: field.type === "multiselect" }); if (result.ok) onCommit(result.value, result.newChoices); else setError(result.message || "This value doesn't fit the field."); }}/>
    {error && <span className="tb-inline-error" role="alert">{error}</span>}
  </span>;
}
