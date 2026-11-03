import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  Clock,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import ModalPortal from "../ModalPortal";
import { PersoraDatePicker } from "@/design-system";
import {
  KANBAN_COLUMNS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  canRolePerform,
  formatCoordinatePair,
  formatTravelMoney,
  isValidCoordinatePair,
  parseGoogleMapsInput,
  type TaskPriority,
  type TaskStatus,
} from "../../../cloudflare/travel-space-rules.js";
import { createCalendarEvent, updateCalendarEvent } from "../../lib/calendar-api";
import {
  createTripItem,
  deleteTripItem,
  describeTravelError,
  getDestinationStopLabel,
  reorderTripItems,
  updateTripDestinations,
  updateTripItem,
  type TravelItem,
  type TravelWorkspace,
} from "../../lib/travel-space-api";
import type { AppUser } from "../../types";
import { TravelInteractiveMap, type MapActivityPin, type MapDestinationPoint } from "./TravelInteractiveMap";

const COLUMN_LABELS: Record<"todo" | "in_progress" | "done", string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

interface Props {
  mode: "itinerary" | "tasks";
  user: AppUser;
  workspace: TravelWorkspace;
  onWorkspaceChange: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
  initialOpenModal?: "task" | "activity" | null;
  onModalHandled?: () => void;
  initialItineraryView?: "timeline" | "day" | "map" | null;
  onItineraryViewHandled?: () => void;
}

export default function TripItineraryAndTasks({
  mode,
  user,
  workspace,
  onWorkspaceChange,
  notify,
  initialOpenModal,
  onModalHandled,
  initialItineraryView,
  onItineraryViewHandled,
}: Props) {
  const canEdit = canRolePerform(workspace.role, "edit_itinerary");
  const [itineraryView, setItineraryView] = useState<"timeline" | "day" | "map">(
    () => initialItineraryView || "timeline",
  );

  useEffect(() => {
    if (mode === "itinerary" && initialItineraryView) {
      setItineraryView(initialItineraryView);
      onItineraryViewHandled?.();
    }
  }, [mode, initialItineraryView, onItineraryViewHandled]);
  const [selectedDayDate, setSelectedDayDate] = useState<string>(workspace.days[0]?.date || workspace.trip.startDate);
  const [kanbanFilter, setKanbanFilter] = useState<"all" | "unscheduled" | "scheduled">("all");
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  // Item Editor Modal state
  const [editorOpen, setEditorOpen] = useState<boolean>(Boolean(initialOpenModal));
  const [editingItem, setEditingItem] = useState<TravelItem | null>(null);
  const [defaultScheduleDate, setDefaultScheduleDate] = useState<string>(
    initialOpenModal === "activity" ? workspace.days[0]?.date || workspace.trip.startDate : "",
  );

  const openCreateModal = (scheduledDate: string | null) => {
    setEditingItem(null);
    setDefaultScheduleDate(scheduledDate || "");
    setEditorOpen(true);
    onModalHandled?.();
  };

  const openEditModal = (item: TravelItem) => {
    setEditingItem(item);
    setDefaultScheduleDate(item.scheduledDate || "");
    setEditorOpen(true);
  };

  const dayLabelMap = useMemo(() => {
    const m = new Map<string, number>();
    workspace.days.forEach((d) => m.set(d.date, d.dayNumber));
    return m;
  }, [workspace.days]);

  const overlapSet = useMemo(() => new Set(workspace.overlaps.overlappingIds), [workspace.overlaps.overlappingIds]);
  const travellerMap = useMemo(
    () => new Map(workspace.travellers.map((t) => [t.id, t.fullName])),
    [workspace.travellers],
  );
  const bookingMap = useMemo(
    () => new Map(workspace.bookings.map((b) => [b.id, b.title])),
    [workspace.bookings],
  );

  const unscheduledItems = useMemo(
    () =>
      workspace.items
        .filter((i) => !i.scheduledDate)
        .sort((a, b) => a.kanbanSortOrder - b.kanbanSortOrder),
    [workspace.items],
  );

  const handleScheduleChange = async (item: TravelItem, nextDate: string | null) => {
    try {
      const ws = await updateTripItem(user, workspace.trip.id, item.id, {
        scheduledDate: nextDate || null,
      });
      onWorkspaceChange(ws);
      notify(nextDate ? `Scheduled on ${nextDate}.` : "Returned to unscheduled tasks.");
    } catch (err: any) {
      notify(err?.message || "Could not update schedule.", "error");
    }
  };

  const handleStatusChange = async (item: TravelItem, nextStatus: TaskStatus) => {
    try {
      const ws = await updateTripItem(user, workspace.trip.id, item.id, { status: nextStatus });
      onWorkspaceChange(ws);
    } catch (err: any) {
      notify(err?.message || "Could not update status.", "error");
    }
  };

  const handleDropOnKanbanColumn = async (col: "todo" | "in_progress" | "done") => {
    setDropTargetKey(null);
    if (!dragItemId || !canEdit) return;
    const dragged = workspace.items.find((i) => i.id === dragItemId);
    setDragItemId(null);
    if (!dragged || dragged.status === col) return;
    await handleStatusChange(dragged, col);
  };

  const handleDropOnDay = async (date: string | null) => {
    setDropTargetKey(null);
    if (!dragItemId || !canEdit) return;
    const dragged = workspace.items.find((i) => i.id === dragItemId);
    setDragItemId(null);
    if (!dragged || dragged.scheduledDate === date) return;
    await handleScheduleChange(dragged, date);
  };

  const moveWithinDay = async (dayItems: TravelItem[], idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= dayItems.length) return;
    const reordered = [...dayItems];
    const [picked] = reordered.splice(idx, 1);
    reordered.splice(target, 0, picked);
    try {
      const ws = await reorderTripItems(
        user,
        workspace.trip.id,
        reordered.map((it, i) => ({ id: it.id, daySortOrder: i })),
      );
      onWorkspaceChange(ws);
    } catch (err: any) {
      notify(err?.message || "Could not reorder activities.", "error");
    }
  };

  const moveWithinColumn = async (colItems: TravelItem[], idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= colItems.length) return;
    const reordered = [...colItems];
    const [picked] = reordered.splice(idx, 1);
    reordered.splice(target, 0, picked);
    try {
      const ws = await reorderTripItems(
        user,
        workspace.trip.id,
        reordered.map((it, i) => ({ id: it.id, kanbanSortOrder: i })),
      );
      onWorkspaceChange(ws);
    } catch (err: any) {
      notify(err?.message || "Could not reorder tasks.", "error");
    }
  };

  const handleDelete = async (item: TravelItem) => {
    try {
      const ws = await deleteTripItem(user, workspace.trip.id, item.id);
      onWorkspaceChange(ws);
      notify("Removed from trip.");
    } catch (err: any) {
      notify(err?.message || "Could not delete item.", "error");
    }
  };

  const handleSyncToCalendar = async (item: TravelItem) => {
    if (!item.scheduledDate) return;
    if (user.demo) {
      notify("Sign in to a Persora account to sync trip activities with Calendar.", "error");
      return;
    }
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Dhaka";
      const hasTimes = Boolean(item.startTime && item.endTime && item.endTime > item.startTime);
      const eventPayload: any = {
        itemType: "event",
        title: `${workspace.trip.title}: ${item.title}`,
        description: item.notes || item.description || "",
        location: item.location || "",
        category: "personal",
        allDay: !hasTimes,
        timeZone: tz,
        startDate: item.scheduledDate,
        endDate: item.scheduledDate,
        ...(hasTimes
          ? {
              startAt: new Date(`${item.scheduledDate}T${item.startTime}:00`).toISOString(),
              endAt: new Date(`${item.scheduledDate}T${item.endTime}:00`).toISOString(),
            }
          : {}),
      };
      let calId = item.syncedCalendarEventId;
      if (calId) {
        const res = await updateCalendarEvent(calId, { event: eventPayload, scope: "series" });
        calId = res.event.id;
      } else {
        const res = await createCalendarEvent(eventPayload);
        calId = res.event.id;
      }
      const ws = await updateTripItem(user, workspace.trip.id, item.id, { syncedCalendarEventId: calId });
      onWorkspaceChange(ws);
      notify("Synced activity to Persora Calendar.");
    } catch (err: any) {
      notify(err?.message || "Could not sync with Calendar.", "error");
    }
  };

  const mapStops = useMemo<MapDestinationPoint[]>(
    () =>
      workspace.destinations.map((d, idx) => ({
        id: d.id,
        latitude: d.latitude,
        longitude: d.longitude,
        orderIndex: idx,
      })),
    [workspace.destinations],
  );

  const activityPins = useMemo<MapActivityPin[]>(
    () =>
      workspace.items
        .filter((it) => it.scheduledDate && isValidCoordinatePair(it.latitude, it.longitude))
        .map((it) => ({
          id: it.id,
          title: it.title,
          latitude: it.latitude!,
          longitude: it.longitude!,
          dayLabel: it.scheduledDate ? `Day ${dayLabelMap.get(it.scheduledDate) || ""}` : undefined,
          timeLabel: it.startTime || undefined,
        })),
    [workspace.items, dayLabelMap],
  );

  // =========================================================================
  // TASKS KANBAN VIEW
  // =========================================================================
  if (mode === "tasks") {
    const visibleItems = workspace.items.filter((i) => {
      if (kanbanFilter === "unscheduled") return !i.scheduledDate;
      if (kanbanFilter === "scheduled") return Boolean(i.scheduledDate);
      return true;
    });

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="ts-filter-bar">
          <div className="ts-segmented" role="tablist" aria-label="Task schedule filter">
            <button
              type="button"
              className={kanbanFilter === "all" ? "is-active" : ""}
              onClick={() => setKanbanFilter("all")}
            >
              All ({workspace.items.length})
            </button>
            <button
              type="button"
              className={kanbanFilter === "unscheduled" ? "is-active" : ""}
              onClick={() => setKanbanFilter("unscheduled")}
            >
              Unscheduled ({unscheduledItems.length})
            </button>
            <button
              type="button"
              className={kanbanFilter === "scheduled" ? "is-active" : ""}
              onClick={() => setKanbanFilter("scheduled")}
            >
              On Itinerary ({workspace.items.length - unscheduledItems.length})
            </button>
          </div>

          {canEdit && (
            <button type="button" className="ts-btn ts-btn-primary" onClick={() => openCreateModal(null)}>
              <Plus size={14} /> Add Task
            </button>
          )}
        </div>

        <div className="ts-kanban-grid">
          {KANBAN_COLUMNS.map((col) => {
            const colItems = visibleItems
              .filter((i) => (col === "done" ? i.status === "done" : i.status === col))
              .sort((a, b) => a.kanbanSortOrder - b.kanbanSortOrder);
            return (
              <div
                key={col}
                data-testid={`kanban-col-${col}`}
                className={`ts-kanban-col ${dropTargetKey === col ? "is-drop-target" : ""}`}
                onDragOver={(e) => {
                  if (!canEdit) return;
                  e.preventDefault();
                  setDropTargetKey(col);
                }}
                onDragLeave={() => setDropTargetKey(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleDropOnKanbanColumn(col);
                }}
              >
                <div className="ts-kanban-col-head">
                  <span>{COLUMN_LABELS[col]}</span>
                  <span className="ts-tab-count">{colItems.length}</span>
                </div>

                {colItems.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ds-text-muted)", padding: "18px 6px", textAlign: "center" }}>
                    Drop or add {COLUMN_LABELS[col].toLowerCase()} tasks
                  </div>
                ) : (
                  colItems.map((item, idx) => {
                    const dayNum = item.scheduledDate ? dayLabelMap.get(item.scheduledDate) : null;
                    return (
                      <div
                        key={item.id}
                        data-testid={`task-card-${item.id}`}
                        className="ts-task-card"
                        draggable={canEdit}
                        onDragStart={() => setDragItemId(item.id)}
                        onDragEnd={() => {
                          setDragItemId(null);
                          setDropTargetKey(null);
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "flex-start" }}>
                          <strong style={{ fontSize: 13, lineHeight: 1.35 }}>{item.title}</strong>
                          <span className="ts-status-pill" style={{ height: 20, fontSize: 10.5 }}>
                            {item.priority}
                          </span>
                        </div>

                        {item.description && (
                          <div style={{ fontSize: 12, color: "var(--ds-text-secondary)" }}>{item.description}</div>
                        )}

                        <div className="ts-meta-row">
                          {item.scheduledDate ? (
                            <span style={{ color: "var(--ds-accent)", fontWeight: 500 }}>
                              <CalendarCheck size={12} />
                              {dayNum ? `Day ${dayNum} · ` : ""}
                              {item.scheduledDate}
                              {item.startTime ? ` ${item.startTime}` : ""}
                            </span>
                          ) : (
                            <span>Unscheduled</span>
                          )}
                          {item.dueDate && <span>Due {item.dueDate}</span>}
                          {item.assigneeTravellerId && travellerMap.get(item.assigneeTravellerId) && (
                            <span>@{travellerMap.get(item.assigneeTravellerId)}</span>
                          )}
                        </div>

                        {canEdit && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
                            <select
                              aria-label={`Status for ${item.title}`}
                              className="ts-select"
                              style={{ height: 26, fontSize: 11.5, padding: "2px 6px", width: "auto" }}
                              value={item.status}
                              onChange={(e) => void handleStatusChange(item, e.target.value as TaskStatus)}
                            >
                              <option value="todo">To Do</option>
                              <option value="in_progress">In Progress</option>
                              <option value="done">Done</option>
                              <option value="skipped">Skipped</option>
                            </select>

                            <select
                              aria-label={`Schedule day for ${item.title}`}
                              className="ts-select"
                              style={{ height: 26, fontSize: 11.5, padding: "2px 6px", width: "auto", flex: "1 1 110px" }}
                              value={item.scheduledDate || ""}
                              onChange={(e) => void handleScheduleChange(item, e.target.value || null)}
                            >
                              <option value="">Unscheduled</option>
                              {workspace.days.map((d) => (
                                <option key={d.date} value={d.date}>
                                  Day {d.dayNumber} · {d.date}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              disabled={idx === 0}
                              onClick={() => void moveWithinColumn(colItems, idx, -1)}
                              aria-label={`Move ${item.title} up`}
                            >
                              <ArrowUp size={11} />
                            </button>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              disabled={idx === colItems.length - 1}
                              onClick={() => void moveWithinColumn(colItems, idx, 1)}
                              aria-label={`Move ${item.title} down`}
                            >
                              <ArrowDown size={11} />
                            </button>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              onClick={() => openEditModal(item)}
                              aria-label={`Edit ${item.title}`}
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm ts-btn-danger"
                              onClick={() => void handleDelete(item)}
                              aria-label={`Delete ${item.title}`}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>

        {editorOpen && (
          <ItemEditorModal
            user={user}
            workspace={workspace}
            editingItem={editingItem}
            defaultScheduleDate={defaultScheduleDate}
            onClose={() => setEditorOpen(false)}
            onSaved={(ws) => {
              onWorkspaceChange(ws);
              setEditorOpen(false);
            }}
            notify={notify}
          />
        )}
      </div>
    );
  }

  // =========================================================================
  // ITINERARY VIEW (Timeline View / Day View / Map View)
  // =========================================================================
  const daysToRender =
    itineraryView === "day"
      ? workspace.days.filter((d) => d.date === selectedDayDate)
      : workspace.days;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ts-filter-bar">
        <div className="ts-segmented" role="tablist" aria-label="Itinerary view mode">
          <button
            type="button"
            className={itineraryView === "timeline" ? "is-active" : ""}
            onClick={() => setItineraryView("timeline")}
          >
            Timeline View
          </button>
          <button
            type="button"
            className={itineraryView === "day" ? "is-active" : ""}
            onClick={() => setItineraryView("day")}
          >
            Day View
          </button>
          <button
            type="button"
            className={itineraryView === "map" ? "is-active" : ""}
            onClick={() => setItineraryView("map")}
          >
            Route Map
          </button>
        </div>

        {canEdit && (
          <button
            type="button"
            className="ts-btn ts-btn-primary"
            onClick={() => openCreateModal(itineraryView === "day" ? selectedDayDate : workspace.days[0]?.date || null)}
          >
            <Plus size={14} /> Add Activity
          </button>
        )}
      </div>

      {workspace.overlaps.conflicts.length > 0 && (
        <div className="ts-alert">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} />
            Schedule overlap detected on {workspace.overlaps.conflicts[0].date}:{" "}
            <b>{workspace.overlaps.conflicts[0].firstTitle}</b> overlaps with{" "}
            <b>{workspace.overlaps.conflicts[0].secondTitle}</b>.
          </span>
        </div>
      )}

      {itineraryView === "day" && workspace.days.length > 0 && (
        <div className="ts-segmented">
          {workspace.days.map((d) => (
            <button
              key={d.date}
              type="button"
              className={selectedDayDate === d.date ? "is-active" : ""}
              onClick={() => setSelectedDayDate(d.date)}
            >
              Day {d.dayNumber} · {d.date.slice(5)}
            </button>
          ))}
        </div>
      )}

      {itineraryView === "map" ? (
        <div className="ts-panel">
          <div className="ts-panel-head">
            <div>
              <h3>Trip Route &amp; Map Stops</h3>
              <p className="ts-muted-note">
                Numbered pins show ordered trip stops ({workspace.destinations.length}); secondary pins show scheduled activities with coordinates ({activityPins.length}).
              </p>
            </div>
            {workspace.destinations.length > 0 ? (
              <span style={{ fontSize: 12, color: "var(--ds-text-muted)" }}>
                {workspace.destinations
                  .slice(0, 3)
                  .map((d, idx) => getDestinationStopLabel(d, idx))
                  .join(" → ")}
              </span>
            ) : null}
          </div>
          <TravelInteractiveMap
            user={user}
            destinations={mapStops}
            activityMarkers={activityPins}
            readOnly={!canEdit}
            onChange={
              canEdit
                ? async (next) => {
                    try {
                      const ws = await updateTripDestinations(
                        user,
                        workspace.trip.id,
                        next.map((s) => ({ id: s.id, latitude: s.latitude, longitude: s.longitude })),
                      );
                      onWorkspaceChange(ws);
                    } catch (err) {
                      notify(describeTravelError(err, "Could not update route stops."), "error");
                    }
                  }
                : undefined
            }
            height={440}
          />
        </div>
      ) : (
        <div className="ts-two-col">
          {/* Scheduled Days Column */}
          <div className="ts-day-list">
            {daysToRender.map((day) => {
              const dayItems = workspace.items
                .filter((i) => i.scheduledDate === day.date)
                .sort((a, b) => {
                  if (a.startTime && b.startTime && a.startTime !== b.startTime) {
                    return a.startTime.localeCompare(b.startTime);
                  }
                  return a.daySortOrder - b.daySortOrder;
                });

              return (
                <div
                  key={day.date}
                  data-testid={`itinerary-day-${day.date}`}
                  className={`ts-day-card ${dropTargetKey === `day:${day.date}` ? "is-drop-target" : ""}`}
                  onDragOver={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    setDropTargetKey(`day:${day.date}`);
                  }}
                  onDragLeave={() => setDropTargetKey(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleDropOnDay(day.date);
                  }}
                >
                  <div className="ts-day-head">
                    <div>
                      <strong style={{ fontSize: 14 }}>Day {day.dayNumber}</strong>
                      <span style={{ marginLeft: 8, fontSize: 12.5, color: "var(--ds-text-secondary)" }}>
                        {day.date}
                      </span>
                    </div>
                    {canEdit && (
                      <button type="button" className="ts-btn ts-btn-sm" onClick={() => openCreateModal(day.date)}>
                        <Plus size={12} /> Add to Day {day.dayNumber}
                      </button>
                    )}
                  </div>

                  {dayItems.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "var(--ds-text-muted)", padding: "8px 0" }}>
                      No activities scheduled yet. Drag an unscheduled task here or click &ldquo;Add to Day {day.dayNumber}&rdquo;.
                    </div>
                  ) : (
                    dayItems.map((act, idx) => (
                      <div
                        key={act.id}
                        data-testid={`itinerary-item-${act.id}`}
                        className={`ts-task-card ${overlapSet.has(act.id) ? "is-overlap" : ""}`}
                        draggable={canEdit}
                        onDragStart={() => setDragItemId(act.id)}
                        onDragEnd={() => {
                          setDragItemId(null);
                          setDropTargetKey(null);
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {act.startTime && (
                              <span className="ts-status-pill ts-num">
                                <Clock size={11} />
                                {act.startTime}
                                {act.endTime ? `–${act.endTime}` : ""}
                              </span>
                            )}
                            <strong
                              style={{
                                fontSize: 13.5,
                                textDecoration: act.status === "skipped" ? "line-through" : "none",
                              }}
                            >
                              {act.title}
                            </strong>
                          </div>
                          <span className={`ts-status-pill ts-status-${act.status === "done" ? "completed" : "planning"}`}>
                            {act.status.replace("_", " ")}
                          </span>
                        </div>

                        {(act.location || act.estimatedCost !== null || act.bookingId) && (
                          <div className="ts-meta-row">
                            {act.location && (
                              <span>
                                <MapPin size={12} /> {act.location}
                              </span>
                            )}
                            {act.estimatedCost !== null && (
                              <span>Est. {formatTravelMoney(act.estimatedCost, workspace.trip.primaryCurrency)}</span>
                            )}
                            {act.bookingId && bookingMap.get(act.bookingId) && (
                              <span>Booking: {bookingMap.get(act.bookingId)}</span>
                            )}
                          </div>
                        )}

                        {act.notes && (
                          <div style={{ fontSize: 12, color: "var(--ds-text-secondary)" }}>{act.notes}</div>
                        )}

                        {canEdit && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              onClick={() =>
                                void handleStatusChange(act, act.status === "done" ? "todo" : "done")
                              }
                            >
                              <CheckCircle2 size={12} />
                              {act.status === "done" ? "Reopen" : "Mark Done"}
                            </button>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              onClick={() => void handleScheduleChange(act, null)}
                              title="Remove from day without deleting task"
                            >
                              <Undo2 size={12} /> Unschedule
                            </button>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              onClick={() => void handleSyncToCalendar(act)}
                              title="Sync to Persora Calendar"
                            >
                              <CalendarPlus size={12} />
                              {act.syncedCalendarEventId ? "Update Calendar" : "Calendar"}
                            </button>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              disabled={idx === 0}
                              onClick={() => void moveWithinDay(dayItems, idx, -1)}
                              aria-label="Move activity earlier"
                            >
                              <ArrowUp size={11} />
                            </button>
                            <button
                              type="button"
                              className="ts-btn ts-btn-sm"
                              disabled={idx === dayItems.length - 1}
                              onClick={() => void moveWithinDay(dayItems, idx, 1)}
                              aria-label="Move activity later"
                            >
                              <ArrowDown size={11} />
                            </button>
                            <button type="button" className="ts-btn ts-btn-sm" onClick={() => openEditModal(act)}>
                              <Pencil size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>

          {/* Unscheduled Tasks Tray (Drag or 1-Click Schedule onto Itinerary) */}
          <div
            className={`ts-panel ${dropTargetKey === "unscheduled" ? "is-drop-target" : ""}`}
            style={{ alignSelf: "start" }}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDropTargetKey("unscheduled");
            }}
            onDragLeave={() => setDropTargetKey(null)}
            onDrop={(e) => {
              e.preventDefault();
              void handleDropOnDay(null);
            }}
          >
            <div className="ts-panel-head">
              <h3>Unscheduled Tasks ({unscheduledItems.length})</h3>
              {canEdit && (
                <button type="button" className="ts-btn ts-btn-sm" onClick={() => openCreateModal(null)}>
                  <Plus size={12} /> Task
                </button>
              )}
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ds-text-muted)" }}>
              Drag any task onto a trip day — or pick a day below — to schedule it without duplicating records.
            </p>
            {unscheduledItems.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--ds-text-muted)" }}>
                All trip tasks are scheduled on the itinerary.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {unscheduledItems.map((task) => (
                  <div
                    key={task.id}
                    className="ts-task-card"
                    draggable={canEdit}
                    onDragStart={() => setDragItemId(task.id)}
                    onDragEnd={() => {
                      setDragItemId(null);
                      setDropTargetKey(null);
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <strong style={{ fontSize: 13 }}>{task.title}</strong>
                      <span className="ts-status-pill" style={{ height: 20, fontSize: 10.5 }}>
                        {task.status.replace("_", " ")}
                      </span>
                    </div>
                    {canEdit && (
                      <select
                        aria-label={`Schedule ${task.title} to day`}
                        className="ts-select"
                        style={{ height: 28, fontSize: 12 }}
                        value=""
                        onChange={(e) => {
                          if (e.target.value) void handleScheduleChange(task, e.target.value);
                        }}
                      >
                        <option value="">Schedule to day…</option>
                        {workspace.days.map((d) => (
                          <option key={d.date} value={d.date}>
                            Day {d.dayNumber} · {d.date}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {editorOpen && (
        <ItemEditorModal
          user={user}
          workspace={workspace}
          editingItem={editingItem}
          defaultScheduleDate={defaultScheduleDate}
          onClose={() => setEditorOpen(false)}
          onSaved={(ws) => {
            onWorkspaceChange(ws);
            setEditorOpen(false);
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

function ItemEditorModal({
  user,
  workspace,
  editingItem,
  defaultScheduleDate,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  workspace: TravelWorkspace;
  editingItem: TravelItem | null;
  defaultScheduleDate: string;
  onClose: () => void;
  onSaved: (ws: TravelWorkspace) => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const [title, setTitle] = useState(editingItem?.title || "");
  const [description, setDescription] = useState(editingItem?.description || "");
  const [status, setStatus] = useState<TaskStatus>(editingItem?.status || "todo");
  const [priority, setPriority] = useState<TaskPriority>(editingItem?.priority || "normal");
  const [dueDate, setDueDate] = useState(editingItem?.dueDate || "");
  const [scheduledDate, setScheduledDate] = useState(editingItem?.scheduledDate || defaultScheduleDate || "");
  const [startTime, setStartTime] = useState(editingItem?.startTime || "");
  const [endTime, setEndTime] = useState(editingItem?.endTime || "");
  const [location, setLocation] = useState(editingItem?.location || "");
  const [coordOrUrl, setCoordOrUrl] = useState(() =>
    editingItem && isValidCoordinatePair(editingItem.latitude, editingItem.longitude)
      ? formatCoordinatePair(editingItem.latitude!, editingItem.longitude!, 5)
      : "",
  );
  const [assigneeId, setAssigneeId] = useState(editingItem?.assigneeTravellerId || "");
  const [bookingId, setBookingId] = useState(editingItem?.bookingId || "");
  const [estimatedCost, setEstimatedCost] = useState(
    editingItem?.estimatedCost !== null && editingItem?.estimatedCost !== undefined
      ? String(editingItem.estimatedCost)
      : "",
  );
  const [notes, setNotes] = useState(editingItem?.notes || "");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      if (coordOrUrl.trim()) {
        const parsed = parseGoogleMapsInput(coordOrUrl.trim());
        if (!parsed.ok || parsed.latitude === undefined || parsed.longitude === undefined) {
          throw new Error(parsed.message || "Enter valid map coordinates or leave blank.");
        }
        lat = parsed.latitude;
        lng = parsed.longitude;
      }

      const payload = {
        title: title.trim(),
        description,
        status,
        priority,
        dueDate: dueDate || null,
        scheduledDate: scheduledDate || null,
        startTime: scheduledDate && startTime ? startTime : null,
        endTime: scheduledDate && endTime ? endTime : null,
        location,
        latitude: lat,
        longitude: lng,
        assigneeTravellerId: assigneeId || null,
        bookingId: bookingId || null,
        estimatedCost: estimatedCost === "" ? null : Number(estimatedCost),
        notes,
      };
      const ws = editingItem
        ? await updateTripItem(user, workspace.trip.id, editingItem.id, payload)
        : await createTripItem(user, workspace.trip.id, payload);
      notify(editingItem ? "Updated item." : scheduledDate ? "Added itinerary activity." : "Added trip task.");
      onSaved(ws);
    } catch (err: any) {
      notify(err?.message || "Could not save item.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label={editingItem ? "Edit item" : "Add task or activity"}>
        <form className="ts-modal-card" onSubmit={submit}>
          <div className="ts-modal-head">
            <h3>{editingItem ? "Edit Task / Activity" : scheduledDate ? "Add Itinerary Activity" : "Add Trip Task"}</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            <div className="ts-field-grid">
              <div className="ts-field is-full">
                <label htmlFor="ts-item-title">Title *</label>
                <input
                  id="ts-item-title"
                  className="ts-input"
                  placeholder="e.g. Check in at hotel, Visit Himchari waterfall…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="ts-field">
                <label htmlFor="ts-item-status">Status</label>
                <select
                  id="ts-item-status"
                  className="ts-select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ts-field">
                <label htmlFor="ts-item-priority">Priority</label>
                <select
                  id="ts-item-priority"
                  className="ts-select"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ts-field">
                <label htmlFor="ts-item-day">Itinerary Day (leave empty for unscheduled task)</label>
                <select
                  id="ts-item-day"
                  className="ts-select"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                >
                  <option value="">Unscheduled Task</option>
                  {workspace.days.map((d) => (
                    <option key={d.date} value={d.date}>
                      Day {d.dayNumber} · {d.date}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ts-field">
                <label htmlFor="ts-item-due">Preparation Due Date</label>
                <PersoraDatePicker
                  id="ts-item-due"
                  value={dueDate}
                  allowClear
                  ariaLabel="Preparation due date"
                  onChange={setDueDate}
                />
              </div>

              {scheduledDate && (
                <>
                  <div className="ts-field">
                    <label htmlFor="ts-item-start">Start Time</label>
                    <input
                      id="ts-item-start"
                      type="time"
                      className="ts-input"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                    />
                  </div>
                  <div className="ts-field">
                    <label htmlFor="ts-item-end">End Time</label>
                    <input
                      id="ts-item-end"
                      type="time"
                      className="ts-input"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="ts-field">
                <label htmlFor="ts-item-loc">Location Label</label>
                <input
                  id="ts-item-loc"
                  className="ts-input"
                  placeholder="Address, terminal, or landmark"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>

              <div className="ts-field">
                <label htmlFor="ts-item-coords">Map Pin (Coords or Google Maps URL)</label>
                <input
                  id="ts-item-coords"
                  className="ts-input"
                  placeholder="e.g. 23.8103, 90.4125 or Maps link"
                  value={coordOrUrl}
                  onChange={(e) => setCoordOrUrl(e.target.value)}
                />
              </div>

              <div className="ts-field">
                <label htmlFor="ts-item-cost">Estimated Cost ({workspace.trip.primaryCurrency})</label>
                <input
                  id="ts-item-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  className="ts-input ts-num"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                />
              </div>

              {workspace.travellers.length > 1 && (
                <div className="ts-field">
                  <label htmlFor="ts-item-assignee">Assigned Traveller</label>
                  <select
                    id="ts-item-assignee"
                    className="ts-select"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {workspace.travellers.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {workspace.bookings.length > 0 && (
                <div className="ts-field">
                  <label htmlFor="ts-item-booking">Linked Booking</label>
                  <select
                    id="ts-item-booking"
                    className="ts-select"
                    value={bookingId}
                    onChange={(e) => setBookingId(e.target.value)}
                  >
                    <option value="">None</option>
                    {workspace.bookings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title} ({b.category})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="ts-field is-full">
                <label htmlFor="ts-item-desc">Short Description</label>
                <input
                  id="ts-item-desc"
                  className="ts-input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional summary"
                />
              </div>

              <div className="ts-field is-full">
                <label htmlFor="ts-item-notes">Notes</label>
                <textarea
                  id="ts-item-notes"
                  className="ts-textarea"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Meeting point, gate details, checklist…"
                />
              </div>
            </div>
          </div>
          <div className="ts-modal-foot">
            <button type="button" className="ts-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ts-btn ts-btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingItem ? "Save Changes" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}
