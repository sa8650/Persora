// Persora Calendar — pointer drag helper for moving and resizing items.
//
// Mouse/pen: the drag starts once the pointer moves a few pixels, so a plain
// click still opens the item. Touch: the drag starts after a hold without
// moving (350 ms for whole-item move so swiping still scrolls the calendar,
// 180 ms on resize handles), and once active, touchmove is cancelled so the
// page doesn't scroll underneath. Escape cancels. After a drag the click that
// follows is swallowed.
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { daysBetween } from "../../../cloudflare/calendar-rules.js";
import type { MoveTarget } from "../../../cloudflare/calendar-rules.js";
import {
  dayDragTarget, horizontalResizeTarget, sameTarget, targetDates,
} from "../../lib/calendar-view";
import type { HorizontalResizeEdge, Occurrence } from "../../lib/calendar-view";

export interface DragHandlers {
  onStart: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  onEnd: (x: number, y: number) => void;
  onCancel: () => void;
}

export type DragCursorClass = "cal-dragging" | "cal-resizing-ns" | "cal-resizing-ew";

export interface PointerDragOptions {
  cursorClass?: DragCursorClass;
  longPressMs?: number;
}

export const LONG_PRESS_MS = 350;
export const RESIZE_HOLD_MS = 180;
export const SETTLE_MS = 210;
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
export function beginPointerDrag(
  event: ReactPointerEvent<HTMLElement>,
  handlers: DragHandlers,
  options: PointerDragOptions = {},
): boolean {
  const touch = event.pointerType === "touch";
  if (!touch && event.button !== 0) return false;
  const cursorClass = options.cursorClass || "cal-dragging";
  const holdMs = options.longPressMs ?? LONG_PRESS_MS;
  const pointerId = event.pointerId;
  const startX = event.clientX; const startY = event.clientY;
  let lastX = startX; let lastY = startY;
  let active = false; let finished = false;
  let timer = 0;

  const activate = () => {
    if (active || finished) return;
    active = true;
    document.body.classList.add(cursorClass);
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
    document.body.classList.remove("cal-dragging", "cal-resizing-ns", "cal-resizing-ew");
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
      if (Math.hypot(lastX - startX, lastY - startY) > TOUCH_SLOP) finish(false);
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
    timer = window.setTimeout(activate, holdMs);
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
export type InvalidMoveHandler = (message: string, occurrenceId: string) => void;

export interface DayDragState {
  id: string;
  mode: "move" | "resize-start" | "resize-end";
  target: MoveTarget;
  dates: Set<string>;
  changed: boolean;
  invalid: string | null;
}

/**
 * Drag or horizontally resize by whole days (Month view and the week's all-day
 * row). Drop targets are elements with `data-drop-date`. Timed items keep their
 * exact wall-clock time at each boundary.
 */
export function useDayDrag(
  zone: string,
  onMove?: MoveHandler,
  savingIds?: Set<string>,
  onInvalidMove?: InvalidMoveHandler,
) {
  const [dayDrag, setDayDrag] = useState<DayDragState | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const settleTimer = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const markSettled = (id: string) => {
    window.clearTimeout(settleTimer.current);
    setSettlingId(id);
    settleTimer.current = window.setTimeout(() => setSettlingId((current) => (current === id ? null : current)), SETTLE_MS);
  };

  const startDayDrag = (event: ReactPointerEvent<HTMLElement>, occurrence: Occurrence) => {
    if (!onMove || savingIds?.has(occurrence.id)) return;
    const grab = dropDateAt(event.clientX, event.clientY);
    if (!grab) return;
    let delta = 0;
    let currentTarget = dayDragTarget(occurrence, 0, zone);
    const show = (days: number) => {
      currentTarget = dayDragTarget(occurrence, days, zone);
      setDayDrag({
        id: occurrence.id,
        mode: "move",
        target: currentTarget,
        dates: targetDates(currentTarget, zone),
        changed: days !== 0,
        invalid: null,
      });
    };
    beginPointerDrag(event, {
      onStart: () => show(0),
      onMove: (x, y) => {
        const date = dropDateAt(x, y);
        if (!date) return;
        const next = daysBetween(grab, date);
        if (next !== delta) { delta = next; show(delta); }
      },
      onEnd: () => {
        setDayDrag(null);
        if (delta) {
          markSettled(occurrence.id);
          onMove(occurrence, currentTarget);
        }
      },
      onCancel: () => setDayDrag(null),
    });
  };

  const startDayResize = (
    event: ReactPointerEvent<HTMLElement>,
    occurrence: Occurrence,
    edge: HorizontalResizeEdge,
  ) => {
    if (!onMove || savingIds?.has(occurrence.id)) return;
    event.stopPropagation();
    const initialTarget = dayDragTarget(occurrence, 0, zone);
    let current: DayDragState = {
      id: occurrence.id,
      mode: edge === "start" ? "resize-start" : "resize-end",
      target: initialTarget,
      dates: targetDates(initialTarget, zone),
      changed: false,
      invalid: null,
    };
    beginPointerDrag(event, {
      onStart: () => setDayDrag(current),
      onMove: (x, y) => {
        const date = dropDateAt(x, y);
        if (!date) return;
        const outcome = horizontalResizeTarget(occurrence, edge, date, zone);
        if (outcome.target) {
          current = {
            id: occurrence.id,
            mode: edge === "start" ? "resize-start" : "resize-end",
            target: outcome.target,
            dates: targetDates(outcome.target, zone),
            changed: !sameTarget(occurrence, outcome.target),
            invalid: null,
          };
        } else {
          current = {
            id: occurrence.id,
            mode: edge === "start" ? "resize-start" : "resize-end",
            target: initialTarget,
            dates: new Set([date]),
            changed: false,
            invalid: outcome.invalid,
          };
        }
        setDayDrag(current);
      },
      onEnd: () => {
        setDayDrag(null);
        if (current.invalid) {
          onInvalidMove?.(current.invalid, occurrence.id);
          return;
        }
        if (current.changed) {
          markSettled(occurrence.id);
          onMove(occurrence, current.target);
        }
      },
      onCancel: () => setDayDrag(null),
    }, { cursorClass: "cal-resizing-ew", longPressMs: RESIZE_HOLD_MS });
  };

  return { dayDrag, settlingId, startDayDrag, startDayResize };
}
