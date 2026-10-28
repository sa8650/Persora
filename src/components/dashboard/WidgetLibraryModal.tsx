import { useEffect, useId, useMemo, useState } from "react";
import { Check, LayoutGrid, Plus, Sparkles, X } from "lucide-react";
import ModalPortal from "../ModalPortal";
import { Badge } from "../reui/badge";
import { IconTile } from "../reui/icon-tile";
import { PersoraEmptyState, PersoraSearchField, iconToneClass } from "../../design-system";
import {
  DASHBOARD_WIDGET_CATALOG,
  DASHBOARD_WIDGET_CATEGORIES,
  type DashboardWidgetCategoryId,
  type DashboardWidgetInstance,
  type DashboardWidgetType,
} from "../../lib/dashboard-api";
import { WIDGET_VISUALS } from "./widget-icons";

export interface WidgetLibraryModalProps {
  open: boolean;
  existingWidgets: DashboardWidgetInstance[];
  onClose: () => void;
  onAddWidget: (type: DashboardWidgetType) => void;
}

export function WidgetLibraryModal({
  open,
  existingWidgets,
  onClose,
  onAddWidget,
}: WidgetLibraryModalProps) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<"all" | DashboardWidgetCategoryId>("all");
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const countsByType = useMemo(() => {
    const map = new Map<DashboardWidgetType, number>();
    for (const w of existingWidgets) {
      if (w.visible === false) continue;
      map.set(w.type, (map.get(w.type) || 0) + 1);
    }
    return map;
  }, [existingWidgets]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DASHBOARD_WIDGET_CATALOG.filter((entry) => {
      if (selectedCategory !== "all" && entry.category !== selectedCategory) return false;
      if (!q) return true;
      const catLabel = DASHBOARD_WIDGET_CATEGORIES.find((c) => c.id === entry.category)?.label || "";
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.previewSummary.toLowerCase().includes(q) ||
        catLabel.toLowerCase().includes(q)
      );
    });
  }, [query, selectedCategory]);

  const grouped = useMemo(() => {
    return DASHBOARD_WIDGET_CATEGORIES.map((category) => ({
      category,
      items: filteredCatalog.filter((entry) => entry.category === category.id),
    })).filter((group) => group.items.length > 0);
  }, [filteredCatalog]);

  if (!open) return null;

  return (
    <ModalPortal>
      <div
        className="modal-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          className="modal-card modal-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          style={{ maxWidth: 880 }}
        >
          <div className="modal-head">
            <div className="flex items-center gap-3">
              <IconTile variant="soft" size="default" className="ds-tone-blue" aria-hidden="true">
                <LayoutGrid size={17} />
              </IconTile>
              <div>
                <h2 id={titleId}>Widget Library</h2>
                <p>Add real data-connected Persora widgets to personalize your command center.</p>
              </div>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close widget library">
              <X size={16} />
            </button>
          </div>

          <div className="modal-body space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <PersoraSearchField
                value={query}
                onChange={setQuery}
                onClear={() => setQuery("")}
                placeholder="Search widgets by name, data source, or category…"
                aria-label="Search dashboard widgets"
                containerClassName="w-full sm:max-w-sm"
              />
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Widget categories">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCategory === "all"}
                  onClick={() => setSelectedCategory("all")}
                  className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
                    selectedCategory === "all"
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All ({DASHBOARD_WIDGET_CATALOG.length})
                </button>
                {DASHBOARD_WIDGET_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
                      selectedCategory === cat.id
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {grouped.length === 0 ? (
              <PersoraEmptyState
                icon={<Sparkles size={18} />}
                title="No matching widgets"
                description="Try another search term or switch categories."
                stacked={false}
                action={
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => {
                      setQuery("");
                      setSelectedCategory("all");
                    }}
                  >
                    Show all widgets
                  </button>
                }
              />
            ) : (
              <div className="max-h-[58vh] space-y-6 overflow-y-auto pr-1">
                {grouped.map(({ category, items }) => (
                  <div key={category.id} className="space-y-2.5">
                    <div className="flex items-baseline justify-between border-b border-border pb-1.5">
                      <div>
                        <h3 className="text-[13px] font-semibold text-foreground">{category.label}</h3>
                        <p className="text-[11.5px] text-muted-foreground">{category.description}</p>
                      </div>
                      <Badge variant="secondary" size="xs" radius="full">
                        {items.length}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {items.map((item) => {
                        const visual = WIDGET_VISUALS[item.type];
                        const Icon = visual.icon;
                        const count = countsByType.get(item.type) || 0;
                        const canAdd = count === 0 || item.allowMultiple;

                        return (
                          <article
                            key={item.type}
                            className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
                            data-library-widget={item.type}
                          >
                            <div className="flex items-start gap-3">
                              <IconTile
                                variant="soft"
                                size="default"
                                className={iconToneClass(visual.tone)}
                                aria-hidden="true"
                              >
                                <Icon size={16} />
                              </IconTile>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <h4 className="text-[13px] font-semibold text-foreground">{item.name}</h4>
                                  {count > 0 && (
                                    <Badge variant="primary-light" size="xs" radius="full">
                                      Added{count > 1 ? ` ×${count}` : ""}
                                    </Badge>
                                  )}
                                  {item.allowMultiple && (
                                    <Badge variant="outline" size="xs" radius="full">
                                      Multi-instance
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-[12px] leading-relaxed text-muted-foreground">
                                  {item.description}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5">
                              <span className="truncate text-[11px] font-medium text-muted-foreground">
                                {item.previewSummary}
                              </span>
                              <button
                                type="button"
                                disabled={!canAdd}
                                aria-label={`Add ${item.name} widget`}
                                onClick={() => onAddWidget(item.type)}
                                className={
                                  canAdd
                                    ? "main-add-button !h-8 !px-3 !text-xs"
                                    : "quiet-button !h-8 !px-3 !text-xs opacity-60 cursor-not-allowed"
                                }
                              >
                                {canAdd ? (
                                  <>
                                    <Plus size={14} />
                                    <span>{count > 0 ? "Add another" : "Add widget"}</span>
                                  </>
                                ) : (
                                  <>
                                    <Check size={13} />
                                    <span>On dashboard</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <span className="text-xs text-muted-foreground">
              {existingWidgets.length} widget{existingWidgets.length === 1 ? "" : "s"} currently active on your dashboard
            </span>
            <button type="button" className="quiet-button" onClick={onClose}>
              Done
            </button>
          </div>
        </section>
      </div>
    </ModalPortal>
  );
}
