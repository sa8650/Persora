import * as React from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { IconStack } from "@/components/reui/icon-stack";
import { IconTile } from "@/components/reui/icon-tile";
import { Spinner } from "@/components/ui/spinner";
import { LauncherModuleIcon } from "@/components/launcher/LauncherIcons";
import type { LauncherModuleId } from "@/lib/app-launcher";
import { cn } from "@/lib/utils";

export type PersoraTone =
  | "blue"
  | "emerald"
  | "green"
  | "amber"
  | "orange"
  | "yellow"
  | "rose"
  | "red"
  | "violet"
  | "indigo"
  | "cyan"
  | "teal"
  | "sky"
  | "slate";

const TONE_MAP: Record<PersoraTone, string> = {
  blue: "ds-tone-blue",
  sky: "ds-tone-blue",
  emerald: "ds-tone-emerald",
  green: "ds-tone-emerald",
  teal: "ds-tone-cyan",
  cyan: "ds-tone-cyan",
  amber: "ds-tone-amber",
  orange: "ds-tone-amber",
  yellow: "ds-tone-amber",
  rose: "ds-tone-rose",
  red: "ds-tone-rose",
  violet: "ds-tone-violet",
  indigo: "ds-tone-violet",
  slate: "ds-tone-slate",
};

export function iconToneClass(tone?: string | null): string {
  if (!tone) return "ds-tone-blue";
  return TONE_MAP[tone as PersoraTone] || "ds-tone-blue";
}

export interface PersoraIconStackProps {
  moduleId?: LauncherModuleId;
  icon?: React.ReactNode;
  tone?: PersoraTone | string;
  size?: number;
  className?: string;
}

/**
 * Shared Persora isometric layered card stack displaying either an authentic
 * Persora module icon (`LauncherModuleIcon`) or a semantic glyph.
 */
export function PersoraIconStack({
  moduleId,
  icon,
  tone = "blue",
  size = 22,
  className,
}: PersoraIconStackProps) {
  return (
    <IconStack
      className={cn("ds-icon-stack", iconToneClass(tone), className)}
      style={{ ["--li-gap" as string]: "var(--ds-card-bg)" } as React.CSSProperties}
    >
      {moduleId ? <LauncherModuleIcon id={moduleId} size={size} /> : icon}
    </IconStack>
  );
}

export interface PersoraEmptyStateProps {
  moduleId?: LauncherModuleId;
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: PersoraTone | string;
  stacked?: boolean;
  compact?: boolean;
  className?: string;
  role?: React.AriaRole;
}

/**
 * Standardized empty state built on Persora's `PersoraIconStack` / `IconTile`
 * and the Persora module icon set. Guarantees generous vertical rhythm so icons
 * and headings never collide.
 */
export function PersoraEmptyState({
  moduleId,
  icon,
  title,
  description,
  action,
  tone = "blue",
  stacked = true,
  compact = false,
  className,
  role,
}: PersoraEmptyStateProps) {
  const glyph = moduleId ? <LauncherModuleIcon id={moduleId} size={22} /> : icon;
  return (
    <div
      className={cn(
        "section-empty ds-empty-state",
        compact && "ds-empty-state-compact",
        className,
      )}
      role={role}
    >
      {glyph ? (
        <div className="ds-empty-visual" aria-hidden="true">
          {stacked ? (
            <PersoraIconStack moduleId={moduleId} icon={icon} tone={tone} />
          ) : (
            <IconTile
              variant="soft"
              size="lg"
              className={iconToneClass(tone)}
              style={{ ["--li-gap" as string]: "var(--ds-card-bg)" } as React.CSSProperties}
            >
              {glyph}
            </IconTile>
          )}
        </div>
      ) : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="ds-empty-actions">{action}</div> : null}
    </div>
  );
}

export interface PersoraAsideStatProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: PersoraTone | string;
  note?: React.ReactNode;
  noteIcon?: React.ReactNode;
}

/**
 * Standardized section header stat tile using ReUI `IconTile` beside a clean
 * stacked label + count so text never overlaps the icon artwork.
 */
export function PersoraAsideStat({
  icon,
  label,
  value,
  tone = "blue",
  note,
  noteIcon,
}: PersoraAsideStatProps) {
  return (
    <div className="section-heading-aside">
      <div className={cn("section-aside-art ds-aside-stat", `aside-${tone}`)}>
        <IconTile variant="soft" size="default" className={iconToneClass(tone)} aria-hidden="true">
          {icon}
        </IconTile>
        <div className="ds-aside-stat-copy">
          <span>{label}</span>
          <strong>{typeof value === "number" ? String(value).padStart(2, "0") : value}</strong>
        </div>
      </div>
      {note ? (
        <div className="aside-note">
          {noteIcon}
          <span>{note}</span>
        </div>
      ) : null}
    </div>
  );
}

export interface PersoraSearchFieldProps extends Omit<React.ComponentProps<"input">, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  clearLabel?: string;
  containerClassName?: string;
}

/**
 * Icon-safe search input container: uses flex layout with shrink-0 leading icon
 * and zero-border inner `<input>` so text and icons never overlap.
 */
export function PersoraSearchField({
  value,
  onChange,
  onClear,
  clearLabel = "Clear search",
  containerClassName,
  className,
  ...props
}: PersoraSearchFieldProps) {
  return (
    <label className={cn("ds-search-field", containerClassName)}>
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={className}
        {...props}
      />
      {value && (
        <button
          type="button"
          className="ds-search-clear"
          onClick={() => (onClear ? onClear() : onChange(""))}
          aria-label={clearLabel}
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}

export interface PersoraDeleteModalProps {
  /** Heading displayed inside the alertdialog (e.g. `Delete “Budget 2026”?`). */
  title: React.ReactNode;
  /** Optional explicit id for aria-labelledby (defaults to a generated id). */
  titleId?: string;
  /** Supporting explanation or impact summary rendered below the heading. */
  description?: React.ReactNode;
  /** Additional body nodes (lists, badges, warnings). */
  children?: React.ReactNode;
  /** Label for the confirm CTA button (default: `"Delete"`). */
  confirmLabel?: React.ReactNode;
  /** Label for the cancel button (default: `"Cancel"`). */
  cancelLabel?: React.ReactNode;
  /** Optional controlled visibility flag (defaults to `true` when mounted). */
  open?: boolean;
  /** Use destructive rose styling (default: `true`). */
  danger?: boolean;
  /** Disables dismissal and shows a loading spinner on the confirm button. */
  busy?: boolean;
  /**
   * @deprecated The clean confirmation layout no longer renders a header icon.
   * Accepted for API compatibility with existing call sites.
   */
  icon?: React.ReactNode;
  /** Optional eyebrow label above the title. */
  eyebrow?: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Global Persora Delete / Destructive Confirmation Modal.
 *
 * Clean, centered confirmation layout: title, one-line impact summary, then a
 * full-width destructive action stacked above a full-width Cancel button.
 * Always portals directly to `document.body` above `.workspace-sidebar` and
 * all page stacking contexts so confirmation dialogs never open confined inside
 * `.workspace-main` or beside the sidebar.
 */
export function PersoraDeleteModal({
  open = true,
  title,
  titleId,
  description,
  children,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  busy = false,
  eyebrow,
  className,
  backdropClassName,
  onCancel,
  onConfirm,
}: PersoraDeleteModalProps) {
  const autoId = React.useId();
  const resolvedTitleId = titleId || `ds-delete-title-${autoId}`;
  const descId = `ds-delete-desc-${autoId}`;
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  const onCancelRef = React.useRef(onCancel);
  onCancelRef.current = onCancel;

  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open, busy]);

  if (!open) return null;

  const content = (
    <div
      className={cn("modal-backdrop ds-delete-modal-backdrop", backdropClassName)}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <section
        className={cn("confirm-dialog ds-delete-modal", className)}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={resolvedTitleId}
        aria-describedby={description || children ? descId : undefined}
      >
        <div className="ds-delete-modal-copy">
          {eyebrow ? <span className="ds-delete-modal-eyebrow">{eyebrow}</span> : null}
          <h2 id={resolvedTitleId}>{title}</h2>
          {(description || children) && (
            <div id={descId} className="confirm-copy ds-delete-modal-body">
              {description ? <p>{description}</p> : null}
              {children}
            </div>
          )}
        </div>

        <div className="confirm-actions ds-delete-modal-actions">
          <button
            type="button"
            className={cn(
              "ds-delete-confirm-btn",
              danger ? "confirm-danger-button" : "ds-primary-confirm-btn editor-submit",
            )}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <Spinner className="size-3.5" /> : null}
            <span>{confirmLabel}</span>
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="ds-delete-cancel-btn quiet-button"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}

// ---------------------------------------------------------------------------
// PersoraDatePicker — Reusable Persora Date Input + Anchored Month Calendar
// ---------------------------------------------------------------------------

export interface PersoraDatePickerProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  min?: string;
  minDate?: string;
  max?: string;
  maxDate?: string;
  rangeStart?: string;
  rangeEnd?: string;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  clearable?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  "aria-label"?: string;
  ariaInvalid?: boolean;
  className?: string;
}

function isoToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoYmd(ymd: string): { year: number; month: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d };
}

function buildCalendarMonthCells(year: number, month: number): Array<{ date: string; day: number; inMonth: boolean }> {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = first.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - startDow));
  const cells: Array<{ date: string; day: number; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const cur = new Date(gridStart);
    cur.setUTCDate(gridStart.getUTCDate() + i);
    const iso = cur.toISOString().slice(0, 10);
    cells.push({
      date: iso,
      day: cur.getUTCDate(),
      inMonth: cur.getUTCMonth() + 1 === month && cur.getUTCFullYear() === year,
    });
  }
  return cells;
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_HEADS = ["S", "M", "T", "W", "T", "F", "S"];

export function PersoraDatePicker({
  id,
  value,
  onChange,
  min,
  minDate,
  max,
  maxDate,
  rangeStart,
  rangeEnd,
  disabled = false,
  required = false,
  allowClear = false,
  clearable = false,
  placeholder = "YYYY-MM-DD",
  ariaLabel,
  "aria-label": ariaLabelAttr,
  ariaInvalid,
  className,
}: PersoraDatePickerProps) {
  const effectiveMin = min ?? minDate;
  const effectiveMax = max ?? maxDate;
  const effectiveAllowClear = allowClear || clearable;
  const effectiveAriaLabel = ariaLabel ?? ariaLabelAttr;
  const [open, setOpen] = React.useState(false);
  const shellRef = React.useRef<HTMLDivElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const today = React.useMemo(() => isoToday(), []);

  const seed = parseIsoYmd(value) || parseIsoYmd(effectiveMin || "") || parseIsoYmd(today)!;
  const [viewYear, setViewYear] = React.useState(seed.year);
  const [viewMonth, setViewMonth] = React.useState(seed.month);
  const [coords, setCoords] = React.useState<{ top: number; left: number; isSheet: boolean }>({
    top: 0,
    left: 0,
    isSheet: false,
  });

  React.useEffect(() => {
    const parsed = parseIsoYmd(value);
    if (parsed) {
      setViewYear(parsed.year);
      setViewMonth(parsed.month);
    }
  }, [value]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw <= 540) {
        setCoords({ top: 0, left: 0, isSheet: true });
        return;
      }
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popW = 268;
      const popH = 296;
      const left = Math.min(Math.max(8, rect.left), Math.max(8, vw - popW - 8));
      const top = rect.bottom + 6 + popH <= vh - 8 ? rect.bottom + 6 : Math.max(8, rect.top - popH - 6);
      setCoords({ top, left, isSheet: false });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        shellRef.current &&
        !shellRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const shiftMonth = (delta: number) => {
    let nextM = viewMonth + delta;
    let nextY = viewYear;
    if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    } else if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    setViewYear(nextY);
    setViewMonth(nextM);
  };

  const cells = React.useMemo(() => buildCalendarMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);

  return (
    <div
      ref={shellRef}
      className={cn("ds-date-picker-shell", disabled && "is-disabled", ariaInvalid && "is-invalid", className)}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        required={required}
        aria-label={effectiveAriaLabel}
        aria-invalid={ariaInvalid || undefined}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onChange={(e) => onChange(e.target.value)}
        className="ds-date-picker-input"
      />
      <button
        type="button"
        className="ds-date-picker-trigger"
        disabled={disabled}
        aria-label="Open calendar"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <CalendarDays size={14} aria-hidden="true" />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {coords.isSheet && (
              <div
                className="ds-date-picker-scrim"
                aria-hidden="true"
                onClick={() => setOpen(false)}
              />
            )}
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Select date"
              className={cn("ds-date-picker-popover", coords.isSheet && "is-sheet")}
              style={coords.isSheet ? undefined : { top: coords.top, left: coords.left }}
            >
              <div className="ds-date-picker-head">
                <span className="ds-date-picker-month">
                  {MONTH_LABELS[viewMonth - 1]} {viewYear}
                </span>
                <div className="ds-date-picker-nav">
                  <button
                    type="button"
                    className="ds-date-picker-nav-btn"
                    aria-label="Previous month"
                    onClick={() => shiftMonth(-1)}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="ds-date-picker-nav-btn"
                    aria-label="Next month"
                    onClick={() => shiftMonth(1)}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
              <div className="ds-date-picker-grid">
                {WEEKDAY_HEADS.map((label, idx) => (
                  <span key={idx} className="ds-date-picker-weekday" aria-hidden="true">
                    {label}
                  </span>
                ))}
                {cells.map((cell) => {
                  const isBeforeMin = Boolean(effectiveMin && cell.date < effectiveMin);
                  const isAfterMax = Boolean(effectiveMax && cell.date > effectiveMax);
                  const cellDisabled = isBeforeMin || isAfterMax;
                  const isSelected = value === cell.date;
                  const isToday = today === cell.date;
                  const inRange = Boolean(
                    rangeStart &&
                      rangeEnd &&
                      rangeEnd >= rangeStart &&
                      cell.date >= rangeStart &&
                      cell.date <= rangeEnd,
                  );
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      disabled={cellDisabled}
                      aria-pressed={isSelected}
                      className={cn(
                        "ds-date-picker-day",
                        !cell.inMonth && "is-outside",
                        inRange && "is-in-range",
                        isToday && "is-today",
                        isSelected && "is-selected",
                      )}
                      onClick={() => {
                        onChange(cell.date);
                        setOpen(false);
                      }}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
              <div className="ds-date-picker-foot">
                <button
                  type="button"
                  className="ds-date-picker-foot-btn"
                  disabled={Boolean((effectiveMin && today < effectiveMin) || (effectiveMax && today > effectiveMax))}
                  onClick={() => {
                    onChange(today);
                    setOpen(false);
                  }}
                >
                  Today
                </button>
                {(effectiveAllowClear || !required) && value ? (
                  <button
                    type="button"
                    className="ds-date-picker-foot-btn is-muted"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PersoraSegmentedControl — Reusable Flat Segmented Button Group
// ---------------------------------------------------------------------------

export interface PersoraSegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface PersoraSegmentedControlProps<T extends string = string> {
  value: T;
  options: ReadonlyArray<PersoraSegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

export function PersoraSegmentedControl<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: PersoraSegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("ds-segmented", size === "sm" && "ds-segmented-sm", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            className={cn("ds-segmented-btn", active && "is-active")}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon ? <span className="ds-segmented-icon">{opt.icon}</span> : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}


