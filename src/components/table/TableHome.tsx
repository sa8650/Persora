// Persora Table — home page: New table, starred and recent tables, search,
// sort, simple labels, and rename/duplicate/star/delete.
import { useEffect, useMemo, useState } from "react";
import { Copy, Database, FileUp, LayoutTemplate, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Sheet, Star, Tag, Trash2 } from "lucide-react";
import type { AppUser } from "../../types";
import { ConfirmDialog } from "../VaultDialogs";
import ModalPortal from "../ModalPortal";
import { TABLE_LIMITS } from "../../../cloudflare/table-rules.js";
import { TABLE_TEMPLATES, blankSmartTable, blankSpreadsheet, buildTemplate } from "../../../cloudflare/table-templates.js";
import { createTable, deleteTable, duplicateTable, listTables, tableErrorMessage, updateTableInfo, type CreateTableBody, type TableSummary } from "../../lib/table/table-api";
import { listDrafts, type TableDraft } from "../../lib/table/table-drafts";
import { Menu, PromptDialog, TableDialog, newId, plural, relativeTime } from "./table-ui";
import ImportDialog from "./ImportDialog";

type SortKey = "recent" | "opened" | "name" | "created";
type Filter = "all" | "starred" | "spreadsheet" | "smart" | `label:${string}`;

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function KindIcon({ kind, size = 16 }: { kind: TableSummary["kind"]; size?: number }) {
  return kind === "smart" ? <Database size={size} aria-hidden="true"/> : <Sheet size={size} aria-hidden="true"/>;
}

export default function TableHome({ user, notify, onOpen, onTrashChanged }: {
  user: AppUser;
  notify: (message: string, kind?: "success" | "error") => void;
  onOpen: (id: string) => void;
  onTrashChanged?: () => void;
}) {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TableSummary | null>(null);
  const [labelTarget, setLabelTarget] = useState<TableSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TableSummary | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<TableDraft[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    listTables(controller.signal).then((list) => setTables(list)).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadError(tableErrorMessage(error, "Your tables couldn't be loaded. Check your connection and try again."));
    });
    listDrafts(user.id).then(setDrafts).catch(() => setDrafts([]));
    return () => controller.abort();
  }, [reloadKey, user.id]);

  const labels = useMemo(() => [...new Set((tables || []).map((table) => table.label).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [tables]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const list = (tables || []).filter((table) => {
      if (query && !table.name.toLocaleLowerCase().includes(query) && !table.label.toLocaleLowerCase().includes(query)) return false;
      if (filter === "starred") return table.starred;
      if (filter === "spreadsheet" || filter === "smart") return table.kind === filter;
      if (filter.startsWith("label:")) return table.label === filter.slice(6);
      return true;
    });
    const by: Record<SortKey, (a: TableSummary, b: TableSummary) => number> = {
      recent: (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      opened: (a, b) => Date.parse(b.openedAt || b.createdAt) - Date.parse(a.openedAt || a.createdAt),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
      created: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    };
    return list.sort(by[sort]);
  }, [tables, search, filter, sort]);
  const starred = useMemo(() => (tables || []).filter((table) => table.starred).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [tables]);
  const atLimit = (tables?.length || 0) >= TABLE_LIMITS.tables;
  const pendingDrafts = drafts.filter((draft) => (tables || []).some((table) => table.id === draft.tableId));

  const mirror = (next: TableSummary) => setTables((current) => current ? (current.some((row) => row.id === next.id) ? current.map((row) => (row.id === next.id ? next : row)) : [next, ...current]) : [next]);

  const create = async (body: Omit<CreateTableBody, "id">, label: string) => {
    if (atLimit) { notify(`You can have up to ${TABLE_LIMITS.tables} tables. Delete some you no longer need first.`, "error"); return false; }
    setBusy("create");
    try {
      const table = await createTable({ id: newId(), ...body });
      mirror(table);
      notify(label);
      onOpen(table.id);
      return true;
    } catch (error) {
      notify(tableErrorMessage(error, "The table couldn't be created. Check your connection and try again."), "error");
      return false;
    } finally { setBusy(null); }
  };
  const createBlank = (kind: "spreadsheet" | "smart") => {
    if (kind === "spreadsheet") void create({ kind, name: "Untitled spreadsheet", sheets: blankSpreadsheet().sheets }, "Spreadsheet created.");
    else { const content = blankSmartTable(); void create({ kind, name: "Untitled table", meta: content.meta, records: content.records }, "Smart Table created."); }
  };
  const createFromTemplate = async (templateId: string) => {
    const info = TABLE_TEMPLATES.find((entry) => entry.id === templateId);
    const content = buildTemplate(templateId, todayIso());
    if (!info || !content) return;
    const ok = await create(content.kind === "smart"
      ? { kind: "smart", name: info.name, template: info.id, meta: content.meta, records: content.records }
      : { kind: "spreadsheet", name: info.name, template: info.id, sheets: content.sheets }, `${info.name} created. Example rows are labelled — remove them when you're ready.`);
    if (ok) setTemplatesOpen(false);
  };

  const toggleStar = async (table: TableSummary) => {
    mirror({ ...table, starred: !table.starred });
    try { mirror(await updateTableInfo(table.id, { starred: !table.starred })); } catch (error) {
      mirror(table);
      notify(tableErrorMessage(error, "The star couldn't be saved. Try again."), "error");
    }
  };
  const rename = async (table: TableSummary, name: string) => {
    setBusy("rename"); setDialogError(null);
    try { mirror(await updateTableInfo(table.id, { name })); setRenameTarget(null); notify("Table renamed."); } catch (error) {
      setDialogError(tableErrorMessage(error, "The new name couldn't be saved. Try again."));
    } finally { setBusy(null); }
  };
  const setLabel = async (table: TableSummary, label: string) => {
    setBusy("label"); setDialogError(null);
    try { mirror(await updateTableInfo(table.id, { label: label.trim() })); setLabelTarget(null); notify(label.trim() ? "Label saved." : "Label removed."); } catch (error) {
      setDialogError(tableErrorMessage(error, "The label couldn't be saved. Try again."));
    } finally { setBusy(null); }
  };
  const duplicate = async (table: TableSummary) => {
    if (atLimit) { notify(`You can have up to ${TABLE_LIMITS.tables} tables.`, "error"); return; }
    setBusy(`dup:${table.id}`);
    try { mirror(await duplicateTable(table.id, newId(), `${table.name} copy`.slice(0, TABLE_LIMITS.nameLength))); notify("Table duplicated."); } catch (error) {
      notify(tableErrorMessage(error, "The table couldn't be duplicated. Try again."), "error");
    } finally { setBusy(null); }
  };
  const remove = async (table: TableSummary) => {
    setBusy("delete");
    try {
      await deleteTable(table.id);
      setTables((current) => current?.filter((row) => row.id !== table.id) || null);
      setDeleteTarget(null);
      notify("Moved to Trash. You can restore it for 7 days.");
      onTrashChanged?.();
    } catch (error) {
      notify(tableErrorMessage(error, "The table couldn't be deleted. Try again."), "error");
    } finally { setBusy(null); }
  };

  const row = (table: TableSummary) => <li key={table.id} className="tb-row">
    <button type="button" className="tb-row-open" onClick={() => onOpen(table.id)} aria-label={`Open ${table.name}`}>
      <span className={`tb-kind-badge is-${table.kind}`}><KindIcon kind={table.kind}/></span>
      <span className="tb-row-main">
        <b>{table.name}</b>
        <small>{table.kind === "smart" ? `Smart Table · ${plural(table.recordCount, "record")}` : `Spreadsheet · ${plural(table.sheetCount, "sheet")}`} · Edited {relativeTime(table.updatedAt)}</small>
      </span>
      {table.label && <span className="tb-label-chip">{table.label}</span>}
    </button>
    <button type="button" className={`tb-icon-button tb-star ${table.starred ? "is-on" : ""}`} aria-pressed={table.starred} aria-label={table.starred ? `Unstar ${table.name}` : `Star ${table.name}`} title={table.starred ? "Unstar" : "Star"} onClick={() => void toggleStar(table)}>
      <Star size={16} fill={table.starred ? "currentColor" : "none"}/>
    </button>
    <Menu label={`More actions for ${table.name}`} icon={busy === `dup:${table.id}` ? <span className="spinner"/> : <MoreHorizontal size={16}/>} align="end" items={[
      { id: "rename", label: "Rename", icon: <Pencil size={14}/>, onSelect: () => { setDialogError(null); setRenameTarget(table); } },
      { id: "label", label: table.label ? "Change label" : "Add label", icon: <Tag size={14}/>, onSelect: () => { setDialogError(null); setLabelTarget(table); } },
      { id: "duplicate", label: "Duplicate", icon: <Copy size={14}/>, disabled: atLimit, onSelect: () => void duplicate(table) },
      "divider",
      { id: "delete", label: "Delete", icon: <Trash2 size={14}/>, danger: true, onSelect: () => setDeleteTarget(table) },
    ]}/>
  </li>;

  const newMenu = <Menu label="New table" buttonClassName="tb-primary-button" align="end" icon={busy === "create" ? <span className="spinner"/> : <Plus size={16}/>} items={[
    { id: "sheet", label: "Blank spreadsheet", hint: "Cells, formulas and sheets", icon: <Sheet size={15}/>, onSelect: () => createBlank("spreadsheet") },
    { id: "smart", label: "Smart Table", hint: "Typed fields, views and summaries", icon: <Database size={15}/>, onSelect: () => createBlank("smart") },
    "divider",
    { id: "template", label: "From template…", icon: <LayoutTemplate size={15}/>, onSelect: () => setTemplatesOpen(true) },
    { id: "import", label: "Import file…", hint: "CSV or Excel (.xlsx)", icon: <FileUp size={15}/>, onSelect: () => setImportOpen(true) },
  ]}><span>New table</span></Menu>;

  return <section className="tb-home" aria-labelledby="tb-home-title">
    <header className="tb-home-head">
      <div>
        <h2 id="tb-home-title">Persora Table</h2>
        <p>Spreadsheets and Smart Tables, saved privately to your account.</p>
      </div>
      {newMenu}
    </header>

    {pendingDrafts.length > 0 && <div className="tb-banner is-info" role="status">
      <span>Unsaved changes are kept on this device for {pendingDrafts.map((draft) => draft.name).join(", ")}.</span>
      <button type="button" className="tb-link-button" onClick={() => onOpen(pendingDrafts[0].tableId)}>Open to review</button>
    </div>}

    {tables && tables.length > 0 && <div className="tb-home-tools">
      <label className="tb-search"><Search size={15} aria-hidden="true"/><span className="tb-visually-hidden">Search tables</span>
        <input type="search" placeholder="Search tables" value={search} onChange={(event) => setSearch(event.target.value)}/>
      </label>
      <div className="tb-chips" role="group" aria-label="Show">
        {([["all", "All"], ["starred", "Starred"], ["spreadsheet", "Spreadsheets"], ["smart", "Smart Tables"]] as Array<[Filter, string]>).map(([id, text]) =>
          <button key={id} type="button" className={`tb-chip ${filter === id ? "is-active" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{text}</button>)}
        {labels.map((label) => <button key={label} type="button" className={`tb-chip ${filter === `label:${label}` ? "is-active" : ""}`} aria-pressed={filter === `label:${label}`} onClick={() => setFilter(`label:${label}`)}><Tag size={12} aria-hidden="true"/>{label}</button>)}
      </div>
      <label className="tb-select"><span className="tb-visually-hidden">Sort tables</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
          <option value="recent">Recently edited</option>
          <option value="opened">Recently opened</option>
          <option value="name">Name</option>
          <option value="created">Newest first</option>
        </select>
      </label>
    </div>}

    {loadError ? <div className="tb-banner is-error" role="alert"><span>{loadError}</span><button type="button" className="tb-link-button" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={13}/> Try again</button></div>
      : !tables ? <div className="tb-loading" role="status"><span className="spinner"/> Loading your tables…</div>
        : tables.length === 0 ? <div className="tb-empty">
          <h3>No tables yet</h3>
          <p>Start with a blank spreadsheet, a Smart Table with typed fields, one of {TABLE_TEMPLATES.length} templates, or import a CSV or Excel file.</p>
          <div className="tb-empty-actions">
            <button type="button" className="tb-secondary-button" onClick={() => createBlank("spreadsheet")} disabled={busy === "create"}><Sheet size={15}/> Blank spreadsheet</button>
            <button type="button" className="tb-secondary-button" onClick={() => createBlank("smart")} disabled={busy === "create"}><Database size={15}/> Smart Table</button>
            <button type="button" className="tb-secondary-button" onClick={() => setTemplatesOpen(true)}><LayoutTemplate size={15}/> Templates</button>
            <button type="button" className="tb-secondary-button" onClick={() => setImportOpen(true)}><FileUp size={15}/> Import file</button>
          </div>
        </div>
          : <>
            {filter === "all" && !search && starred.length > 0 && <section aria-labelledby="tb-starred-title">
              <h3 className="tb-section-title" id="tb-starred-title">Starred</h3>
              <ul className="tb-list">{starred.map(row)}</ul>
            </section>}
            <section aria-labelledby="tb-all-title">
              <h3 className="tb-section-title" id="tb-all-title">{search || filter !== "all" ? `${plural(visible.length, "table")} found` : sort === "recent" ? "Recent" : "All tables"}</h3>
              {visible.length ? <ul className="tb-list">{visible.map(row)}</ul> : <p className="tb-muted">No tables match. Try a different search or filter.</p>}
            </section>
            {atLimit && <p className="tb-muted">You've reached the limit of {TABLE_LIMITS.tables} tables.</p>}
          </>}

    {templatesOpen && <TableDialog id="tb-templates-title" title="Start from a template" icon={<LayoutTemplate size={18}/>} wide busy={busy === "create"} onClose={() => setTemplatesOpen(false)}>
      <p className="tb-muted">Each template includes a few example rows labelled “Example”. Remove them any time.</p>
      <ul className="tb-template-grid">
        {TABLE_TEMPLATES.map((template) => <li key={template.id}>
          <button type="button" className="tb-template" disabled={busy === "create"} onClick={() => void createFromTemplate(template.id)}>
            <span className={`tb-kind-badge is-${template.kind}`}><KindIcon kind={template.kind}/></span>
            <span><b>{template.name}</b><small>{template.kind === "smart" ? "Smart Table" : "Spreadsheet"} · {template.description}</small></span>
          </button>
        </li>)}
      </ul>
    </TableDialog>}

    {importOpen && <ImportDialog busy={busy === "create"} onClose={() => setImportOpen(false)}
      onImport={async (body, message) => { const ok = await create(body, message); if (ok) setImportOpen(false); return ok; }}/>}

    {renameTarget && <PromptDialog id="tb-rename-title" title="Rename table" label="Name" initial={renameTarget.name} maxLength={TABLE_LIMITS.nameLength}
      busy={busy === "rename"} error={dialogError} validate={(value) => (value.trim() ? null : "Enter a name.")}
      onCancel={() => setRenameTarget(null)} onConfirm={(value) => void rename(renameTarget, value.trim())}/>}
    {labelTarget && <PromptDialog id="tb-label-title" title={labelTarget.label ? "Change label" : "Add label"} label="Label (leave empty to remove)" initial={labelTarget.label} maxLength={TABLE_LIMITS.labelLength}
      busy={busy === "label"} error={dialogError} onCancel={() => setLabelTarget(null)} onConfirm={(value) => void setLabel(labelTarget, value)}/>}
    {deleteTarget && <ModalPortal><ConfirmDialog title={`Delete “${deleteTarget.name}”?`} confirmLabel={busy === "delete" ? "Deleting…" : "Move to Trash"} onCancel={() => setDeleteTarget(null)} onConfirm={() => void remove(deleteTarget)}>
      <p>The table and its {deleteTarget.kind === "smart" ? "records and attached files" : "sheets"} move to Trash. You can restore everything from Trash for 7 days.</p>
    </ConfirmDialog></ModalPortal>}
  </section>;
}
