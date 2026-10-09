import type { ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Persora's single, centralized item-modal shell.
 *
 * Every item view / add / edit dialog across all spaces (vault records,
 * tasks & schedules, personal finance records) and the unified share modal
 * are rendered through this one standalone component, so every space shares
 * the exact same modal chrome: soft backdrop, rounded surface, icon tile +
 * eyebrow + title header, scrollable body and a footer strip.
 */
export interface ItemModalShellProps {
  /** id applied to the <h2> for aria-labelledby. */
  labelledBy: string;
  /** Extra surface classes, e.g. "vault-modal-editor" or "record-share-dialog". */
  className?: string;
  /** Extra backdrop classes, e.g. "todo-editor-backdrop" or "record-share-backdrop". */
  backdropClassName?: string;
  /** Icon element rendered inside the header icon tile. */
  icon?: ReactNode;
  /** Extra classes for the icon tile (section colors, kind colors, …). */
  iconClassName?: string;
  /** Small uppercase overline above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Optional node rendered under the title (e.g. the shared/private pill). */
  headerMeta?: ReactNode;
  /** Optional extra header actions rendered before the close button. */
  headerExtra?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  /** When false, clicking the backdrop does not dismiss (e.g. while saving). */
  dismissable?: boolean;
  children: ReactNode;
}

export default function ItemModalShell({
  labelledBy,
  className = "",
  backdropClassName = "",
  icon,
  iconClassName = "",
  eyebrow,
  title,
  headerMeta,
  headerExtra,
  onClose,
  closeDisabled = false,
  closeLabel = "Close",
  dismissable = true,
  children,
}: ItemModalShellProps) {
  return (
    <div
      className={`modal-backdrop ${backdropClassName}`.trim()}
      role="presentation"
      onMouseDown={(event) => { if (dismissable && event.target === event.currentTarget) onClose(); }}
    >
      <section
        className={`vault-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <header className="vault-modal-header">
          {icon ? <span className={`vault-modal-icon ${iconClassName}`.trim()}>{icon}</span> : null}
          <div className="vault-modal-title">
            {eyebrow ? <small>{eyebrow}</small> : null}
            <h2 id={labelledBy}>{title}</h2>
            {headerMeta}
          </div>
          {headerExtra}
          <button type="button" className="vault-modal-close" onClick={onClose} disabled={closeDisabled} aria-label={closeLabel}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
