import * as React from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
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


