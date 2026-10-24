// Persora Table — small shared UI pieces (menus, dialogs, formatting helpers).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import ModalPortal from "../ModalPortal";
import ItemModalShell from "../ItemModalShell";

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
 * A compact dropdown menu: opens below its button, closes on outside click,
 * Escape or selection, and supports arrow-key navigation.
 */
export function Menu({ label, icon, items, className = "", buttonClassName = "tb-icon-button", align = "start", title, children }: {
  label: string;
  icon?: ReactNode;
  items: Array<MenuItem | "divider">;
  className?: string;
  buttonClassName?: string;
  align?: "start" | "end";
  title?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); } return; }
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };
  return <div className={`tb-menu ${className}`} ref={root}>
    <button type="button" className={buttonClassName} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={label} title={title ?? label} onClick={() => setOpen((value) => !value)}>
      {icon}{children}
    </button>
    {open && <div className={`tb-menu-list tb-menu-${align}`} role="menu" id={menuId} ref={list} onKeyDown={onKeyDown}>
      {items.map((item, index) => item === "divider"
        ? <div key={`d${index}`} className="tb-menu-divider" role="separator"/>
        : <button key={item.id} type="button" role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={item.checked} className={`tb-menu-item ${item.danger ? "is-danger" : ""}`} disabled={item.disabled}
          onClick={() => { setOpen(false); item.onSelect(); }}>
          <span className="tb-menu-icon" aria-hidden="true">{item.icon}</span>
          <span className="tb-menu-label">{item.label}{item.hint && <small>{item.hint}</small>}</span>
          {item.checked && <span className="tb-menu-check" aria-hidden="true">✓</span>}
        </button>)}
    </div>}
  </div>;
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
    footer={<><button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="editor-submit" onClick={() => submit()} disabled={busy}>{busy ? <><span className="spinner"/> Saving…</> : confirmLabel}</button></>}>
    <form onSubmit={submit} className="tb-form" noValidate>
      <label className="tb-field"><span>{label}</span>
        <input autoFocus value={value} maxLength={maxLength} onChange={(event) => setValue(event.target.value)} aria-invalid={touched && Boolean(problem)} aria-describedby={`${id}-error`}/>
      </label>
      {(touched && problem) || error ? <p className="tb-form-error" id={`${id}-error`} role="alert">{(touched && problem) || error}</p> : null}
    </form>
  </TableDialog>;
}
