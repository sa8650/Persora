import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  AudioLines,
  Link2,
  Mic,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { AudioSource, AudioSpaceItem } from "../../types";
import { loadAudioSpaceFile, markAudioSpacePlayed } from "../../lib/cloud";
import { formatDuration, sourceLabel } from "../../lib/audio-space";
import "./audio-space.css";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const WAVEFORM_BARS = 48;

export interface PlayerTrack {
  id: string;
  title: string;
  subtitle: string;
  source: AudioSource;
  /** External URL for link items; stored files stream via authenticated API blob URLs. */
  src: string;
  durationSeconds: number | null;
  external: boolean;
  /** Optional cover/thumbnail URL when supplied on item metadata. */
  artworkUrl?: string | null;
}

function trackSourceLabel(source: AudioSource): string {
  return source === "recording" ? "Recording" : source === "link" ? "Audio link" : "Upload";
}

function extractArtworkUrl(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const candidates = [metadata.artworkUrl, metadata.coverUrl, metadata.thumbnailUrl, metadata.image];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (/^(https?:\/\/|\/|data:image\/)/i.test(trimmed)) return trimmed;
  }
  return null;
}

export function trackForItem(item: AudioSpaceItem): PlayerTrack {
  const external = item.source === "link";
  return {
    id: item.id,
    title: item.title,
    subtitle: sourceLabel(item),
    source: item.source,
    src: external ? item.externalUrl || "" : "",
    durationSeconds: item.durationSeconds,
    external,
    artworkUrl: extractArtworkUrl(item.metadata),
  };
}

export interface AudioPlayerApi {
  current: PlayerTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  rate: number;
  peaks: number[] | null;
  error: string | null;
  queue: PlayerTrack[];
  playTrack: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (deltaSeconds: number) => void;
  next: () => void;
  previous: () => void;
  setVolume: (volume: number) => void;
  setRate: (rate: number) => void;
  close: () => void;
  /** Cached waveform peaks by item id so cards can show a mini waveform once decoded. */
  peaksFor: (id: string) => number[] | null;
  /** Keep track titles in sync when items are renamed or deleted. */
  registerItems: (items: AudioSpaceItem[]) => void;
}

function syntheticPeaks(seed: string): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < WAVEFORM_BARS; i += 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const normalized = ((hash >>> 0) % 1000) / 1000;
    bars.push(0.22 + normalized * 0.72);
  }
  return bars;
}

async function measurePeaks(blob: Blob): Promise<number[] | null> {
  if (typeof window === "undefined") return null;
  const AudioCtx: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  // Decoding multi-tens-of-MB files only to draw 48 bars wastes memory; fall back gracefully.
  if (blob.size > 25 * 1024 * 1024) return null;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / WAVEFORM_BARS));
    const raw: number[] = [];
    let peakMax = 0;
    for (let i = 0; i < WAVEFORM_BARS; i += 1) {
      const start = i * block;
      let sum = 0;
      let count = 0;
      const step = Math.max(1, Math.floor(block / 64));
      for (let j = 0; j < block && start + j < channel.length; j += step) {
        sum += Math.abs(channel[start + j]);
        count += 1;
      }
      const value = count ? sum / count : 0;
      raw.push(value);
      if (value > peakMax) peakMax = value;
    }
    if (peakMax <= 0) return raw.map(() => 0.25);
    return raw.map((value) => Math.max(0.14, Math.min(1, value / peakMax)));
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/**
 * Persistent workspace-level audio player state. Lives in `Workspace.tsx` so
 * playback continues smoothly as the user navigates across Persora sections
 * with a single HTMLAudioElement and zero reloads.
 */
export function useAudioPlayer(): AudioPlayerApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const peaksCacheRef = useRef<Map<string, number[]>>(new Map());
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [rate, setRateState] = useState<number>(1);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, bumpPeaksVersion] = useState(0);

  const revokeBlob = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof Audio === "undefined") return undefined;
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onError = () => {
      setPlaying(false);
      setError("This audio couldn't be played. Check the file or external link.");
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      revokeBlob();
    };
  }, [revokeBlob]);

  const startTrack = useCallback((track: PlayerTrack) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seq = ++loadSeqRef.current;
    setError(null);
    setCurrent(track);
    setCurrentTime(0);
    setDuration(track.durationSeconds || 0);
    const cached = peaksCacheRef.current.get(track.id) || null;
    setPeaks(cached ?? syntheticPeaks(track.id));

    audio.pause();
    revokeBlob();

    const playLoaded = (url: string) => {
      if (loadSeqRef.current !== seq) return;
      audio.src = url;
      audio.playbackRate = rate;
      audio.volume = volume;
      void audio.play().catch((playErr) => {
        if (loadSeqRef.current !== seq) return;
        // AbortError simply means the user picked another track mid-load.
        if (playErr instanceof DOMException && playErr.name === "AbortError") return;
        setPlaying(false);
        setError("Playback couldn't start. Click play to try again.");
      });
      void markAudioSpacePlayed(track.id).catch(() => undefined);
    };

    if (track.external) {
      if (!track.src) {
        setError("This link has no audio URL.");
        return;
      }
      playLoaded(track.src);
      return;
    }

    // Stored files live behind our authenticated API; fetch with the Bearer
    // token and hand the resulting object URL to <audio>.
    void loadAudioSpaceFile(track.id)
      .then(async (blob) => {
        if (loadSeqRef.current !== seq) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        playLoaded(url);
        if (!peaksCacheRef.current.has(track.id)) {
          const decoded = await measurePeaks(blob);
          if (decoded) {
            peaksCacheRef.current.set(track.id, decoded);
            bumpPeaksVersion((v) => v + 1);
            if (loadSeqRef.current === seq) setPeaks(decoded);
          }
        }
      })
      .catch((fetchErr) => {
        if (loadSeqRef.current !== seq) return;
        setPlaying(false);
        setError(fetchErr instanceof Error ? fetchErr.message : "Audio file couldn't be loaded.");
      });
  }, [rate, revokeBlob, volume]);

  const playTrack = useCallback((track: PlayerTrack, nextQueue?: PlayerTrack[]) => {
    if (nextQueue) setQueue(nextQueue);
    const audio = audioRef.current;
    if (current?.id === track.id && audio) {
      if (audio.paused) {
        void audio.play().catch(() => setError("Playback was blocked or failed."));
      } else {
        audio.pause();
      }
      return;
    }
    startTrack(track);
  }, [current?.id, startTrack]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      void audio.play().catch(() => setError("Playback couldn't start."));
    } else {
      audio.pause();
    }
  }, [current]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const maxDuration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : current?.durationSeconds && current.durationSeconds > 0
          ? current.durationSeconds
          : seconds;
    const clamped = Math.max(0, Math.min(seconds, maxDuration));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }, [current?.durationSeconds]);

  const skip = useCallback((deltaSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seek((audio.currentTime || 0) + deltaSeconds);
  }, [seek]);

  const stepQueue = useCallback((direction: 1 | -1) => {
    if (!current || queue.length === 0) return;
    const idx = queue.findIndex((entry) => entry.id === current.id);
    const nextIdx = idx < 0 ? 0 : (idx + direction + queue.length) % queue.length;
    const target = queue[nextIdx];
    if (target) startTrack(target);
  }, [current, queue, startTrack]);

  const next = useCallback(() => stepQueue(1), [stepQueue]);
  const previous = useCallback(() => stepQueue(-1), [stepQueue]);

  const setVolume = useCallback((nextVolume: number) => {
    const clamped = Math.max(0, Math.min(1, nextVolume));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  const setRate = useCallback((nextRate: number) => {
    setRateState(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  }, []);

  const close = useCallback(() => {
    loadSeqRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    revokeBlob();
    setPlaying(false);
    setCurrent(null);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [revokeBlob]);

  const peaksFor = useCallback((id: string) => peaksCacheRef.current.get(id) || null, []);

  const registerItems = useCallback((items: AudioSpaceItem[]) => {
    setCurrent((prev) => {
      if (!prev) return null;
      const match = items.find((item) => item.id === prev.id);
      if (!match) return prev;
      const artworkUrl = extractArtworkUrl(match.metadata);
      return match.title === prev.title &&
        match.durationSeconds === prev.durationSeconds &&
        artworkUrl === prev.artworkUrl
        ? prev
        : { ...prev, title: match.title, durationSeconds: match.durationSeconds, artworkUrl };
    });
  }, []);

  return {
    current,
    playing,
    currentTime,
    duration,
    volume,
    rate,
    peaks,
    error,
    queue,
    playTrack,
    toggle,
    seek,
    skip,
    next,
    previous,
    setVolume,
    setRate,
    close,
    peaksFor,
    registerItems,
  };
}

export function WaveformBars({
  peaks,
  progress = 0,
  className = "",
}: {
  peaks: number[] | null;
  progress?: number;
  className?: string;
}) {
  const bars = peaks && peaks.length ? peaks : null;
  return (
    <div className={`as-waveform ${className}`.trim()} aria-hidden="true">
      {(bars || Array.from({ length: 32 }, (_, idx) => 0.25 + ((idx * 37) % 10) * 0.06)).map((height, idx, list) => {
        const ratio = (idx + 0.5) / list.length;
        const active = progress > 0 && ratio <= progress;
        return (
          <span
            key={idx}
            className={`as-wave-bar ${active ? "is-played" : ""} ${!bars ? "is-idle" : ""}`.trim()}
            style={{ height: `${Math.round(height * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/**
 * Compact 4-bar equalizer shared between the AudioSpace player and Dynamic Island.
 * Uses GPU-only scaleY transforms and pauses cleanly when `playing` is false.
 */
export function AudioEqualizer({
  playing,
  variant = "player",
  className = "",
}: {
  playing: boolean;
  variant?: "player" | "island-face" | "island-panel";
  className?: string;
}) {
  return (
    <span
      className={`as-audio-eq as-audio-eq--${variant} ${playing ? "is-playing" : "is-paused"} ${className}`.trim()}
      data-playing={playing ? "true" : "false"}
      aria-hidden="true"
    >
      <span className="as-eq-bar" />
      <span className="as-eq-bar" />
      <span className="as-eq-bar" />
      <span className="as-eq-bar" />
    </span>
  );
}

export function TrackArtworkBadge({
  track,
  size = "md",
}: {
  track: PlayerTrack;
  size?: "sm" | "md";
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [track.id, track.artworkUrl]);

  const toneClass =
    track.source === "link"
      ? "is-link"
      : track.source === "recording"
        ? "is-recording"
        : "is-upload";

  if (track.artworkUrl && !imgFailed) {
    return (
      <span className={`as-artwork-badge as-artwork-badge--${size} has-image`} aria-hidden="true">
        <img
          src={track.artworkUrl}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className={`as-artwork-badge as-artwork-badge--${size} ${toneClass}`} aria-hidden="true">
      {track.source === "link" ? (
        <Link2 size={size === "sm" ? 13 : 15} />
      ) : track.source === "recording" ? (
        <Mic size={size === "sm" ? 13 : 15} />
      ) : (
        <AudioLines size={size === "sm" ? 13 : 15} />
      )}
    </span>
  );
}

/**
 * Compact Now Playing section rendered inside the expanded Dynamic Island
 * whenever the user is outside AudioSpace and a track is active.
 */
export function IslandNowPlaying({
  player,
  onOpenAudioSpace,
}: {
  player: AudioPlayerApi;
  onOpenAudioSpace: () => void;
}) {
  const current = player.current;
  if (!current) return null;

  const totalDuration = player.duration || current.durationSeconds || 0;
  const clampedTime = totalDuration > 0 ? Math.min(player.currentTime, totalDuration) : player.currentTime;
  const progressPct = totalDuration > 0 ? Math.min(100, Math.max(0, (clampedTime / totalDuration) * 100)) : 0;
  const hasQueue = player.queue.length > 1;

  return (
    <div className="island-now-playing" role="group" aria-label="Now playing">
      <div className="island-np-top">
        <button
          type="button"
          className="island-np-lead"
          onClick={onOpenAudioSpace}
          title="Return to AudioSpace"
          aria-label={`Open ${current.title} in AudioSpace`}
        >
          <TrackArtworkBadge track={current} size="sm" />
          <span className="island-np-meta">
            <span className="island-np-title">{current.title}</span>
            <span className="island-np-sub">
              <AudioEqualizer playing={player.playing} variant="island-panel" />
              <span>{player.playing ? "Playing" : "Paused"} · {current.subtitle || trackSourceLabel(current.source)}</span>
            </span>
          </span>
        </button>

        <div className="island-np-controls">
          <button
            type="button"
            className="island-np-btn"
            onClick={player.previous}
            disabled={!hasQueue}
            aria-label="Previous track"
            title="Previous track"
          >
            <SkipBack size={13} />
          </button>
          <button
            type="button"
            className="island-np-play"
            onClick={player.toggle}
            aria-label={player.playing ? "Pause" : "Play"}
            title={player.playing ? "Pause" : "Play"}
          >
            {player.playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            className="island-np-btn"
            onClick={player.next}
            disabled={!hasQueue}
            aria-label="Next track"
            title="Next track"
          >
            <SkipForward size={13} />
          </button>
          <button
            type="button"
            className="island-np-btn island-np-close"
            onClick={player.close}
            aria-label="Close audio player"
            title="Stop and close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="island-np-progress-row">
        <span className="island-np-time">{formatDuration(clampedTime)}</span>
        <div className="island-np-seek-wrap">
          <span className="island-np-seek-track" aria-hidden="true">
            <span className="island-np-seek-fill" style={{ width: `${progressPct}%` }} />
          </span>
          <input
            type="range"
            className="island-np-seek"
            min={0}
            max={totalDuration || 1}
            step={0.1}
            value={Math.min(clampedTime, totalDuration || 1)}
            disabled={!totalDuration}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label="Seek audio position"
          />
        </div>
        <span className="island-np-time">{formatDuration(totalDuration)}</span>
      </div>

      {player.error && (
        <div className="island-np-error" role="status">
          <AlertCircle size={11} />
          <span>{player.error}</span>
        </div>
      )}
    </div>
  );
}

type PlayerMode = "collapsed" | "compact" | "expanded";

/**
 * Minimal Vengeance UI-inspired floating glass media player scoped exclusively
 * to AudioSpace (`AudioSpaceView`). Supports collapsed mini-pill, compact bar,
 * and expanded detail controls while sharing the workspace-wide audio engine.
 */
export default function AudioPlayerBar({ player }: { player: AudioPlayerApi }) {
  const [mode, setMode] = useState<PlayerMode>("compact");
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const lastNonZeroVolumeRef = useRef(1);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const host = document.querySelector<HTMLElement>(".workspace-main");
    setPortalHost(host);
  }, []);

  useEffect(() => {
    if (player.volume > 0) {
      lastNonZeroVolumeRef.current = player.volume;
    }
  }, [player.volume]);

  const current = player.current;
  if (!current) return null;

  const totalDuration = player.duration || current.durationSeconds || 0;
  const clampedTime = totalDuration > 0 ? Math.min(player.currentTime, totalDuration) : player.currentTime;
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, clampedTime / totalDuration)) : 0;
  const progressPct = progress * 100;
  const hasQueue = player.queue.length > 1;
  const isCollapsed = mode === "collapsed";
  const isExpanded = mode === "expanded";

  const toggleMute = () => {
    if (player.volume === 0) {
      player.setVolume(lastNonZeroVolumeRef.current || 1);
    } else {
      lastNonZeroVolumeRef.current = player.volume;
      player.setVolume(0);
    }
  };

  const dock = (
    <div className="as-player-dock">
      <section
        className={`as-mini-player is-${mode}`}
        data-player-mode={mode}
        aria-label="AudioSpace audio player"
      >
        {player.error && !isCollapsed && (
          <div className="as-mini-error" role="alert">
            <AlertCircle size={13} />
            <span>{player.error}</span>
          </div>
        )}

        {isCollapsed ? (
          <div className="as-mini-pill-row">
            <AudioEqualizer playing={player.playing} variant="player" />
            <button
              type="button"
              className="as-mini-play as-mini-play--sm"
              onClick={player.toggle}
              aria-label={player.playing ? "Pause" : "Play"}
              title={player.playing ? "Pause" : "Play"}
            >
              {player.playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button
              type="button"
              className="as-mini-icon-btn"
              onClick={player.next}
              disabled={!hasQueue}
              aria-label="Next track"
              title="Next track"
            >
              <SkipForward size={13} />
            </button>
            <span className="as-mini-pill-time" title={current.title}>
              {formatDuration(clampedTime)}
            </span>
            <button
              type="button"
              className="as-mini-toggle-pill"
              onClick={() => setMode("compact")}
              aria-label="Expand player"
              title={`Expand player (${current.title})`}
            >
              <Plus size={13} />
            </button>
          </div>
        ) : (
          <div className="as-mini-compact-row">
            <TrackArtworkBadge track={current} size="md" />

            <div className="as-mini-meta">
              <div className="as-mini-title-row">
                <AudioEqualizer playing={player.playing} variant="player" />
                <b className="as-mini-title" title={current.title}>
                  {current.title}
                </b>
              </div>
              <small className="as-mini-sub">
                <span>{current.subtitle || trackSourceLabel(current.source)}</span>
                <span aria-hidden="true">·</span>
                <span className="as-mini-tabular">
                  {formatDuration(clampedTime)} / {formatDuration(totalDuration)}
                </span>
              </small>
            </div>

            <div className="as-mini-transport">
              <button
                type="button"
                className="as-mini-icon-btn"
                onClick={player.previous}
                disabled={!hasQueue}
                aria-label="Previous track"
                title="Previous track"
              >
                <SkipBack size={14} />
              </button>
              <button
                type="button"
                className="as-mini-play"
                onClick={player.toggle}
                aria-label={player.playing ? "Pause" : "Play"}
                title={player.playing ? "Pause" : "Play"}
              >
                {player.playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                type="button"
                className="as-mini-icon-btn"
                onClick={player.next}
                disabled={!hasQueue}
                aria-label="Next track"
                title="Next track"
              >
                <SkipForward size={14} />
              </button>
            </div>

            <div className="as-mini-utilities">
              <button
                type="button"
                className={`as-mini-icon-btn ${isExpanded ? "is-active" : ""}`.trim()}
                onClick={() => setMode(isExpanded ? "compact" : "expanded")}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? "Hide extra audio controls" : "More audio controls"}
                title={isExpanded ? "Hide extra controls" : "Volume, speed & waveform"}
              >
                <SlidersHorizontal size={13} />
              </button>
              <button
                type="button"
                className="as-mini-icon-btn"
                onClick={() => setMode("collapsed")}
                aria-label="Minimize player"
                title="Collapse to mini pill"
              >
                <Minus size={13} />
              </button>
              <button
                type="button"
                className="as-mini-icon-btn as-mini-close"
                onClick={player.close}
                aria-label="Close player"
                title="Stop and close"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {isExpanded && (
          <div className="as-mini-drawer">
            <div className="as-mini-wave-row">
              <span className="as-mini-time">{formatDuration(clampedTime)}</span>
              <div className="as-seek-wrap">
                <WaveformBars peaks={player.peaks} progress={progress} className="as-player-wave" />
                <input
                  type="range"
                  className="as-seek-range"
                  min={0}
                  max={totalDuration || 1}
                  step={0.1}
                  value={Math.min(clampedTime, totalDuration || 1)}
                  disabled={!totalDuration}
                  onChange={(event) => player.seek(Number(event.target.value))}
                  aria-label="Seek timeline"
                />
              </div>
              <span className="as-mini-time">{formatDuration(totalDuration)}</span>
            </div>

            <div className="as-mini-extra-row">
              <div className="as-mini-skip-group">
                <button
                  type="button"
                  className="as-mini-chip-btn"
                  onClick={() => player.skip(-10)}
                  aria-label="Back 10 seconds"
                  title="Back 10 seconds"
                >
                  <RotateCcw size={12} />
                  <span>10s</span>
                </button>
                <button
                  type="button"
                  className="as-mini-chip-btn"
                  onClick={() => player.skip(10)}
                  aria-label="Forward 10 seconds"
                  title="Forward 10 seconds"
                >
                  <RotateCw size={12} />
                  <span>10s</span>
                </button>
              </div>

              <div className="as-mini-volume-group">
                <button
                  type="button"
                  className="as-mini-icon-btn"
                  onClick={toggleMute}
                  aria-label={player.volume === 0 ? "Unmute" : "Mute"}
                  title={player.volume === 0 ? "Unmute" : "Mute"}
                >
                  {player.volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </button>
                <input
                  type="range"
                  className="as-volume-range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={player.volume}
                  onChange={(event) => player.setVolume(Number(event.target.value))}
                  aria-label="Volume"
                />
              </div>

              <label className="as-rate-label">
                <span className="sr-only">Playback speed</span>
                <select
                  className="as-rate-select"
                  value={player.rate}
                  onChange={(event) => player.setRate(Number(event.target.value))}
                  aria-label="Playback speed"
                >
                  {PLAYBACK_RATES.map((rateOption) => (
                    <option key={rateOption} value={rateOption}>
                      {rateOption}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {!isExpanded && (
          <div className="as-mini-progress">
            <span className="as-mini-progress-track" aria-hidden="true">
              <span className="as-mini-progress-fill" style={{ width: `${progressPct}%` }} />
            </span>
            <input
              type="range"
              className="as-mini-progress-input"
              min={0}
              max={totalDuration || 1}
              step={0.1}
              value={Math.min(clampedTime, totalDuration || 1)}
              disabled={!totalDuration}
              onChange={(event) => player.seek(Number(event.target.value))}
              aria-label="Seek position"
            />
          </div>
        )}
      </section>
    </div>
  );

  return portalHost ? createPortal(dock, portalHost) : dock;
}
