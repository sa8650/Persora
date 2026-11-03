import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Compass,
  Copy,
  ImageOff,
  ImagePlus,
  MapPin,
  Pencil,
  Play,
  Plus,
  Receipt,
  Ticket,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import MoreOptionsMenu, { type MoreMenuAction } from "../MoreOptionsMenu";
import { Button, PersoraDeleteModal, Progress } from "@/design-system";
import {
  canRolePerform,
  formatCoordinatePair,
  formatTravelMoney,
  isValidCoordinatePair,
  type TripStatus,
} from "../../../cloudflare/travel-space-rules.js";
import {
  deleteTrip,
  describeTravelError,
  duplicateTrip,
  getDestinationStopLabel,
  removeTripCover,
  updateTrip,
  uploadTripAttachment,
  validateTripCoverFile,
  type TravelWorkspace,
} from "../../lib/travel-space-api";
import type { AppUser, PersoraContact, TimelineDraft, VaultItem } from "../../types";
import CreateTripDialog from "./CreateTripDialog";
import { TravelInteractiveMap, type MapActivityPin, type MapDestinationPoint } from "./TravelInteractiveMap";
import { formatCompactTripDateRange } from "./TripCard";
import { TripCoverMedia } from "./TripCoverMedia";
import TripFinanceTabs from "./TripFinanceTabs";
import TripItineraryAndTasks from "./TripItineraryAndTasks";
import { CompleteTripModal, TripMemoriesTab } from "./TripMemoriesAndComplete";
import TripOrganizationTabs from "./TripOrganizationTabs";

export type TripTabId =
  | "overview"
  | "itinerary"
  | "tasks"
  | "expenses"
  | "budget"
  | "bookings"
  | "travellers"
  | "documents"
  | "memories";

interface Props {
  user: AppUser;
  workspace: TravelWorkspace;
  vaultItems: VaultItem[];
  contacts: PersoraContact[];
  onWorkspaceChange: (ws: TravelWorkspace) => void;
  onBack: () => void;
  onTripDuplicated?: (ws: TravelWorkspace) => void;
  onTripDeleted: () => void;
  onOpenVaultItem?: (item: VaultItem) => void;
  onSaveVaultItem?: (draft: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string }) => Promise<VaultItem | void>;
  onSaveTimelineEvent?: (draft: TimelineDraft) => Promise<void>;
  notify: (msg: string, kind?: "success" | "error") => void;
}

const STATUS_LABELS: Record<TripStatus, string> = {
  planning: "Planning",
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export default function TripWorkspace({
  user,
  workspace,
  vaultItems,
  contacts,
  onWorkspaceChange,
  onBack,
  onTripDuplicated,
  onTripDeleted,
  onOpenVaultItem,
  onSaveVaultItem,
  onSaveTimelineEvent,
  notify,
}: Props) {
  const [tab, setTab] = useState<TripTabId>("overview");
  const [pendingItineraryView, setPendingItineraryView] = useState<"timeline" | "day" | "map" | null>(null);
  const [editTripOpen, setEditTripOpen] = useState(false);
  const [completeFlowOpen, setCompleteFlowOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverUploadProgress, setCoverUploadProgress] = useState<number | null>(null);
  const [quickModal, setQuickModal] = useState<
    "task" | "activity" | "expense" | "booking" | "document" | null
  >(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);

  const canEditTrip = canRolePerform(workspace.role, "edit_trip");
  const canEditItinerary = canRolePerform(workspace.role, "edit_itinerary");
  const canCreateExpense = canRolePerform(workspace.role, "create_expense");
  const isOwner = workspace.role === "owner";
  const cur = workspace.trip.primaryCurrency;
  const b = workspace.budgetOverview;

  const openRouteMap = () => {
    setPendingItineraryView("map");
    setTab("itinerary");
  };

  const triggerQuickAction = (
    targetTab: TripTabId,
    modal: "task" | "activity" | "expense" | "booking" | "document",
  ) => {
    setQuickModal(modal);
    setTab(targetTab);
  };

  const scheduledActivities = useMemo(
    () =>
      workspace.items
        .filter((i) => i.scheduledDate && i.status !== "done" && i.status !== "skipped")
        .sort((x, y) => {
          const byDate = (x.scheduledDate || "").localeCompare(y.scheduledDate || "");
          if (byDate !== 0) return byDate;
          return (x.startTime || "").localeCompare(y.startTime || "");
        }),
    [workspace.items],
  );

  const importantTasks = useMemo(
    () =>
      workspace.items
        .filter((i) => i.status !== "done" && i.status !== "skipped")
        .sort((a, b) => {
          const pa = PRIORITY_RANK[a.priority] ?? 2;
          const pb = PRIORITY_RANK[b.priority] ?? 2;
          if (pa !== pb) return pa - pb;
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return a.kanbanSortOrder - b.kanbanSortOrder;
        }),
    [workspace.items],
  );

  const recentExpenses = useMemo(
    () =>
      [...workspace.expenses]
        .sort((a, b) => (b.expenseDate || b.createdAt || "").localeCompare(a.expenseDate || a.createdAt || ""))
        .slice(0, 4),
    [workspace.expenses],
  );

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

  const activityPins = useMemo<MapActivityPin[]>(() => {
    const dayLookup = new Map(workspace.days.map((d) => [d.date, `Day ${d.dayNumber}`]));
    return workspace.items
      .filter((i) => i.scheduledDate && isValidCoordinatePair(i.latitude, i.longitude))
      .map((i) => ({
        id: i.id,
        title: i.title,
        latitude: i.latitude!,
        longitude: i.longitude!,
        dayLabel: i.scheduledDate ? dayLookup.get(i.scheduledDate) || i.scheduledDate : undefined,
        timeLabel: i.startTime || undefined,
      }));
  }, [workspace.items, workspace.days]);

  const prepAlerts = useMemo(() => {
    const alerts: string[] = [];
    const todayIso = new Date().toISOString().slice(0, 10);
    const expiredDocs = workspace.documents.filter((d) => d.expiryDate && d.expiryDate < todayIso);
    if (expiredDocs.length > 0) {
      alerts.push(`${expiredDocs.length} attached travel document(s) have passed their expiry date.`);
    }
    const overdueTasks = workspace.items.filter(
      (i) => i.dueDate && i.dueDate < todayIso && i.status !== "done" && i.status !== "skipped",
    );
    if (overdueTasks.length > 0) {
      alerts.push(`${overdueTasks.length} preparation task(s) are past their due date.`);
    }
    if (workspace.overlaps.conflicts.length > 0) {
      alerts.push(`${workspace.overlaps.conflicts.length} itinerary schedule overlap(s) need attention.`);
    }
    if (b.budgetScope === "group" && b.totalPendingContributions > 0) {
      alerts.push(
        `${formatTravelMoney(b.totalPendingContributions, cur)} in group contributions is pending collection.`,
      );
    }
    return alerts;
  }, [workspace.documents, workspace.items, workspace.overlaps.conflicts.length, b, cur]);

  const handleStatusTransition = async (next: TripStatus) => {
    if (next === "completed") {
      setCompleteFlowOpen(true);
      return;
    }
    try {
      const ws = await updateTrip(user, workspace.trip.id, { status: next });
      onWorkspaceChange(ws);
      notify(`Trip marked as ${STATUS_LABELS[next] || next}.`);
    } catch (err) {
      notify(describeTravelError(err, "Could not update trip status."), "error");
    }
  };

  const handleDirectCoverSelect = async (file: File | null) => {
    if (!file) return;
    if (coverFileInputRef.current) coverFileInputRef.current.value = "";
    const validationErr = validateTripCoverFile(file);
    if (validationErr) {
      notify(validationErr, "error");
      return;
    }
    setCoverUploadProgress(0);
    try {
      const ws = await uploadTripAttachment(user, workspace.trip.id, "cover", file, undefined, {
        onProgress: (p) => setCoverUploadProgress(p.percent),
      });
      onWorkspaceChange(ws);
      notify("Trip cover image updated.");
    } catch (err) {
      notify(describeTravelError(err, "Could not upload trip cover image."), "error");
    } finally {
      setCoverUploadProgress(null);
    }
  };

  const handleDirectCoverRemove = async () => {
    try {
      const ws = await removeTripCover(user, workspace.trip.id);
      onWorkspaceChange(ws);
      notify("Trip cover image removed.");
    } catch (err) {
      notify(describeTravelError(err, "Could not remove trip cover image."), "error");
    }
  };

  const handleDuplicateCurrentTrip = async () => {
    try {
      const dupWs = await duplicateTrip(user, workspace.trip.id);
      notify(`Duplicated "${dupWs.trip.title}".`);
      onTripDuplicated?.(dupWs);
    } catch (err) {
      notify(describeTravelError(err, "Could not duplicate trip."), "error");
    }
  };

  const confirmDeleteTrip = async () => {
    setDeleting(true);
    try {
      await deleteTrip(user, workspace.trip.id);
      setDeleteModalOpen(false);
      notify("Trip moved to Trash.");
      onTripDeleted();
    } catch (err) {
      notify(describeTravelError(err, "Could not delete trip."), "error");
    } finally {
      setDeleting(false);
    }
  };

  // Compact Actions Menu items
  const actionMenuItems = useMemo<MoreMenuAction[]>(() => {
    const items: MoreMenuAction[] = [];
    if (canEditTrip) {
      items.push({
        label: "Edit trip details",
        icon: Pencil,
        onSelect: () => setEditTripOpen(true),
      });
      items.push({
        label: workspace.trip.hasCover ? "Replace cover image" : "Upload cover image",
        icon: ImagePlus,
        onSelect: () => coverFileInputRef.current?.click(),
      });
      if (workspace.trip.hasCover) {
        items.push({
          label: "Remove cover image",
          icon: ImageOff,
          onSelect: () => void handleDirectCoverRemove(),
        });
      }
      if (workspace.trip.status === "planning") {
        items.push({
          label: "Mark as Upcoming",
          icon: Compass,
          onSelect: () => void handleStatusTransition("upcoming"),
        });
      }
      if (workspace.trip.status === "planning" || workspace.trip.status === "upcoming") {
        items.push({
          label: "Start trip",
          icon: Play,
          onSelect: () => void handleStatusTransition("ongoing"),
        });
      }
      if (workspace.trip.status !== "completed" && workspace.trip.status !== "cancelled") {
        items.push({
          label: "Complete trip",
          icon: CheckCircle2,
          onSelect: () => setCompleteFlowOpen(true),
        });
        items.push({
          label: "Cancel trip",
          icon: XCircle,
          onSelect: () => void handleStatusTransition("cancelled"),
        });
      }
      if (workspace.trip.status === "cancelled") {
        items.push({
          label: "Reopen as Planning",
          icon: Compass,
          onSelect: () => void handleStatusTransition("planning"),
        });
      }
    }

    items.push({
      label: "Duplicate trip",
      icon: Copy,
      onSelect: () => void handleDuplicateCurrentTrip(),
    });

    if (isOwner) {
      items.push({
        label: "Delete trip",
        icon: Trash2,
        danger: true,
        onSelect: () => setDeleteModalOpen(true),
      });
    }
    return items;
  }, [canEditTrip, isOwner, workspace.trip.hasCover, workspace.trip.status]);

  // Clean 9-Tab Workspace Navigation
  const tabs: Array<{ id: TripTabId; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "itinerary", label: "Itinerary", count: workspace.items.filter((i) => i.scheduledDate).length },
    { id: "tasks", label: "Tasks", count: workspace.items.length },
    { id: "expenses", label: "Expenses", count: workspace.expenses.length },
    { id: "budget", label: "Budget" },
    { id: "bookings", label: "Bookings", count: workspace.bookings.length },
    { id: "travellers", label: "Travellers", count: workspace.travellers.length },
    { id: "documents", label: "Documents", count: workspace.documents.length },
    { id: "memories", label: "Memories", count: workspace.memories.length },
  ];

  const showBudgetSection =
    b.budgetScope !== "none" && (b.totalPlannedBudget > 0 || b.totalExpenses > 0);
  const hasSecondaryData =
    prepAlerts.length > 0 ||
    showBudgetSection ||
    recentExpenses.length > 0 ||
    workspace.bookings.length > 0;
  const budgetPct =
    b.totalPlannedBudget > 0
      ? Math.min(100, Math.round((b.totalExpenses / b.totalPlannedBudget) * 100))
      : 0;

  return (
    <div className="ts-workspace">
      <input
        ref={coverFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="ts-sr-only-file"
        aria-label="Upload trip cover image"
        onChange={(e) => void handleDirectCoverSelect(e.target.files?.[0] || null)}
      />

      {/* Dedicated Trip Workspace Header */}
      <header className="ts-ws-header">
        <div className="ts-ws-back-row">
          <button type="button" className="ts-ws-back-link" onClick={onBack}>
            <ArrowLeft size={14} />
            <span>Back to My Trips</span>
          </button>
        </div>

        <div className="ts-ws-hero">
          <div className="ts-ws-cover-slot">
            <TripCoverMedia
              user={user}
              trip={workspace.trip}
              className="ts-ws-cover-media"
              alt={`${workspace.trip.title} cover`}
            >
              {canEditTrip && (
                <button
                  type="button"
                  className="ts-ws-cover-edit-btn"
                  onClick={() => coverFileInputRef.current?.click()}
                  title={workspace.trip.hasCover ? "Replace cover image" : "Upload cover image"}
                >
                  <ImagePlus size={12} />
                  <span>{workspace.trip.hasCover ? "Cover" : "Add cover"}</span>
                </button>
              )}
            </TripCoverMedia>
          </div>

          <div className="ts-ws-main-meta">
            <div className="ts-ws-title-line">
              <h2 className="ts-ws-title">{workspace.trip.title}</h2>
              <span className={`ts-trip-status ts-status-${workspace.trip.status}`}>
                {STATUS_LABELS[workspace.trip.status] || workspace.trip.status}
              </span>
            </div>

            <div className="ts-ws-submeta">
              <span className="ts-ws-meta-item ts-num">
                <Calendar size={13} />
                <span>
                  {formatCompactTripDateRange(
                    workspace.trip.startDate,
                    workspace.trip.endDate,
                    workspace.trip.durationDays,
                  )}
                </span>
              </span>
              <span className="ts-trip-meta-dot" aria-hidden="true">·</span>
              <span className="ts-ws-meta-item">
                <Users size={13} />
                <span>
                  {workspace.travellers.length}{" "}
                  {workspace.travellers.length === 1 ? "traveller" : "travellers"}
                </span>
              </span>
              <span className="ts-trip-meta-dot" aria-hidden="true">·</span>
              <button
                type="button"
                className="ts-ws-meta-link"
                onClick={openRouteMap}
              >
                <MapPin size={13} />
                <span>
                  {workspace.destinations.length === 0
                    ? "Add route stops"
                    : `${workspace.destinations.length} ${workspace.destinations.length === 1 ? "destination" : "destinations"}`}
                </span>
              </button>
            </div>
          </div>

          <div className="ts-ws-actions">
            {canEditTrip && workspace.trip.status === "ongoing" ? (
              <Button type="button" variant="default" size="sm" onClick={() => setCompleteFlowOpen(true)}>
                <CheckCircle2 size={13} />
                <span>Complete Trip</span>
              </Button>
            ) : canEditTrip ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditTripOpen(true)}>
                <Pencil size={13} />
                <span>Edit Trip</span>
              </Button>
            ) : null}

            <MoreOptionsMenu
              label="Trip actions"
              actions={actionMenuItems}
              iconOrientation="horizontal"
            />
          </div>
        </div>

        {coverUploadProgress !== null && (
          <div className="ts-ws-upload-progress" role="status" aria-live="polite">
            <div className="ts-upload-progress-label">
              <span>Uploading cover image…</span>
              <span className="ts-num">{coverUploadProgress}%</span>
            </div>
            <Progress value={coverUploadProgress} className="h-1.5" />
          </div>
        )}
      </header>

      {/* Clean 9-Tab Workspace Navigation */}
      <div className="ts-tabs-rail" role="tablist" aria-label="Trip workspace tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`ts-tab-btn ${tab === t.id ? "is-active" : ""}`}
            onClick={() => {
              if (t.id === "itinerary") setPendingItineraryView("timeline");
              setTab(t.id);
            }}
          >
            <span>{t.label}</span>
            {typeof t.count === "number" && t.count > 0 && (
              <span className="ts-tab-count ts-num">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* TAB 1: BALANCED OVERVIEW */}
      {tab === "overview" && (
        <div className="ts-overview-grid">
          {/* Main Column: Destination Map Preview, Upcoming Itinerary, Important Tasks */}
          <div className="ts-overview-main">
            <section className="ts-panel">
              <div className="ts-panel-head">
                <div>
                  <h3>Destination Map</h3>
                  <p className="ts-muted-note">
                    {workspace.destinations.length === 0
                      ? "No route stops pinned yet."
                      : `${workspace.destinations.length} ordered ${workspace.destinations.length === 1 ? "stop" : "stops"}`}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="xs" onClick={openRouteMap}>
                  {workspace.destinations.length > 0 ? "Open Route Map" : "Add Stops"}
                </Button>
              </div>

              <TravelInteractiveMap
                user={user}
                variant="compact"
                destinations={mapStops}
                activityMarkers={activityPins}
                height={208}
                onOpenFullMap={openRouteMap}
              />

              {workspace.destinations.length > 0 && (
                <div className="ts-overview-stop-list">
                  {workspace.destinations.slice(0, 5).map((d, idx) => (
                    <div key={d.id} className="ts-overview-stop-row">
                      <span>
                        <b>{idx + 1}.</b> {getDestinationStopLabel(d, idx)}
                      </span>
                      <small className="ts-num">{formatCoordinatePair(d.latitude, d.longitude, 4)}</small>
                    </div>
                  ))}
                  {workspace.destinations.length > 5 && (
                    <small className="ts-muted-note">
                      +{workspace.destinations.length - 5} additional stop(s) on Route Map
                    </small>
                  )}
                </div>
              )}

              {workspace.trip.description ? (
                <p className="ts-trip-overview-desc">{workspace.trip.description}</p>
              ) : null}
            </section>

            {(scheduledActivities.length > 0 || importantTasks.length === 0) && (
              <section className="ts-panel">
                <div className="ts-panel-head">
                  <h3>Upcoming Itinerary</h3>
                  <div className="ts-panel-head-actions">
                    {canEditItinerary && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => triggerQuickAction("itinerary", "activity")}
                      >
                        <Plus size={12} /> Add activity
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="xs" onClick={() => setTab("itinerary")}>
                      View all
                    </Button>
                  </div>
                </div>
                {scheduledActivities.length === 0 ? (
                  <p className="ts-muted-note">
                    No day-by-day activities scheduled yet. Open Itinerary to plan each travel day.
                  </p>
                ) : (
                  <div className="ts-overview-act-list">
                    {scheduledActivities.slice(0, 5).map((act) => (
                      <div key={act.id} className="ts-overview-act-row">
                        <div className="ts-overview-row-main">
                          <strong>{act.title}</strong>
                          {act.location ? <small>{act.location}</small> : null}
                        </div>
                        <span className="ts-overview-row-aside ts-num">
                          {act.scheduledDate}
                          {act.startTime ? ` · ${act.startTime}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {importantTasks.length > 0 && (
              <section className="ts-panel">
                <div className="ts-panel-head">
                  <h3>Important Tasks</h3>
                  <div className="ts-panel-head-actions">
                    {canEditItinerary && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => triggerQuickAction("tasks", "task")}
                      >
                        <Plus size={12} /> Add task
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="xs" onClick={() => setTab("tasks")}>
                      Open board ({importantTasks.length})
                    </Button>
                  </div>
                </div>
                <div className="ts-overview-act-list">
                  {importantTasks.slice(0, 5).map((task) => (
                    <div key={task.id} className="ts-overview-act-row">
                      <div className="ts-overview-row-main">
                        <strong>{task.title}</strong>
                        <small>
                          {task.priority !== "normal" ? `${task.priority.toUpperCase()} · ` : ""}
                          {task.scheduledDate ? `Scheduled ${task.scheduledDate}` : "Checklist"}
                        </small>
                      </div>
                      {task.dueDate ? (
                        <span className="ts-overview-row-aside ts-num">Due {task.dueDate}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Secondary Column: Reminders, Budget Summary, Recent Expenses, Booking Summary */}
          <aside className="ts-overview-side">
            {prepAlerts.length > 0 && (
              <section className="ts-panel ts-panel-reminders">
                <div className="ts-panel-head">
                  <h3>Important Reminders</h3>
                </div>
                <div className="ts-alert-list">
                  {prepAlerts.map((msg, idx) => (
                    <div key={idx} className="ts-alert-item">
                      <AlertTriangle size={13} />
                      <span>{msg}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {showBudgetSection && (
              <section className="ts-panel">
                <div className="ts-panel-head">
                  <h3>Budget Summary</h3>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setTab("budget")}>
                    Manage
                  </Button>
                </div>
                <div className="ts-budget-mini">
                  <div className="ts-budget-mini-numbers ts-num">
                    <div>
                      <small>Spent</small>
                      <strong>{formatTravelMoney(b.totalExpenses, cur)}</strong>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <small>
                        {b.budgetScope === "group" ? "Group budget" : "Planned budget"}
                      </small>
                      <strong>{formatTravelMoney(b.totalPlannedBudget, cur)}</strong>
                    </div>
                  </div>
                  {b.totalPlannedBudget > 0 && (
                    <Progress value={budgetPct} className="h-1.5" />
                  )}
                  <div className="ts-budget-mini-foot ts-num">
                    <span>
                      Remaining: <b>{formatTravelMoney(b.remainingBudget, cur)}</b>
                    </span>
                    {canCreateExpense && (
                      <button
                        type="button"
                        className="ts-inline-link-btn"
                        onClick={() => triggerQuickAction("expenses", "expense")}
                      >
                        + Log expense
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}

            {recentExpenses.length > 0 && (
              <section className="ts-panel">
                <div className="ts-panel-head">
                  <h3>Recent Expenses</h3>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setTab("expenses")}>
                    All ({workspace.expenses.length})
                  </Button>
                </div>
                <div className="ts-overview-act-list">
                  {recentExpenses.map((exp) => (
                    <div key={exp.id} className="ts-overview-act-row">
                      <div className="ts-overview-row-main">
                        <strong>{exp.title}</strong>
                        <small>{exp.expenseDate}</small>
                      </div>
                      <span className="ts-overview-row-aside ts-num">
                        <b>{formatTravelMoney(exp.amount, exp.currency)}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {workspace.bookings.length > 0 && (
              <section className="ts-panel">
                <div className="ts-panel-head">
                  <h3>Booking Summary</h3>
                  <Button type="button" variant="ghost" size="xs" onClick={() => setTab("bookings")}>
                    All ({workspace.bookings.length})
                  </Button>
                </div>
                <div className="ts-overview-act-list">
                  {workspace.bookings.slice(0, 4).map((bk) => (
                    <div key={bk.id} className="ts-overview-act-row">
                      <div className="ts-overview-row-main">
                        <strong>{bk.title}</strong>
                        <small>
                          {bk.provider || bk.category}
                          {bk.bookingReference ? ` · Ref ${bk.bookingReference}` : ""}
                        </small>
                      </div>
                      <span className="ts-status-pill">{bk.bookingStatus}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!hasSecondaryData && (
              <section className="ts-panel">
                <div className="ts-panel-head">
                  <h3>Quick Setup</h3>
                </div>
                <p className="ts-muted-note" style={{ marginBottom: 10 }}>
                  Add budget limits, travel reservations, or documents as your plans come together.
                </p>
                <div className="ts-quick-links">
                  <Button type="button" variant="outline" size="xs" onClick={() => setTab("budget")}>
                    <Wallet size={12} /> Configure budget
                  </Button>
                  {canCreateExpense && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => triggerQuickAction("expenses", "expense")}
                    >
                      <Receipt size={12} /> Log expense
                    </Button>
                  )}
                  {canEditTrip && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => triggerQuickAction("bookings", "booking")}
                    >
                      <Ticket size={12} /> Add booking
                    </Button>
                  )}
                </div>
              </section>
            )}
          </aside>
        </div>
      )}

      {/* TAB 2 & 3: ITINERARY (with Timeline | Day | Route Map) & TASKS */}
      {(tab === "itinerary" || tab === "tasks") && (
        <TripItineraryAndTasks
          mode={tab}
          user={user}
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
          notify={notify}
          initialItineraryView={tab === "itinerary" ? pendingItineraryView : null}
          onItineraryViewHandled={() => setPendingItineraryView(null)}
          initialOpenModal={
            tab === "tasks" && quickModal === "task"
              ? "task"
              : tab === "itinerary" && quickModal === "activity"
                ? "activity"
                : null
          }
          onModalHandled={() => setQuickModal(null)}
        />
      )}

      {/* TAB 4 & 5: EXPENSES & BUDGET */}
      {(tab === "expenses" || tab === "budget") && (
        <TripFinanceTabs
          mode={tab}
          user={user}
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
          onSaveVaultItem={onSaveVaultItem}
          notify={notify}
          initialOpenExpenseModal={tab === "expenses" && quickModal === "expense"}
          onModalHandled={() => setQuickModal(null)}
        />
      )}

      {/* TAB 6, 7, 8: BOOKINGS, TRAVELLERS, DOCUMENTS */}
      {(tab === "bookings" || tab === "travellers" || tab === "documents") && (
        <TripOrganizationTabs
          mode={tab}
          user={user}
          workspace={workspace}
          vaultItems={vaultItems}
          contacts={contacts}
          onOpenVaultItem={onOpenVaultItem}
          onWorkspaceChange={onWorkspaceChange}
          notify={notify}
          initialOpenModal={
            (tab === "bookings" && quickModal === "booking") ||
            (tab === "documents" && quickModal === "document")
          }
          onModalHandled={() => setQuickModal(null)}
        />
      )}

      {/* TAB 9: MEMORIES & TRAVEL JOURNAL */}
      {tab === "memories" && (
        <TripMemoriesTab
          user={user}
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
          notify={notify}
        />
      )}

      {editTripOpen && (
        <CreateTripDialog
          user={user}
          contacts={contacts}
          existingWorkspace={workspace}
          onClose={() => setEditTripOpen(false)}
          onSubmit={async (payload, coverFile, options) => {
            let ws = await updateTrip(user, workspace.trip.id, payload);
            if (coverFile) {
              ws = await uploadTripAttachment(user, workspace.trip.id, "cover", coverFile, undefined, {
                onProgress: (p) => options?.onUploadProgress?.(p.percent),
              });
            } else if (options?.removeCover) {
              ws = await removeTripCover(user, workspace.trip.id);
            }
            onWorkspaceChange(ws);
            setEditTripOpen(false);
            notify("Trip details updated.");
          }}
        />
      )}

      {completeFlowOpen && (
        <CompleteTripModal
          user={user}
          workspace={workspace}
          onSaveTimelineEvent={onSaveTimelineEvent}
          onClose={() => setCompleteFlowOpen(false)}
          onCompleted={(ws) => {
            onWorkspaceChange(ws);
            setCompleteFlowOpen(false);
            setTab("memories");
          }}
          notify={notify}
        />
      )}

      <PersoraDeleteModal
        open={deleteModalOpen}
        eyebrow="Move Trip to Trash"
        title={`Move "${workspace.trip.title}" to Trash?`}
        description="This trip and all its plans, expenses, and documents can be restored from the Persora 7-day Trash."
        confirmLabel="Move to Trash"
        cancelLabel="Cancel"
        busy={deleting}
        danger
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={() => void confirmDeleteTrip()}
      />
    </div>
  );
}
