// Persora Table — Google Sheets-style home dashboard (starter template strip,
// single combined filter box, real read-only worksheet/Smart Table card previews,
// and simplified 2-row card footers).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowUpDown, ChevronDown, ChevronsUpDown, Copy, FileSpreadsheet, FolderOpen,
  LayoutGrid, List, MoreVertical, Pencil, RefreshCw, Search, Share2, Star, Table2, Tag, Trash2, Upload, Users, X,
} from "lucide-react";
import { TABLE_LIMITS, cleanName, type TableKind } from "../../../cloudflare/table-rules.js";
import { TABLE_TEMPLATES, blankSmartTable, blankSpreadsheet, buildTemplate, type TemplateInfo } from "../../../cloudflare/table-templates.js";
import { PersoraDeleteModal, PersoraEmptyState } from "../../design-system";
import { LauncherModuleIcon } from "../launcher/LauncherIcons";
import {
  createTable, deleteTable, duplicateTable, listTables, tableErrorMessage, updateTableInfo,
  type CreateTableBody, type TableSummary,
} from "../../lib/table/table-api";
import { listDrafts } from "../../lib/table/table-drafts";
import type { AppUser } from "../../types";
import ImportDialog from "./ImportDialog";
import ShareTableDialog from "./ShareTableDialog";
import { BlankTableArtwork, TableCardPreview, TableContentMiniature, clearTablePreviewCache } from "./TableCardPreview";
import { TemplateCardThumb, templateGradient } from "../shared/template-card";
import { Menu, PromptDialog } from "./table-ui";

export function KindIcon({ kind, size = 16 }: { kind: TableKind; size?: number }) {
  return kind === "smart"
    ? <Table2 size={size} aria-hidden="true" />
    : <FileSpreadsheet size={size} aria-hidden="true" />;
}

type Filter = "all" | "starred" | "shared" | "spreadsheet" | "smart" | `label:${string}`;
type Sort = "opened" | "recent" | "name" | "created";
type ViewMode = "grid" | "list";

const FEATURED_TEMPLATE_IDS = ["monthly-budget", "savings-tracker", "expense-tracker", "study-planner"];
const VIEW_STORAGE_KEY = "persora.table.homeView";

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function readInitialViewMode(): ViewMode {
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return saved === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function formatOpenedLabel(iso: string | null | undefined): string {
  if (!iso) return "Opened recently";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "Opened recently";
  const date = new Date(parsed);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `Opened ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)}`;
  }
  return `Opened ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

function lastOpenedMillis(table: TableSummary): number {
  const raw = table.openedAt || table.updatedAt || table.createdAt;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

function sharedPermissionText(permission: TableSummary["permission"]): string {
  if (permission === "edit") return "Can edit";
  if (permission === "comment") return "Can comment";
  return "View only";
}

export default function TableHome({ user, notify, onOpen, onTrashChanged }: {
  user: AppUser;
  notify: (message: string, kind?: "error" | "success") => void;
  onOpen: (id: string) => void;
  onTrashChanged?: () => void;
}) {
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("opened");
  const [viewMode, setViewMode] = useState<ViewMode>(readInitialViewMode);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TableSummary | null>(null);
  const [labelTarget, setLabelTarget] = useState<TableSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TableSummary | null>(null);
  const [shareTarget, setShareTarget] = useState<TableSummary | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    setLoading(true);
    try {
      const [rows, drafts] = await Promise.all([listTables(signal), listDrafts(user.id)]);
      if (!mounted.current) return;
      setTables(rows);
      setDraftIds(new Set(drafts.map((draft) => draft.tableId)));
    } catch (error) {
      if ((error as Error)?.name === "AbortError" || !mounted.current) return;
      setLoadError(tableErrorMessage(error, "Your tables couldn't be loaded. Check your connection and try again."));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [load]);

  const changeViewMode = (next: ViewMode) => {
    setViewMode(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore storage errors */
    }
  };

  const labels = useMemo(() => {
    const found = new Set<string>();
    for (const table of tables) if (!table.shared && table.label) found.add(table.label);
    return [...found].sort((a, b) => a.localeCompare(b));
  }, [tables]);

  useEffect(() => {
    if (filter.startsWith("label:") && !labels.includes(filter.slice(6))) {
      setFilter("all");
    }
  }, [filter, labels]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables
      .filter((table) => {
        if (filter === "starred" && !table.starred) return false;
        if (filter === "shared" && !table.shared && !table.hasShares) return false;
        if (filter === "spreadsheet" && table.kind !== "spreadsheet") return false;
        if (filter === "smart" && table.kind !== "smart") return false;
        if (filter.startsWith("label:") && table.label !== filter.slice(6)) return false;
        if (!q) return true;
        return (
          table.name.toLowerCase().includes(q) ||
          table.label.toLowerCase().includes(q) ||
          (table.ownerName ? table.ownerName.toLowerCase().includes(q) : false)
        );
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        if (sort === "created") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
        if (sort === "recent") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        return lastOpenedMillis(b) - lastOpenedMillis(a);
      });
  }, [tables, search, filter, sort]);

  const ownedCount = useMemo(() => tables.filter((table) => !table.shared).length, [tables]);
  const atLimit = ownedCount >= TABLE_LIMITS.tables;

  const starterTemplates = useMemo(() => {
    const today = todayIso();
    const list: TemplateInfo[] = galleryOpen
      ? [...TABLE_TEMPLATES]
      : FEATURED_TEMPLATE_IDS
          .map((id) => TABLE_TEMPLATES.find((tpl) => tpl.id === id))
          .filter((tpl): tpl is TemplateInfo => Boolean(tpl));
    return list.map((tpl) => ({
      info: tpl,
      content: buildTemplate(tpl.id, today),
    }));
  }, [galleryOpen]);

  const activeFilterLabel = useMemo(() => {
    switch (filter) {
      case "all": return "All tables";
      case "starred": return "Starred";
      case "shared": return "Shared";
      case "spreadsheet": return "Spreadsheets";
      case "smart": return "Smart Tables";
      default: return filter.startsWith("label:") ? filter.slice(6) : "All tables";
    }
  }, [filter]);

  const recentHeading = useMemo(() => {
    if (filter === "starred") return "Starred tables";
    if (filter === "shared") return "Shared tables";
    if (filter === "spreadsheet") return "Recent spreadsheets";
    if (filter === "smart") return "Recent Smart Tables";
    if (filter.startsWith("label:")) return `Label: ${filter.slice(6)}`;
    return "Recent tables";
  }, [filter]);

  async function createBlank(kind: "spreadsheet" | "smart") {
    if (busy) return;
    setBusy("create");
    try {
      const content = kind === "spreadsheet" ? blankSpreadsheet() : blankSmartTable();
      const created = await createTable({
        id: crypto.randomUUID(),
        kind,
        name: kind === "spreadsheet" ? "Untitled spreadsheet" : "Untitled table",
        ...(content.kind === "spreadsheet"
          ? { sheets: content.sheets }
          : { meta: content.meta, records: content.records }),
      });
      notify(kind === "spreadsheet" ? "Spreadsheet created." : "Smart Table created.", "success");
      onOpen(created.id);
    } catch (error) {
      notify(tableErrorMessage(error, "Could not create the table. Please try again."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function createFromTemplate(templateId: string) {
    if (busy) return;
    const info = TABLE_TEMPLATES.find((item) => item.id === templateId);
    const content = buildTemplate(templateId, todayIso());
    if (!info || !content) return;
    setBusy("create");
    try {
      const created = await createTable({
        id: crypto.randomUUID(),
        kind: info.kind,
        name: info.name,
        template: info.id,
        ...(content.kind === "spreadsheet"
          ? { sheets: content.sheets }
          : { meta: content.meta, records: content.records }),
      });
      notify(`Created "${created.name}".`, "success");
      onOpen(created.id);
    } catch (error) {
      notify(tableErrorMessage(error, "Could not create the table from that template."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function importBody(body: Omit<CreateTableBody, "id">, message: string): Promise<boolean> {
    if (busy) return false;
    setBusy("import");
    try {
      const created = await createTable({ id: crypto.randomUUID(), ...body });
      setImportOpen(false);
      notify(message, "success");
      onOpen(created.id);
      return true;
    } catch (error) {
      notify(tableErrorMessage(error, "Could not import that file."), "error");
      return false;
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function toggleStar(table: TableSummary) {
    if (table.shared) return;
    const next = !table.starred;
    setTables((current) => current.map((item) => (item.id === table.id ? { ...item, starred: next } : item)));
    try {
      const saved = await updateTableInfo(table.id, { starred: next });
      if (mounted.current) {
        setTables((current) => current.map((item) => (item.id === table.id ? saved : item)));
      }
    } catch (error) {
      if (mounted.current) {
        setTables((current) => current.map((item) => (item.id === table.id ? { ...item, starred: table.starred } : item)));
      }
      notify(tableErrorMessage(error, "Could not update the star."), "error");
    }
  }

  async function rename(name: string) {
    const target = renameTarget;
    if (!target) return;
    const cleaned = cleanName(name, TABLE_LIMITS.nameLength, "Table name");
    setBusy(target.id);
    try {
      const saved = await updateTableInfo(target.id, { name: cleaned });
      if (mounted.current) {
        setTables((current) => current.map((item) => (item.id === target.id ? saved : item)));
        setRenameTarget(null);
      }
      notify("Table renamed.", "success");
    } catch (error) {
      notify(tableErrorMessage(error, "Could not rename the table."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function saveLabel(label: string) {
    const target = labelTarget;
    if (!target) return;
    setBusy(target.id);
    try {
      const saved = await updateTableInfo(target.id, { label: label.trim().slice(0, TABLE_LIMITS.labelLength) });
      if (mounted.current) {
        setTables((current) => current.map((item) => (item.id === target.id ? saved : item)));
        setLabelTarget(null);
      }
      notify(saved.label ? `Label set to "${saved.label}".` : "Label cleared.", "success");
    } catch (error) {
      notify(tableErrorMessage(error, "Could not update the label."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function copy(table: TableSummary) {
    if (busy || table.shared) return;
    setBusy(table.id);
    try {
      const name = `${table.name} (copy)`.slice(0, TABLE_LIMITS.nameLength);
      const created = await duplicateTable(table.id, crypto.randomUUID(), name);
      if (mounted.current) setTables((current) => [created, ...current]);
      notify(`Duplicated as "${created.name}".`, "success");
    } catch (error) {
      notify(tableErrorMessage(error, "Could not duplicate the table."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setBusy(target.id);
    try {
      await deleteTable(target.id);
      clearTablePreviewCache(target.id);
      if (mounted.current) {
        setTables((current) => current.filter((item) => item.id !== target.id));
        setDeleteTarget(null);
      }
      onTrashChanged?.();
      notify(`"${target.name}" moved to Trash.`, "success");
    } catch (error) {
      notify(tableErrorMessage(error, "Could not move the table to Trash."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  const buildItemMenu = (table: TableSummary) => {
    const isSharedWithMe = Boolean(table.shared);
    if (isSharedWithMe) {
      return [
        {
          id: "open",
          label: "Open",
          icon: <FolderOpen size={15} />,
          onSelect: () => onOpen(table.id),
        },
        "divider" as const,
        {
          id: "shared-info",
          label: `Shared by ${table.ownerName || "Persora Member"}`,
          hint: `${sharedPermissionText(table.permission)} · ${table.kind === "spreadsheet" ? "Spreadsheet" : "Smart Table"}`,
          icon: <Users size={15} />,
          disabled: true,
          onSelect: () => {},
        },
      ];
    }
    return [
      {
        id: "open",
        label: "Open",
        icon: <FolderOpen size={15} />,
        onSelect: () => onOpen(table.id),
      },
      {
        id: "rename",
        label: "Rename",
        icon: <Pencil size={15} />,
        onSelect: () => setRenameTarget(table),
      },
      {
        id: "star",
        label: table.starred ? "Remove star" : "Add star",
        icon: <Star size={15} fill={table.starred ? "currentColor" : "none"} />,
        onSelect: () => void toggleStar(table),
      },
      {
        id: "share",
        label: "Share…",
        icon: <Share2 size={15} />,
        onSelect: () => setShareTarget(table),
      },
      {
        id: "label",
        label: table.label ? "Change label…" : "Add label…",
        hint: table.label ? `Current: ${table.label}` : undefined,
        icon: <Tag size={15} />,
        onSelect: () => setLabelTarget(table),
      },
      {
        id: "duplicate",
        label: "Duplicate",
        icon: <Copy size={15} />,
        disabled: atLimit,
        onSelect: () => void copy(table),
      },
      "divider" as const,
      {
        id: "delete",
        label: "Move to Trash",
        icon: <Trash2 size={15} />,
        danger: true,
        onSelect: () => setDeleteTarget(table),
      },
    ];
  };

  const renderCard = (table: TableSummary) => {
    const isSharedIndicator = Boolean(table.shared || table.hasShares);
    const hasDraft = draftIds.has(table.id);
    const openedText = formatOpenedLabel(table.openedAt || table.updatedAt || table.createdAt);

    return (
      <li key={table.id} className="tb-card-item">
        <article
          className="tb-card"
          onClick={() => onOpen(table.id)}
        >
          <div className="tb-card-preview">
            <TableCardPreview table={table} />
            {hasDraft && (
              <span className="tb-card-draft-dot" title="Unsaved changes saved on this device">
                Draft
              </span>
            )}
          </div>
          <div className="tb-card-footer">
            <div className="tb-card-main-row">
              <button
                type="button"
                className="tb-card-title-btn"
                title={table.name}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(table.id);
                }}
              >
                {table.name}
              </button>
              <div
                className="tb-card-menu-wrap"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Menu
                  label={`More actions for ${table.name}`}
                  icon={<MoreVertical size={15} />}
                  buttonClassName="tb-icon-button tb-card-more"
                  items={buildItemMenu(table)}
                />
              </div>
            </div>
            <div className="tb-card-meta-row">
              <span className="tb-card-app-icon" aria-hidden="true">
                <LauncherModuleIcon id="tables" size={16} />
              </span>
              {isSharedIndicator && (
                <span
                  className="tb-card-shared-icon"
                  role="img"
                  aria-label="Shared"
                  title={table.shared ? `Shared by ${table.ownerName || "Persora Member"}` : "Shared"}
                >
                  <Users size={13} aria-hidden="true" />
                </span>
              )}
              <span className="tb-card-opened" title={openedText}>
                {openedText}
              </span>
            </div>
          </div>
        </article>
      </li>
    );
  };

  const renderListRow = (table: TableSummary) => {
    const isSharedIndicator = Boolean(table.shared || table.hasShares);
    const hasDraft = draftIds.has(table.id);
    const openedText = formatOpenedLabel(table.openedAt || table.updatedAt || table.createdAt);

    return (
      <li key={table.id} className="tb-list-row">
        <button
          type="button"
          className="tb-list-row-open"
          onClick={() => onOpen(table.id)}
          aria-label={`Open ${table.name}`}
        >
          <span className="tb-card-app-icon" aria-hidden="true">
            <LauncherModuleIcon id="tables" size={18} />
          </span>
          <span className="tb-list-row-name" title={table.name}>{table.name}</span>
          {hasDraft && <span className="tb-pill is-warn">Unsaved draft</span>}
          {isSharedIndicator && (
            <span
              className="tb-card-shared-icon"
              role="img"
              aria-label="Shared"
              title={table.shared ? `Shared by ${table.ownerName || "Persora Member"}` : "Shared"}
            >
              <Users size={14} aria-hidden="true" />
            </span>
          )}
          <span className="tb-list-row-date">{openedText}</span>
        </button>
        <div
          className="tb-card-menu-wrap"
          onClick={(event) => event.stopPropagation()}
        >
          <Menu
            label={`More actions for ${table.name}`}
            icon={<MoreVertical size={15} />}
            buttonClassName="tb-icon-button tb-card-more"
            items={buildItemMenu(table)}
          />
        </div>
      </li>
    );
  };

  const filterMenuItems = useMemo(() => {
    const base: Array<Parameters<typeof Menu>[0]["items"][number]> = [
      { id: "all", label: "All", checked: filter === "all", onSelect: () => setFilter("all") },
      { id: "starred", label: "Starred", icon: <Star size={14} />, checked: filter === "starred", onSelect: () => setFilter("starred") },
      { id: "shared", label: "Shared", icon: <Users size={14} />, checked: filter === "shared", onSelect: () => setFilter("shared") },
      { id: "spreadsheet", label: "Spreadsheets", icon: <FileSpreadsheet size={14} />, checked: filter === "spreadsheet", onSelect: () => setFilter("spreadsheet") },
      { id: "smart", label: "Smart Tables", icon: <Table2 size={14} />, checked: filter === "smart", onSelect: () => setFilter("smart") },
    ];
    if (labels.length > 0) {
      base.push("divider");
      for (const lbl of labels) {
        const key: Filter = `label:${lbl}`;
        base.push({
          id: key,
          label: lbl,
          icon: <Tag size={14} />,
          checked: filter === key,
          onSelect: () => setFilter(key),
        });
      }
    }
    return base;
  }, [filter, labels]);

  const sortMenuItems = useMemo<Parameters<typeof Menu>[0]["items"]>(() => [
    { id: "opened", label: "Last opened by me", checked: sort === "opened", onSelect: () => setSort("opened") },
    { id: "recent", label: "Last modified", checked: sort === "recent", onSelect: () => setSort("recent") },
    { id: "name", label: "Title (A–Z)", checked: sort === "name", onSelect: () => setSort("name") },
    { id: "created", label: "Newest created", checked: sort === "created", onSelect: () => setSort("created") },
  ], [sort]);

  return (
    <div className="tb-home">
      {atLimit && (
        <div className="tb-banner is-warn" role="status">
          <AlertCircle size={16} aria-hidden="true" />
          <span>You have reached the {TABLE_LIMITS.tables}-table limit. Move tables you no longer need to Trash to create more.</span>
        </div>
      )}

      {draftIds.size > 0 && !loading && (
        <div className="tb-banner" role="status">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            {draftIds.size === 1
              ? "1 table has unsaved changes saved on this device."
              : `${draftIds.size} tables have unsaved changes saved on this device.`}{" "}
            Open it to finish saving.
          </span>
        </div>
      )}

      {/* Top Google Sheets-style creation & real template strip */}
      <section className="tb-start-shelf" aria-labelledby="tb-start-heading">
        <div className="tb-start-head">
          <h2 className="tb-start-title" id="tb-start-heading">Start a new table</h2>
          <div className="tb-start-controls">
            <button
              type="button"
              className={`tb-gallery-toggle ${galleryOpen ? "is-open" : ""}`}
              aria-expanded={galleryOpen}
              onClick={() => setGalleryOpen((prev) => !prev)}
            >
              <span>Template gallery</span>
              <ChevronsUpDown size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <ul className={`tb-starter-grid ${galleryOpen ? "is-expanded" : ""}`}>
          <li className="tb-starter-item">
            <button
              type="button"
              className="tb-starter-card"
              disabled={atLimit || busy === "create"}
              onClick={() => void createBlank("spreadsheet")}
            >
              <TemplateCardThumb className="tb-starter-thumb">
                <BlankTableArtwork kind="spreadsheet" />
              </TemplateCardThumb>
              <span className="tb-starter-label">Blank spreadsheet</span>
              <span className="tb-starter-kind">Spreadsheet</span>
            </button>
          </li>
          <li className="tb-starter-item">
            <button
              type="button"
              className="tb-starter-card"
              disabled={atLimit || busy === "create"}
              onClick={() => void createBlank("smart")}
            >
              <TemplateCardThumb className="tb-starter-thumb">
                <BlankTableArtwork kind="smart" />
              </TemplateCardThumb>
              <span className="tb-starter-label">Blank Smart Table</span>
              <span className="tb-starter-kind">Smart Table</span>
            </button>
          </li>
          {starterTemplates.map(({ info, content }, index) => (
            <li key={info.id} className="tb-starter-item">
              <button
                type="button"
                className="tb-starter-card"
                disabled={atLimit || busy === "create"}
                title={info.description}
                onClick={() => void createFromTemplate(info.id)}
              >
                <TemplateCardThumb className="tb-starter-thumb" gradient={templateGradient(index)}>
                  {content ? (
                    <TableContentMiniature
                      content={content}
                      sheetCount={content.kind === "spreadsheet" ? content.sheets.length : 0}
                      compact
                    />
                  ) : (
                    <BlankTableArtwork kind={info.kind} />
                  )}
                </TemplateCardThumb>
                <span className="tb-starter-label">{info.name}</span>
                <span className="tb-starter-kind">
                  {info.kind === "spreadsheet" ? "Spreadsheet" : "Smart Table"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Recent tables toolbar + single combined filter dropdown + card grid */}
      <section className="tb-recent-section" aria-labelledby="tb-recent-heading">
        <div className="tb-recent-bar">
          <h2 className="tb-recent-heading" id="tb-recent-heading">{recentHeading}</h2>
          <div className="tb-recent-controls">
            <label className="tb-search tb-home-search">
              <Search size={14} aria-hidden="true" />
              <span className="tb-visually-hidden">Search tables</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tables…"
              />
              {search && (
                <button
                  type="button"
                  className="tb-search-clear"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </label>

            <Menu
              label="Filter tables"
              align="end"
              buttonClassName={`tb-filter-box ${filter !== "all" ? "is-filtered" : ""}`}
              items={filterMenuItems}
            >
              <span className="tb-filter-box-text">{activeFilterLabel}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </Menu>

            <div className="tb-recent-icon-group">
              <button
                type="button"
                className="tb-icon-button tb-toolbar-icon-btn"
                aria-label={viewMode === "grid" ? "Switch to list view" : "Switch to grid view"}
                title={viewMode === "grid" ? "List view" : "Grid view"}
                onClick={() => changeViewMode(viewMode === "grid" ? "list" : "grid")}
              >
                {viewMode === "grid" ? <List size={15} aria-hidden="true" /> : <LayoutGrid size={15} aria-hidden="true" />}
              </button>

              <Menu
                label="Sort tables"
                title="Sort options"
                icon={<ArrowUpDown size={15} />}
                buttonClassName="tb-icon-button tb-toolbar-icon-btn"
                items={sortMenuItems}
              />

              <button
                type="button"
                className="tb-icon-button tb-toolbar-icon-btn"
                aria-label="Import CSV or Excel"
                title="Import CSV or Excel (.xlsx)"
                disabled={atLimit}
                onClick={() => setImportOpen(true)}
              >
                <Upload size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="tb-banner is-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{loadError}</span>
            <button type="button" className="tb-button" onClick={() => void load()}>
              <RefreshCw size={14} aria-hidden="true" />Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="tb-loading" role="status">
            <span className="tb-spinner" aria-hidden="true" />Loading your tables…
          </div>
        ) : tables.length === 0 ? (
          <PersoraEmptyState
            className="tb-empty"
            moduleId="tables"
            tone="emerald"
            title="No tables yet"
            description="Create a blank spreadsheet or Smart Table above, pick a template, or import an existing CSV or .xlsx file."
            action={
              <>
                <button
                  type="button"
                  className="tb-button tb-button-primary"
                  disabled={busy === "create"}
                  onClick={() => void createBlank("spreadsheet")}
                >
                  <FileSpreadsheet size={15} aria-hidden="true" />Blank spreadsheet
                </button>
                <button
                  type="button"
                  className="tb-button"
                  disabled={busy === "create"}
                  onClick={() => void createBlank("smart")}
                >
                  <Table2 size={15} aria-hidden="true" />Blank Smart Table
                </button>
              </>
            }
          />
        ) : visible.length === 0 ? (
          <PersoraEmptyState
            compact
            className="tb-empty"
            moduleId="tables"
            tone="emerald"
            title={filter === "shared" ? "No shared tables yet" : "No matching tables"}
            description={
              filter === "shared"
                ? "Tables shared with you or shared by you will appear right here."
                : "Try a different search term or change the filter."
            }
            action={
              (filter !== "all" || search) ? (
                <button
                  type="button"
                  className="tb-button"
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                  }}
                >
                  Show all tables
                </button>
              ) : undefined
            }
          />
        ) : viewMode === "list" ? (
          <ul className="tb-list">{visible.map(renderListRow)}</ul>
        ) : (
          <ul className="tb-card-grid">{visible.map(renderCard)}</ul>
        )}
      </section>

      {importOpen && (
        <ImportDialog
          busy={busy === "import"}
          onClose={() => setImportOpen(false)}
          onImport={importBody}
        />
      )}

      {renameTarget && (
        <PromptDialog
          id="tb-rename-title"
          title="Rename table"
          label="Name"
          initial={renameTarget.name}
          maxLength={TABLE_LIMITS.nameLength}
          confirmLabel="Rename"
          busy={busy === renameTarget.id}
          validate={(val) => (!val.trim() ? "Enter a name for this table." : null)}
          onCancel={() => setRenameTarget(null)}
          onConfirm={(val) => void rename(val)}
        />
      )}

      {labelTarget && (
        <PromptDialog
          id="tb-label-title"
          title="Label"
          label="Folder or label (leave blank to clear)"
          initial={labelTarget.label}
          maxLength={TABLE_LIMITS.labelLength}
          confirmLabel="Save label"
          busy={busy === labelTarget.id}
          onCancel={() => setLabelTarget(null)}
          onConfirm={(val) => void saveLabel(val)}
        />
      )}

      {deleteTarget && (
        <PersoraDeleteModal
          open
          title={`Move "${deleteTarget.name}" to Trash?`}
          description="This table will stay in Trash for 30 days so you can restore it if needed, or delete it permanently from Trash."
          confirmLabel="Move to Trash"
          cancelLabel="Cancel"
          danger
          busy={busy === deleteTarget.id}
          onCancel={() => {
            if (busy !== deleteTarget.id) setDeleteTarget(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {shareTarget && (
        <ShareTableDialog
          tableId={shareTarget.id}
          tableName={shareTarget.name}
          notify={notify}
          onClose={() => {
            setShareTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
