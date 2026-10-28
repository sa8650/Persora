import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Badge } from "../reui/badge";
import { IconTile } from "../reui/icon-tile";
import { Spinner } from "../ui/spinner";
import { iconToneClass } from "../../design-system";
import {
  DASHBOARD_WIDGET_BY_TYPE,
  DASHBOARD_WIDGET_HEIGHTS,
  DASHBOARD_WIDGET_WIDTHS,
  WIDTH_RANK,
  type DashboardWidgetHeight,
  type DashboardWidgetInstance,
  type DashboardWidgetWidth,
} from "../../lib/dashboard-api";
import { WIDGET_VISUALS } from "./widget-icons";

const WIDTH_LABELS: Record<DashboardWidgetWidth, string> = {
  compact: "Compact (1/3)",
  half: "Half (1/2)",
  "two-thirds": "Wide (2/3)",
  full: "Full width",
};

const WIDTH_SHORT: Record<DashboardWidgetWidth, string> = {
  compact: "1/3",
  half: "1/2",
  "two-thirds": "2/3",
  full: "Full",
};

const HEIGHT_LABELS: Record<DashboardWidgetHeight, string> = {
  compact: "Compact",
  standard: "Standard",
  expanded: "Expanded",
};

export interface DashboardWidgetProps {
  widget: DashboardWidgetInstance;
  index: number;
  totalCount: number;
  isEditing: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  subtitle?: string;
  countBadge?: number | string | null;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  footerLabel?: string;
  onFooterAction?: () => void;
  footerMeta?: ReactNode;
  onConfigure: () => void;
  onResize: (patch: { width?: DashboardWidgetWidth; height?: DashboardWidgetHeight }) => void;
  onToggleCollapse: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragHandlePointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragHandleKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}

export function DashboardWidget({
  widget,
  index,
  totalCount,
  isEditing,
  isDragging = false,
  isDropTarget = false,
  subtitle,
  countBadge,
  loading = false,
  error = "",
  onRetry,
  isEmpty = false,
  emptyTitle = "Nothing to show yet",
  emptyDescription,
  emptyAction,
  footerLabel,
  onFooterAction,
  footerMeta,
  onConfigure,
  onResize,
  onToggleCollapse,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragHandlePointerDown,
  onDragHandleKeyDown,
  children,
}: DashboardWidgetProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const bodyId = useId();

  const meta = DASHBOARD_WIDGET_BY_TYPE[widget.type];
  const visual = WIDGET_VISUALS[widget.type];
  const Icon = visual.icon;
  const canDuplicate = meta.allowMultiple;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [menuOpen]);

  return (
    <section
      className="ds-widget-card"
      data-widget-id={widget.id}
      data-widget-type={widget.type}
      data-width={widget.width}
      data-height={widget.height}
      data-collapsed={widget.collapsed ? "true" : "false"}
      data-editing={isEditing ? "true" : "false"}
      data-dragging={isDragging ? "true" : "false"}
      data-drop-target={isDropTarget ? "true" : "false"}
      aria-labelledby={headingId}
    >
      <header className="ds-widget-header">
        <div className="flex min-w-0 items-center gap-2.5">
          {isEditing && (
            <button
              type="button"
              className="ds-widget-drag-handle"
              aria-label={`Drag ${widget.title} to reorder (position ${index + 1} of ${totalCount}). Use arrow keys to move.`}
              title="Drag or use arrow keys to reorder"
              onPointerDown={onDragHandlePointerDown}
              onKeyDown={onDragHandleKeyDown}
            >
              <GripVertical size={15} />
            </button>
          )}
          <IconTile variant="soft" size="sm" className={iconToneClass(visual.tone)} aria-hidden="true">
            <Icon size={15} />
          </IconTile>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 id={headingId} className="truncate text-[13.5px] font-semibold leading-tight text-foreground">
                {widget.title}
              </h3>
              {countBadge !== undefined && countBadge !== null && (
                <Badge variant="primary-light" size="xs" radius="full">
                  {countBadge}
                </Badge>
              )}
            </div>
            {(subtitle || (isEditing && meta.name !== widget.title)) && (
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                {subtitle || meta.name}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isEditing ? (
            <>
              <div className="hidden items-center gap-1 sm:inline-flex" role="group" aria-label={`Width for ${widget.title}`}>
                {DASHBOARD_WIDGET_WIDTHS.map((widthOpt) => {
                  const disabled = WIDTH_RANK[widthOpt] < WIDTH_RANK[meta.minWidth];
                  const active = widget.width === widthOpt;
                  return (
                    <button
                      key={widthOpt}
                      type="button"
                      disabled={disabled}
                      onClick={() => onResize({ width: widthOpt })}
                      aria-pressed={active}
                      title={disabled ? `Minimum readable width is ${WIDTH_LABELS[meta.minWidth]}` : WIDTH_LABELS[widthOpt]}
                      className={`h-6 rounded-md border px-1.5 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-primary bg-accent text-accent-foreground"
                          : disabled
                            ? "cursor-not-allowed border-border opacity-40"
                            : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {WIDTH_SHORT[widthOpt]}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="icon-button !h-7 !w-7"
                disabled={index === 0}
                onClick={onMoveUp}
                aria-label={`Move ${widget.title} up`}
                title="Move up"
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                className="icon-button !h-7 !w-7"
                disabled={index >= totalCount - 1}
                onClick={onMoveDown}
                aria-label={`Move ${widget.title} down`}
                title="Move down"
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                className="icon-button !h-7 !w-7"
                onClick={onConfigure}
                aria-label={`Configure ${widget.title}`}
                title="Configure widget"
              >
                <SlidersHorizontal size={14} />
              </button>
              <button
                type="button"
                className="icon-button !h-7 !w-7 text-destructive"
                onClick={onRemove}
                aria-label={`Remove ${widget.title} from dashboard`}
                title="Remove widget"
              >
                <Trash2 size={14} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="icon-button !h-7 !w-7"
                onClick={onToggleCollapse}
                aria-expanded={!widget.collapsed}
                aria-controls={bodyId}
                aria-label={widget.collapsed ? `Expand ${widget.title}` : `Collapse ${widget.title}`}
                title={widget.collapsed ? "Expand widget" : "Collapse widget"}
              >
                {widget.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
              <div className="relative" ref={menuWrapRef}>
                <button
                  type="button"
                  className="icon-button !h-7 !w-7"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`${widget.title} options`}
                  onClick={() => setMenuOpen((prev) => !prev)}
                >
                  <MoreHorizontal size={15} />
                </button>
                {menuOpen && (
                  <div className="ds-widget-menu-popover" role="menu" aria-label={`${widget.title} actions`}>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-secondary"
                      onClick={() => {
                        setMenuOpen(false);
                        onConfigure();
                      }}
                    >
                      <SlidersHorizontal size={14} className="text-muted-foreground" />
                      <span>Configure…</span>
                    </button>

                    <div className="my-1 border-t border-border px-2.5 pt-1.5 pb-1">
                      <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Width
                      </span>
                      <div className="mt-1 grid grid-cols-4 gap-1">
                        {DASHBOARD_WIDGET_WIDTHS.map((widthOpt) => {
                          const disabled = WIDTH_RANK[widthOpt] < WIDTH_RANK[meta.minWidth];
                          const active = widget.width === widthOpt;
                          return (
                            <button
                              key={widthOpt}
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                onResize({ width: widthOpt });
                                setMenuOpen(false);
                              }}
                              className={`h-6 rounded border text-[11px] font-medium ${
                                active
                                  ? "border-primary bg-accent text-accent-foreground"
                                  : disabled
                                    ? "cursor-not-allowed border-border opacity-35"
                                    : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {WIDTH_SHORT[widthOpt]}
                            </button>
                          );
                        })}
                      </div>
                      <span className="mt-2 block text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Height
                      </span>
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        {DASHBOARD_WIDGET_HEIGHTS.map((heightOpt) => {
                          const active = widget.height === heightOpt;
                          return (
                            <button
                              key={heightOpt}
                              type="button"
                              onClick={() => {
                                onResize({ height: heightOpt });
                                setMenuOpen(false);
                              }}
                              className={`h-6 rounded border text-[11px] font-medium ${
                                active
                                  ? "border-primary bg-accent text-accent-foreground"
                                  : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {HEIGHT_LABELS[heightOpt]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-secondary"
                      onClick={() => {
                        setMenuOpen(false);
                        onToggleCollapse();
                      }}
                    >
                      {widget.collapsed ? (
                        <ChevronDown size={14} className="text-muted-foreground" />
                      ) : (
                        <ChevronUp size={14} className="text-muted-foreground" />
                      )}
                      <span>{widget.collapsed ? "Expand" : "Collapse"}</span>
                    </button>

                    {canDuplicate && (
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-secondary"
                        onClick={() => {
                          setMenuOpen(false);
                          onDuplicate();
                        }}
                      >
                        <Copy size={14} className="text-muted-foreground" />
                        <span>Duplicate</span>
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      disabled={index === 0}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-secondary disabled:opacity-40"
                      onClick={() => {
                        setMenuOpen(false);
                        onMoveUp();
                      }}
                    >
                      <ArrowUp size={14} className="text-muted-foreground" />
                      <span>Move up</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      disabled={index >= totalCount - 1}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-secondary disabled:opacity-40"
                      onClick={() => {
                        setMenuOpen(false);
                        onMoveDown();
                      }}
                    >
                      <ArrowDown size={14} className="text-muted-foreground" />
                      <span>Move down</span>
                    </button>

                    <div className="my-1 border-t border-border" />

                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-destructive hover:bg-secondary"
                      onClick={() => {
                        setMenuOpen(false);
                        onRemove();
                      }}
                    >
                      <Trash2 size={14} />
                      <span>Remove from dashboard</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {!widget.collapsed && (
        <>
          <div id={bodyId} className="ds-widget-body">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-[12.5px] text-muted-foreground">
                <Spinner className="size-4 text-primary" />
                <span>Loading {widget.title.toLowerCase()}…</span>
              </div>
            ) : error ? (
              <div
                className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-border bg-secondary/60 px-4 py-6 text-center"
                role="alert"
              >
                <IconTile variant="soft" size="sm" className="ds-tone-rose">
                  <AlertCircle size={15} />
                </IconTile>
                <div className="space-y-0.5">
                  <p className="text-[12.5px] font-semibold text-foreground">Couldn’t load this widget</p>
                  <p className="text-[11.5px] text-muted-foreground">{error}</p>
                </div>
                {onRetry && (
                  <button type="button" className="quiet-button !h-8 !px-3 !text-xs" onClick={onRetry}>
                    <RefreshCw size={13} /> Retry
                  </button>
                )}
              </div>
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
                <IconTile variant="soft" size="default" className={iconToneClass(visual.tone)} aria-hidden="true">
                  <Icon size={16} />
                </IconTile>
                <div className="max-w-[280px] space-y-0.5">
                  <p className="text-[12.5px] font-semibold text-foreground">{emptyTitle}</p>
                  {emptyDescription && (
                    <p className="text-[11.5px] leading-relaxed text-muted-foreground">{emptyDescription}</p>
                  )}
                </div>
                {emptyAction && <div className="mt-1">{emptyAction}</div>}
              </div>
            ) : (
              children
            )}
          </div>

          {(footerLabel || footerMeta) && (
            <footer className="ds-widget-footer">
              <div className="min-w-0 truncate text-[11.5px] text-muted-foreground">
                {footerMeta}
              </div>
              {footerLabel && onFooterAction && (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                  onClick={onFooterAction}
                >
                  <span>{footerLabel}</span>
                  <ArrowRight size={13} />
                </button>
              )}
            </footer>
          )}
        </>
      )}
    </section>
  );
}
