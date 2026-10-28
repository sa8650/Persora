// Persora Table — per-view settings: filters, sort, visible fields, grouping,
// calendar date field and gallery cover. Views never change records.
import { useState } from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import {
  CHOICE_TYPES, FILTER_OPERATORS, NUMERIC_TYPES, TABLE_LIMITS, operatorsFor,
  type Field, type FilterOperator, type TableView, type ViewFilter, type ViewSort,
} from "../../../cloudflare/table-rules.js";
import { TableDialog } from "./table-ui";
import { Checkbox } from "@/components/ui/checkbox";

const NO_VALUE_OPS: FilterOperator[] = ["empty", "not_empty", "checked", "unchecked"];

function FilterValue({ field, filter, onChange }: { field: Field; filter: ViewFilter; onChange: (value: ViewFilter["value"]) => void }) {
  if (NO_VALUE_OPS.includes(filter.op)) return null;
  if (field.type === "select" || field.type === "status") {
    return <select aria-label="Value" value={String(filter.value || "")} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose…</option>{(field.choices || []).map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select>;
  }
  if (field.type === "multiselect") {
    const wanted = Array.isArray(filter.value) ? filter.value : [];
    return <span className="tb-filter-choices">{(field.choices || []).map((choice) => <label key={choice.id}>
      <Checkbox checked={wanted.includes(choice.id)} onCheckedChange={(checked) => onChange(checked === true ? [...wanted, choice.id] : wanted.filter((id) => id !== choice.id))}/> {choice.label}
    </label>)}</span>;
  }
  if (field.type === "date") return <input aria-label="Date" type="date" value={String(filter.value || "")} onChange={(event) => onChange(event.target.value)}/>;
  return <input aria-label="Value" inputMode={NUMERIC_TYPES.includes(field.type) ? "decimal" : undefined} value={String(filter.value ?? "")} maxLength={200}
    placeholder={field.type === "percent" ? "e.g. 15" : "Value"} onChange={(event) => onChange(event.target.value)}/>;
}

export default function ViewSettingsDialog({ view, fields, primaryField, onSave, onClose }: {
  view: TableView;
  fields: Field[];
  primaryField: string;
  onSave: (view: TableView) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TableView>(() => ({ ...view, filters: view.filters.map((filter) => ({ ...filter })), sort: view.sort.map((entry) => ({ ...entry })), hidden: [...view.hidden] }));
  const byId = new Map(fields.map((field) => [field.id, field]));
  const groupable = fields.filter((field) => field.type === "select" || field.type === "status");
  const dates = fields.filter((field) => field.type === "date");
  const covers = fields.filter((field) => field.type === "attachment");
  const set = (patch: Partial<TableView>) => setDraft((current) => ({ ...current, ...patch }));
  const setFilter = (index: number, patch: Partial<ViewFilter>) => set({ filters: draft.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)) });
  const setSort = (index: number, patch: Partial<ViewSort>) => set({ sort: draft.sort.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) });
  const nameProblem = draft.name.trim() ? null : "Enter a view name.";

  return <TableDialog id="tb-view-settings" title={`${view.name} settings`} icon={<SlidersHorizontal size={18}/>} wide onClose={onClose}
    footer={<><button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
      <button type="button" className="editor-submit" disabled={Boolean(nameProblem)} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>Save view</button></>}>
    <div className="tb-form">
      <div className="tb-form-grid">
        <label className="tb-field"><span>View name</span><input value={draft.name} maxLength={40} onChange={(event) => set({ name: event.target.value })} aria-invalid={Boolean(nameProblem)}/></label>
        {(draft.type === "board" || draft.type === "table") && <label className="tb-field"><span>{draft.type === "board" ? "Group cards by" : "Group rows by"}</span>
          <select value={draft.groupBy || ""} onChange={(event) => set({ groupBy: event.target.value || null })}>
            <option value="">{draft.type === "board" ? (groupable.length ? "Choose a field…" : "Add a Single select or Status field first") : "No grouping"}</option>
            {groupable.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
          </select>
        </label>}
        {draft.type === "calendar" && <label className="tb-field"><span>Date field</span>
          <select value={draft.dateField || ""} onChange={(event) => set({ dateField: event.target.value || null })}>
            <option value="">{dates.length ? "Choose a field…" : "Add a Date field first"}</option>
            {dates.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
          </select>
        </label>}
        {draft.type === "gallery" && <label className="tb-field"><span>Card image</span>
          <select value={draft.coverField || ""} onChange={(event) => set({ coverField: event.target.value || null })}>
            <option value="">{covers.length ? "No image" : "No Attachment field yet"}</option>
            {covers.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
          </select>
        </label>}
      </div>

      <fieldset className="tb-field tb-rule-list"><legend>Filters <small>(records must match all)</small></legend>
        {draft.filters.length === 0 && <p className="tb-muted">No filters — every record is shown.</p>}
        {draft.filters.map((filter, index) => {
          const field = byId.get(filter.fieldId);
          if (!field) return null;
          return <div key={index} className="tb-rule">
            <select aria-label="Field" value={filter.fieldId} onChange={(event) => { const next = byId.get(event.target.value)!; setFilter(index, { fieldId: next.id, op: operatorsFor(next.type)[0], value: CHOICE_TYPES.includes(next.type) && next.type === "multiselect" ? [] : "" }); }}>
              {fields.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
            <select aria-label="Condition" value={filter.op} onChange={(event) => setFilter(index, { op: event.target.value as FilterOperator })}>
              {operatorsFor(field.type).map((op) => <option key={op} value={op}>{FILTER_OPERATORS[op]}</option>)}
            </select>
            <FilterValue field={field} filter={filter} onChange={(value) => setFilter(index, { value })}/>
            <button type="button" className="tb-icon-button" aria-label="Remove filter" onClick={() => set({ filters: draft.filters.filter((_, i) => i !== index) })}><Trash2 size={14}/></button>
          </div>;
        })}
        <button type="button" className="tb-link-button" disabled={draft.filters.length >= TABLE_LIMITS.viewFilters || !fields.length}
          onClick={() => { const field = fields[0]; set({ filters: [...draft.filters, { fieldId: field.id, op: operatorsFor(field.type)[0], value: "" }] }); }}><Plus size={13}/> Add filter</button>
      </fieldset>

      <fieldset className="tb-field tb-rule-list"><legend>Sort</legend>
        {draft.sort.length === 0 && <p className="tb-muted">Records keep their own order.</p>}
        {draft.sort.map((entry, index) => <div key={index} className="tb-rule">
          <select aria-label="Sort field" value={entry.fieldId} onChange={(event) => setSort(index, { fieldId: event.target.value })}>
            {fields.filter((field) => field.type !== "attachment").map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}
          </select>
          <select aria-label="Direction" value={entry.dir} onChange={(event) => setSort(index, { dir: event.target.value as "asc" | "desc" })}>
            <option value="asc">Ascending</option><option value="desc">Descending</option>
          </select>
          <button type="button" className="tb-icon-button" aria-label="Remove sort" onClick={() => set({ sort: draft.sort.filter((_, i) => i !== index) })}><Trash2 size={14}/></button>
        </div>)}
        <button type="button" className="tb-link-button" disabled={draft.sort.length >= 3 || !fields.length}
          onClick={() => set({ sort: [...draft.sort, { fieldId: (fields.find((field) => field.type !== "attachment") || fields[0]).id, dir: "asc" }] })}><Plus size={13}/> Add sort</button>
      </fieldset>

      <fieldset className="tb-field tb-visible-fields"><legend>Visible fields</legend>
        {fields.map((field) => <label key={field.id}>
          <Checkbox disabled={field.id === primaryField} checked={!draft.hidden.includes(field.id)}
            onCheckedChange={(checked) => set({ hidden: checked === true ? draft.hidden.filter((id) => id !== field.id) : [...draft.hidden, field.id] })}/>
          {field.name}{field.id === primaryField && <small> (primary)</small>}
        </label>)}
      </fieldset>
    </div>
  </TableDialog>;
}
