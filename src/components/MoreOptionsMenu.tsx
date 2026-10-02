import { useEffect, useRef, useState } from "react";
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
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);
  return <div className="card-menu-wrap more-options-wrap" ref={wrapRef}>
    <button type="button" className="tiny-action" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}><MoreHorizontal size={17}/></button>
    {open && <div className="card-action-menu" role="menu" onClick={(event) => event.stopPropagation()}>
      {actions.map(({ label: actionLabel, icon: Icon, danger, onSelect }) => <button type="button" role="menuitem" key={actionLabel} className={danger ? "danger-menu-item" : ""} onClick={() => { setOpen(false); onSelect(); }}>{Icon && <Icon size={14}/>}<span>{actionLabel}</span></button>)}
      {folders && onMoveFolder && <label className="menu-folder-move"><span><Folder size={13}/> Move to folder</span><select aria-label="Move to folder" value={folderId || ""} onChange={(event) => { setOpen(false); onMoveFolder(event.target.value || null); }}><option value="">No folder</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>}
    </div>}
  </div>;
}
