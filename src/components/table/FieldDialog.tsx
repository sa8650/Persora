// Persora Table — create or edit a Smart Table field, including a safe type
// change preview: values convert when possible and are otherwise kept as
// written (flagged) — never deleted.
import { useMemo, useState } from "react";
import { Info, Plus, SlidersHorizontal, Trash2, TriangleAlert } from "lucide-react";
import {
  CHOICE_COLORS, CHOICE_TYPES, DEFAULT_STATUS_CHOICES, FIELD_TYPES, TABLE_CURRENCIES, TABLE_LIMITS, makeChoices, newField, newLocalId, planRetype,
  type Choice, type Field, type FieldType, type FieldValue, type TableRecord,
} from "../../../cloudflare/table-rules.js";
import { TableDialog, plural } from "./table-ui";

export interface FieldSaveResult { field: Field; values?: Map<string, FieldValue> }

export default function FieldDialog({ field, fields, records, onSave, onClose }: {
  field: Field | null;
  fields: Field[];
  records: TableRecord[];
  onSave: (result: FieldSaveResult) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(field?.name || "");
  const [type, setType] = useState<FieldType>(field?.type || "text");
  const [choices, setChoices] = useState<Choice[]>(field?.choices?.map((choice) => ({ ...choice })) || []);
  const [currency, setCurrency] = useState(field?.currency || "BDT");
  const [decimals, setDecimals] = useState<number | "">(field?.decimals ?? "");
  const [touched, setTouched] = useState(false);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    if (!field || !CHOICE_TYPES.includes(field.type)) return counts;
    for (const record of records) {
      const value = record.values?.[field.id];
      for (const id of Array.isArray(value) ? value : value ? [value] : []) if (typeof id === "string") counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }, [field, records]);

  const isChoice = CHOICE_TYPES.includes(type);
  const plan = useMemo(() => (field && field.type !== type ? planRetype(field, type, records) : null), [field, type, records]);
  const trimmed = name.trim();
  const nameProblem = !trimmed ? "Enter a field name."
    : trimmed.length > TABLE_LIMITS.fieldNameLength ? `Use at most ${TABLE_LIMITS.fieldNameLength} characters.`
      : fields.some((other) => other.id !== field?.id && other.name.trim().toLowerCase() === trimmed.toLowerCase()) ? "Another field already has this name."
        : null;
  const choiceProblem = isChoice && choices.some((choice) => !choice.label.trim()) ? "Every option needs a label."
    : isChoice && new Set(choices.map((choice) => choice.label.trim().toLowerCase())).size !== choices.length ? "Options must have different labels." : null;

  const changeType = (next: FieldType) => {
    setType(next);
    if (CHOICE_TYPES.includes(next) && !choices.length) {
      setChoices(next === "status" ? makeChoices(DEFAULT_STATUS_CHOICES.map((choice) => ({ ...choice }))) : []);
    }
  };

  const save = () => {
    setTouched(true);
    if (nameProblem || choiceProblem || (plan && !plan.allowed)) return;
    const options = {
      ...(isChoice ? { choices: choices.map((choice) => ({ ...choice, label: choice.label.trim() })) } : {}),
      ...(type === "currency" ? { currency } : {}),
      ...((type === "number" || type === "currency" || type === "percent") && decimals !== "" ? { decimals: Number(decimals) } : {}),
    };
    if (!field) { onSave({ field: newField(trimmed, type, options) }); return; }
    if (plan) {
      // Retype: start from the plan's field (it may have gained options while converting).
      const merged: Field = { ...plan.field, name: trimmed, ...options };
      if (isChoice) {
        // Keep the options edited here, plus any the conversion had to create.
        const own = options.choices || [];
        const created = (plan.field.choices || []).filter((choice) => !own.some((entry) => entry.id === choice.id || entry.label.toLowerCase() === choice.label.toLowerCase()));
        merged.choices = [...own, ...created].slice(0, TABLE_LIMITS.choices);
        // Values the plan pointed at its own option ids move to the matching option kept here.
        const remap = new Map<string, string>();
        for (const choice of plan.field.choices || []) {
          const match = own.find((entry) => entry.id === choice.id || entry.label.toLowerCase() === choice.label.toLowerCase());
          if (match) remap.set(choice.id, match.id);
        }
        const values = new Map<string, FieldValue>();
        for (const [recordId, value] of plan.values) {
          values.set(recordId, Array.isArray(value) ? (value as string[]).map((id) => remap.get(id) ?? id) : typeof value === "string" ? remap.get(value) ?? value : value);
        }
        onSave({ field: merged, values });
        return;
      }
      onSave({ field: merged, values: plan.values });
      return;
    }
    const next: Field = { ...field, name: trimmed, ...options };
    if (!isChoice) delete next.choices;
    if (type !== "currency") delete next.currency;
    if (!(type === "number" || type === "currency" || type === "percent") || decimals === "") delete next.decimals;
    onSave({ field: next });
  };

  return <TableDialog id="tb-field-title" title={field ? `Edit field “${field.name}”` : "New field"} icon={<SlidersHorizontal size={18}/>} onClose={onClose}
    footer={<><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button type="button" className="editor-submit" onClick={save} disabled={Boolean(plan && !plan.allowed)}>{field ? "Save field" : "Add field"}</button></>}>
    <form className="tb-form" noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="tb-form-grid">
        <label className="tb-field"><span>Name</span>
          <input autoFocus value={name} maxLength={TABLE_LIMITS.fieldNameLength} onChange={(event) => setName(event.target.value)} aria-invalid={touched && Boolean(nameProblem)}/>
        </label>
        <label className="tb-field"><span>Type</span>
          <select value={type} onChange={(event) => changeType(event.target.value as FieldType)}>
            {FIELD_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        {type === "currency" && <label className="tb-field"><span>Currency</span>
          <select value={currency} onChange={(event) => setCurrency(event.target.value)}>{TABLE_CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select>
        </label>}
        {(type === "number" || type === "currency" || type === "percent") && <label className="tb-field"><span>Decimal places</span>
          <select value={decimals} onChange={(event) => setDecimals(event.target.value === "" ? "" : Number(event.target.value))}>
            <option value="">Automatic</option>{[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>}
      </div>
      {touched && nameProblem && <p className="tb-form-error" role="alert">{nameProblem}</p>}

      {isChoice && <fieldset className="tb-field tb-choices-editor"><legend>Options</legend>
        {choices.length === 0 && <p className="tb-muted">No options yet.{type === "multiselect" ? " New options are also created when you type them in a cell." : ""}</p>}
        <ul>{choices.map((choice, index) => {
          const used = usage.get(choice.id) || 0;
          return <li key={choice.id}>
            <select aria-label={`Color for ${choice.label || "option"}`} value={String(choice.color)} className={`tb-choice-color is-${choice.color}`}
              onChange={(event) => setChoices((list) => list.map((entry, i) => (i === index ? { ...entry, color: event.target.value } : entry)))}>
              {CHOICE_COLORS.map((color) => <option key={color} value={color}>{color}</option>)}
            </select>
            <input aria-label="Option label" value={choice.label} maxLength={TABLE_LIMITS.choiceLength} onChange={(event) => setChoices((list) => list.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)))}/>
            <button type="button" className="tb-icon-button" disabled={used > 0} title={used ? `Used by ${plural(used, "record")} — change those records first` : "Remove option"} aria-label={`Remove option ${choice.label}`}
              onClick={() => setChoices((list) => list.filter((_, i) => i !== index))}><Trash2 size={14}/></button>
            {used > 0 && <small className="tb-muted">{plural(used, "record")}</small>}
          </li>;
        })}</ul>
        <button type="button" className="tb-link-button" disabled={choices.length >= TABLE_LIMITS.choices}
          onClick={() => setChoices((list) => [...list, { id: newLocalId("c"), label: "", color: CHOICE_COLORS[list.length % CHOICE_COLORS.length] }])}><Plus size={13}/> Add option</button>
        {touched && choiceProblem && <p className="tb-form-error" role="alert">{choiceProblem}</p>}
      </fieldset>}

      {plan && (plan.allowed
        ? <div className="tb-report" role="status">
          <p><Info size={13}/> Changing <b>{field!.name}</b> to {FIELD_TYPES.find((entry) => entry.id === type)?.label}: {plural(plan.converted, "value")} will convert.</p>
          {plan.kept > 0 && <p className="tb-hint"><TriangleAlert size={13}/> {plural(plan.kept, "value")} can't convert and will be kept exactly as written, marked for review (e.g. {plan.examples.map((example) => `“${example}”`).join(", ")}). Nothing is deleted, and you can undo this change.</p>}
        </div>
        : <p className="tb-form-error" role="alert"><TriangleAlert size={13}/> {plan.reason}</p>)}
    </form>
  </TableDialog>;
}
