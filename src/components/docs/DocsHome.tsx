// Persora Docs — Google Docs / Persora Table & Forms-style dashboard:
// Top "Start a new document" shelf (var(--ds-shelf-bg) = rgb(250, 252, 255)) + starter templates,
// single-line "Recent documents" toolbar with search + compact All/Starred/Shared filter dropdown,
// lightweight white-page document card previews, and simplified 2-row card footers.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  FolderOpen,
  LayoutGrid,
  List,
  MoreVertical,
  Pencil,
  RefreshCw,
  Search,
  Share2,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  DOC_LIMITS,
  DOC_TEMPLATES,
  blankDocContent,
  buildDocTemplate,
  cleanDocTitle,
  type DocTemplateInfo,
} from "../../../cloudflare/docs-rules.js";
import {
  createDoc,
  deleteDoc,
  docErrorMessage,
  docShareAdapter,
  duplicateDoc,
  listDocs,
  updateDocInfo,
  type DocSummary,
} from "../../lib/docs-api";
import { PersoraDeleteModal, PersoraEmptyState } from "@/design-system";
import { Spinner } from "@/components/ui/spinner";
import ModalPortal from "../ModalPortal";
import { TemplateCardThumb, templateGradient } from "../shared/template-card";
import { LauncherModuleIcon } from "../launcher/LauncherIcons";
import ShareTableDialog from "../table/ShareTableDialog";
import {
  BlankDocArtwork,
  DocCardPreview,
  DocContentMiniature,
  clearDocPreviewCache,
} from "./DocCardPreview";

type FilterMode = "all" | "starred" | "shared";
type SortMode = "opened" | "updated" | "title" | "created";
type ViewMode = "grid" | "list";

const VIEW_STORAGE_KEY = "persora.docs.viewMode";
const INLINE_TEMPLATE_LIMIT = 5;

function readInitialViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

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
    return `Opened ${new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)}`;
  }
  return `Opened ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

function lastOpenedMs(doc: DocSummary): number {
  const raw = doc.openedAt || doc.updatedAt || doc.createdAt;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

function RenameDocDialog({
  doc,
  busy,
  onCancel,
  onSave,
}: {
  doc: DocSummary;
  busy: boolean;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [value, setValue] = useState(doc.title);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      const cleaned = cleanDocTitle(value);
      onSave(cleaned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter a valid document title.");
    }
  };

  return (
    <ModalPortal>
      <div
        className="pd-modal-scrim"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !busy) onCancel();
        }}
      >
        <section
          className="pd-rename-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pd-rename-title"
        >
          <header className="pd-rename-head">
            <h3 id="pd-rename-title">Rename document</h3>
            <button
              type="button"
              className="pd-icon-btn"
              onClick={onCancel}
              disabled={busy}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </header>
          <form onSubmit={submit} className="pd-rename-form">
            <label className="pd-rename-field">
              <span>Document name</span>
              <input
                type="text"
                value={value}
                maxLength={DOC_LIMITS.maxTitleChars}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError("");
                }}
                autoFocus
                disabled={busy}
              />
            </label>
            {error && (
              <p className="pd-rename-error" role="alert">
                {error}
              </p>
            )}
            <footer className="pd-rename-foot">
              <button
                type="button"
                className="pd-btn-secondary"
                onClick={onCancel}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="pd-btn-primary" disabled={busy || !value.trim()}>
                {busy ? <Spinner className="size-3.5" /> : null}
                <span>Save</span>
              </button>
            </footer>
          </form>
        </section>
      </div>
    </ModalPortal>
  );
}

function PortaledDropdown({
  open,
  anchorEl,
  onClose,
  label,
  children,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CSSProperties>({
    position: "fixed",
    top: -9999,
    left: -9999,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!open || !anchorEl || !menuRef.current) return;
    const place = () => {
      if (!anchorEl || !menuRef.current) return;
      const rect = anchorEl.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.right - menuRect.width;
      if (left < 8) left = 8;
      if (left + menuRect.width > vw - 8) left = Math.max(8, vw - menuRect.width - 8);
      let top = rect.bottom + 6;
      if (top + menuRect.height > vh - 8 && rect.top - menuRect.height - 6 >= 8) {
        top = rect.top - menuRect.height - 6;
      }
      setPos({ position: "fixed", top, left, visibility: "visible" });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorEl, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        anchorEl &&
        !anchorEl.contains(target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorEl, onClose, open]);

  if (!open) return null;
  return (
    <ModalPortal>
      <div
        ref={menuRef}
        className="pd-menu-list"
        style={pos}
        role="menu"
        aria-label={label}
      >
        {children}
      </div>
    </ModalPortal>
  );
}

export default function DocsHome({
  notify,
  onOpen,
  onTrashChanged,
}: {
  notify: (message: string, kind?: "success" | "error") => void;
  onOpen: (id: string) => void;
  onTrashChanged?: () => void;
}) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("opened");
  const [viewMode, setViewMode] = useState<ViewMode>(readInitialViewMode);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [cardMenu, setCardMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null);

  const [renameTarget, setRenameTarget] = useState<DocSummary | null>(null);
  const [shareTarget, setShareTarget] = useState<DocSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocSummary | null>(null);

  const mounted = useRef(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    setLoading(true);
    try {
      const rows = await listDocs(signal);
      if (!mounted.current) return;
      setDocs(rows);
    } catch (error) {
      if ((error as Error)?.name === "AbortError" || !mounted.current) return;
      setLoadError(
        docErrorMessage(
          error,
          "Your documents couldn't be loaded. Check your connection and try again.",
        ),
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

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

  const ownedCount = useMemo(() => docs.filter((d) => !d.shared).length, [docs]);
  const atLimit = ownedCount >= DOC_LIMITS.docs;

  const starterTemplates = useMemo(() => {
    const today = todayIso();
    const list: readonly DocTemplateInfo[] = galleryOpen
      ? DOC_TEMPLATES
      : DOC_TEMPLATES.slice(0, INLINE_TEMPLATE_LIMIT);
    return list.map((tpl) => ({
      info: tpl,
      seed: buildDocTemplate(tpl.id, today),
    }));
  }, [galleryOpen]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs
      .filter((doc) => {
        if (filter === "starred" && !doc.starred) return false;
        if (filter === "shared" && !doc.shared && !doc.hasShares) return false;
        if (!q) return true;
        return (
          doc.title.toLowerCase().includes(q) ||
          doc.snippet.toLowerCase().includes(q) ||
          (doc.ownerName ? doc.ownerName.toLowerCase().includes(q) : false)
        );
      })
      .sort((a, b) => {
        if (sort === "title") {
          return a.title.localeCompare(b.title, undefined, {
            numeric: true,
            sensitivity: "base",
          });
        }
        if (sort === "created") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
        if (sort === "updated") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
        return lastOpenedMs(b) - lastOpenedMs(a);
      });
  }, [docs, filter, search, sort]);

  const activeFilterLabel =
    filter === "starred" ? "Starred" : filter === "shared" ? "Shared" : "All";

  const recentHeading =
    filter === "starred"
      ? "Starred documents"
      : filter === "shared"
        ? "Shared documents"
        : "Recent documents";

  async function handleCreateBlank() {
    if (busy || atLimit) return;
    setBusy("create");
    try {
      const created = await createDoc({
        id: crypto.randomUUID(),
        title: "Untitled document",
        content: blankDocContent(),
      });
      onOpen(created.id);
    } catch (error) {
      notify(docErrorMessage(error, "Could not create document. Please try again."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function handleCreateFromTemplate(templateId: DocTemplateInfo["id"]) {
    if (busy || atLimit) return;
    setBusy(`tpl:${templateId}`);
    try {
      const seed = buildDocTemplate(templateId, todayIso());
      const created = await createDoc({
        id: crypto.randomUUID(),
        title: seed.title,
        content: seed.content,
      });
      notify(`Created "${created.title}".`, "success");
      onOpen(created.id);
    } catch (error) {
      notify(docErrorMessage(error, "Could not create document from template."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function handleToggleStar(doc: DocSummary) {
    if (doc.shared) return;
    const nextStarred = !doc.starred;
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, starred: nextStarred } : d)));
    try {
      const updated = await updateDocInfo(doc.id, { starred: nextStarred });
      setDocs((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, starred: updated.starred } : d)),
      );
      notify(updated.starred ? `Starred "${doc.title}".` : `Removed star from "${doc.title}".`);
    } catch (error) {
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, starred: !nextStarred } : d)));
      notify(docErrorMessage(error, "Could not update star status."), "error");
    }
  }

  async function handleRename(doc: DocSummary, nextTitle: string) {
    setBusy(`rename:${doc.id}`);
    try {
      const updated = await updateDocInfo(doc.id, { title: nextTitle });
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id ? { ...d, title: updated.title, updatedAt: updated.updatedAt } : d,
        ),
      );
      setRenameTarget(null);
      notify(`Renamed to "${updated.title}".`);
    } catch (error) {
      notify(docErrorMessage(error, "Could not rename document."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function handleDuplicate(doc: DocSummary) {
    if (busy || atLimit) return;
    setBusy(`dup:${doc.id}`);
    try {
      const copy = await duplicateDoc(
        doc.id,
        crypto.randomUUID(),
        cleanDocTitle(`${doc.title} copy`, { allowEmptyDefault: true }),
      );
      setDocs((prev) => [copy, ...prev]);
      notify(`Duplicated "${copy.title}".`);
    } catch (error) {
      notify(docErrorMessage(error, "Could not duplicate document."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget || busy) return;
    const target = deleteTarget;
    setBusy(`del:${target.id}`);
    try {
      await deleteDoc(target.id);
      clearDocPreviewCache(target.id);
      setDocs((prev) => prev.filter((d) => d.id !== target.id));
      setDeleteTarget(null);
      onTrashChanged?.();
      notify(`Moved "${target.title}" to Trash.`);
    } catch (error) {
      notify(docErrorMessage(error, "Could not move document to Trash."), "error");
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  const activeCardDoc = cardMenu ? docs.find((d) => d.id === cardMenu.id) || null : null;

  return (
    <div className="pd-home">
      {/* Start Shelf (#fafcff / rgb(250, 252, 255)) */}
      <section className="pd-start-shelf" aria-labelledby="pd-start-heading">
        <div className="pd-start-head">
          <h2 id="pd-start-heading" className="pd-start-title">
            Start a new document
          </h2>
          <div className="pd-start-controls">
            <button
              type="button"
              className={`pd-gallery-toggle ${galleryOpen ? "is-open" : ""}`}
              onClick={() => setGalleryOpen((o) => !o)}
              aria-expanded={galleryOpen}
            >
              <span>Template gallery</span>
              <ChevronsUpDown size={14} />
            </button>
          </div>
        </div>

        <div className={`pd-starter-grid ${galleryOpen ? "is-expanded" : ""}`}>
          <button
            type="button"
            className="pd-starter-card"
            onClick={() => void handleCreateBlank()}
            disabled={Boolean(busy) || atLimit}
            aria-label="New blank document"
          >
            <TemplateCardThumb className="pd-starter-thumb pd-starter-thumb-blank">
              <BlankDocArtwork />
            </TemplateCardThumb>
            <div className="pd-starter-caption">
              <strong className="pd-starter-name">Blank document</strong>
            </div>
          </button>

          {starterTemplates.map(({ info, seed }, index) => (
            <button
              key={info.id}
              type="button"
              className="pd-starter-card"
              onClick={() => void handleCreateFromTemplate(info.id)}
              disabled={Boolean(busy) || atLimit}
            >
              <TemplateCardThumb className="pd-starter-thumb" gradient={templateGradient(index)}>
                <div className="pd-mini">
                  <DocContentMiniature content={seed.content} />
                </div>
              </TemplateCardThumb>
              <div className="pd-starter-caption">
                <strong className="pd-starter-name">{info.label}</strong>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Recent Documents Toolbar */}
      <section className="pd-recent-section" aria-labelledby="pd-recent-heading">
        <div className="pd-recent-bar">
          <h2 id="pd-recent-heading" className="pd-recent-title">
            {recentHeading}
          </h2>

          <div className="pd-recent-controls">
            <label className="pd-home-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search documents"
                placeholder="Search documents…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="pd-search-clear"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </label>

            {/* Compact Filter Dropdown: All / Starred / Shared */}
            <button
              type="button"
              className={`pd-filter-trigger ${filter !== "all" ? "is-filtered" : ""}`}
              aria-label="Filter documents"
              aria-haspopup="menu"
              aria-expanded={Boolean(filterAnchor)}
              onClick={(e) =>
                setFilterAnchor(filterAnchor ? null : e.currentTarget)
              }
            >
              <span>{activeFilterLabel}</span>
              <ChevronDown size={13} />
            </button>
            <PortaledDropdown
              open={Boolean(filterAnchor)}
              anchorEl={filterAnchor}
              onClose={() => setFilterAnchor(null)}
              label="Filter documents"
            >
              {(
                [
                  { id: "all", label: "All" },
                  { id: "starred", label: "Starred" },
                  { id: "shared", label: "Shared" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === item.id}
                  className="pd-menu-item"
                  onClick={() => {
                    setFilter(item.id);
                    setFilterAnchor(null);
                  }}
                >
                  <span className="pd-menu-label">{item.label}</span>
                  {filter === item.id && <Check size={14} className="pd-menu-check" />}
                </button>
              ))}
            </PortaledDropdown>

            {/* Sort Dropdown */}
            <button
              type="button"
              className="pd-icon-control"
              aria-label="Sort documents"
              aria-haspopup="menu"
              aria-expanded={Boolean(sortAnchor)}
              title="Sort options"
              onClick={(e) => setSortAnchor(sortAnchor ? null : e.currentTarget)}
            >
              <ArrowUpDown size={14} />
            </button>
            <PortaledDropdown
              open={Boolean(sortAnchor)}
              anchorEl={sortAnchor}
              onClose={() => setSortAnchor(null)}
              label="Sort documents"
            >
              {(
                [
                  { id: "opened", label: "Last opened" },
                  { id: "updated", label: "Last modified" },
                  { id: "title", label: "Title (A–Z)" },
                  { id: "created", label: "Date created" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sort === item.id}
                  className="pd-menu-item"
                  onClick={() => {
                    setSort(item.id);
                    setSortAnchor(null);
                  }}
                >
                  <span className="pd-menu-label">{item.label}</span>
                  {sort === item.id && <Check size={14} className="pd-menu-check" />}
                </button>
              ))}
            </PortaledDropdown>

            {/* Grid / List View Toggle */}
            <div className="pd-view-toggle" role="group" aria-label="View layout">
              <button
                type="button"
                className={`pd-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
                onClick={() => changeViewMode("grid")}
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                title="Grid view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                className={`pd-view-btn ${viewMode === "list" ? "is-active" : ""}`}
                onClick={() => changeViewMode("list")}
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                title="List view"
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Content States */}
        {loading ? (
          <div className="pd-loading" role="status">
            <Spinner className="size-4 text-primary" />
            <span>Loading your documents…</span>
          </div>
        ) : loadError ? (
          <div className="pd-error-box" role="alert">
            <AlertCircle size={16} />
            <span>{loadError}</span>
            <button
              type="button"
              className="pd-btn-secondary"
              onClick={() => void load()}
            >
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        ) : docs.length === 0 ? (
          <PersoraEmptyState
            className="pd-empty"
            role="status"
            moduleId="docs"
            tone="blue"
            title="No documents yet"
            description="Start a blank document or pick a template above to write notes, letters, proposals, and plans in a clean page workspace."
            action={
              <button
                type="button"
                className="pd-btn-primary"
                onClick={() => void handleCreateBlank()}
                disabled={Boolean(busy)}
              >
                New document
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <PersoraEmptyState
            className="pd-empty"
            role="status"
            icon={<FolderOpen size={20} />}
            tone="slate"
            title="No matching documents"
            description="No documents match your current search or filter."
            action={
              <button
                type="button"
                className="pd-btn-secondary"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Show all documents
              </button>
            }
          />
        ) : viewMode === "list" ? (
          <div className="pd-list-card" role="list">
            {visible.map((doc) => {
              const isSharedIndicator = Boolean(doc.shared || doc.hasShares);
              return (
                <div
                  key={doc.id}
                  role="listitem"
                  className="pd-list-row"
                  onClick={() => onOpen(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(doc.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <LauncherModuleIcon id="docs" size={18} />
                  <span className="pd-list-name">{doc.title}</span>
                  {doc.starred && (
                    <Star size={13} className="pd-card-star" fill="currentColor" aria-label="Starred" />
                  )}
                  {isSharedIndicator && (
                    <span className="pd-shared-indicator" title={doc.shared ? `Shared by ${doc.ownerName || "Member"}` : "Shared"}>
                      <Users size={13} />
                    </span>
                  )}
                  <span className="pd-list-opened">{formatOpenedLabel(doc.openedAt || doc.updatedAt)}</span>
                  <button
                    type="button"
                    className="pd-card-more-btn"
                    aria-label={`More actions for ${doc.title}`}
                    aria-haspopup="menu"
                    aria-expanded={cardMenu?.id === doc.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCardMenu(
                        cardMenu?.id === doc.id
                          ? null
                          : { id: doc.id, anchor: e.currentTarget },
                      );
                    }}
                  >
                    <MoreVertical size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pd-card-grid" role="list">
            {visible.map((doc) => {
              const isSharedIndicator = Boolean(doc.shared || doc.hasShares);
              return (
                <article
                  key={doc.id}
                  role="listitem"
                  className="pd-card"
                  tabIndex={0}
                  onClick={() => onOpen(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(doc.id);
                    }
                  }}
                >
                  <div className="pd-mini">
                    <DocCardPreview doc={doc} />
                  </div>

                  {/* Simplified 2-row Card Footer */}
                  <div className="pd-card-foot">
                    <div className="pd-card-main-row">
                      <span className="pd-card-name" title={doc.title}>
                        {doc.title}
                      </span>
                      {doc.starred && (
                        <Star
                          size={13}
                          className="pd-card-star"
                          fill="currentColor"
                          aria-label="Starred"
                        />
                      )}
                      <button
                        type="button"
                        className="pd-card-more-btn"
                        aria-label={`More actions for ${doc.title}`}
                        aria-haspopup="menu"
                        aria-expanded={cardMenu?.id === doc.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCardMenu(
                            cardMenu?.id === doc.id
                              ? null
                              : { id: doc.id, anchor: e.currentTarget },
                          );
                        }}
                      >
                        <MoreVertical size={15} />
                      </button>
                    </div>

                    <div className="pd-card-meta-row">
                      <LauncherModuleIcon id="docs" size={16} />
                      {isSharedIndicator && (
                        <span
                          className="pd-shared-indicator"
                          aria-label="Shared"
                          title={
                            doc.shared
                              ? `Shared by ${doc.ownerName || "Member"}`
                              : "Shared document"
                          }
                        >
                          <Users size={12} />
                        </span>
                      )}
                      <span className="pd-card-opened">
                        {formatOpenedLabel(doc.openedAt || doc.updatedAt)}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Card 3-Dot Action Menu */}
      <PortaledDropdown
        open={Boolean(cardMenu && activeCardDoc)}
        anchorEl={cardMenu?.anchor ?? null}
        onClose={() => setCardMenu(null)}
        label="Document actions"
      >
        {activeCardDoc && (
          <>
            {(!activeCardDoc.shared || activeCardDoc.permission === "edit") && (
              <button
                type="button"
                role="menuitem"
                className="pd-menu-item"
                onClick={() => {
                  const target = activeCardDoc;
                  setCardMenu(null);
                  setRenameTarget(target);
                }}
              >
                <Pencil size={14} className="pd-menu-icon" />
                <span className="pd-menu-label">Rename</span>
              </button>
            )}

            {!activeCardDoc.shared && (
              <button
                type="button"
                role="menuitem"
                className="pd-menu-item"
                onClick={() => {
                  const target = activeCardDoc;
                  setCardMenu(null);
                  void handleToggleStar(target);
                }}
              >
                <Star
                  size={14}
                  className="pd-menu-icon"
                  fill={activeCardDoc.starred ? "currentColor" : "none"}
                />
                <span className="pd-menu-label">
                  {activeCardDoc.starred ? "Unstar" : "Star"}
                </span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              className="pd-menu-item"
              disabled={atLimit}
              onClick={() => {
                const target = activeCardDoc;
                setCardMenu(null);
                void handleDuplicate(target);
              }}
            >
              <Copy size={14} className="pd-menu-icon" />
              <span className="pd-menu-label">Duplicate</span>
            </button>

            {!activeCardDoc.shared && (
              <button
                type="button"
                role="menuitem"
                className="pd-menu-item"
                onClick={() => {
                  const target = activeCardDoc;
                  setCardMenu(null);
                  setShareTarget(target);
                }}
              >
                <Share2 size={14} className="pd-menu-icon" />
                <span className="pd-menu-label">Share</span>
              </button>
            )}

            {!activeCardDoc.shared && (
              <>
                <div className="pd-menu-divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="pd-menu-item is-danger"
                  onClick={() => {
                    const target = activeCardDoc;
                    setCardMenu(null);
                    setDeleteTarget(target);
                  }}
                >
                  <Trash2 size={14} className="pd-menu-icon" />
                  <span className="pd-menu-label">Delete</span>
                </button>
              </>
            )}
          </>
        )}
      </PortaledDropdown>

      {/* Rename Modal */}
      {renameTarget && (
        <RenameDocDialog
          doc={renameTarget}
          busy={busy === `rename:${renameTarget.id}`}
          onCancel={() => setRenameTarget(null)}
          onSave={(nextTitle) => void handleRename(renameTarget, nextTitle)}
        />
      )}

      {/* Reused Share Modal */}
      {shareTarget && !shareTarget.shared && (
        <ShareTableDialog
          tableId={shareTarget.id}
          tableName={shareTarget.title}
          resourceLabel="document"
          allowComment={false}
          adapter={docShareAdapter}
          notify={notify}
          onSharingChanged={(hasActive) =>
            setDocs((prev) =>
              prev.map((d) =>
                d.id === shareTarget.id ? { ...d, hasShares: hasActive } : d,
              ),
            )
          }
          onClose={() => setShareTarget(null)}
        />
      )}

      {/* Delete to Global Trash Confirmation */}
      <PersoraDeleteModal
        open={Boolean(deleteTarget)}
        title="Move document to Trash?"
        description={
          deleteTarget
            ? `"${deleteTarget.title}" will move to your Persora Trash. You can restore it anytime within 7 days.`
            : ""
        }
        confirmLabel="Move to Trash"
        busy={Boolean(deleteTarget && busy === `del:${deleteTarget.id}`)}
        onCancel={() => {
          if (!busy) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDeleteConfirmed()}
      />
    </div>
  );
}
