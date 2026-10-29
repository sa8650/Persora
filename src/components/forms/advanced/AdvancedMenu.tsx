import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface AdvancedMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * Compact three-dot menu for advanced-form cards.
 *
 * Advanced Forms ship their own menu and dialog rather than borrowing the
 * Persora Table ones, so the Forms workspace never has to load `table.css`.
 * Behaviour matches the table menu: click-away, Escape, arrow-key roving.
 */
export function AdvancedMenu({
  label,
  icon,
  items,
}: {
  label: string;
  icon: ReactNode;
  items: (AdvancedMenuItem | "divider")[];
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"down" | "up">("down");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setPlacement(below < 300 && rect.top > below ? "up" : "down");
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
    next?.focus();
  };

  return (
    <div className="aff-menu-root" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="aff-menu-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {icon}
      </button>
      {open ? (
        <div
          className={`aff-menu-list${placement === "up" ? " is-up" : ""}`}
          id={menuId}
          role="menu"
          aria-label={label}
          ref={listRef}
          onKeyDown={onKeyDown}
        >
          {items.map((item, index) =>
            item === "divider" ? (
              <span key={`divider-${index}`} className="aff-menu-divider" role="separator" />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`aff-menu-item${item.danger ? " is-danger" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Single-field prompt used to rename an advanced form. Mirrors the shared
 * Persora prompt (label, validation, Escape/Enter) without the Table styles.
 */
export function AdvancedPromptDialog({
  title,
  label,
  initial,
  maxLength,
  confirmLabel = "Save",
  validate,
  onCancel,
  onConfirm,
}: {
  title: string;
  label: string;
  initial: string;
  maxLength: number;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const problem = validate ? validate(value) : null;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const submit = () => {
    setTouched(true);
    if (problem) return;
    onConfirm(value);
  };

  return (
    <div className="aff-dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form
        className="aff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => { event.preventDefault(); submit(); }}
      >
        <div className="aff-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="aff-dialog-close" aria-label="Close" onClick={onCancel}>×</button>
        </div>

        <label className="aff-dialog-field">
          <span>{label}</span>
          <input
            ref={inputRef}
            value={value}
            maxLength={maxLength}
            aria-invalid={Boolean(touched && problem) || undefined}
            onChange={(event) => { setValue(event.target.value); setTouched(true); }}
          />
        </label>
        {touched && problem ? <p className="aff-dialog-error" role="alert">{problem}</p> : null}

        <div className="aff-dialog-actions">
          <button type="button" className="aff-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="aff-primary">{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
