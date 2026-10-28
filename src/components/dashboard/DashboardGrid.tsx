import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { moveWidgetById, type DashboardWidgetInstance } from "../../lib/dashboard-api";

const DRAG_THRESHOLD_PX = 6;

interface DragSession {
  widgetId: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export interface DashboardGridProps {
  widgets: DashboardWidgetInstance[];
  isEditing: boolean;
  onMoveById: (id: string, targetId: string) => void;
  onStepOrder: (id: string, delta: -1 | 1) => void;
  renderCell: (
    widget: DashboardWidgetInstance,
    index: number,
    dragProps: {
      isDragging: boolean;
      isDropTarget: boolean;
      onDragHandlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
      onDragHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    },
  ) => ReactNode;
}

export function DashboardGrid({
  widgets,
  isEditing,
  onMoveById,
  onStepOrder,
  renderCell,
}: DashboardGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<DashboardWidgetInstance[] | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const displayedWidgets = previewOrder ?? widgets;

  // Reset preview if external widget list changes while not actively dragging
  useEffect(() => {
    if (!draggingId) {
      setPreviewOrder(null);
      setHoverTargetId(null);
    }
  }, [widgets, draggingId]);

  // Prevent accidental click activation right after releasing a drag gesture
  useEffect(() => {
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  const finishDrag = useCallback(
    (commit: boolean) => {
      const session = dragSessionRef.current;
      dragSessionRef.current = null;
      const targetId = hoverTargetId;
      setDraggingId(null);
      setHoverTargetId(null);
      setPreviewOrder(null);

      if (session?.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 120);
      }

      if (commit && session?.moved && targetId && targetId !== session.widgetId) {
        onMoveById(session.widgetId, targetId);
        const movedWidget = widgets.find((w) => w.id === session.widgetId);
        const newIdx = moveWidgetById(widgets, session.widgetId, targetId).findIndex(
          (w) => w.id === session.widgetId,
        );
        if (movedWidget && newIdx >= 0) {
          setAnnouncement(`${movedWidget.title} moved to position ${newIdx + 1} of ${widgets.length}.`);
        }
      }
    },
    [hoverTargetId, onMoveById, widgets],
  );

  useEffect(() => {
    if (!draggingId) return;

    const onPointerMove = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      if (!session.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      session.moved = true;

      // Hit-test grid cells under pointer without overlapping or jumping
      const elements = document.elementsFromPoint(event.clientX, event.clientY);
      const cellEl = elements.find(
        (el) => el instanceof HTMLElement && el.dataset.dashboardCellId,
      ) as HTMLElement | undefined;
      const overId = cellEl?.dataset.dashboardCellId;
      if (overId && overId !== session.widgetId) {
        setHoverTargetId(overId);
        setPreviewOrder(moveWidgetById(widgets, session.widgetId, overId));
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      finishDrag(true);
    };

    const onPointerCancel = () => finishDrag(false);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finishDrag(false);
        setAnnouncement("Widget drag cancelled.");
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [draggingId, finishDrag, widgets]);

  const handleDragPointerDown = useCallback(
    (widgetId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isEditing || event.button > 0) return;
      dragSessionRef.current = {
        widgetId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      setDraggingId(widgetId);
      setHoverTargetId(widgetId);
    },
    [isEditing],
  );

  const handleDragKeyDown = useCallback(
    (widget: DashboardWidgetInstance, index: number, event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isEditing) return;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        if (index > 0) {
          onStepOrder(widget.id, -1);
          setAnnouncement(`${widget.title} moved to position ${index} of ${widgets.length}.`);
          requestAnimationFrame(() => {
            gridRef.current
              ?.querySelector<HTMLButtonElement>(`[data-widget-id="${widget.id}"] .ds-widget-drag-handle`)
              ?.focus({ preventScroll: true });
          });
        }
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        if (index < widgets.length - 1) {
          onStepOrder(widget.id, 1);
          setAnnouncement(`${widget.title} moved to position ${index + 2} of ${widgets.length}.`);
          requestAnimationFrame(() => {
            gridRef.current
              ?.querySelector<HTMLButtonElement>(`[data-widget-id="${widget.id}"] .ds-widget-drag-handle`)
              ?.focus({ preventScroll: true });
          });
        }
      }
    },
    [isEditing, onStepOrder, widgets.length],
  );

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div ref={gridRef} className="ds-dashboard-grid" data-editing={isEditing ? "true" : "false"}>
        {displayedWidgets.map((widget, index) => (
          <div
            key={widget.id}
            className="ds-dashboard-cell"
            data-width={widget.width}
            data-dashboard-cell-id={widget.id}
          >
            {renderCell(widget, index, {
              isDragging: draggingId === widget.id,
              isDropTarget: Boolean(draggingId && hoverTargetId === widget.id && draggingId !== widget.id),
              onDragHandlePointerDown: (e) => handleDragPointerDown(widget.id, e),
              onDragHandleKeyDown: (e) => handleDragKeyDown(widget, index, e),
            })}
          </div>
        ))}
      </div>
    </>
  );
}
