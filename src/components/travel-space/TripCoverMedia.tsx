import { useEffect, useState } from "react";
import { Compass, MapPin } from "lucide-react";
import { resolveTripCoverUrl, type TravelTripSummary } from "../../lib/travel-space-api";
import type { AppUser } from "../../types";

export interface TripCoverMediaProps {
  user: AppUser;
  trip?: Pick<
    TravelTripSummary,
    | "id"
    | "title"
    | "hasCover"
    | "coverUpdatedAt"
    | "updatedAt"
    | "localCoverDataUrl"
    | "tripType"
    | "destinations"
  > | null;
  /** Immediate client-side preview URL (e.g. selected file before upload). */
  previewUrl?: string | null;
  /** Force showing the Persora fallback (e.g. when user clicked Remove Cover in Edit mode). */
  forceFallback?: boolean;
  className?: string;
  alt?: string;
  compact?: boolean;
  children?: React.ReactNode;
}

const TRIP_TYPE_FALLBACK_LABEL: Record<string, string> = {
  vacation: "Vacation",
  business: "Business",
  "family-tour": "Family tour",
  educational: "Educational",
  adventure: "Adventure",
  religious: "Religious",
  other: "Journey",
};

export function TripCoverMedia({
  user,
  trip,
  previewUrl,
  forceFallback = false,
  className = "",
  alt,
  compact = false,
  children,
}: TripCoverMediaProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);

  const tripId = trip?.id || "";
  const hasCover = Boolean(trip?.hasCover) && !forceFallback;
  const coverVersion = trip?.coverUpdatedAt || trip?.updatedAt || "";
  const localCoverDataUrl = trip?.localCoverDataUrl || null;

  useEffect(() => {
    setLoadFailed(false);

    if (previewUrl) {
      setResolvedUrl(previewUrl);
      setLoading(false);
      return;
    }

    if (!trip || !hasCover) {
      setResolvedUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    resolveTripCoverUrl(user, {
      id: tripId,
      hasCover: true,
      coverUpdatedAt: coverVersion || null,
      updatedAt: trip.updatedAt,
      localCoverDataUrl,
    })
      .then((url) => {
        if (cancelled) return;
        setResolvedUrl(url);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedUrl(null);
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, user.id, tripId, hasCover, coverVersion, localCoverDataUrl, previewUrl, trip]);

  const activeImageSrc = previewUrl || (!forceFallback && !loadFailed ? resolvedUrl : null);
  const stopCount = trip?.destinations?.length || 0;
  const typeLabel = trip?.tripType ? TRIP_TYPE_FALLBACK_LABEL[trip.tripType] || "Trip" : "TravelSpace";

  return (
    <div
      className={`ts-cover-frame ${compact ? "is-compact" : ""} ${loading ? "is-loading" : ""} ${className}`.trim()}
      data-has-cover={activeImageSrc ? "true" : "false"}
    >
      {activeImageSrc ? (
        <img
          src={activeImageSrc}
          alt={alt || (trip?.title ? `${trip.title} cover` : "Trip cover")}
          className="ts-cover-img"
          loading="lazy"
          decoding="async"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <div className="ts-cover-fallback" aria-hidden="true">
          <svg
            className="ts-cover-fallback-svg"
            viewBox="0 0 320 180"
            fill="none"
            preserveAspectRatio="xMidYMid slice"
          >
            <line x1="0" y1="45" x2="320" y2="45" className="ts-cover-grid-line" />
            <line x1="0" y1="90" x2="320" y2="90" className="ts-cover-grid-line" />
            <line x1="0" y1="135" x2="320" y2="135" className="ts-cover-grid-line" />
            <line x1="80" y1="0" x2="80" y2="180" className="ts-cover-grid-line" />
            <line x1="160" y1="0" x2="160" y2="180" className="ts-cover-grid-line" />
            <line x1="240" y1="0" x2="240" y2="180" className="ts-cover-grid-line" />
            <path
              d="M 54 128 C 102 124, 118 66, 164 78 C 206 88, 224 52, 266 56"
              className="ts-cover-route-path"
            />
            <circle cx="54" cy="128" r="4.5" className="ts-cover-route-node" />
            <circle cx="164" cy="78" r="4" className="ts-cover-route-node-mid" />
            <circle cx="266" cy="56" r="5" className="ts-cover-route-node-end" />
          </svg>
          {!compact && (
            <div className="ts-cover-fallback-meta">
              <span className="ts-cover-fallback-chip">
                <Compass size={12} />
                <span>{typeLabel}</span>
              </span>
              {stopCount > 0 && (
                <span className="ts-cover-fallback-stops">
                  <MapPin size={11} />
                  <span>
                    {stopCount} {stopCount === 1 ? "stop" : "stops"}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
