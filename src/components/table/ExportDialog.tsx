// Persora Table — export as CSV or Excel, with an honest list of what each
// format keeps and loses (shown before the download, not after).
import { useState } from "react";
import { Download, Info } from "lucide-react";
import { exportNotes } from "../../../cloudflare/table-io.js";
import type { TableKind } from "../../../cloudflare/table-rules.js";
import { TableDialog } from "./table-ui";

export default function ExportDialog({ kind, sheets = 1, attachments = false, scopeNote, onClose, onExport }: {
  kind: TableKind;
  sheets?: number;
  attachments?: boolean;
  /** Extra line about what is exported (e.g. "Records in the current view"). */
  scopeNote?: string;
  onClose: () => void;
  onExport: (format: "csv" | "xlsx") => Promise<void>;
}) {
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notes = exportNotes(kind, format, { sheets, attachments });
  const run = async () => {
    setBusy(true); setError(null);
    try { await onExport(format); onClose(); } catch (problem) {
      setError(problem instanceof Error && problem.message ? problem.message : "The file couldn't be created. Try again.");
    } finally { setBusy(false); }
  };
  return <TableDialog id="tb-export-title" title="Export" icon={<Download size={18}/>} busy={busy} onClose={onClose}
    footer={<><button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="editor-submit" onClick={() => void run()} disabled={busy}>{busy ? <><span className="spinner"/> Preparing…</> : `Download .${format}`}</button></>}>
    <div className="tb-form">
      <fieldset className="tb-field tb-radio-stack"><legend>Format</legend>
        <label><input type="radio" name="tb-export-format" checked={format === "xlsx"} onChange={() => setFormat("xlsx")}/> <span><b>Excel (.xlsx)</b><small>{kind === "spreadsheet" ? "All sheets, values, formulas and basic formatting" : "Fields as columns, typed values"}</small></span></label>
        <label><input type="radio" name="tb-export-format" checked={format === "csv"} onChange={() => setFormat("csv")}/> <span><b>CSV (.csv)</b><small>Plain values only — opens anywhere</small></span></label>
      </fieldset>
      {scopeNote && <p className="tb-muted">{scopeNote}</p>}
      <ul className="tb-notes">{notes.map((note) => <li key={note}><Info size={13} aria-hidden="true"/> {note}</li>)}</ul>
      {error && <p className="tb-form-error" role="alert">{error}</p>}
    </div>
  </TableDialog>;
}
