import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Compass,
  ExternalLink,
  Heart,
  LayoutGrid,
  List,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import "./travel-space.css";
import PageToolbar from "../page-toolbar/PageToolbar";
import ModalPortal from "../ModalPortal";
import {
  Button,
  PersoraDeleteModal,
  PersoraEmptyState,
  PersoraSearchField,
  Spinner,
} from "@/design-system";
import {
  EXPLORE_KINDS,
  EXPLORE_STATUSES,
  TRAVEL_CURRENCIES,
  TRIP_STATUSES,
  formatCoordinatePair,
  formatTravelMoney,
  isValidCoordinatePair,
  parseGoogleMapsInput,
  searchCuratedDestinations,
  type ExploreKind,
  type ExploreStatus,
  type TripStatus,
} from "../../../cloudflare/travel-space-rules.js";
import {
  addExplorePlaceToItinerary,
  addExplorePlaceToTrip,
  createTrip,
  deleteExplorePlace,
  deleteTrip,
  describeTravelError,
  duplicateTrip,
  getDestinationStopLabel,
  loadTravelBootstrap,
  loadTripWorkspace,
  removeTripCover,
  saveExplorePlace,
  updateTrip,
  uploadTripAttachment,
  type TravelBootstrap,
  type TravelExplorePlace,
  type TravelTripSummary,
  type TravelWorkspace,
} from "../../lib/travel-space-api";
import type { AppUser, PersoraContact, TimelineDraft, VaultItem } from "../../types";
import CreateTripDialog from "./CreateTripDialog";
import { TravelInteractiveMap } from "./TravelInteractiveMap";
import { TripCard } from "./TripCard";
import TripWorkspace from "./TripWorkspace";

type MainSection = "my-trips" | "explore";

interface Props {
  user: AppUser;
  items: VaultItem[];
  contacts: PersoraContact[];
  onOpenVaultItem?: (item: VaultItem) => void;
  onSaveVaultItem?: (draft: Omit<VaultItem, "id" | "createdAt" | "updatedAt"> & { id?: string }) => Promise<VaultItem | void>;
  onSaveTimelineEvent?: (draft: TimelineDraft) => Promise<void>;
  onTrashChanged?: () => void;
  notify: (msg: string, kind?: "success" | "error") => void;
}

const EXPLORE_STATUS_LABELS: Record<ExploreStatus, string> = {
  want_to_visit: "Want to Visit",
  planned: "Planned",
  visited: "Visited",
};

const FILTER_STATUS_LABELS: Record<TripStatus, string> = {
  planning: "Planning",
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function TravelSpaceView({
  user,
  items,
  contacts,
  onOpenVaultItem,
  onSaveVaultItem,
  onSaveTimelineEvent,
  onTrashChanged,
  notify,
}: Props) {
  const [section, setSection] = useState<MainSection>("my-trips");
  const [bootstrap, setBootstrap] = useState<TravelBootstrap>({
    trips: [],
    explorePlaces: [],
    upcomingActivities: [],
    recentExpenses: [],
  });
  const [loading, setLoading] = useState(true);
  const [activeWorkspace, setActiveWorkspace] = useState<TravelWorkspace | null>(null);
  const [createTripOpen, setCreateTripOpen] = useState(false);
  const [editingDashboardWorkspace, setEditingDashboardWorkspace] = useState<TravelWorkspace | null>(null);
  const [deletingDashboardTrip, setDeletingDashboardTrip] = useState<TravelTripSummary | null>(null);

  // My Trips controls (client-side search, status filter, sort, grid/list layout)
  const [tripStatusFilter, setTripStatusFilter] = useState<"all" | TripStatus>("all");
  const [tripViewMode, setTripViewMode] = useState<"grid" | "list">("grid");
  const [tripSearch, setTripSearch] = useState("");
  const [tripSort, setTripSort] = useState<"start_date" | "created" | "status" | "budget">("start_date");

  // Explore controls
  const [exploreStatusFilter, setExploreStatusFilter] = useState<"all" | ExploreStatus>("all");
  const [exploreCountryFilter, setExploreCountryFilter] = useState<string>("all");
  const [exploreSearch, setExploreSearch] = useState("");
  const [exploreModalOpen, setExploreModalOpen] = useState(false);
  const [editingPlace, setEditingPlace] = useState<TravelExplorePlace | null>(null);

  const syncUrlTripParam = useCallback((tripId: string | null) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "travel-space");
      if (tripId) url.searchParams.set("trip", tripId);
      else url.searchParams.delete("trip");
      window.history.replaceState({}, "", `${url.pathname}?${url.searchParams.toString()}`);
    } catch {
      // Ignore history API errors
    }
  }, []);

  const userRef = useRef(user);
  userRef.current = user;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const bootstrappedUserKeyRef = useRef<string | null>(null);

  const refreshBootstrap = useCallback(async () => {
    try {
      const data = await loadTravelBootstrap(userRef.current);
      setBootstrap(data);
    } catch (err: any) {
      notifyRef.current(err?.message || "Could not load TravelSpace.", "error");
    }
  }, []);

  const userKey = `${user.id}:${Boolean(user.demo)}`;
  useEffect(() => {
    let active = true;
    const isNewUser = bootstrappedUserKeyRef.current !== userKey;
    (async () => {
      if (isNewUser) setLoading(true);
      try {
        const data = await loadTravelBootstrap(userRef.current);
        if (!active) return;
        setBootstrap(data);
        bootstrappedUserKeyRef.current = userKey;

        const initialTripId = new URLSearchParams(window.location.search).get("trip");
        if (initialTripId) {
          const ws = await loadTripWorkspace(userRef.current, initialTripId).catch(() => null);
          if (active && ws) setActiveWorkspace(ws);
        }
      } catch (err: any) {
        if (active) notifyRef.current(err?.message || "Could not load TravelSpace.", "error");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userKey]);

  const openTrip = async (tripId: string) => {
    try {
      const ws = await loadTripWorkspace(user, tripId);
      setActiveWorkspace(ws);
      syncUrlTripParam(ws.trip.id);
    } catch (err: any) {
      notify(err?.message || "Could not open trip workspace.", "error");
    }
  };

  const closeTrip = () => {
    setActiveWorkspace(null);
    syncUrlTripParam(null);
    void refreshBootstrap();
  };

  const handleEditTripFromCard = async (trip: TravelTripSummary) => {
    try {
      const ws = await loadTripWorkspace(user, trip.id);
      setEditingDashboardWorkspace(ws);
    } catch (err) {
      notify(describeTravelError(err, "Could not load trip details for editing."), "error");
    }
  };

  const handleDuplicateTrip = async (trip: TravelTripSummary) => {
    try {
      const duplicated = await duplicateTrip(user, trip.id);
      await refreshBootstrap();
      notify(`Duplicated "${duplicated.trip.title}".`);
    } catch (err) {
      notify(describeTravelError(err, "Could not duplicate trip."), "error");
    }
  };

  const handleConfirmDeleteDashboardTrip = async () => {
    if (!deletingDashboardTrip) return;
    const target = deletingDashboardTrip;
    setDeletingDashboardTrip(null);
    try {
      await deleteTrip(user, target.id);
      onTrashChanged?.();
      await refreshBootstrap();
      notify(`"${target.title}" moved to Trash (recoverable for 7 days).`);
    } catch (err) {
      notify(describeTravelError(err, "Could not delete trip."), "error");
    }
  };

  const counts = useMemo(() => {
    const t = bootstrap.trips;
    const statusMap: Record<TripStatus, number> = {
      planning: 0,
      upcoming: 0,
      ongoing: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const trip of t) {
      if (statusMap[trip.status] !== undefined) statusMap[trip.status] += 1;
    }
    return {
      total: t.length,
      upcoming: statusMap.upcoming + statusMap.planning,
      ongoing: statusMap.ongoing,
      completed: statusMap.completed,
      savedPlaces: bootstrap.explorePlaces.length,
      byStatus: statusMap,
    };
  }, [bootstrap]);

  const filteredTrips = useMemo(() => {
    const q = tripSearch.trim().toLowerCase();
    const list = bootstrap.trips.filter((t) => {
      if (tripStatusFilter !== "all" && t.status !== tripStatusFilter) return false;
      if (!q) return true;
      const inTitle = t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
      const inDest = t.destinations.some(
        (d, idx) =>
          getDestinationStopLabel(d, idx).toLowerCase().includes(q) ||
          formatCoordinatePair(d.latitude, d.longitude).includes(q),
      );
      return inTitle || inDest;
    });

    list.sort((a, b) => {
      if (tripSort === "created") return b.createdAt.localeCompare(a.createdAt);
      if (tripSort === "status") return a.status.localeCompare(b.status);
      if (tripSort === "budget") return (b.plannedBudget || 0) - (a.plannedBudget || 0);
      return a.startDate.localeCompare(b.startDate);
    });
    return list;
  }, [bootstrap.trips, tripStatusFilter, tripSearch, tripSort]);

  const exploreCountries = useMemo(() => {
    const set = new Set<string>();
    bootstrap.explorePlaces.forEach((p) => {
      if (p.country) set.add(p.country);
    });
    return [...set].sort();
  }, [bootstrap.explorePlaces]);

  const filteredExplore = useMemo(() => {
    const q = exploreSearch.trim().toLowerCase();
    return bootstrap.explorePlaces.filter((p) => {
      if (exploreStatusFilter !== "all" && p.status !== exploreStatusFilter) return false;
      if (exploreCountryFilter !== "all" && p.country !== exploreCountryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.country.toLowerCase().includes(q) ||
        p.notes.toLowerCase().includes(q)
      );
    });
  }, [bootstrap.explorePlaces, exploreStatusFilter, exploreCountryFilter, exploreSearch]);

  const exploreMapDestinations = useMemo(
    () =>
      filteredExplore
        .filter((p) => isValidCoordinatePair(p.latitude, p.longitude))
        .map((p, idx) => ({
          id: p.id,
          latitude: p.latitude!,
          longitude: p.longitude!,
          orderIndex: idx,
        })),
    [filteredExplore],
  );

  const curatedMatches = useMemo(() => {
    if (!exploreSearch.trim()) return [];
    return searchCuratedDestinations(exploreSearch).slice(0, 6);
  }, [exploreSearch]);

  const urlManagerItems = useMemo(
    () => items.filter((i) => i.section === "urls"),
    [items],
  );

  const hasActiveFilters = tripStatusFilter !== "all" || Boolean(tripSearch.trim());

  return (
    <>
      <PageToolbar
        label="TravelSpace"
        start={
          activeWorkspace ? (
            <span className="ts-toolbar-crumb">
              <button type="button" className="ts-toolbar-crumb-btn" onClick={closeTrip}>
                My Trips
              </button>
              <span aria-hidden="true">/</span>
              <span className="ts-toolbar-crumb-current">{activeWorkspace.trip.title}</span>
            </span>
          ) : (
            <div className="ts-segmented" role="tablist" aria-label="TravelSpace sections">
              <button
                type="button"
                role="tab"
                aria-selected={section === "my-trips"}
                className={section === "my-trips" ? "is-active" : ""}
                onClick={() => setSection("my-trips")}
              >
                My Trips ({counts.total})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={section === "explore"}
                className={section === "explore" ? "is-active" : ""}
                onClick={() => setSection("explore")}
              >
                Explore ({counts.savedPlaces})
              </button>
            </div>
          )
        }
      />

      <div className="ts-root">
        {loading ? (
          <div className="medical-loading">
            <Spinner className="size-4 text-primary" /> Loading TravelSpace…
          </div>
        ) : activeWorkspace ? (
          <TripWorkspace
            user={user}
            workspace={activeWorkspace}
            vaultItems={items}
            contacts={contacts}
            onWorkspaceChange={(ws) => {
              setActiveWorkspace(ws);
              void refreshBootstrap();
            }}
            onBack={closeTrip}
            onTripDuplicated={(dupWs) => {
              setActiveWorkspace(dupWs);
              syncUrlTripParam(dupWs.trip.id);
              void refreshBootstrap();
            }}
            onTripDeleted={() => {
              onTrashChanged?.();
              closeTrip();
            }}
            onOpenVaultItem={onOpenVaultItem}
            onSaveVaultItem={onSaveVaultItem}
            onSaveTimelineEvent={onSaveTimelineEvent}
            notify={notify}
          />
        ) : section === "my-trips" ? (
          <div className="ts-dashboard">
            {/* Clean Persora Dashboard Header */}
            <header className="ts-dashboard-header">
              <div className="ts-title-group">
                <h1 className="ts-title">TravelSpace</h1>
                <p className="ts-subtitle">
                  Plan journeys, coordinate shared budgets, and organize itineraries, bookings, and memories in one calm workspace.
                </p>
              </div>
              <div className="ts-dashboard-header-actions">
                <PersoraSearchField
                  value={tripSearch}
                  onChange={setTripSearch}
                  placeholder="Search trips or coordinates…"
                  aria-label="Search trips"
                  className="ts-dashboard-search"
                />
                <div className="ts-view-toggle" role="group" aria-label="View layout">
                  <button
                    type="button"
                    className={tripViewMode === "grid" ? "is-active" : ""}
                    onClick={() => setTripViewMode("grid")}
                    aria-label="Grid view"
                    aria-pressed={tripViewMode === "grid"}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    type="button"
                    className={tripViewMode === "list" ? "is-active" : ""}
                    onClick={() => setTripViewMode("list")}
                    aria-label="List view"
                    aria-pressed={tripViewMode === "list"}
                  >
                    <List size={14} />
                  </button>
                </div>
                <Button type="button" variant="default" onClick={() => setCreateTripOpen(true)}>
                  <Plus size={14} />
                  <span>Create Trip</span>
                </Button>
              </div>
            </header>

            {/* Compact Overview Summary Strip (no oversized stat cards) */}
            <section className="ts-summary-strip" aria-label="Trip overview summary">
              <button
                type="button"
                className={`ts-summary-metric ${tripStatusFilter === "all" ? "is-active" : ""}`}
                onClick={() => setTripStatusFilter("all")}
              >
                <span className="ts-summary-label">Total trips</span>
                <strong className="ts-summary-value ts-num">{counts.total}</strong>
              </button>
              <div className="ts-summary-divider" aria-hidden="true" />
              <button
                type="button"
                className={`ts-summary-metric ${tripStatusFilter === "upcoming" || tripStatusFilter === "planning" ? "is-active" : ""}`}
                onClick={() =>
                  setTripStatusFilter(counts.byStatus.upcoming > 0 ? "upcoming" : "planning")
                }
              >
                <span className="ts-summary-label">Upcoming</span>
                <strong className="ts-summary-value ts-num">{counts.upcoming}</strong>
              </button>
              <div className="ts-summary-divider" aria-hidden="true" />
              <button
                type="button"
                className={`ts-summary-metric ${tripStatusFilter === "ongoing" ? "is-active" : ""}`}
                onClick={() => setTripStatusFilter("ongoing")}
              >
                <span className="ts-summary-label">Ongoing</span>
                <strong className="ts-summary-value ts-num">{counts.ongoing}</strong>
              </button>
              <div className="ts-summary-divider" aria-hidden="true" />
              <button
                type="button"
                className={`ts-summary-metric ${tripStatusFilter === "completed" ? "is-active" : ""}`}
                onClick={() => setTripStatusFilter("completed")}
              >
                <span className="ts-summary-label">Completed</span>
                <strong className="ts-summary-value ts-num">{counts.completed}</strong>
              </button>
            </section>

            {/* My Trips Controls & Trip Collection */}
            {bootstrap.trips.length === 0 ? (
              <PersoraEmptyState
                stacked
                icon={<Compass size={20} />}
                tone="blue"
                title="No trips planned yet"
                description="Create a solo or group trip to manage routes, itineraries, shared budgets, bookings, travel documents, and memories."
                action={
                  <Button type="button" variant="default" onClick={() => setCreateTripOpen(true)}>
                    <Plus size={14} />
                    <span>Create Trip</span>
                  </Button>
                }
              />
            ) : (
              <section className="ts-my-trips-section" aria-label="My Trips">
                <div className="ts-controls-bar">
                  <div className="ts-filter-pills" role="tablist" aria-label="Trip status filter">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tripStatusFilter === "all"}
                      className={`ts-filter-pill ${tripStatusFilter === "all" ? "is-active" : ""}`}
                      onClick={() => setTripStatusFilter("all")}
                    >
                      <span>All</span>
                      <span className="ts-filter-count ts-num">{counts.total}</span>
                    </button>
                    {TRIP_STATUSES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        role="tab"
                        aria-selected={tripStatusFilter === st}
                        className={`ts-filter-pill ${tripStatusFilter === st ? "is-active" : ""}`}
                        onClick={() => setTripStatusFilter(st)}
                      >
                        <span>{FILTER_STATUS_LABELS[st]}</span>
                        {counts.byStatus[st] > 0 && (
                          <span className="ts-filter-count ts-num">{counts.byStatus[st]}</span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="ts-controls-right">
                    <select
                      aria-label="Sort trips"
                      className="ts-select ts-sort-select"
                      value={tripSort}
                      onChange={(e) => setTripSort(e.target.value as any)}
                    >
                      <option value="start_date">Sort: Start date</option>
                      <option value="created">Sort: Recently created</option>
                      <option value="status">Sort: Status</option>
                      <option value="budget">Sort: Budget</option>
                    </select>
                  </div>
                </div>

                {filteredTrips.length === 0 ? (
                  <PersoraEmptyState
                    compact
                    icon={<Compass size={18} />}
                    tone="neutral"
                    title="No matching trips"
                    description="No trips match the active search or status filter."
                    action={
                      hasActiveFilters ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setTripStatusFilter("all");
                            setTripSearch("");
                          }}
                        >
                          Reset filters
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <div className={tripViewMode === "grid" ? "ts-trips-grid" : "ts-trips-list"}>
                    {filteredTrips.map((trip) => (
                      <TripCard
                        key={trip.id}
                        user={user}
                        trip={trip}
                        mode={tripViewMode}
                        onOpen={(id) => void openTrip(id)}
                        onEdit={(t) => void handleEditTripFromCard(t)}
                        onDuplicate={(t) => void handleDuplicateTrip(t)}
                        onDelete={(t) => setDeletingDashboardTrip(t)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        ) : (
          /* ============================================================== */
          /* EXPLORE & SAVED DESTINATIONS                                   */
          /* ============================================================== */
          <div className="ts-dashboard">
            <header className="ts-dashboard-header">
              <div className="ts-title-group">
                <h2 className="ts-title">Explore &amp; Saved Destinations</h2>
                <p className="ts-subtitle">
                  Save places you want to visit, organize research links, and add saved spots directly to any trip route or itinerary.
                </p>
              </div>
              <div className="ts-dashboard-header-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateTripOpen(true)}
                >
                  <Plus size={14} />
                  <span>Create Trip</span>
                </Button>
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    setEditingPlace(null);
                    setExploreModalOpen(true);
                  }}
                >
                  <Plus size={14} />
                  <span>Save Place</span>
                </Button>
              </div>
            </header>

            <div className="ts-controls-bar">
              <div className="ts-filter-pills">
                <button
                  type="button"
                  className={`ts-filter-pill ${exploreStatusFilter === "all" ? "is-active" : ""}`}
                  onClick={() => setExploreStatusFilter("all")}
                >
                  <span>All</span>
                  <span className="ts-filter-count ts-num">{bootstrap.explorePlaces.length}</span>
                </button>
                {EXPLORE_STATUSES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`ts-filter-pill ${exploreStatusFilter === st ? "is-active" : ""}`}
                    onClick={() => setExploreStatusFilter(st)}
                  >
                    <span>{EXPLORE_STATUS_LABELS[st]}</span>
                  </button>
                ))}
              </div>

              <div className="ts-controls-right">
                <PersoraSearchField
                  value={exploreSearch}
                  onChange={setExploreSearch}
                  placeholder="Search saved or curated places…"
                  aria-label="Search saved places"
                  className="ts-dashboard-search"
                />
                {exploreCountries.length > 0 && (
                  <select
                    className="ts-select ts-sort-select"
                    value={exploreCountryFilter}
                    onChange={(e) => setExploreCountryFilter(e.target.value)}
                  >
                    <option value="all">All countries</option>
                    {exploreCountries.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {curatedMatches.length > 0 && (
              <div className="ts-panel">
                <div className="ts-panel-head">
                  <h3>
                    <Sparkles size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />
                    Directory Suggestions
                  </h3>
                </div>
                <div className="ts-chip-list">
                  {curatedMatches.map((item) => (
                    <button
                      key={`${item.name}-${item.country}`}
                      type="button"
                      className="ts-btn ts-btn-sm"
                      onClick={async () => {
                        try {
                          await saveExplorePlace(user, {
                            name: item.name,
                            city: item.city,
                            country: item.country,
                            latitude: item.latitude,
                            longitude: item.longitude,
                            kind: item.placeType === "place" ? "attraction" : "destination",
                            status: "want_to_visit",
                          });
                          await refreshBootstrap();
                          setExploreSearch("");
                          notify(`Saved ${item.name} to Explore wishlist.`);
                        } catch (err) {
                          notify(describeTravelError(err, "Could not save place."), "error");
                        }
                      }}
                    >
                      + Save {item.name}, {item.country}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {exploreMapDestinations.length > 0 && (
              <div className="ts-panel">
                <div className="ts-panel-head">
                  <h3>Explore Map Preview</h3>
                  <small style={{ color: "var(--ds-text-muted)" }}>
                    Saved wishlist places with pinned coordinates
                  </small>
                </div>
                <TravelInteractiveMap
                  user={user}
                  variant="compact"
                  destinations={exploreMapDestinations}
                  height={200}
                />
              </div>
            )}

            {filteredExplore.length === 0 ? (
              <PersoraEmptyState
                stacked={bootstrap.explorePlaces.length === 0}
                compact={bootstrap.explorePlaces.length > 0}
                tone="blue"
                icon={<Compass size={18} />}
                title="No saved places yet"
                description='Click "Save Place" or search above to build your travel wishlist.'
              />
            ) : (
              <div className="ts-trips-grid">
                {filteredExplore.map((place) => (
                  <div key={place.id} className="ts-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <small style={{ color: "var(--ds-text-muted)", fontWeight: 600 }}>
                          {place.kind.toUpperCase()}
                          {place.country ? ` · ${place.country.toUpperCase()}` : ""}
                        </small>
                        <h4 style={{ margin: "2px 0 0", fontSize: 14.5 }}>{place.name}</h4>
                      </div>
                      <button
                        type="button"
                        className="ts-btn ts-btn-sm"
                        onClick={async () => {
                          await saveExplorePlace(user, { favorite: !place.favorite }, place.id);
                          await refreshBootstrap();
                        }}
                        aria-label="Toggle favourite"
                      >
                        <Heart
                          size={12}
                          fill={place.favorite ? "#dc2626" : "none"}
                          color={place.favorite ? "#dc2626" : "currentColor"}
                        />
                      </button>
                    </div>

                    <div className="ts-meta-row">
                      <span className="ts-status-pill">{EXPLORE_STATUS_LABELS[place.status]}</span>
                      {place.city && <span>{place.city}</span>}
                      {isValidCoordinatePair(place.latitude, place.longitude) && (
                        <span>
                          <MapPin size={11} /> {formatCoordinatePair(place.latitude!, place.longitude!, 3)}
                        </span>
                      )}
                      {place.estimatedCost !== null && (
                        <span>Est. {formatTravelMoney(place.estimatedCost, place.currency)}</span>
                      )}
                    </div>

                    {place.notes && (
                      <div style={{ fontSize: 12.5, color: "var(--ds-text-secondary)" }}>{place.notes}</div>
                    )}

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
                      {place.referenceUrl && (
                        <a
                          href={place.referenceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ts-btn ts-btn-sm"
                          style={{ textDecoration: "none" }}
                        >
                          <ExternalLink size={11} /> Reference
                        </a>
                      )}

                      {bootstrap.trips.length > 0 && (
                        <>
                          <select
                            aria-label={`Add ${place.name} to trip destinations`}
                            className="ts-select"
                            style={{ height: 28, fontSize: 11.5, width: "auto", padding: "2px 6px" }}
                            value=""
                            onChange={async (e) => {
                              const tid = e.target.value;
                              if (!tid) return;
                              try {
                                await addExplorePlaceToTrip(user, place.id, tid);
                                await refreshBootstrap();
                                notify(`Added ${place.name} to trip map stops.`);
                              } catch (err) {
                                notify(describeTravelError(err, "Could not add stop to trip."), "error");
                              }
                            }}
                          >
                            <option value="">+ Add to Trip…</option>
                            {bootstrap.trips.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.title}
                              </option>
                            ))}
                          </select>

                          <select
                            aria-label={`Add ${place.name} to trip itinerary`}
                            className="ts-select"
                            style={{ height: 28, fontSize: 11.5, width: "auto", padding: "2px 6px" }}
                            value=""
                            onChange={async (e) => {
                              const tid = e.target.value;
                              if (!tid) return;
                              try {
                                await addExplorePlaceToItinerary(user, place.id, tid);
                                await refreshBootstrap();
                                notify(`Added ${place.name} to trip itinerary.`);
                              } catch (err) {
                                notify(describeTravelError(err, "Could not add to itinerary."), "error");
                              }
                            }}
                          >
                            <option value="">+ Add to Itinerary…</option>
                            {bootstrap.trips.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.title}
                              </option>
                            ))}
                          </select>
                        </>
                      )}

                      <button
                        type="button"
                        className="ts-btn ts-btn-sm"
                        onClick={() => {
                          setEditingPlace(place);
                          setExploreModalOpen(true);
                        }}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="ts-btn ts-btn-sm ts-btn-danger"
                        onClick={async () => {
                          await deleteExplorePlace(user, place.id);
                          await refreshBootstrap();
                          notify("Removed saved place.");
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Trip Dialog */}
      {createTripOpen && (
        <CreateTripDialog
          user={user}
          contacts={contacts}
          onClose={() => setCreateTripOpen(false)}
          onSubmit={async (payload, coverFile, options) => {
            let ws = await createTrip(user, payload);
            let coverUploadErr: string | null = null;
            if (coverFile) {
              try {
                ws = await uploadTripAttachment(user, ws.trip.id, "cover", coverFile, undefined, {
                  onProgress: (p) => options?.onUploadProgress?.(p.percent),
                });
              } catch (err) {
                coverUploadErr = describeTravelError(err, "Cover image could not be uploaded.");
              }
            }
            setCreateTripOpen(false);
            setActiveWorkspace(ws);
            syncUrlTripParam(ws.trip.id);
            await refreshBootstrap();
            if (coverUploadErr) {
              notify(`Trip "${ws.trip.title}" created, but cover upload failed: ${coverUploadErr}`, "error");
            } else {
              notify(`Created trip "${ws.trip.title}".`);
            }
          }}
        />
      )}

      {/* Edit Trip Directly from Dashboard Card */}
      {editingDashboardWorkspace && (
        <CreateTripDialog
          user={user}
          contacts={contacts}
          existingWorkspace={editingDashboardWorkspace}
          onClose={() => setEditingDashboardWorkspace(null)}
          onSubmit={async (payload, coverFile, options) => {
            const targetId = editingDashboardWorkspace.trip.id;
            let ws = await updateTrip(user, targetId, payload);
            if (coverFile) {
              ws = await uploadTripAttachment(user, targetId, "cover", coverFile, undefined, {
                onProgress: (p) => options?.onUploadProgress?.(p.percent),
              });
            } else if (options?.removeCover) {
              ws = await removeTripCover(user, targetId);
            }
            setEditingDashboardWorkspace(null);
            await refreshBootstrap();
            notify(`Updated "${ws.trip.title}".`);
          }}
        />
      )}

      {/* Delete Trip Confirmation from Dashboard Card */}
      <PersoraDeleteModal
        open={Boolean(deletingDashboardTrip)}
        eyebrow="Move Trip to Trash"
        title={deletingDashboardTrip ? `Delete "${deletingDashboardTrip.title}"?` : "Delete trip?"}
        description="The trip and all itineraries, tasks, expenses, bookings, documents, and memories will move to Persora Trash for 7 days."
        confirmLabel="Move to Trash"
        cancelLabel="Cancel"
        danger
        onCancel={() => setDeletingDashboardTrip(null)}
        onConfirm={() => void handleConfirmDeleteDashboardTrip()}
      />

      {exploreModalOpen && (
        <ExplorePlaceModal
          user={user}
          trips={bootstrap.trips}
          urlManagerItems={urlManagerItems}
          editingPlace={editingPlace}
          onClose={() => {
            setExploreModalOpen(false);
            setEditingPlace(null);
          }}
          onSaved={async () => {
            setExploreModalOpen(false);
            setEditingPlace(null);
            await refreshBootstrap();
            notify("Saved destination to Explore.");
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function ExplorePlaceModal({
  user,
  trips,
  urlManagerItems,
  editingPlace,
  onClose,
  onSaved,
  notify,
}: {
  user: AppUser;
  trips: TravelTripSummary[];
  urlManagerItems: VaultItem[];
  editingPlace: TravelExplorePlace | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  notify: (msg: string, kind?: "success" | "error") => void;
}) {
  const [name, setName] = useState(editingPlace?.name || "");
  const [kind, setKind] = useState<ExploreKind>(editingPlace?.kind || "destination");
  const [city, setCity] = useState(editingPlace?.city || "");
  const [country, setCountry] = useState(editingPlace?.country || "");
  const [status, setStatus] = useState<ExploreStatus>(editingPlace?.status || "want_to_visit");
  const [tripId, setTripId] = useState(editingPlace?.tripId || "");
  const [estimatedCost, setEstimatedCost] = useState(
    editingPlace?.estimatedCost !== null && editingPlace?.estimatedCost !== undefined
      ? String(editingPlace.estimatedCost)
      : "",
  );
  const [currency, setCurrency] = useState(editingPlace?.currency || "BDT");
  const [referenceUrl, setReferenceUrl] = useState(editingPlace?.referenceUrl || "");
  const [linkedUrlItemId, setLinkedUrlItemId] = useState(editingPlace?.linkedUrlItemId || "");
  const [coordOrUrl, setCoordOrUrl] = useState(() =>
    editingPlace && isValidCoordinatePair(editingPlace.latitude, editingPlace.longitude)
      ? formatCoordinatePair(editingPlace.latitude!, editingPlace.longitude!, 5)
      : "",
  );
  const [notes, setNotes] = useState(editingPlace?.notes || "");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      if (coordOrUrl.trim()) {
        const parsed = parseGoogleMapsInput(coordOrUrl.trim());
        if (!parsed.ok || parsed.latitude === undefined || parsed.longitude === undefined) {
          throw new Error(parsed.message || "Enter valid coordinates or a Google Maps URL.");
        }
        lat = parsed.latitude;
        lng = parsed.longitude;
      } else {
        const hit = searchCuratedDestinations(name.trim() || city.trim())[0];
        if (hit && isValidCoordinatePair(hit.latitude, hit.longitude)) {
          lat = hit.latitude!;
          lng = hit.longitude!;
        }
      }

      await saveExplorePlace(
        user,
        {
          name: name.trim(),
          kind,
          city,
          country,
          status,
          tripId: tripId || null,
          estimatedCost: estimatedCost === "" ? null : Number(estimatedCost),
          currency,
          referenceUrl,
          linkedUrlItemId: linkedUrlItemId || null,
          latitude: lat,
          longitude: lng,
          notes,
        },
        editingPlace?.id,
      );
      await onSaved();
    } catch (err: any) {
      notify(err?.message || "Could not save place.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="ts-modal-backdrop" role="dialog" aria-modal="true" aria-label="Save explore place">
        <form className="ts-modal-card" onSubmit={submit}>
          <div className="ts-modal-head">
            <h3>{editingPlace ? "Edit Saved Place" : "Save Destination / Place"}</h3>
            <button type="button" className="ts-btn ts-btn-sm" onClick={onClose} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="ts-modal-body">
            <div className="ts-field-grid">
              <div className="ts-field">
                <label>Place / Destination Name *</label>
                <input className="ts-input" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="ts-field">
                <label>Place Type</label>
                <select className="ts-select" value={kind} onChange={(e) => setKind(e.target.value as ExploreKind)}>
                  {EXPLORE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>City</label>
                <input className="ts-input" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="ts-field">
                <label>Country</label>
                <input className="ts-input" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
              <div className="ts-field">
                <label>Wishlist Status</label>
                <select className="ts-select" value={status} onChange={(e) => setStatus(e.target.value as ExploreStatus)}>
                  {EXPLORE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {EXPLORE_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Associated Trip (optional)</label>
                <select className="ts-select" value={tripId} onChange={(e) => setTripId(e.target.value)}>
                  <option value="">None</option>
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ts-field">
                <label>Estimated Expense</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="ts-input ts-num"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                />
              </div>
              <div className="ts-field">
                <label>Currency</label>
                <select className="ts-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {TRAVEL_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {urlManagerItems.length > 0 && (
                <div className="ts-field is-full">
                  <label>Link from Persora URL Manager</label>
                  <select
                    className="ts-select"
                    value={linkedUrlItemId}
                    onChange={(e) => {
                      const uidVal = e.target.value;
                      setLinkedUrlItemId(uidVal);
                      const found = urlManagerItems.find((u) => u.id === uidVal);
                      if (found?.metadata?.url) setReferenceUrl(found.metadata.url);
                    }}
                  >
                    <option value="">None</option>
                    {urlManagerItems.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="ts-field is-full">
                <label>Map Coordinates or Google Maps URL (optional)</label>
                <input
                  className="ts-input"
                  placeholder="e.g. 23.8103, 90.4125 or https://www.google.com/maps/place/..."
                  value={coordOrUrl}
                  onChange={(e) => setCoordOrUrl(e.target.value)}
                />
              </div>

              <div className="ts-field is-full">
                <label>Reference URL (blog, guide, map link)</label>
                <input
                  className="ts-input"
                  placeholder="https://…"
                  value={referenceUrl}
                  onChange={(e) => setReferenceUrl(e.target.value)}
                />
              </div>

              <div className="ts-field is-full">
                <label>Notes</label>
                <textarea className="ts-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="ts-modal-foot">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={saving}>
              {saving ? "Saving…" : "Save Place"}
            </Button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}
