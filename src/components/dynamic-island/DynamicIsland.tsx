import { motion, useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import "./dynamic-island.css";

type IslandSize = { width: number; height: number };

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };
// Measured sizes replace this on the first layout pass; it only avoids a 0×0 flash.
const FALLBACK_SIZE: IslandSize = { width: 118, height: 50 };
// The island can be nudged left or right along the top strip — never down.
const DRAG_KEY = "persora.island.offset";
const DRAG_THRESHOLD = 4;

/**
 * Persora Dynamic Island — the workspace's floating, morphing control surface.
 *
 * Collapsed it is a single compact pill; on interaction it springs open into a
 * floating control panel. The shell owns only geometry and dismissal; every
 * control inside is a real workspace control passed in by the host.
 */
export default function DynamicIsland({
  triggerLabel,
  face,
  open,
  onOpenChange,
  children,
  layer,
}: {
  /** Accessible name of the collapsed pill. */
  triggerLabel: string;
  /** Collapsed face content (mark + status dot). */
  face: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Expanded panel controls. */
  children: ReactNode;
  /** Popovers (menus, notification centre) rendered beneath the pill, outside the morphing shell. */
  layer?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLButtonElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef(false);
  const [panelSize, setPanelSize] = useState<IslandSize>(FALLBACK_SIZE);
  const [faceSize, setFaceSize] = useState<IslandSize>(FALLBACK_SIZE);
  const [settled, setSettled] = useState(!open);
  const [dragging, setDragging] = useState(false);
  // Keeps a popover fully inside the workspace column, wherever the island is.
  const [layerShift, setLayerShift] = useState(0);
  const reduceMotion = useReducedMotion();
  const offsetX = useMotionValue(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; moved: boolean } | null>(null);
  // Set when a drag ended, so the pill's own click does not open the island too.
  const draggedRef = useRef(false);
  const panelId = useId();

  // Both faces stay laid out, so the shell can morph between real sizes.
  useLayoutEffect(() => {
    const measure = () => {
      const panel = panelRef.current;
      const faceButton = faceRef.current;
      if (panel) setPanelSize({ width: panel.offsetWidth, height: panel.offsetHeight });
      if (faceButton) setFaceSize({ width: faceButton.offsetWidth, height: faceButton.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (panelRef.current) observer.observe(panelRef.current);
    if (faceRef.current) observer.observe(faceRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Keep the pill inside its own column — never under the sidebar and never off
  // the right edge. The column is whatever the island is mounted in.
  const clampOffset = useCallback((value: number) => {
    const host = rootRef.current?.parentElement;
    if (!host) return value;
    const rect = host.getBoundingClientRect();
    const halfWidth = shellRef.current
      ? shellRef.current.getBoundingClientRect().width / 2
      : (open ? panelSize.width : faceSize.width) / 2;
    // The island is centred in its column, so it may shift either way by the gap
    // between the pill's edge and the column's edges.
    const limit = Math.max(0, rect.width / 2 - halfWidth - 12);
    return Math.min(limit, Math.max(-limit, value));
  }, [open, panelSize.width, faceSize.width]);

  // Restore the saved position for this device.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(DRAG_KEY));
      if (Number.isFinite(saved) && saved !== 0) offsetX.set(clampOffset(saved));
    } catch {
      /* storage unavailable — the island simply starts centred */
    }
  }, [offsetX, clampOffset]);

  // Opening widens the island, so the whole pill plus panel is kept in view.
  useLayoutEffect(() => {
    offsetX.set(clampOffset(offsetX.get()));
  }, [offsetX, clampOffset, open, panelSize.width, faceSize.width, settled]);

  // Re-clamp on resize and whenever the shell changes size.
  useEffect(() => {
    offsetX.set(clampOffset(offsetX.get()));
    const onResize = () => offsetX.set(clampOffset(offsetX.get()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [offsetX, clampOffset]);

  // A popover follows the island but never slides under the sidebar or off the
  // right edge: it is nudged back inside the column when it would overflow.
  const placeLayer = useCallback(() => {
    const host = rootRef.current?.parentElement;
    const popover = layerRef.current?.firstElementChild as HTMLElement | null;
    if (!host || !popover) return;
    const hostRect = host.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    if (!box.width) return;
    const edge = 12;
    let delta = 0;
    if (box.left < hostRect.left + edge) delta = hostRect.left + edge - box.left;
    else if (box.right > hostRect.right - edge) delta = hostRect.right - edge - box.right;
    if (Math.abs(delta) < 1) return;
    setLayerShift((shift) => shift + Math.round(delta));
  }, []);

  // Popovers change size (notification centre vs. account menu) — re-measure,
  // and settle again after a nudge so the shift converges in one or two passes.
  useLayoutEffect(() => {
    placeLayer();
    const popover = layerRef.current?.firstElementChild;
    if (!popover) return;
    const observer = new ResizeObserver(placeLayer);
    observer.observe(popover);
    return () => observer.disconnect();
  }, [placeLayer, open, layer]);

  useLayoutEffect(() => {
    placeLayer();
  }, [placeLayer, layerShift]);

  useEffect(() => {
    const unsubscribe = offsetX.on("change", placeLayer);
    window.addEventListener("resize", placeLayer);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", placeLayer);
    };
  }, [offsetX, placeLayer]);

  const close = useCallback((refocus = false) => {
    restoreFocusRef.current = refocus;
    onOpenChange(false);
  }, [onOpenChange]);

  // Outside click collapses the island (capture phase so nothing swallows it).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !rootRef.current) return;
      // A popover opened from a control never collapses the island, and neither
      // does anything inside the shell: the island stays open until the user
      // picks something or dismisses it explicitly.
      if (rootRef.current.contains(target)) return;
      // The app launcher's drawer is portaled to <body>; interacting with it
      // must not collapse the island behind it.
      if (target instanceof Element && target.closest(".app-launcher-panel")) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  // Escape collapses the island, but an open popover inside it closes first.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const popovers = rootRef.current?.querySelectorAll('[role="dialog"]');
      if (popovers && popovers.length > 0) return;
      close(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Keep the trigger reachable after a keyboard dismissal.
  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    faceRef.current?.focus();
  }, [open]);

  // Arrow keys move between the island's controls.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const controls = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        "[data-island-control]:not([disabled]), .island-panel .app-launcher-button:not([disabled]), .island-panel .ds-theme-toggle:not([disabled])",
      ) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (controls.length < 2) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    controls[(index + step + controls.length) % controls.length].focus();
  };

  // The shell morphs between the two faces.
  const size = open ? panelSize : faceSize;
  // Popovers hang beneath whatever the island currently is: aligned to the
  // collapsed pill's edge, and to the open panel's edge while expanded.
  const anchorSize = size;
  const morph = reduceMotion
    ? { duration: 0 }
    : SPRING;

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Mouse/pen only: a touch drag must stay a tap on phones.
    if (event.pointerType === "touch" || event.button !== 0) return;
    // Anything inside the island's own popover keeps its behaviour.
    if (event.target instanceof Element && event.target.closest(".island-layer")) return;
    // The pill itself is grabbable; every other control keeps its own clicks.
    if (event.target instanceof Element && !event.target.closest(".island-face") && event.target.closest("button, input, a, [role='dialog']")) return;
    draggedRef.current = false;
    // Capture is taken only once the drag really starts: capturing on
    // pointer-down would retarget the click and the pill would stop opening.
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: offsetX.get(), moved: false };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    offsetX.set(clampOffset(drag.startOffset + delta));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const captured = drag.moved;
    dragRef.current = null;
    setDragging(false);
    if (captured) event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!drag.moved) return;
    // A drag must not also register as a click on the pill.
    draggedRef.current = true;
    try { window.localStorage.setItem(DRAG_KEY, String(Math.round(offsetX.get()))); } catch { /* ignore */ }
  };

  return (
    <>
      <div
        className={`dynamic-island-anchor ${dragging ? "is-dragging" : ""}`.trim()}
        ref={rootRef}
        onKeyDown={onKeyDown}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <motion.div
          ref={shellRef}
          className={`island-shell ${open ? "is-open" : ""} ${settled ? "is-settled" : ""}`.trim()}
          initial={false}
          animate={{ width: size.width, height: size.height }}
          transition={morph}
          onAnimationComplete={() => setSettled(true)}
          /* The anchor has no width, so the shell is centred with its own
             measured width — Motion keeps the transform for the drag. */
          style={{ x: offsetX, marginLeft: -Math.round(size.width / 2) }}
        >
        <button
          ref={faceRef}
          type="button"
          className="island-face"
          onClick={() => {
            if (draggedRef.current) { draggedRef.current = false; return; }
            onOpenChange(true);
          }}
          aria-label={triggerLabel}
          aria-expanded={open}
          aria-controls={panelId}
          aria-hidden={open}
          tabIndex={open ? -1 : 0}
        >
          {face}
        </button>
        {/* The panel follows the trigger so Tab order runs trigger → controls. */}
        <div className="island-panel" ref={panelRef} id={panelId} aria-hidden={!open} data-open={open ? "true" : "false"}>
          {children}
        </div>
      </motion.div>
        <motion.div className="island-layer" style={{ x: offsetX }}>
          {/* Anchored to the pill's own box, so menus open beneath it even after a drag. */}
          <div
            className="island-layer-anchor"
            ref={layerRef}
            style={{ width: anchorSize.width, height: anchorSize.height, marginLeft: layerShift }}
          >
            {layer}
          </div>
        </motion.div>
      </div>
    </>
  );
}

/** One island control: an icon button sized and spaced for the island row. */
export function IslandControl({
  label,
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={`island-control ${className}`.trim()}
      data-island-control=""
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}
