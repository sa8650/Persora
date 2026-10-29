import { useMemo, useState } from "react";
import { CalendarClock, Download, Search, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { PersoraDeleteModal } from "@/design-system";
import {
  advancedResponsesToCsv,
  isAnswerField,
  type AdvancedAnswerValue,
  type AdvancedForm,
  type AdvancedResponse,
} from "../../../../cloudflare/advanced-forms-rules.js";

function displayAnswer(value: AdvancedAnswerValue): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return `${value.name} (${Math.round(value.size / 1024)} KB)`;
  return String(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AdvancedResponsesTab({
  form,
  onDeleteResponse,
  notify,
}: {
  form: AdvancedForm;
  onDeleteResponse: (responseId: string) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [query, setQuery] = useState("");
  const [filterField, setFilterField] = useState("all");
  const [active, setActive] = useState<AdvancedResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdvancedResponse | null>(null);

  const answerFields = useMemo(() => form.fields.filter(isAnswerField), [form.fields]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return form.responses.filter((response) => {
      if (filterField !== "all" && !displayAnswer(response.answers[filterField]).replace("—", "").trim()) return false;
      if (!needle) return true;
      return Object.values(response.answers).some((value) => displayAnswer(value).toLowerCase().includes(needle));
    });
  }, [form.responses, query, filterField]);

  const summary = useMemo(() => {
    return answerFields.map((field) => {
      const values = form.responses
        .map((response) => response.answers[field.id])
        .filter((value) => value != null && value !== "" && !(Array.isArray(value) && value.length === 0));
      const counts = new Map<string, number>();
      values.forEach((value) => {
        const keys = Array.isArray(value) ? value : [displayAnswer(value)];
        keys.forEach((key) => counts.set(String(key), (counts.get(String(key)) || 0) + 1));
      });
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return { field, answered: values.length, top };
    });
  }, [answerFields, form.responses]);

  const exportCsv = () => {
    if (!form.responses.length) {
      notify("There are no responses to export yet.", "error");
      return;
    }
    const csv = advancedResponsesToCsv(form);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${form.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-responses.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Exported ${form.responses.length} ${form.responses.length === 1 ? "response" : "responses"} as CSV.`);
  };

  return (
    <div className="affr-root">
      <header className="affr-head">
        <div className="affr-stats">
          <div className="affr-stat">
            <IconTile variant="soft" size="sm" className="ds-tone-violet"><Users size={15} /></IconTile>
            <div><b>{form.responses.length}</b><span>{form.responses.length === 1 ? "response" : "responses"}</span></div>
          </div>
          <div className="affr-stat">
            <IconTile variant="soft" size="sm" className="ds-tone-blue"><CalendarClock size={15} /></IconTile>
            <div>
              <b>{form.responses[0] ? formatDate(form.responses[0].submittedAt).split(",")[0] : "—"}</b>
              <span>Latest submission</span>
            </div>
          </div>
          <div className="affr-stat">
            <IconTile variant="soft" size="sm" className="ds-tone-amber"><Search size={15} /></IconTile>
            <div><b>{summary.filter((entry) => entry.answered > 0).length}/{answerFields.length}</b><span>Questions answered</span></div>
          </div>
        </div>
        <button type="button" className="aff-primary" onClick={exportCsv} disabled={!form.responses.length}>
          <Download size={15} /> Export CSV
        </button>
      </header>

      <div className="affr-controls">
        <label className="aff-search">
          <Search size={14} aria-hidden="true" />
          <span className="aff-visually-hidden">Search responses</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search responses…" />
        </label>
        <label className="aff-filter">
          <span className="aff-visually-hidden">Filter responses</span>
          <select value={filterField} onChange={(event) => setFilterField(event.target.value)}>
            <option value="all">All questions answered</option>
            {answerFields.map((field) => <option key={field.id} value={field.id}>Has: {field.label || field.type}</option>)}
          </select>
        </label>
        <span className="affr-count">{filtered.length} shown</span>
      </div>

      {form.responses.length === 0 ? (
        <div className="aff-empty-state">
          <IconTile variant="soft" size="lg" className="ds-tone-violet"><Users size={20} /></IconTile>
          <h4>No responses yet</h4>
          <p>Publish the form and open the respondent view to collect your first response.</p>
        </div>
      ) : (
        <div className="affr-body">
          <div className="affr-table-wrap">
            <table className="affr-table">
              <thead>
                <tr>
                  <th scope="col">Submitted</th>
                  {answerFields.slice(0, 3).map((field) => <th key={field.id} scope="col">{field.label || field.type}</th>)}
                  <th scope="col"><span className="aff-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((response) => (
                  <tr key={response.id}>
                    <td>
                      <button type="button" className="affr-open" onClick={() => setActive(response)}>
                        {formatDate(response.submittedAt)}
                      </button>
                    </td>
                    {answerFields.slice(0, 3).map((field) => (
                      <td key={field.id} className="affr-answer">{displayAnswer(response.answers[field.id])}</td>
                    ))}
                    <td className="affr-row-actions">
                      <button type="button" onClick={() => setActive(response)}>View</button>
                      <button type="button" className="is-danger" aria-label="Delete response" onClick={() => setDeleteTarget(response)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr><td colSpan={answerFields.slice(0, 3).length + 2} className="affr-none">No responses match this search.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <aside className="affr-summary" aria-label="Answer summary">
            <h4>Answer summary</h4>
            {summary.map(({ field, answered, top }) => (
              <div key={field.id} className="affr-summary-row">
                <span className="affr-summary-label">{field.label || field.type}</span>
                <span className="affr-summary-count">{answered} answered</span>
                {top.map(([value, count]) => (
                  <div key={value} className="affr-bar">
                    <span className="affr-bar-label">{value}</span>
                    <span className="affr-bar-track"><span style={{ width: `${answered ? Math.round((count / answered) * 100) : 0}%` }} /></span>
                    <span className="affr-bar-count">{count}</span>
                  </div>
                ))}
              </div>
            ))}
          </aside>
        </div>
      )}

      {active ? (
        <div className="affr-detail-scrim" role="dialog" aria-modal="true" aria-label="Response detail" onClick={() => setActive(null)}>
          <div className="affr-detail" onClick={(event) => event.stopPropagation()}>
            <header className="affr-detail-head">
              <div>
                <h3>Response detail</h3>
                <p>{formatDate(active.submittedAt)}</p>
              </div>
              <Badge variant="secondary" size="xs">{active.device}</Badge>
            </header>
            <div className="affr-detail-body">
              {answerFields.map((field) => (
                <div key={field.id} className="affr-detail-row">
                  <span>{field.label || field.type}</span>
                  <b>{displayAnswer(active.answers[field.id])}</b>
                </div>
              ))}
            </div>
            <footer className="affr-detail-foot">
              <button type="button" className="aff-ghost" onClick={() => setActive(null)}>Close</button>
            </footer>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <PersoraDeleteModal
          eyebrow="Advanced Forms"
          title="Delete this response?"
          description="The response and every answer in it will be removed from this form."
          confirmLabel="Delete response"
          cancelLabel="Keep response"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            onDeleteResponse(deleteTarget.id);
            setDeleteTarget(null);
            notify("Response deleted.");
          }}
        />
      ) : null}
    </div>
  );
}
