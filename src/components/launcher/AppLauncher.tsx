// Persora app launcher: a 3 × 3 dot-grid button in the workspace top bar that
// opens a floating drawer of every workspace module — favorites first, the rest
// in their own scrollable area. Modules open through the workspace's existing
// navigation (the same `updateView` the sidebar uses), in the same tab.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Minus, Pencil, Plus } from "lucide-react";
import type { AppUser, ViewId } from "../../types";
import ModalPortal from "../ModalPortal";
import { LAUNCHER_FAVORITES_MAX, LAUNCHER_MODULE_BY_ID, moveFavorite, type LauncherModuleId } from "../../lib/app-launcher";
import { LauncherGridGlyph, LauncherModuleIcon } from "./LauncherIcons";
import { useLauncherFavorites, type LauncherSyncState } from "./useLauncherFavorites";
import "./app-launcher.css";

interface AppLauncherProps {
  user: AppUser;
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  /** Called when the drawer opens (e.g. to close other top-bar popovers). */
  onOpen?: () => void;
}

type Phase = "closed" | "open" | "closing";
interface Drag { id: LauncherModuleId; pointerId: number; x: number; y: number; moved: boolean }

const CLOSE_MS = 130;
const COLUMNS = 3;

const syncLabel = (sync: LauncherSyncState, accountSync: boolean) => {
  if (!accountSync) return "Saved on this device";
  if (sync === "saving" || sync === "loading") return "Saving…";
  if (sync === "error") return "Saved on this device · will sync when your account is reachable";
  return "Synced to your account";
};

export default function AppLauncher({ user, activeView, onNavigate, onOpen }: AppLauncherProps) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LauncherModuleId[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const panelId = useId();
  const titleId = useId();
  const { favorites: savedFavorites, others: savedOthers, customized, update, refresh, sync, accountSync } = useLauncherFavorites(user);

  // While dragging, the drawer shows the live order; it's saved on drop.
  const favorites = draft ?? savedFavorites;
  const others = savedOthers;
  const isOpen = phase !== "closed";
  const full = favorites.length >= LAUNCHER_FAVORITES_MAX;

  const measure = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const edge = button.closest(".topbar-actions")?.getBoundingClientRect().right ?? rect.right;
    setAnchor({ top: Math.round(rect.bottom + 10), right: Math.max(8, Math.round(window.innerWidth - edge)) });
  }, []);

  const close = useCallback((returnFocus = false) => {
    setPhase((current) => (current === "open" ? "closing" : current));
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { setPhase("closed"); setEditing(false); setDraft(null); drag.current = null; }, CLOSE_MS);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  const openDrawer = () => {
    window.clearTimeout(closeTimer.current);
    measure();
    refresh();
    onOpen?.();
    setPhase("open");
  };
  const toggle = () => (phase === "open" ? close() : openDrawer());

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Anchor under the button, and follow viewport changes while open.
  useLayoutEffect(() => {
    if (!isOpen) return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isOpen, measure]);

  // Focus the first module when the drawer opens.
  useEffect(() => {
    if (phase !== "open") return;
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("[data-launcher-tile]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  // Outside click and Escape dismiss; clicks inside the drawer never do.
  useEffect(() => {
    if (phase !== "open") return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("pointerdown", onPointerDown, true); document.removeEventListener("keydown", onKeyDown, true); };
  }, [phase, close]);

  const openModule = (id: LauncherModuleId) => {
    onNavigate(id);
    close(true);
  };

  const label = (id: LauncherModuleId) => LAUNCHER_MODULE_BY_ID[id].label;
  const addFavorite = (id: LauncherModuleId) => {
    if (full) { setAnnouncement(`Favorites can hold up to ${LAUNCHER_FAVORITES_MAX} modules.`); return; }
    update([...favorites, id]);
    setAnnouncement(`${label(id)} added to favorites.`);
  };
  const removeFavorite = (id: LauncherModuleId) => {
    const index = favorites.indexOf(id);
    update(favorites.filter((entry) => entry !== id));
    setAnnouncement(`${label(id)} removed from favorites.`);
    // Keep keyboard focus inside the favorites (or on the editor) after removal.
    requestAnimationFrame(() => {
      const tiles = panelRef.current?.querySelectorAll<HTMLElement>("[data-favorite-tile]");
      const next = tiles?.[Math.min(index, (tiles?.length || 1) - 1)];
      (next || panelRef.current?.querySelector<HTMLElement>(".app-launcher-edit"))?.focus({ preventScroll: true });
    });
  };
  const moveTo = (id: LauncherModuleId, to: number) => {
    const from = favorites.indexOf(id);
    const target = Math.max(0, Math.min(favorites.length - 1, to));
    if (from < 0 || from === target) return;
    update(moveFavorite(favorites, from, target));
    setAnnouncement(`${label(id)} moved to position ${target + 1} of ${favorites.length}.`);
  };

  // Arrow keys move between modules (or, while editing, reorder the favorite).
  const onTileKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: LauncherModuleId, favorite: boolean) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
    if (delta === undefined) {
      if (event.key === "Tab") onTabBoundary(event);
      return;
    }
    event.preventDefault();
    if (editing && favorite) { moveTo(id, favorites.indexOf(id) + delta); return; }
    const grids = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-launcher-grid]") || []);
    const grid = event.currentTarget.closest<HTMLElement>("[data-launcher-grid]");
    if (!grid) return;
    const tiles = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>("[data-launcher-tile]"));
    const own = tiles(grid);
    const index = own.indexOf(event.currentTarget);
    const nextIndex = index + delta;
    if (nextIndex >= 0 && nextIndex < own.length) { own[nextIndex].focus(); return; }
    if (Math.abs(delta) !== COLUMNS) return;
    const neighbour = grids[grids.indexOf(grid) + (delta > 0 ? 1 : -1)];
    if (!neighbour) return;
    const list = tiles(neighbour);
    if (!list.length) return;
    const column = index % COLUMNS;
    if (delta > 0) list[Math.min(column, list.length - 1)].focus();
    else {
      const lastRow = Math.floor((list.length - 1) / COLUMNS) * COLUMNS;
      list[Math.min(lastRow + column, list.length - 1)].focus();
    }
  };

  // The drawer is portaled; keep Tab order continuous with the top bar.
  const onTabBoundary = (event: KeyboardEvent<HTMLElement>) => {
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") || []);
    if (!focusable.length) return;
    if (event.shiftKey && event.target === focusable[0]) { event.preventDefault(); buttonRef.current?.focus(); }
    else if (!event.shiftKey && event.target === focusable[focusable.length - 1]) {
      event.preventDefault();
      const next = buttonRef.current?.nextElementSibling as HTMLElement | null;
      close();
      next?.focus();
    }
  };

  // Pointer reordering (mouse, pen and touch) while editing favorites.
  const onFavoritePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: LauncherModuleId) => {
    if (!editing || event.button !== 0) return;
    drag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onFavoritePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
    current.moved = true;
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-favorite-id]");
    const overId = over?.dataset.favoriteId as LauncherModuleId | undefined;
    const order = draft ?? savedFavorites;
    if (!overId || overId === current.id || !order.includes(overId)) { if (!draft) setDraft(order); return; }
    setDraft(moveFavorite(order, order.indexOf(current.id), order.indexOf(overId)));
  };
  const onFavoritePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (draft) {
      const changed = draft.some((id, index) => id !== savedFavorites[index]);
      if (changed) {
        update(draft);
        setAnnouncement(`${label(current.id)} moved to position ${draft.indexOf(current.id) + 1} of ${draft.length}.`);
      }
      setDraft(null);
    }
  };

  const tile = (id: LauncherModuleId, favorite: boolean) => {
    const module = LAUNCHER_MODULE_BY_ID[id];
    const active = activeView === id;
    const dragging = draft !== null && drag.current?.id === id;
    if (editing && favorite) {
      return (
        <li key={id} className={`app-launcher-cell ${dragging ? "is-dragging" : ""}`} data-favorite-id={id}>
          <button
            type="button" className="app-launcher-tile is-editing" data-launcher-tile="" data-favorite-tile=""
            aria-label={`${module.label}, favorite ${favorites.indexOf(id) + 1} of ${favorites.length}`}
            aria-describedby={`${panelId}-reorder-hint`}
            onPointerDown={(event) => onFavoritePointerDown(event, id)} onPointerMove={onFavoritePointerMove}
            onPointerUp={onFavoritePointerUp} onPointerCancel={() => { drag.current = null; setDraft(null); }}
            onKeyDown={(event) => onTileKeyDown(event, id, true)}
          >
            <span className="app-launcher-icon"><LauncherModuleIcon id={id} /></span>
            <span className="app-launcher-label">{module.label}</span>
          </button>
          <button type="button" className="app-launcher-badge is-remove" onClick={() => removeFavorite(id)} aria-label={`Remove ${module.label} from favorites`} title={`Remove ${module.label} from favorites`} onKeyDown={onTabBoundary}><Minus size={12} strokeWidth={2.6} /></button>
        </li>
      );
    }
    if (editing) {
      return (
        <li key={id} className="app-launcher-cell">
          <button
            type="button" className="app-launcher-tile is-addable" data-launcher-tile="" aria-disabled={full || undefined}
            aria-label={full ? `${module.label} — favorites are full` : `Add ${module.label} to favorites`}
            title={full ? `Favorites can hold up to ${LAUNCHER_FAVORITES_MAX} modules` : `Add ${module.label} to favorites`}
            onClick={() => addFavorite(id)} onKeyDown={(event) => onTileKeyDown(event, id, false)}
          >
            <span className="app-launcher-icon"><LauncherModuleIcon id={id} /></span>
            <span className="app-launcher-label">{module.label}</span>
            <span className="app-launcher-badge is-add" aria-hidden="true"><Plus size={12} strokeWidth={2.6} /></span>
          </button>
        </li>
      );
    }
    return (
      <li key={id} className="app-launcher-cell">
        <button
          type="button" className={`app-launcher-tile ${active ? "is-active" : ""}`} data-launcher-tile=""
          aria-current={active ? "page" : undefined} title={`${module.label} — ${module.hint}`}
          onClick={() => openModule(id)} onKeyDown={(event) => onTileKeyDown(event, id, favorite)}
        >
          <span className="app-launcher-icon"><LauncherModuleIcon id={id} /></span>
          <span className="app-launcher-label">{module.label}</span>
        </button>
      </li>
    );
  };

  return (
    <>
      <button
        ref={buttonRef} type="button" className={`app-launcher-button ${phase === "open" ? "is-open" : ""}`}
        onClick={toggle} onPointerEnter={refresh} onFocus={refresh}
        aria-label="Persora apps" title="Persora apps" aria-haspopup="dialog" aria-expanded={phase === "open"} aria-controls={isOpen ? panelId : undefined}
      >
        <LauncherGridGlyph />
      </button>
      {isOpen && anchor && (
        <ModalPortal>
          <div
            ref={panelRef} id={panelId} role="dialog" aria-modal="false" aria-labelledby={titleId}
            className={`app-launcher-panel ${phase === "closing" ? "is-closing" : ""} ${editing ? "is-editing" : ""}`}
            style={{ "--launcher-top": `${anchor.top}px`, "--launcher-right": `${anchor.right}px` } as CSSProperties}
          >
            <div className="app-launcher-head">
              <h2 id={titleId}>{editing ? "Edit favorites" : "Your favorites"}</h2>
              {editing
                ? <button type="button" className="app-launcher-done" onClick={() => { setEditing(false); requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(".app-launcher-edit")?.focus()); }} onKeyDown={onTabBoundary}><Check size={14} strokeWidth={2.4} />Done</button>
                : <button type="button" className="app-launcher-edit" onClick={() => { setEditing(true); requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>(".app-launcher-done")?.focus()); }} aria-label="Edit favorites" title="Edit favorites" onKeyDown={onTabBoundary}><Pencil size={14} /></button>}
            </div>
            <div className="app-launcher-body">
              <section className="app-launcher-favorites" aria-label="Favorites">
                {favorites.length
                  ? <ul className="app-launcher-grid" data-launcher-grid="">{favorites.map((id) => tile(id, true))}</ul>
                  : <p className="app-launcher-empty">{editing ? "Add modules from the list below." : "No favorites yet. Use the pencil to pin the modules you use most."}</p>}
                {editing && <p className="app-launcher-hint" id={`${panelId}-reorder-hint`}>Drag to reorder, or use the arrow keys. {favorites.length}/{LAUNCHER_FAVORITES_MAX}</p>}
              </section>
              {others.length > 0 && (
                <section className="app-launcher-more" aria-labelledby={`${panelId}-more`}>
                  <h3 id={`${panelId}-more`}>{editing ? "Add to favorites" : "More from Persora"}</h3>
                  <ul className="app-launcher-grid app-launcher-more-grid" data-launcher-grid="">{others.map((id) => tile(id, false))}</ul>
                </section>
              )}
            </div>
            {editing && (
              <div className="app-launcher-foot">
                <span className={`app-launcher-sync is-${accountSync ? sync : "local"}`} role="status">{syncLabel(sync, accountSync)}</span>
                {customized && <button type="button" className="app-launcher-reset" onClick={() => { update(null); setAnnouncement("Favorites restored to the defaults."); }} onKeyDown={onTabBoundary}>Restore defaults</button>}
              </div>
            )}
            <span className="app-launcher-live" aria-live="polite">{announcement}</span>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
