import { Calendar, Copy, MapPin, Pencil, Trash2, Users, Wallet } from "lucide-react";
import MoreOptionsMenu, { type MoreMenuAction } from "../MoreOptionsMenu";
import { canRolePerform, formatTravelMoney, type TripStatus } from "../../../cloudflare/travel-space-rules.js";
import type { TravelTripSummary } from "../../lib/travel-space-api";
import type { AppUser } from "../../types";
import { TripCoverMedia } from "./TripCoverMedia";

export interface TripCardProps {
  user: AppUser;
  trip: TravelTripSummary;
  mode: "grid" | "list";
  onOpen: (tripId: string) => void;
  onEdit?: (trip: TravelTripSummary) => void;
  onDuplicate?: (trip: TravelTripSummary) => void;
  onDelete?: (trip: TravelTripSummary) => void;
}

const STATUS_LABELS: Record<TripStatus, string> = {
  planning: "Planning",
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function formatCompactTripDateRange(startDate: string, endDate: string, durationDays?: number): string {
  if (!startDate || !endDate) return startDate || endDate || "";
  try {
    const start = new Date(`${startDate}T12:00:00Z`);
    const end = new Date(`${endDate}T12:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return `${startDate} – ${endDate}`;
    }
    const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
    const startFmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: "UTC",
    }).format(start);
    const endFmt = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(end);
    const days = durationDays && durationDays > 0 ? ` · ${durationDays}d` : "";
    return `${startFmt} – ${endFmt}${days}`;
  } catch {
    return `${startDate} – ${endDate}`;
  }
}

export function TripCard({
  user,
  trip,
  mode,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
}: TripCardProps) {
  const canEdit = canRolePerform(trip.myRole, "edit_trip");
  const canDelete = canRolePerform(trip.myRole, "delete_trip");

  const menuItems: MoreMenuAction[] = [
    ...(onEdit && canEdit
      ? [
          {
            label: "Edit trip",
            icon: Pencil,
            onSelect: () => onEdit(trip),
          },
        ]
      : []),
    ...(onDuplicate
      ? [
          {
            label: "Duplicate trip",
            icon: Copy,
            onSelect: () => onDuplicate(trip),
          },
        ]
      : []),
    ...(onDelete && canDelete
      ? [
          {
            label: "Delete trip",
            icon: Trash2,
            danger: true,
            onSelect: () => onDelete(trip),
          },
        ]
      : []),
  ];

  const stopCount = trip.destinations?.length || 0;
  const planned = Number(trip.plannedBudget || 0);
  const spent = Number(trip.totalSpent || 0);
  const showBudget = trip.budgetScope !== "none" && (planned > 0 || spent > 0);

  const travellerLabel =
    trip.companionType === "solo" && trip.travelerCount <= 1
      ? "Solo"
      : `${trip.travelerCount} ${trip.travelerCount === 1 ? "traveller" : "travellers"}`;

  const destinationLabel =
    stopCount === 0
      ? "No stops yet"
      : `${stopCount} ${stopCount === 1 ? "destination" : "destinations"}`;

  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-stop-card-open]")) return;
    onOpen(trip.id);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(trip.id);
    }
  };

  return (
    <article
      className={`ts-trip-card ${mode === "list" ? "is-list" : "is-grid"}`}
      role="link"
      tabIndex={0}
      aria-label={`Open ${trip.title}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="ts-trip-card-media-wrap">
        <TripCoverMedia
          user={user}
          trip={trip}
          compact={mode === "list"}
          className="ts-trip-card-cover"
          alt={`${trip.title} cover`}
        >
          <span className={`ts-trip-status ts-status-${trip.status}`}>
            {STATUS_LABELS[trip.status] || trip.status}
          </span>
        </TripCoverMedia>
      </div>

      <div className="ts-trip-card-body">
        <div className="ts-trip-card-top">
          <h3 className="ts-trip-card-title" title={trip.title}>
            {trip.title}
          </h3>
          {menuItems.length > 0 && (
            <div className="ts-trip-card-actions" data-stop-card-open="true">
              <MoreOptionsMenu
                label={`More actions for ${trip.title}`}
                actions={menuItems}
                iconOrientation="horizontal"
              />
            </div>
          )}
        </div>

        <div className="ts-trip-card-dates ts-num">
          <Calendar size={12.5} />
          <span>{formatCompactTripDateRange(trip.startDate, trip.endDate, trip.durationDays)}</span>
        </div>

        <div className="ts-trip-card-meta">
          <span className="ts-trip-meta-item">
            <MapPin size={12} />
            <span>{destinationLabel}</span>
          </span>
          <span className="ts-trip-meta-dot" aria-hidden="true">·</span>
          <span className="ts-trip-meta-item">
            <Users size={12} />
            <span>{travellerLabel}</span>
          </span>
          {showBudget && (
            <>
              <span className="ts-trip-meta-dot" aria-hidden="true">·</span>
              <span className="ts-trip-meta-item ts-num ts-trip-meta-budget">
                <Wallet size={12} />
                <span>
                  {planned > 0
                    ? `${formatTravelMoney(spent, trip.primaryCurrency)} / ${formatTravelMoney(planned, trip.primaryCurrency)}`
                    : formatTravelMoney(spent, trip.primaryCurrency)}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
