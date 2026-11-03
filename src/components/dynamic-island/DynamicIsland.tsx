import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import "./dynamic-island.css";

type IslandSize = { width: number; height: number };

const MORPH_SPRING = {
  type: "spring" as const,
  stiffness: 360,
  damping: 32,
  mass: 0.78,
};
// Measured sizes replace this on the first layout pass; it only avoids a 0×0 flash.
const FALLBACK_FACE_SIZE: IslandSize = { width: 52, height: 36 };
const FALLBACK_PANEL_SIZE: IslandSize = { width: 224, height: 38 };
// The island can be nudged left or right along the top strip — never down.
const DRAG_KEY = "persora.island.offset";
const DRAG_THRESHOLD = 8;

/**
 * Persora Dynamic Island — the workspace's floating, morphing control surface.
 *
 * Collapsed it is a single compact pill floating cleanly over the top toolbar;
 * on interaction it springs open symmetrically from its centre into a floating
 * control panel without shifting or blocking surrounding toolbar controls.
 */
export default function DynamicIsland({
  triggerLabel,
  face,
  open,
  onOpenChange,
  hasMedia = false,
  children,
  layer,
}: {
  /** Accessible name of the collapsed pill. */
  triggerLabel: string;
  /** Collapsed face content (mark + status dot / equalizer). */
  face: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** True when the expanded panel includes the compact Now Playing media strip. */
  hasMedia?: boolean;
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
  const [panelSize, setPanelSize] = useState<IslandSize>(FALLBACK_PANEL_SIZE);
  const [faceSize, setFaceSize] = useState<IslandSize>(FALLBACK_FACE_SIZE);
  const [dragging, setDragging] = useState(false);
  // Keeps a popover fully inside the workspace column, wherever the island is.
  const [layerShift, setLayerShift] = useState(0);
  const reduceMotion = useReducedMotion();
  const offsetX = useMotionValue(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; moved: boolean } | null>(null);
  // Set briefly when a drag ended so the pill's synthetic click does not toggle it.
  const draggedRef = useRef(false);
  const panelId = useId();

  // Both faces stay laid out, so the shell can morph between real content sizes.
  useLayoutEffect(() => {
    const measure = () => {
      const panel = panelRef.current;
      const faceButton = faceRef.current;
      if (panel && panel.offsetWidth > 0 && panel.offsetHeight > 0) {
        setPanelSize((prev) =>
          prev.width === panel.offsetWidth && prev.height === panel.offsetHeight
            ? prev
            : { width: panel.offsetWidth, height: panel.offsetHeight },
        );
      }
      if (faceButton && faceButton.offsetWidth > 0 && faceButton.offsetHeight > 0) {
        setFaceSize((prev) =>
          prev.width === faceButton.offsetWidth && prev.height === faceButton.offsetHeight
            ? prev
            : { width: faceButton.offsetWidth, height: faceButton.offsetHeight },
        );
      }
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
  // the right edge — using the target width rather than mid-morph DOM bounds.
  const clampOffset = useCallback(
    (value: number, targetWidth?: number) => {
      const host = rootRef.current?.parentElement;
      if (!host) return value;
      const rect = host.getBoundingClientRect();
      if (!rect.width) return value;
      const width = (targetWidth ?? (open ? panelSize.width : faceSize.width)) + 2;
      const limit = Math.max(0, rect.width / 2 - width / 2 - 12);
      return Math.min(limit, Math.max(-limit, value));
    },
    [open, panelSize.width, faceSize.width],
  );

  // Restore the saved position for this device.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(DRAG_KEY));
      if (Number.isFinite(saved) && saved !== 0) {
        offsetX.set(clampOffset(saved, faceSize.width));
      }
    } catch {
      /* storage unavailable — the island simply starts centred */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening near a column edge smoothly nudges the island inward so the full
  // expanded panel stays in view without an abrupt snap.
  useEffect(() => {
    const current = offsetX.get();
    const clamped = clampOffset(current);
    if (Math.abs(clamped - current) < 0.5) return;
    if (reduceMotion) {
      offsetX.set(clamped);
      return;
    }
    const controls = animate(offsetX, clamped, MORPH_SPRING);
    return () => controls.stop();
  }, [offsetX, clampOffset, open, panelSize.width, faceSize.width, reduceMotion]);

  // Re-clamp immediately when the viewport or workspace column resizes.
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    const onResize = () => offsetX.set(clampOffset(offsetX.get()));
    const observer = host ? new ResizeObserver(onResize) : null;
    if (host && observer) observer.observe(host);
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [offsetX, clampOffset]);

  // Reset shift whenever popovers close so a previous edge nudge never lingers.
  useLayoutEffect(() => {
    if (!layer) setLayerShift(0);
  }, [layer]);

  // A popover follows the island but never slides under the sidebar or off the
  // right edge: it is nudged back inside the column when it would overflow.
  const placeLayer = useCallback(() => {
    const host = rootRef.current?.parentElement;
    const popover = layerRef.current?.firstElementChild as HTMLElement | null;
    if (!host || !popover) return;
    const hostRect = host.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    if (!box.width || !hostRect.width) return;
    const edge = 12;
    let delta = 0;
    if (box.left < hostRect.left + edge) delta = hostRect.left + edge - box.left;
    else if (box.right > hostRect.right - edge) delta = hostRect.right - edge - box.right;
    if (Math.abs(delta) < 1) return;
    setLayerShift((shift) => shift + Math.round(delta));
  }, []);

  useLayoutEffect(() => {
    if (!layer) return;
    placeLayer();
    const popover = layerRef.current?.firstElementChild;
    if (!popover) return;
    const observer = new ResizeObserver(placeLayer);
    observer.observe(popover);
    return () => observer.disconnect();
  }, [placeLayer, open, layer]);

  useLayoutEffect(() => {
    if (layer) placeLayer();
  }, [placeLayer, layer, layerShift]);

  useEffect(() => {
    const unsubscribe = offsetX.on("change", placeLayer);
    window.addEventListener("resize", placeLayer);
    return () => {
      unsubscribe();
      window.removeEventListener("resize", placeLayer);
    };
  }, [offsetX, placeLayer]);

  const close = useCallback(
    (refocus = false) => {
      restoreFocusRef.current = refocus;
      onOpenChange(false);
    },
    [onOpenChange],
  );

  // Outside click collapses the island (capture phase so nothing swallows it).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !rootRef.current) return;
      if (rootRef.current.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(".app-launcher-panel, .add-document-drawer-backdrop, [data-slot='dialog-content'], .modal-backdrop")
      ) {
        return;
      }
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  // Escape collapses the island only after any open popover or modal has closed.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (rootRef.current?.querySelector('[role="dialog"]')) return;
      if (
        document.querySelector(
          ".app-launcher-panel, .add-document-drawer-backdrop, [data-slot='dialog-content'], .modal-backdrop",
        )
      ) {
        return;
      }
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

  // Arrow keys move between the island's controls (except native range sliders).
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (
      event.target instanceof HTMLInputElement ||
      (event.target instanceof Element && event.target.getAttribute("role") === "slider")
    ) {
      return;
    }
    const controls = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        "[data-island-control]:not([disabled]), .island-panel .app-launcher-button:not([disabled]), .island-panel .ds-theme-toggle:not([disabled]), .island-panel .island-avatar:not([disabled])",
      ) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (controls.length < 2) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    controls[(index + step + controls.length) % controls.length].focus();
  };

  const size = open ? panelSize : faceSize;
  const morph = reduceMotion ? { duration: 0 } : MORPH_SPRING;

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggedRef.current = false;
    // Mouse/pen only: a touch tap on phones never initiates a horizontal drag.
    if (event.pointerType === "touch" || event.button !== 0) return;
    // Expanded controls keep 100% crisp click behaviour without drag capture.
    if (
      event.target instanceof Element &&
      !event.target.closest(".island-face") &&
      event.target.closest("button, input, a, [role='button'], [role='slider'], [role='dialog']")
    ) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: offsetX.get(),
      moved: false,
    };
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
    const moved = drag.moved;
    dragRef.current = null;
    setDragging(false);
    if (moved) event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!moved) return;
    // Block only the synthetic click from this drag gesture, then reset cleanly
    // so the very next tap/click on the pill always opens the island.
    draggedRef.current = true;
    window.requestAnimationFrame(() => {
      draggedRef.current = false;
    });
    try {
      window.localStorage.setItem(DRAG_KEY, String(Math.round(offsetX.get())));
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={`dynamic-island-anchor ${dragging ? "is-dragging" : ""}`.trim()}
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <motion.div className="dynamic-island-track" style={{ x: offsetX }}>
        <motion.div
          ref={shellRef}
          className={`island-shell ${open ? "is-open" : ""} ${hasMedia ? "has-media" : ""}`.trim()}
          initial={false}
          animate={{ width: size.width, height: size.height }}
          transition={morph}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <button
            ref={faceRef}
            type="button"
            className="island-face"
            onClick={() => {
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
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
          <div
            className={`island-panel ${hasMedia ? "has-media" : ""}`.trim()}
            ref={panelRef}
            id={panelId}
            aria-hidden={!open}
            data-open={open ? "true" : "false"}
          >
            {children}
          </div>
        </motion.div>
        <div className="island-layer">
          <div
            className="island-layer-anchor"
            ref={layerRef}
            style={{ width: size.width + 2, marginLeft: layerShift }}
          >
            {layer}
          </div>
        </div>
      </motion.div>
    </div>
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
