import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Copy,
  ExternalLink,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { PersoraDeleteModal } from "@/design-system";
import { Badge } from "@/components/reui/badge";
import { IconTile } from "@/components/reui/icon-tile";
import { AdvancedMenu, AdvancedPromptDialog } from "./AdvancedMenu";
import { ADVANCED_CATEGORIES, ADVANCED_LIMITS, type AdvancedForm } from "../../../../cloudflare/advanced-forms-rules.js";
import { ADVANCED_TEMPLATES } from "../../../../cloudflare/advanced-forms-templates.js";
import AdvancedFormRenderer from "./AdvancedFormRenderer";

export type AdvancedSort = "updated" | "created" | "title" | "responses";

const SORTS: { id: AdvancedSort; label: string }[] = [
  { id: "updated", label: "Last modified" },
  { id: "created", label: "Date created" },
  { id: "title", label: "Name (A–Z)" },
  { id: "responses", label: "Most responses" },
];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Scaled live miniature of the real form design (used on cards and in the gallery). */
export function AdvancedFormMiniature({ form, scale = 0.34, height = 190 }: { form: AdvancedForm; scale?: number; height?: number }) {
  return (
    <div className="aff-mini" style={{ height }} aria-hidden="true">
      <div className="aff-mini-inner" style={{ transform: `scale(${scale})`, width: `${100 / scale}%` }}>
        <AdvancedFormRenderer form={form} mode="mini" />
      </div>
    </div>
  );
}

export default function AdvancedFormsDashboard({
  forms,
  onBack,
  onCreateBlank,
  onCreateFromTemplate,
  onOpen,
  onPreview,
  onRename,
  onDuplicate,
  onDelete,
  onTogglePublish,
  onShare,
  notify,
}: {
  forms: AdvancedForm[];
  onBack: () => void;
  onCreateBlank: () => void;
  onCreateFromTemplate: (templateId: string) => void;
  onOpen: (id: string, tab?: "design" | "configure" | "responses") => void;
  onPreview: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onTogglePublish: (id: string) => void;
  onShare: (id: string) => void;
  notify: (message: string, kind?: "success" | "error") => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<AdvancedSort>("updated");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AdvancedForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdvancedForm | null>(null);
  const galleryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("persora.advanced-forms.layout");
    if (stored === "list" || stored === "grid") setLayout(stored);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("persora.advanced-forms.layout", layout); } catch { /* ignore */ }
  }, [layout]);

  const categories = useMemo(() => {
    const used = new Set(forms.map((form) => form.category || "General"));
    return ["all", ...ADVANCED_CATEGORIES.filter((entry) => used.has(entry)), ...[...used].filter((entry) => !ADVANCED_CATEGORIES.includes(entry))];
  }, [forms]);

  const visibleForms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = forms.filter((form) => {
      if (category !== "all" && (form.category || "General") !== category) return false;
      if (!needle) return true;
      return (
        form.title.toLowerCase().includes(needle) ||
        form.description.toLowerCase().includes(needle) ||
        form.fields.some((field) => field.label.toLowerCase().includes(needle))
      );
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "responses") return b.responses.length - a.responses.length;
      if (sort === "created") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    return sorted;
  }, [forms, query, category, sort]);

  const templates = galleryOpen ? ADVANCED_TEMPLATES : ADVANCED_TEMPLATES.slice(0, 6);

  return (
    <section className="pf-advanced-dashboard" aria-label="Persora Advanced Forms">
      <header className="aff-dash-head">
        <div className="aff-dash-head-left">
          <button type="button" className="aff-back" onClick={onBack} aria-label="Back to Persora Forms" title="Back to Persora Forms">
            <ArrowLeft size={17} />
          </button>
          <IconTile variant="soft" size="sm" className="ds-tone-violet">
            <Wand2 size={16} />
          </IconTile>
          <div className="aff-dash-titles">
            <span className="aff-dash-eyebrow">Persora Forms · Advanced</span>
            <h2 className="aff-dash-title">Advanced Forms</h2>
          </div>
        </div>
        <div className="aff-dash-head-right">
          <Badge variant="primary-light" size="xs">
            <Sparkles size={11} /> Flexible canvas
          </Badge>
          <button type="button" className="aff-primary" onClick={onCreateBlank}>
            <Plus size={15} aria-hidden="true" /> New advanced form
          </button>
        </div>
      </header>

      {/* ---- Template gallery ------------------------------------------- */}
      <section className="aff-gallery-shell" aria-labelledby="aff-gallery-heading">
        <div className="aff-gallery-head">
          <div>
            <h3 id="aff-gallery-heading" className="aff-section-title">Start from a template</h3>
            <p className="aff-section-sub">Designed layouts you can reshape on the canvas.</p>
          </div>
          <div className="aff-gallery-controls">
            <button
              type="button"
              className={`aff-gallery-toggle${galleryOpen ? " is-open" : ""}`}
              aria-expanded={galleryOpen}
              onClick={() => {
                setGalleryOpen((open) => !open);
                requestAnimationFrame(() => galleryRef.current?.scrollTo({ left: 0, behavior: "smooth" }));
              }}
            >
              <span>{galleryOpen ? "Show fewer" : "Template gallery"}</span>
              <SlidersHorizontal size={14} aria-hidden="true" />
            </button>
            <div className="aff-gallery-arrows">
              <button type="button" aria-label="Scroll templates left" onClick={() => galleryRef.current?.scrollBy({ left: -320, behavior: "smooth" })}>
                <ArrowLeft size={15} />
              </button>
              <button type="button" aria-label="Scroll templates right" onClick={() => galleryRef.current?.scrollBy({ left: 320, behavior: "smooth" })}>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>

        <div className={`aff-template-rail${galleryOpen ? " is-expanded" : ""}`} ref={galleryRef}>
          <button type="button" className="aff-template-card aff-template-blank" onClick={onCreateBlank}>
            <span className="aff-template-thumb aff-template-thumb-blank">
              <span className="aff-blank-plus"><Plus size={22} aria-hidden="true" /></span>
            </span>
            <span className="aff-template-name">Blank canvas</span>
            <span className="aff-template-hint">Start with an empty form</span>
          </button>

          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="aff-template-card"
              onClick={() => onCreateFromTemplate(template.id)}
              title={`Use the ${template.title} template`}
            >
              <span className="aff-template-thumb">
                <AdvancedFormMiniature form={template} scale={0.28} height={150} />
                <span className="aff-template-use"><Wand2 size={13} aria-hidden="true" /> Use template</span>
              </span>
              <span className="aff-template-name">{template.title}</span>
              <span className="aff-template-hint">{template.category}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ---- Recent advanced forms -------------------------------------- */}
      <section className="aff-recent" aria-labelledby="aff-recent-heading">
        <div className="aff-recent-head">
          <div className="aff-recent-title-wrap">
            <h3 id="aff-recent-heading" className="aff-section-title">Recent advanced forms</h3>
            <span className="aff-count">{forms.length}</span>
          </div>
          <div className="aff-recent-controls">
            <label className="aff-search">
              <Search size={14} aria-hidden="true" />
              <span className="aff-visually-hidden">Search advanced forms</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search advanced forms…" />
            </label>
            <label className="aff-filter">
              <span className="aff-visually-hidden">Filter by category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((entry) => (
                  <option key={entry} value={entry}>{entry === "all" ? "All categories" : entry}</option>
                ))}
              </select>
            </label>
            <label className="aff-filter">
              <span className="aff-visually-hidden">Sort advanced forms</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as AdvancedSort)}>
                {SORTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            <div className="aff-view-toggle" role="group" aria-label="Layout">
              <button type="button" className={layout === "grid" ? "is-active" : ""} aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} aria-label="Grid view">
                <LayoutGrid size={15} />
              </button>
              <button type="button" className={layout === "list" ? "is-active" : ""} aria-pressed={layout === "list"} onClick={() => setLayout("list")} aria-label="List view">
                <List size={15} />
              </button>
            </div>
          </div>
        </div>

        {visibleForms.length === 0 ? (
          <div className="aff-empty-state">
            <IconTile variant="soft" size="lg" className="ds-tone-violet"><Wand2 size={20} /></IconTile>
            <h4>{forms.length === 0 ? "Your advanced canvas is ready" : "No advanced forms match that search"}</h4>
            <p>
              {forms.length === 0
                ? "Build a form with flexible columns, sections and styling — or start from one of the templates above."
                : "Try a different word, or clear the category filter."}
            </p>
            <button type="button" className="aff-primary" onClick={forms.length === 0 ? onCreateBlank : () => { setQuery(""); setCategory("all"); }}>
              {forms.length === 0 ? <><Plus size={15} /> Create your first advanced form</> : "Clear filters"}
            </button>
          </div>
        ) : (
          <div className={layout === "grid" ? "aff-form-grid" : "aff-form-list"}>
            {visibleForms.map((form) => (
              <article key={form.id} className="aff-form-card">
                <button type="button" className="aff-form-thumb" onClick={() => onOpen(form.id)} aria-label={`Open ${form.title}`}>
                  <AdvancedFormMiniature form={form} scale={layout === "list" ? 0.26 : 0.34} height={layout === "list" ? 120 : 186} />
                  <span className="aff-form-thumb-actions">
                    <span className="aff-open-chip"><Pencil size={12} /> Edit</span>
                  </span>
                </button>

                <div className="aff-form-body">
                  <div className="aff-form-title-row">
                    <h4 className="aff-form-title">{form.title}</h4>
                    <AdvancedMenu
                      label={`${form.title} actions`}
                      icon={<MoreHorizontal size={16} />}
                      items={[
                        { id: "open", label: "Open in builder", icon: <Pencil size={14} />, onSelect: () => onOpen(form.id) },
                        { id: "preview", label: "Preview form", icon: <ExternalLink size={14} />, onSelect: () => onPreview(form.id) },
                        { id: "rename", label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenameTarget(form) },
                        { id: "duplicate", label: "Duplicate", icon: <Copy size={14} />, onSelect: () => onDuplicate(form.id) },
                        "divider",
                        { id: "share", label: "Share / copy respondent link", icon: <Share2 size={14} />, onSelect: () => onShare(form.id) },
                        { id: "responses", label: "View responses", icon: <BarChart3 size={14} />, onSelect: () => onOpen(form.id, "responses") },
                        { id: "publish", label: form.status === "published" ? "Unpublish" : "Publish form", icon: <ArrowUpRight size={14} />, onSelect: () => onTogglePublish(form.id) },
                        "divider",
                        { id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => setDeleteTarget(form) },
                      ]}
                    />
                  </div>

                  <p className="aff-form-meta">
                    <span>Modified {formatDate(form.updatedAt)}</span>
                    <span className="aff-dot" aria-hidden="true" />
                    <span>{form.responses.length} {form.responses.length === 1 ? "response" : "responses"}</span>
                  </p>

                  <div className="aff-form-badges">
                    <Badge variant={form.status === "published" ? "success-light" : "outline"} size="xs">
                      {form.status === "published" ? "Published" : "Draft"}
                    </Badge>
                    <Badge variant="secondary" size="xs">{form.category || "General"}</Badge>
                    {form.sharedWith?.length ? (
                      <Badge variant="primary-light" size="xs" title={`Shared with ${form.sharedWith.length} ${form.sharedWith.length === 1 ? "person" : "people"}`}>
                        <Share2 size={10} /> Shared
                      </Badge>
                    ) : null}
                    {form.settings.logic.length ? (
                      <Badge variant="warning-light" size="xs" title="Conditional logic enabled">Logic</Badge>
                    ) : null}
                  </div>

                  {layout === "list" ? (
                    <div className="aff-form-list-actions">
                      <button type="button" className="aff-ghost" onClick={() => onPreview(form.id)}>Preview</button>
                      <button type="button" className="aff-ghost" onClick={() => onOpen(form.id, "responses")}>Responses</button>
                      <button type="button" className="aff-ghost" onClick={() => onOpen(form.id)}>Edit</button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {renameTarget ? (
        <AdvancedPromptDialog
          title="Rename advanced form"
          label="Form name"
          initial={renameTarget.title}
          maxLength={ADVANCED_LIMITS.titleLength}
          confirmLabel="Save name"
          validate={(value) => (value.trim().length ? null : "Give this form a name.")}
          onCancel={() => setRenameTarget(null)}
          onConfirm={(value) => {
            onRename(renameTarget.id, value.trim());
            setRenameTarget(null);
            notify("Advanced form renamed.");
          }}
        />
      ) : null}

      {deleteTarget ? (
        <PersoraDeleteModal
          eyebrow="Advanced Forms"
          title={`Delete “${deleteTarget.title}”?`}
          description="The form, its design and every collected response will be removed from this workspace. This can't be undone."
          confirmLabel="Delete advanced form"
          cancelLabel="Keep form"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            onDelete(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      ) : null}

    </section>
  );
}
