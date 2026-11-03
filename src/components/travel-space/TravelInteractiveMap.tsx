import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  ArrowDown,
  ArrowUp,
  Bike,
  Car,
  Check,
  Compass,
  Copy,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  Footprints,
  GripVertical,
  Link2,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  Navigation,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Route,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  PersoraEmptyState,
  PersoraSearchField,
  PersoraSegmentedControl,
  Spinner,
} from "@/design-system";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsPlaceUrl,
  formatCoordinatePair,
  isValidCoordinatePair,
  parseGoogleMapsInput,
  roundCoordinate,
  type TravelRouteMode,
} from "../../../cloudflare/travel-space-rules.js";
import type { AppUser } from "../../types";
import {
  describeTravelError,
  fetchMapRoute,
  getDestinationStopLabel,
  getMapTileConfig,
  rememberEphemeralStopLabel,
  searchMapDestinations,
  type MapRouteResponse,
  type MapSearchResult,
} from "../../lib/travel-space-api";

export interface MapDestinationPoint {
  id: string;
  latitude: number;
  longitude: number;
  orderIndex: number;
}

export interface MapActivityPin {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  dayLabel?: string;
  timeLabel?: string;
}

export interface TravelInteractiveMapProps {
  user: AppUser;
  destinations: MapDestinationPoint[];
  onChange?: (next: MapDestinationPoint[]) => void;
  readOnly?: boolean;
  variant?: "interactive" | "compact";
  visible?: boolean;
  height?: number;
  activityMarkers?: MapActivityPin[];
  onOpenFullMap?: () => void;
  className?: string;
  emptyHint?: string;
}

function makeClientStopId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function formatDistanceKm(meters: number | null): string | null {
  if (meters === null || !Number.isFinite(meters) || meters <= 0) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

function formatDurationHm(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const TravelInteractiveMap: React.FC<TravelInteractiveMapProps> = ({
  user,
  destinations,
  onChange,
  readOnly = false,
  variant = "interactive",
  visible = true,
  height = 430,
  activityMarkers = [],
  onOpenFullMap,
  className = "",
  emptyHint,
}) => {
  const autoId = useId();
  const editable = !readOnly && typeof onChange === "function" && variant === "interactive";
  const userRef = useRef(user);
  userRef.current = user;

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const activityLayerRef = useRef<L.LayerGroup | null>(null);
  const routeCasingRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const userLocMarkerRef = useRef<L.CircleMarker | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const prevCountRef = useRef<number>(destinations.length);

  // Latest callbacks/state refs so imperative Leaflet listeners never go stale or recreate the map
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const clickToAddRef = useRef(true);
  const destinationsRef = useRef(destinations);
  destinationsRef.current = destinations;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [selectedId, setSelectedId] = useState<string | null>(destinations[0]?.id || null);
  const [clickToAdd, setClickToAdd] = useState(true);
  clickToAddRef.current = clickToAdd;

  const [routeVisible, setRouteVisible] = useState(true);
  const [routeMode, setRouteMode] = useState<TravelRouteMode>("driving");
  const [routeData, setRouteData] = useState<MapRouteResponse | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MapSearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [activeResultIdx, setActiveResultIdx] = useState(0);

  const [coordPanelOpen, setCoordPanelOpen] = useState(false);
  const [coordInput, setCoordInput] = useState("");
  const [coordFeedback, setCoordFeedback] = useState<{
    tone: "error" | "hint";
    text: string;
    extractedQuery?: string;
  } | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSheet, setMobileSheet] = useState<"collapsed" | "half" | "expanded">("half");
  const sheetDragStartY = useRef<number | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Keep selectedId valid if stops change
  useEffect(() => {
    if (selectedId && destinations.some((d) => d.id === selectedId)) return;
    setSelectedId(destinations[0]?.id || null);
  }, [destinations, selectedId]);

  const flyCameraTo = useCallback((lat: number, lng: number, zoom = 12) => {
    const map = mapRef.current;
    if (!map) return;
    if (prefersReducedMotion()) {
      map.setView([lat, lng], zoom, { animate: false });
    } else {
      map.flyTo([lat, lng], zoom, { duration: 0.65 });
    }
  }, []);

  const fitAllMarkers = useCallback(
    (animate = true) => {
      const map = mapRef.current;
      if (!map) return;
      const allCoords: [number, number][] = [
        ...destinations
          .filter((d) => isValidCoordinatePair(d.latitude, d.longitude))
          .map((d) => [d.latitude, d.longitude] as [number, number]),
        ...activityMarkers
          .filter((a) => isValidCoordinatePair(a.latitude, a.longitude))
          .map((a) => [a.latitude, a.longitude] as [number, number]),
      ];
      if (allCoords.length === 0) {
        map.setView([23.8103, 90.4125], 5, { animate: false });
        return;
      }
      if (allCoords.length === 1) {
        if (animate && !prefersReducedMotion()) {
          map.flyTo(allCoords[0], 12, { duration: 0.65 });
        } else {
          map.setView(allCoords[0], 12, { animate: false });
        }
        return;
      }
      const bounds = L.latLngBounds(allCoords);
      const pad: [number, number] = variant === "compact" ? [26, 26] : [48, 48];
      if (animate && !prefersReducedMotion()) {
        map.flyToBounds(bounds, { padding: pad, maxZoom: 14, duration: 0.7 });
      } else {
        map.fitBounds(bounds, { padding: pad, maxZoom: 14, animate: false });
      }
    },
    [destinations, activityMarkers, variant],
  );

  const addStop = useCallback(
    (latitude: number, longitude: number, ephemeralLabel?: string) => {
      if (!onChangeRef.current || !isValidCoordinatePair(latitude, longitude)) return;
      const lat = roundCoordinate(latitude);
      const lng = roundCoordinate(longitude);
      if (ephemeralLabel) {
        rememberEphemeralStopLabel(lat, lng, ephemeralLabel);
      }
      const current = destinationsRef.current;
      const newStop: MapDestinationPoint = {
        id: makeClientStopId(),
        latitude: lat,
        longitude: lng,
        orderIndex: current.length,
      };
      const next = [...current, newStop].map((item, idx) => ({ ...item, orderIndex: idx }));
      onChangeRef.current(next);
      setSelectedId(newStop.id);
      setLocationNotice(null);

      // Camera transition: single stop -> zoom in; multiple stops -> fit route smoothly
      const map = mapRef.current;
      if (map) {
        if (next.length === 1) {
          flyCameraTo(lat, lng, 12);
        } else {
          const bounds = L.latLngBounds(next.map((d) => [d.latitude, d.longitude] as [number, number]));
          if (prefersReducedMotion()) {
            map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14, animate: false });
          } else {
            map.flyToBounds(bounds, { padding: [48, 48], maxZoom: 14, duration: 0.7 });
          }
        }
      }
    },
    [flyCameraTo],
  );

  // 1. Initialize Leaflet map ONCE per mount, decoupled from React state re-renders
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    const tile = getMapTileConfig();
    const map = L.map(container, {
      center: [23.8103, 90.4125],
      zoom: 5,
      zoomControl: false,
      attributionControl: true,
      zoomAnimation: variant === "interactive",
      fadeAnimation: variant === "interactive",
      scrollWheelZoom: variant === "interactive",
      dragging: variant === "interactive",
      doubleClickZoom: variant === "interactive",
      touchZoom: variant === "interactive",
      boxZoom: variant === "interactive",
      keyboard: variant === "interactive",
    });

    map.attributionControl.setPrefix(false);
    L.tileLayer(tile.url, {
      attribution: tile.attribution,
      maxZoom: tile.maxZoom,
      crossOrigin: true,
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    const activitiesGroup = L.layerGroup().addTo(map);
    markersLayerRef.current = markersGroup;
    activityLayerRef.current = activitiesGroup;
    mapRef.current = map;

    map.on("click", (evt: L.LeafletMouseEvent) => {
      if (variant === "compact") return;
      if (!editableRef.current || !clickToAddRef.current) return;
      addStop(evt.latlng.lat, evt.latlng.lng);
    });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.invalidateSize({ animate: false });
          })
        : null;
    if (resizeObserver) resizeObserver.observe(container);

    // Initial fit if destinations already exist
    const initTimer = window.setTimeout(() => {
      if (!mapRef.current) return;
      map.invalidateSize({ animate: false });
      const initialPts = [
        ...destinationsRef.current.filter((d) => isValidCoordinatePair(d.latitude, d.longitude)),
      ];
      if (initialPts.length === 1) {
        map.setView([initialPts[0].latitude, initialPts[0].longitude], 12, { animate: false });
      } else if (initialPts.length > 1) {
        const b = L.latLngBounds(initialPts.map((p) => [p.latitude, p.longitude] as [number, number]));
        map.fitBounds(b, { padding: variant === "compact" ? [26, 26] : [48, 48], maxZoom: 14, animate: false });
      }
    }, 30);

    return () => {
      window.clearTimeout(initTimer);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      resizeObserver?.disconnect();
      map.stop();
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      activityLayerRef.current = null;
      routeCasingRef.current = null;
      routeLineRef.current = null;
      userLocMarkerRef.current = null;
    };
  }, [addStop, variant]);

  // Re-validate size on sidebar / fullscreen / sheet / visibility transitions
  useEffect(() => {
    if (!visible) return;
    const raf = window.requestAnimationFrame(() => {
      mapRef.current?.invalidateSize({ animate: false });
    });
    const timer = window.setTimeout(() => {
      mapRef.current?.invalidateSize({ animate: false });
    }, 180);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [sidebarOpen, isFullscreen, mobileSheet, visible]);

  // Escape exits fullscreen mode
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsFullscreen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isFullscreen]);

  // 2. Render numbered Persora destination markers & optional itinerary activity pins
  useEffect(() => {
    const group = markersLayerRef.current;
    const actGroup = activityLayerRef.current;
    if (!group || !actGroup) return;

    group.clearLayers();
    actGroup.clearLayers();

    destinations.forEach((dest, idx) => {
      if (!isValidCoordinatePair(dest.latitude, dest.longitude)) return;
      const isSelected = dest.id === selectedId;
      const stopTitle = getDestinationStopLabel(dest, idx);
      const coordText = formatCoordinatePair(dest.latitude, dest.longitude, 4);

      const icon = L.divIcon({
        className: "ts-leaflet-div-icon",
        html: `<div class="ts-map-pin ${isSelected ? "is-selected" : ""}" title="${escapeHtml(stopTitle)}"><span>${idx + 1}</span></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });

      const marker = L.marker([dest.latitude, dest.longitude], {
        icon,
        keyboard: variant === "interactive",
        title: `Stop ${idx + 1}: ${coordText}`,
        zIndexOffset: isSelected ? 900 : 500 - idx,
      });

      if (variant === "interactive") {
        marker.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          setSelectedId(dest.id);
          flyCameraTo(dest.latitude, dest.longitude, Math.max(mapRef.current?.getZoom() || 11, 11));
        });
      }

      marker.addTo(group);
    });

    activityMarkers.forEach((act) => {
      if (!isValidCoordinatePair(act.latitude, act.longitude)) return;
      const actIcon = L.divIcon({
        className: "ts-leaflet-div-icon",
        html: `<div class="ts-map-activity-pin" title="${escapeHtml(act.title)}"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const m = L.marker([act.latitude, act.longitude], {
        icon: actIcon,
        zIndexOffset: 200,
      });
      if (variant === "interactive") {
        const sub = [act.dayLabel, act.timeLabel].filter(Boolean).join(" · ");
        m.bindTooltip(
          `<strong>${escapeHtml(act.title)}</strong>${sub ? `<br/><span>${escapeHtml(sub)}</span>` : ""}`,
          { direction: "top", offset: [0, -8], className: "ts-map-tooltip" },
        );
      }
      m.addTo(actGroup);
    });

    // If stops count changed externally in compact/readOnly mode, re-fit bounds cleanly
    if (prevCountRef.current !== destinations.length) {
      prevCountRef.current = destinations.length;
      if (variant === "compact" || readOnly) {
        fitAllMarkers(false);
      }
    }
  }, [destinations, selectedId, activityMarkers, variant, readOnly, flyCameraTo, fitAllMarkers]);

  // 3. Fetch road-following OSRM route (with stale request cancellation) whenever stops or mode change
  const coordSignature = useMemo(
    () =>
      destinations
        .filter((d) => isValidCoordinatePair(d.latitude, d.longitude))
        .map((d) => `${d.latitude.toFixed(5)},${d.longitude.toFixed(5)}`)
        .join("|"),
    [destinations],
  );

  useEffect(() => {
    const validStops = destinations.filter((d) => isValidCoordinatePair(d.latitude, d.longitude));
    if (validStops.length < 2) {
      setRouteData(null);
      setRouteLoading(false);
      return;
    }

    const controller = new AbortController();
    setRouteLoading(true);

    fetchMapRoute(userRef.current, validStops, routeMode, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setRouteData(res);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setRouteData({
          ok: true,
          mode: routeMode,
          isFallback: true,
          fallbackReason: describeTravelError(err, "Road routing unavailable; showing straight-line preview."),
          geometry: validStops.map((s) => [s.latitude, s.longitude]),
          legs: [],
          distanceMeters: null,
          durationSeconds: null,
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false);
      });

    return () => controller.abort();
  }, [user.id, Boolean(user.demo), coordSignature, routeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Progressive directional route polyline drawing (1 -> 2 -> 3 -> N)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (routeCasingRef.current) {
      routeCasingRef.current.remove();
      routeCasingRef.current = null;
    }
    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    if (!routeVisible || !routeData || routeData.geometry.length < 2) return;

    const coords = routeData.geometry;
    const isFallback = routeData.isFallback;

    const casing = L.polyline([], {
      color: "#ffffff",
      weight: isFallback ? 5 : 6,
      opacity: isFallback ? 0.65 : 0.9,
      interactive: false,
    }).addTo(map);

    const line = L.polyline([], {
      color: isFallback ? "#5b687a" : "#1a73e8",
      weight: isFallback ? 2.5 : 3.75,
      opacity: 0.95,
      dashArray: isFallback ? "6 6" : undefined,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(map);

    routeCasingRef.current = casing;
    routeLineRef.current = line;

    if (prefersReducedMotion() || variant === "compact" || coords.length <= 2) {
      casing.setLatLngs(coords);
      line.setLatLngs(coords);
      return;
    }

    const durationMs = 620;
    const startedAt = performance.now();
    const totalSegments = coords.length - 1;

    const step = (now: number) => {
      if (!mapRef.current) {
        animFrameRef.current = null;
        return;
      }
      const elapsed = Math.max(0, now - startedAt);
      const t = Math.min(1, elapsed / durationMs);
      // Smooth cubic ease-out
      const eased = 1 - (1 - t) ** 3;
      const exactIndex = Math.max(0, Math.min(totalSegments, eased * totalSegments));
      const whole = Math.floor(exactIndex);
      const frac = exactIndex - whole;

      const partial: [number, number][] = coords.slice(0, whole + 1);
      if (whole < totalSegments && frac > 0) {
        const a = coords[whole];
        const b = coords[whole + 1];
        if (a && b) {
          partial.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
        }
      }
      casing.setLatLngs(partial);
      line.setLatLngs(partial);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        casing.setLatLngs(coords);
        line.setLatLngs(coords);
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [routeData, routeVisible, variant]);

  // 5. Debounced, rate-safe destination search (also detects pasted coordinates / Google Maps URLs!)
  useEffect(() => {
    if (!editable) return;
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchWarning(null);
      return;
    }

    // Instant recognition if user typed/pasted coordinates or a Google Maps link right in the search box!
    const parsedDirect = parseGoogleMapsInput(trimmed);
    if (parsedDirect.ok && parsedDirect.latitude !== undefined && parsedDirect.longitude !== undefined) {
      setSearchResults([
        {
          id: `direct-${parsedDirect.latitude}-${parsedDirect.longitude}`,
          label: parsedDirect.labelHint || `Pin (${formatCoordinatePair(parsedDirect.latitude, parsedDirect.longitude)})`,
          subtitle: `${formatCoordinatePair(parsedDirect.latitude, parsedDirect.longitude, 5)} · Direct coordinates`,
          latitude: parsedDirect.latitude,
          longitude: parsedDirect.longitude,
          source: parsedDirect.source?.startsWith("google") ? "google_maps" : "coordinates",
        },
      ]);
      setActiveResultIdx(0);
      setSearchWarning(null);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      searchMapDestinations(user, trimmed, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setSearchResults(res.results || []);
          setActiveResultIdx(0);
          setSearchWarning(res.warning || null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setSearchResults([]);
          setSearchWarning(describeTravelError(err, "Destination search is temporarily unavailable."));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false);
        });
    }, 420);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editable, searchQuery, user]);

  const handleSelectSearchResult = (item: MapSearchResult) => {
    addStop(item.latitude, item.longitude, item.label);
    setSearchQuery("");
    setSearchResults([]);
    setSearchOpen(false);
  };

  const handleParseCoordOrLink = (e?: React.FormEvent) => {
    e?.preventDefault();
    const parsed = parseGoogleMapsInput(coordInput);
    if (parsed.ok && parsed.latitude !== undefined && parsed.longitude !== undefined) {
      addStop(parsed.latitude, parsed.longitude, parsed.labelHint);
      setCoordInput("");
      setCoordFeedback(null);
      setCoordPanelOpen(false);
      return;
    }
    setCoordFeedback({
      tone: parsed.extractedQuery ? "hint" : "error",
      text: parsed.message || "Enter valid latitude, longitude or a Google Maps URL.",
      extractedQuery: parsed.extractedQuery || undefined,
    });
  };

  const moveStop = (index: number, delta: number) => {
    if (!onChange) return;
    const target = index + delta;
    if (target < 0 || target >= destinations.length) return;
    const copy = [...destinations];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    onChange(copy.map((item, idx) => ({ ...item, orderIndex: idx })));
  };

  const reorderDrop = (fromIdx: number, toIdx: number) => {
    if (!onChange || fromIdx === toIdx) return;
    const copy = [...destinations];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    onChange(copy.map((item, idx) => ({ ...item, orderIndex: idx })));
  };

  const removeStop = (id: string) => {
    if (!onChange) return;
    const next = destinations.filter((d) => d.id !== id).map((item, idx) => ({ ...item, orderIndex: idx }));
    onChange(next);
  };

  const handleUseCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationNotice("Location services are not supported by this browser.");
      return;
    }
    setLocating(true);
    setLocationNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = roundCoordinate(pos.coords.latitude);
        const lng = roundCoordinate(pos.coords.longitude);
        const map = mapRef.current;
        if (map) {
          userLocMarkerRef.current?.remove();
          userLocMarkerRef.current = L.circleMarker([lat, lng], {
            radius: 7,
            color: "#ffffff",
            weight: 2,
            fillColor: "#137333",
            fillOpacity: 1,
          })
            .bindTooltip("Current location", { direction: "top" })
            .addTo(map);
          flyCameraTo(lat, lng, 13);
        }
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationNotice("Location permission was declined. Search a place or click on the map instead.");
        } else {
          setLocationNotice("Could not determine current location. Search or click on the map instead.");
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  const selectedStopIndex = destinations.findIndex((d) => d.id === selectedId);
  const selectedStop = selectedStopIndex >= 0 ? destinations[selectedStopIndex] : null;
  const distText = routeData && !routeData.isFallback ? formatDistanceKm(routeData.distanceMeters) : null;
  const durText = routeData && !routeData.isFallback ? formatDurationHm(routeData.durationSeconds) : null;
  const directionsUrl = useMemo(
    () => buildGoogleMapsDirectionsUrl(destinations, routeMode),
    [destinations, routeMode],
  );

  // Compact Trip Overview Preview Card
  if (variant === "compact") {
    return (
      <div
        className={`ts-map-compact-card ${onOpenFullMap ? "is-clickable" : ""} ${className}`.trim()}
        role={onOpenFullMap ? "button" : undefined}
        tabIndex={onOpenFullMap ? 0 : undefined}
        onClick={onOpenFullMap}
        onKeyDown={(e) => {
          if (onOpenFullMap && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onOpenFullMap();
          }
        }}
      >
        <div ref={mapContainerRef} className="ts-map-compact-canvas" style={{ height }} />
        <div className="ts-map-compact-bar">
          <div className="ts-map-compact-meta">
            <Badge variant="secondary" size="sm">
              <MapPin size={11} /> {destinations.length} {destinations.length === 1 ? "stop" : "stops"}
            </Badge>
            {routeData?.isFallback && destinations.length >= 2 ? (
              <Badge variant="outline" size="sm">Straight-line preview</Badge>
            ) : distText ? (
              <span className="ts-map-compact-stat">
                {distText}
                {durText ? ` · ${durText}` : ""}
              </span>
            ) : null}
          </div>
          {onOpenFullMap ? (
            <span className="ts-map-compact-cta">
              Open full map <Maximize2 size={12} />
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={`ts-map-shell ${isFullscreen ? "is-fullscreen" : ""} ${sidebarOpen ? "has-sidebar" : "sidebar-collapsed"} ${className}`.trim()}
      style={isFullscreen ? undefined : { minHeight: height }}
    >
      {/* Interactive Map Stage */}
      <div className="ts-map-stage">
        <div
          ref={mapContainerRef}
          className={`ts-map-canvas ${editable && clickToAdd ? "is-pin-cursor" : ""}`.trim()}
          style={isFullscreen ? undefined : { height }}
        />

        {/* Floating Top Search + Coordinate / Google Maps URL Bar */}
        {editable && (
          <div className="ts-map-search-overlay">
            <div className="ts-map-search-row">
              <div className="ts-map-search-box">
                <PersoraSearchField
                  id={`ts-map-search-${autoId}`}
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" && searchResults.length > 0) {
                      e.preventDefault();
                      setActiveResultIdx((i) => (i + 1) % searchResults.length);
                    } else if (e.key === "ArrowUp" && searchResults.length > 0) {
                      e.preventDefault();
                      setActiveResultIdx((i) => (i - 1 + searchResults.length) % searchResults.length);
                    } else if (e.key === "Enter" && searchResults[activeResultIdx]) {
                      e.preventDefault();
                      handleSelectSearchResult(searchResults[activeResultIdx]);
                    } else if (e.key === "Escape") {
                      setSearchOpen(false);
                    }
                  }}
                  onClear={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  placeholder="Search city, landmark, or paste coordinates..."
                  aria-label="Search destinations"
                />
                {searchLoading ? (
                  <span className="ts-map-search-spinner" aria-hidden="true">
                    <Spinner className="size-3.5" />
                  </span>
                ) : null}

                {searchOpen && (searchResults.length > 0 || searchWarning) && (
                  <div className="ts-map-search-dropdown" role="listbox" aria-label="Destination suggestions">
                    {searchWarning ? (
                      <div className="ts-map-search-warning">{searchWarning}</div>
                    ) : null}
                    {searchResults.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={idx === activeResultIdx}
                        className={`ts-map-search-option ${idx === activeResultIdx ? "is-active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectSearchResult(item)}
                      >
                        <MapPin size={14} className="ts-map-search-option-icon" />
                        <span className="ts-map-search-option-body">
                          <strong>{item.label}</strong>
                          <small>
                            {item.subtitle ? `${item.subtitle} · ` : ""}
                            {formatCoordinatePair(item.latitude, item.longitude, 4)}
                          </small>
                        </span>
                        <Badge variant="outline" size="sm">Add</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant={coordPanelOpen ? "secondary" : "outline"}
                size="sm"
                onClick={() => {
                  setCoordPanelOpen((v) => !v);
                  setCoordFeedback(null);
                }}
                title="Enter coordinates or paste a Google Maps URL"
              >
                <Link2 size={14} />
                <span className="ts-hide-xs">Coords / Link</span>
              </Button>
            </div>

            {coordPanelOpen && (
              <form className="ts-map-coord-popover" onSubmit={handleParseCoordOrLink}>
                <div className="ts-map-coord-row">
                  <input
                    type="text"
                    value={coordInput}
                    onChange={(e) => {
                      setCoordInput(e.target.value);
                      if (coordFeedback) setCoordFeedback(null);
                    }}
                    placeholder="e.g. 23.8103, 90.4125 or https://www.google.com/maps/place/..."
                    aria-label="Coordinates or Google Maps URL"
                  />
                  <Button type="submit" variant="default" size="sm">
                    Pin Stop
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Close coordinates input"
                    onClick={() => setCoordPanelOpen(false)}
                  >
                    <X size={14} />
                  </Button>
                </div>
                {coordFeedback ? (
                  <div className={`ts-map-coord-feedback is-${coordFeedback.tone}`}>
                    <span>{coordFeedback.text}</span>
                    {coordFeedback.extractedQuery ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          setSearchQuery(coordFeedback.extractedQuery || "");
                          setSearchOpen(true);
                          setCoordPanelOpen(false);
                        }}
                      >
                        Search &ldquo;{coordFeedback.extractedQuery}&rdquo;
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <p className="ts-map-coord-help">
                    Supports decimal coordinates (lat, lng) and Google Maps place or direction links. Only coordinates are stored.
                  </p>
                )}
              </form>
            )}
          </div>
        )}

        {/* Top-Right Compact Map Toolbar */}
        <div className="ts-map-controls" role="toolbar" aria-label="Map controls">
          <div className="ts-map-control-group">
            <button
              type="button"
              className="ts-map-ctrl-btn"
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => mapRef.current?.zoomIn()}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="ts-map-ctrl-btn"
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => mapRef.current?.zoomOut()}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              className="ts-map-ctrl-btn"
              title="Fit all stops"
              aria-label="Fit all stops"
              onClick={() => fitAllMarkers(true)}
            >
              <Compass size={15} />
            </button>
            {selectedStop ? (
              <button
                type="button"
                className="ts-map-ctrl-btn"
                title="Center on selected stop"
                aria-label="Center on selected stop"
                onClick={() => flyCameraTo(selectedStop.latitude, selectedStop.longitude, 13)}
              >
                <Crosshair size={15} />
              </button>
            ) : null}
            <button
              type="button"
              className={`ts-map-ctrl-btn ${routeVisible ? "is-active" : ""}`}
              title={routeVisible ? "Hide route line" : "Show route line"}
              aria-label={routeVisible ? "Hide route line" : "Show route line"}
              onClick={() => setRouteVisible((v) => !v)}
            >
              {routeVisible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button
              type="button"
              className="ts-map-ctrl-btn"
              title="Center on current location"
              aria-label="Center on current location"
              disabled={locating}
              onClick={handleUseCurrentLocation}
            >
              {locating ? <Spinner className="size-3.5" /> : <LocateFixed size={15} />}
            </button>
            <button
              type="button"
              className="ts-map-ctrl-btn ts-hide-mobile"
              title={sidebarOpen ? "Collapse stops panel" : "Expand stops panel"}
              aria-label={sidebarOpen ? "Collapse stops panel" : "Expand stops panel"}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              {sidebarOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </button>
            <button
              type="button"
              className="ts-map-ctrl-btn"
              title={isFullscreen ? "Exit fullscreen map" : "Fullscreen map"}
              aria-label={isFullscreen ? "Exit fullscreen map" : "Fullscreen map"}
              onClick={() => setIsFullscreen((v) => !v)}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>
        </div>

        {/* Bottom-Left Status Strip: Travel Mode + Route Metrics / Straight-Line Fallback Notice + Click-to-pin toggle */}
        <div className="ts-map-bottom-bar">
          {destinations.length >= 2 && (
            <PersoraSegmentedControl<TravelRouteMode>
              size="sm"
              ariaLabel="Travel mode"
              value={routeMode}
              onChange={setRouteMode}
              options={[
                { value: "driving", label: "Drive", icon: <Car size={12} /> },
                { value: "walking", label: "Walk", icon: <Footprints size={12} /> },
                { value: "cycling", label: "Cycle", icon: <Bike size={12} /> },
              ]}
            />
          )}

          {destinations.length >= 2 && routeLoading ? (
            <span className="ts-map-status-pill">
              <Spinner className="size-3" /> Calculating route...
            </span>
          ) : destinations.length >= 2 && routeData?.isFallback ? (
            <span
              className="ts-map-status-pill is-fallback"
              title={routeData.fallbackReason || "Road routing unavailable; showing straight-line preview."}
            >
              <Route size={12} /> Straight-line preview
            </span>
          ) : distText ? (
            <span className="ts-map-status-pill">
              <Navigation size={12} /> {distText}
              {durText ? ` · ${durText}` : ""}
            </span>
          ) : null}

          {editable && (
            <button
              type="button"
              className={`ts-map-pin-mode-btn ${clickToAdd ? "is-active" : ""}`}
              aria-pressed={clickToAdd}
              onClick={() => setClickToAdd((v) => !v)}
            >
              <MapPin size={12} />
              <span>{clickToAdd ? "Click map to pin: On" : "Click map to pin: Off"}</span>
            </button>
          )}

          {locationNotice ? <span className="ts-map-status-pill is-warn">{locationNotice}</span> : null}
        </div>
      </div>

      {/* Desktop Collapsible Stops Sidebar & Mobile Draggable Bottom Sheet */}
      <aside
        className={`ts-map-panel is-sheet-${mobileSheet} ${sidebarOpen ? "is-open" : "is-collapsed"}`.trim()}
        aria-label="Trip route stops"
      >
        {/* Mobile Bottom-Sheet Drag Handle */}
        <div
          className="ts-map-sheet-grabber"
          role="button"
          tabIndex={0}
          aria-label="Toggle route stops sheet size"
          onClick={() =>
            setMobileSheet((cur) => (cur === "collapsed" ? "half" : cur === "half" ? "expanded" : "collapsed"))
          }
          onPointerDown={(e) => {
            sheetDragStartY.current = e.clientY;
          }}
          onPointerUp={(e) => {
            if (sheetDragStartY.current === null) return;
            const dy = e.clientY - sheetDragStartY.current;
            sheetDragStartY.current = null;
            if (dy < -32) {
              setMobileSheet((cur) => (cur === "collapsed" ? "half" : "expanded"));
            } else if (dy > 32) {
              setMobileSheet((cur) => (cur === "expanded" ? "half" : "collapsed"));
            }
          }}
        >
          <span className="ts-map-sheet-pill" />
        </div>

        <div className="ts-map-panel-head">
          <div>
            <h4>Route Stops ({destinations.length})</h4>
            <p>
              {destinations.length === 0
                ? "Optional — search, click map, or paste link"
                : "Ordered 1 → N · Coordinates persisted"}
            </p>
          </div>
          {destinations.length >= 1 && (
            <div className="ts-map-panel-head-actions">
              <a
                href={directionsUrl}
                target="_blank"
                rel="noreferrer"
                className="ts-map-ext-link"
                title={destinations.length >= 2 ? "Open multi-stop route in Google Maps" : "Open pin in Google Maps"}
              >
                <ExternalLink size={12} />
                <span>Google Maps</span>
              </a>
              <button
                type="button"
                className="ts-map-icon-action"
                title="Copy shareable Google Maps route link"
                aria-label="Copy Google Maps route link"
                onClick={() => copyText(directionsUrl, "route-share")}
              >
                {copiedKey === "route-share" ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
          )}
        </div>

        <div className="ts-map-panel-body">
          {destinations.length === 0 ? (
            <PersoraEmptyState
              compact
              tone="blue"
              icon={<Sparkles size={16} />}
              title="No stops pinned yet"
              description={
                emptyHint ||
                (editable
                  ? "Search a place, click anywhere on the map, or paste a Google Maps URL. You can also continue without destinations."
                  : "No coordinate stops have been pinned to this trip yet.")
              }
            />
          ) : (
            <ol className="ts-map-stop-list">
              {destinations.map((dest, idx) => {
                const isSelected = dest.id === selectedId;
                const label = getDestinationStopLabel(dest, idx);
                const coordStr = formatCoordinatePair(dest.latitude, dest.longitude, 5);
                const placeUrl = buildGoogleMapsPlaceUrl(dest.latitude, dest.longitude);
                const legAfter =
                  routeData && !routeData.isFallback && routeData.legs[idx] ? routeData.legs[idx] : null;

                return (
                  <li
                    key={dest.id}
                    draggable={editable}
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      if (editable) e.preventDefault();
                    }}
                    onDrop={() => {
                      if (dragIndex !== null) reorderDrop(dragIndex, idx);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={`ts-map-stop-item ${isSelected ? "is-selected" : ""}`.trim()}
                  >
                    <div
                      className="ts-map-stop-main"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedId(dest.id);
                        flyCameraTo(dest.latitude, dest.longitude, 13);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(dest.id);
                          flyCameraTo(dest.latitude, dest.longitude, 13);
                        }
                      }}
                    >
                      {editable ? (
                        <span className="ts-map-stop-grip" aria-hidden="true" title="Drag to reorder">
                          <GripVertical size={13} />
                        </span>
                      ) : null}
                      <span className="ts-map-stop-badge">{idx + 1}</span>
                      <div className="ts-map-stop-copy">
                        <strong>{label}</strong>
                        <span>{coordStr}</span>
                      </div>
                    </div>

                    <div className="ts-map-stop-actions">
                      <a
                        href={placeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ts-map-icon-action"
                        title="Open stop in Google Maps"
                        aria-label={`Open stop ${idx + 1} in Google Maps`}
                      >
                        <ExternalLink size={12} />
                      </a>
                      <button
                        type="button"
                        className="ts-map-icon-action"
                        title="Copy coordinates"
                        aria-label={`Copy stop ${idx + 1} coordinates`}
                        onClick={() => copyText(coordStr, dest.id)}
                      >
                        {copiedKey === dest.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      {editable ? (
                        <>
                          <button
                            type="button"
                            className="ts-map-icon-action"
                            disabled={idx === 0}
                            title="Move stop up"
                            aria-label={`Move stop ${idx + 1} up`}
                            onClick={() => moveStop(idx, -1)}
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            type="button"
                            className="ts-map-icon-action"
                            disabled={idx === destinations.length - 1}
                            title="Move stop down"
                            aria-label={`Move stop ${idx + 1} down`}
                            onClick={() => moveStop(idx, 1)}
                          >
                            <ArrowDown size={12} />
                          </button>
                          <button
                            type="button"
                            className="ts-map-icon-action is-danger"
                            title="Remove stop"
                            aria-label={`Remove stop ${idx + 1}`}
                            onClick={() => removeStop(dest.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      ) : null}
                    </div>

                    {legAfter && (legAfter.distanceMeters || legAfter.durationSeconds) ? (
                      <div className="ts-map-stop-leg">
                        <span>
                          Next leg: {formatDistanceKm(legAfter.distanceMeters) || "—"}
                          {legAfter.durationSeconds ? ` · ${formatDurationHm(legAfter.durationSeconds)}` : ""}
                        </span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
};
