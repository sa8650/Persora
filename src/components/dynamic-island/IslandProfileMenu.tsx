import { LogOut, Settings } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { AppUser } from "../../types";
import "./dynamic-island.css";

/**
 * Island profile menu — identity, account settings, and the single sign-out
 * action. It renders in the island's popover layer (outside the morphing pill)
 * so opening it never resizes the island.
 */
export default function IslandProfileMenu({
  user,
  avatar,
  onClose,
  onOpenSettings,
  onSignOut,
}: {
  user: AppUser;
  /** The workspace's existing avatar rendering, reused as-is. */
  avatar: ReactNode;
  onClose: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current && !menuRef.current.contains(target)) {
        // The avatar button toggles the menu itself; let its own click win.
        const trigger = (target as HTMLElement).closest?.(".island-avatar");
        if (!trigger) onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div className="island-menu" role="dialog" aria-label="Account menu" ref={menuRef}>
      <div className="island-menu-identity">
        <span className="avatar avatar-small island-menu-avatar" aria-hidden="true">{avatar}</span>
        <span className="island-menu-identity-copy">
          <b>{user.fullName}</b>
          <small>{user.email}</small>
        </span>
      </div>
      <button
        type="button"
        className="island-menu-item"
        onClick={() => { onClose(); onOpenSettings(); }}
      >
        <Settings size={15} aria-hidden="true" />
        <span>Account settings</span>
      </button>
      <button type="button" className="island-menu-item is-danger" onClick={() => { onClose(); onSignOut(); }}>
        <LogOut size={15} aria-hidden="true" />
        <span>Sign out</span>
      </button>
    </div>
  );
}
