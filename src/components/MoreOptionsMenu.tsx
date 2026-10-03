import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, MoreHorizontal, type LucideIcon } from "lucide-react";
import type { VaultFolder } from "../types";

export interface MoreMenuAction {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  label: string;
  actions: MoreMenuAction[];
  folders?: VaultFolder[];
  folderId?: string;
  onMoveFolder?: (folderId: string | null) => void;
}

export default function MoreOptionsMenu({ label, actions, folders, folderId, onMoveFolder }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const menu = menuRef.current;
    const menuRect = menu?.getBoundingClientRect();
    const width = menuRect?.width || 208;
    const height = menuRect?.height || 220;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.right - width, viewportWidth - width - 8));
    const fitsBelow = anchor.bottom + height + 6 <= viewportHeight;
    const proposedTop = fitsBelow ? anchor.bottom + 5 : anchor.top - height - 5;
    const top = Math.max(8, Math.min(proposedTop, viewportHeight - Math.min(height, viewportHeight - 16) - 8));
    setPosition({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const updateOnViewportChange = () => updatePosition();
    window.addEventListener("resize", updateOnViewportChange);
    // Capture scroll events from the workspace's nested scroll containers too.
    window.addEventListener("scroll", updateOnViewportChange, true);
    const observer = typeof ResizeObserver !== "undefined" && menuRef.current
      ? new ResizeObserver(updateOnViewportChange)
      : null;
    if (observer && menuRef.current) observer.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", updateOnViewportChange);
      window.removeEventListener("scroll", updateOnViewportChange, true);
      observer?.disconnect();
    };
  }, [open, actions.length, folders?.length, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const menu = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      id={menuId}
      className="card-action-menu card-action-menu-portal"
      role="menu"
      aria-label={label}
      style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: "hidden" }}
      onClick={(event) => event.stopPropagation()}
    >
      {actions.map(({ label: actionLabel, icon: Icon, danger, onSelect }) => <button type="button" role="menuitem" key={actionLabel} className={danger ? "danger-menu-item" : ""} onClick={() => { setOpen(false); onSelect(); }}>{Icon && <Icon size={14}/>}<span>{actionLabel}</span></button>)}
      {folders && onMoveFolder && <label className="menu-folder-move"><span><Folder size={13}/> Move to folder</span><select aria-label="Move to folder" value={folderId || ""} onChange={(event) => { setOpen(false); onMoveFolder(event.target.value || null); }}><option value="">No folder</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
    </div>,
    document.body,
  ) : null;

  return <>
    <div className="card-menu-wrap more-options-wrap" ref={wrapRef}>
      <button ref={triggerRef} type="button" className="tiny-action" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={(event) => { event.stopPropagation(); setPosition(null); setOpen((current) => !current); }}><MoreHorizontal size={17}/></button>
    </div>
    {menu}
  </>;
}
