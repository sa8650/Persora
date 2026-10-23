// Persora Calendar — pointer drag helper for moving and resizing items.
//
// Mouse/pen: the drag starts once the pointer moves a few pixels, so a plain
// click still opens the item. Touch: the drag starts after a long press
// (350 ms without moving), so swiping still scrolls the calendar; once a drag
// is active, touchmove is cancelled so the page doesn't scroll underneath.
// Escape cancels. After a drag the click that follows is swallowed.
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { addDays, daysBetween } from "../../../cloudflare/calendar-rules.js";
import type { MoveTarget } from "../../../cloudflare/calendar-rules.js";
import { dayDragTarget, occurrenceDays } from "../../lib/calendar-view";
import type { Occurrence } from "../../lib/calendar-view";

export interface DragHandlers {
  onStart: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
  onCancel: () => void;
}

export const LONG_PRESS_MS = 350;
const MOUSE_THRESHOLD = 4;
const TOUCH_SLOP = 8;

/**
 * Swallows the click the browser fires right after a drag ends (so dropping an
 * item doesn't also open it). A new press means the user is clicking something
 * on purpose (e.g. a button in the dialog the drop opened), so it cancels this.
 */
function swallowNextClick() {
  const stop = (event: Event) => { event.stopPropagation(); event.preventDefault(); release(); };
  const release = () => {
    window.clearTimeout(timer);
    window.removeEventListener("click", stop, { capture: true });
    window.removeEventListener("pointerdown", release, { capture: true });
  };
  window.addEventListener("click", stop, { capture: true });
  window.addEventListener("pointerdown", release, { capture: true });
  const timer = window.setTimeout(release, 400);
}

/** Call from onPointerDown. Returns false when the press can't start a drag. */
export function beginPointerDrag(event: ReactPointerEvent<HTMLElement>, handlers: DragHandlers): boolean {
  const touch = event.pointerType === "touch";
  if (!touch && event.button !== 0) return false;
  const pointerId = event.pointerId;
  const startX = event.clientX; const startY = event.clientY;
  let lastX = startX; let lastY = startY;
  let active = false; let finished = false;
  let timer = 0;

  const activate = () => {
    if (active || finished) return;
    active = true;
    document.body.classList.add("cal-dragging");
    if (touch && typeof navigator.vibrate === "function") { try { navigator.vibrate(8); } catch { /* optional */ } }
    handlers.onStart(lastX, lastY);
    handlers.onMove(lastX, lastY);
  };

  const cleanup = () => {
    window.clearTimeout(timer);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchCancel);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("contextmenu", onContextMenu, true);
    document.body.classList.remove("cal-dragging");
  };
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (!active) return;
    swallowNextClick();
    if (commit) handlers.onEnd(lastX, lastY); else handlers.onCancel();
  };

  function onPointerMove(next: PointerEvent) {
    if (next.pointerId !== pointerId || touch) return;
    lastX = next.clientX; lastY = next.clientY;
    if (!active) {
      if (Math.hypot(lastX - startX, lastY - startY) < MOUSE_THRESHOLD) return;
      activate();
      return;
    }
    handlers.onMove(lastX, lastY);
  }
  function onPointerUp(next: PointerEvent) { if (next.pointerId === pointerId && !touch) finish(true); }
  function onPointerCancel(next: PointerEvent) { if (next.pointerId === pointerId && (!touch || !active)) finish(false); }
  function onTouchMove(next: TouchEvent) {
    const point = next.touches[0];
    if (!point) return;
    lastX = point.clientX; lastY = point.clientY;
    if (!active) {
      if (Math.hypot(lastX - startX, lastY - startY) > TOUCH_SLOP) finish(false); // a swipe: let it scroll
      return;
    }
    if (next.cancelable) next.preventDefault();
    handlers.onMove(lastX, lastY);
  }
  function onTouchEnd() { finish(true); }
  function onTouchCancel() { finish(false); }
  function onKey(next: KeyboardEvent) { if (next.key === "Escape") { next.stopPropagation(); next.preventDefault(); finish(false); } }
  function onContextMenu(next: Event) { if (touch) next.preventDefault(); }

  window.addEventListener("keydown", onKey, true);
  if (touch) {
    timer = window.setTimeout(activate, LONG_PRESS_MS);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("contextmenu", onContextMenu, true);
  } else {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }
  return true;
}

/** Element under a point carrying data-drop-date (month cells, all-day slots). */
export function dropDateAt(x: number, y: number): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const date = (element as HTMLElement).dataset?.dropDate;
    if (date) return date;
  }
  return null;
}

export type MoveHandler = (occurrence: Occurrence, target: MoveTarget) => void;

/**
 * Drag by whole days (Month view and the week's all-day row). Drop targets
 * are elements with data-drop-date. Timed items keep their time of day.
 */
export function useDayDrag(zone: string, onMove?: MoveHandler, savingIds?: Set<string>) {
  const [dayDrag, setDayDrag] = useState<{ id: string; dates: Set<string> } | null>(null);
  const startDayDrag = (event: ReactPointerEvent<HTMLElement>, occurrence: Occurrence) => {
    if (!onMove || savingIds?.has(occurrence.id)) return;
    const grab = dropDateAt(event.clientX, event.clientY);
    if (!grab) return;
    const span = occurrenceDays(occurrence, zone);
    let delta = 0;
    const show = (days: number) => {
      const dates = new Set<string>();
      for (let date = addDays(span.first, days), count = 0; date <= addDays(span.last, days) && count < 62; date = addDays(date, 1), count += 1) dates.add(date);
      setDayDrag({ id: occurrence.id, dates });
    };
    beginPointerDrag(event, {
      onStart: () => show(0),
      onMove: (x, y) => {
        const date = dropDateAt(x, y);
        if (!date) return;
        const next = daysBetween(grab, date);
        if (next !== delta) { delta = next; show(delta); }
      },
      onEnd: () => { setDayDrag(null); if (delta) onMove(occurrence, dayDragTarget(occurrence, delta, zone)); },
      onCancel: () => setDayDrag(null),
    });
  };
  return { dayDrag, startDayDrag };
}
