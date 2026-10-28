// Persora Table — small shared UI pieces (menus, dialogs, formatting helpers).
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";
import { Spinner } from "@/components/ui/spinner";

export const newId = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "—";
  const diff = Math.max(0, now - time);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const plural = (count: number, word: string, many = `${word}s`) => `${count.toLocaleString()} ${count === 1 ? word : many}`;

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect: () => void;
}

/**
 * Portaled compact dropdown menu: escapes overflow/scroll containers (such as
 * bottom sheet tab strips), automatically flips above the trigger when near the
 * bottom edge of the viewport, closes on outside click/scroll/Escape, and
 * supports arrow-key navigation.
 */
export function Menu({ label, icon, items, className = "", buttonClassName = "tb-icon-button", align = "start", side, title, children }: {
  label: string;
  icon?: ReactNode;
  items: Array<MenuItem | "divider">;
  className?: string;
  buttonClassName?: string;
  align?: "start" | "end";
  side?: "top" | "bottom";
  title?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePosition = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const menuEl = list.current;
      const estHeight = menuEl?.offsetHeight || Math.min(340, items.length * 34 + 16);
      const estWidth = menuEl?.offsetWidth || 216;
      const spaceBelow = vh - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = side === "top" || (side !== "bottom" && spaceBelow < estHeight && spaceAbove > spaceBelow);

      const style: CSSProperties = {
        position: "fixed",
        zIndex: 280,
        maxHeight: `${Math.max(160, (openUp ? spaceAbove : spaceBelow))}px`,
      };

      if (openUp) {
        style.bottom = `${Math.max(8, vh - rect.top + 6)}px`;
        style.top = "auto";
      } else {
        style.top = `${Math.max(8, rect.bottom + 6)}px`;
        style.bottom = "auto";
      }

      if (align === "end") {
        const right = Math.max(8, Math.min(vw - estWidth - 8, vw - rect.right));
        style.right = `${right}px`;
        style.left = "auto";
      } else {
        const left = Math.max(8, Math.min(vw - estWidth - 8, rect.left));
        style.left = `${left}px`;
        style.right = "auto";
      }
      setFloatingStyle(style);
    };

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, align, side, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setOpen(false);
          triggerRef.current?.focus();
        }
        return;
      }
      const target = event.target as Node | null;
      if (target && !root.current?.contains(target) && !list.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div className={`tb-menu ${className}`} ref={root}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={title ?? label}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}{children}
      </button>
      {open && (
        <ModalPortal>
          <div
            className={`tb-menu-list tb-menu-portaled tb-menu-${align}`}
            style={floatingStyle}
            role="menu"
            id={menuId}
            ref={list}
            onKeyDown={onKeyDown}
          >
            {items.map((item, index) => item === "divider"
              ? <div key={`d${index}`} className="tb-menu-divider" role="separator" />
              : (
                <button
                  key={item.id}
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={item.checked}
                  className={`tb-menu-item ${item.danger ? "is-danger" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span className="tb-menu-icon" aria-hidden="true">{item.icon}</span>
                  <span className="tb-menu-label">{item.label}{item.hint && <small>{item.hint}</small>}</span>
                  {item.checked && <span className="tb-menu-check" aria-hidden="true">✓</span>}
                </button>
              ))}
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

/** Persora's modal shell with Persora Table's footer conventions. */
export function TableDialog({ id, title, eyebrow, icon, busy = false, onClose, children, footer, wide = false }: {
  id: string;
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return <ModalPortal>
    <ItemModalShell labelledBy={id} className={`tb-dialog ${wide ? "tb-dialog-wide" : ""}`} backdropClassName="tb-dialog-backdrop" icon={icon} iconClassName="tb-modal-icon"
      eyebrow={eyebrow} title={title} onClose={onClose} closeDisabled={busy} dismissable={!busy}>
      <div className="vault-modal-scroll tb-dialog-body">{children}</div>
      {footer && <div className="editor-form-footer"><div/><div className="editor-actions">{footer}</div></div>}
    </ItemModalShell>
  </ModalPortal>;
}

/** Small text prompt dialog (rename sheet/table, label). */
export function PromptDialog({ id, title, label, initial, maxLength, confirmLabel = "Save", busy = false, error, validate, onCancel, onConfirm }: {
  id: string;
  title: string;
  label: string;
  initial: string;
  maxLength: number;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  validate?: (value: string) => string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const problem = validate ? validate(value) : null;
  const submit = (event?: React.FormEvent) => { event?.preventDefault(); setTouched(true); if (!problem) onConfirm(value); };
  return <TableDialog id={id} title={title} busy={busy} onClose={onCancel}
    footer={<><button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="editor-submit" onClick={() => submit()} disabled={busy}>{busy ? <><Spinner className="size-3.5"/> Saving…</> : confirmLabel}</button></>}>
    <form onSubmit={submit} className="tb-form" noValidate>
      <label className="tb-field"><span>{label}</span>
        <input className="tb-input" value={value} maxLength={maxLength} autoFocus onChange={(event) => { setValue(event.target.value); setTouched(true); }} aria-invalid={Boolean((touched && problem) || error)}/>
      </label>
      {(touched && problem) || error ? <p className="tb-field-error" role="alert">{error || problem}</p> : null}
    </form>
  </TableDialog>;
}
