// AudioSpace — persistent player engine + compact mini-player.
//
// One HTMLAudioElement drives playback everywhere in AudioSpace: clicking any
// card, row or list item plays through this player, and the mini-player stays
// docked at the bottom of the page while the member browses other AudioSpace
// sections. Uploaded/recorded audio streams from the private API (cookie
// session, Range-capable); external links play from their original URL.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ListMusic, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from "lucide-react";
import type { AudioSpaceItem } from "../../types";
import { loadAudioSpaceFile, markAudioSpacePlayed } from "../../lib/cloud";
import { formatDuration } from "../../lib/audio-space";
import "./audio-space.css";

export interface PlayerTrack {
  id: string;
  title: string;
  source: AudioSpaceItem["source"];
  /** Original URL for external links; empty for private files (loaded via the authenticated API). */
  src: string;
  durationSeconds: number | null;
  external: boolean;
}

export function trackForItem(item: AudioSpaceItem): PlayerTrack {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    // External tracks play straight from their original URL. Private files must
    // go through the authenticated API (plain <audio src> never sends the
    // session cookie cross-origin), so the player loads them itself by id.
    src: item.source === "link" ? item.externalUrl || "" : "",
    durationSeconds: item.durationSeconds,
    external: item.source === "link",
  };
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const PEAK_BARS = 56;
const PEAK_MAX_BYTES = 12 * 1024 * 1024;

async function computePeaks(item: AudioSpaceItem): Promise<number[] | null> {
  if (item.source === "link" || !item.fileSize || item.fileSize > PEAK_MAX_BYTES) return null;
  try {
    const blob = await loadAudioSpaceFile(item.id);
    const context = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const channel = buffer.getChannelData(0);
      const block = Math.max(1, Math.floor(channel.length / PEAK_BARS));
      const peaks: number[] = [];
      for (let index = 0; index < PEAK_BARS; index++) {
        let peak = 0;
        const start = index * block;
        for (let sample = 0; sample < block; sample += 8) {
          const value = Math.abs(channel[start + sample] || 0);
          if (value > peak) peak = value;
        }
        peaks.push(Math.max(0.04, Math.min(1, peak)));
      }
      return peaks;
    } finally {
      void context.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

export interface AudioPlayerApi {
  current: PlayerTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  rate: number;
  peaks: number[] | null;
  error: string;
  queue: PlayerTrack[];
  playTrack: (track: PlayerTrack, queue: PlayerTrack[]) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  next: () => void;
  previous: () => void;
  setVolume: (volume: number) => void;
  setRate: (rate: number) => void;
  close: () => void;
  peaksFor: (id: string) => number[] | null;
  /** Registers the visible items so waveform peaks can be computed lazily. */
  registerItems: (items: AudioSpaceItem[]) => void;
}

export function useAudioPlayer(onTrackStarted?: (track: PlayerTrack) => void): AudioPlayerApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<PlayerTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const peakCache = useRef(new Map<string, number[]>());
  const startedIds = useRef(new Set<string>());
  const startedHandler = useRef(onTrackStarted);
  startedHandler.current = onTrackStarted;
  // Blob URL for the in-memory copy of the currently loaded private file.
  const objectUrlRef = useRef<string | null>(null);
  // Bumped on every load/close so stale async loads can never touch the player.
  const loadTokenRef = useRef(0);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  if (!audioRef.current && typeof Audio !== "undefined") {
    const element = new Audio();
    element.preload = "metadata";
    audioRef.current = element;
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => {
      setPlaying(true);
      setError("");
      const id = currentRef.current?.id;
      if (id && !startedIds.current.has(id)) {
        startedIds.current.add(id);
        void markAudioSpacePlayed(id).catch(() => undefined);
        if (startedHandler.current && currentRef.current) startedHandler.current(currentRef.current);
      }
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); nextRef.current(); };
    const onError = () => {
      setPlaying(false);
      const track = currentRef.current;
      setError(track?.external
        ? "This external source can't be streamed here. Open the original link or try another source."
        : "This audio couldn't be played. Please try again.");
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      loadTokenRef.current += 1;
      audio.pause();
      audio.removeAttribute("src");
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentRef = useRef<PlayerTrack | null>(null);
  currentRef.current = current;

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate]);

  const startTrack = useCallback((track: PlayerTrack) => {
    const audio = audioRef.current;
    if (!audio) return;
    const token = ++loadTokenRef.current;
    setError("");
    setCurrent(track);
    setCurrentTime(0);
    setDuration(track.durationSeconds || 0);
    audio.pause();
    releaseObjectUrl();
    audio.removeAttribute("src");
    const beginPlayback = (src: string) => {
      if (loadTokenRef.current !== token) return;
      audio.src = src;
      audio.load();
      void audio.play().catch(() => {
        if (loadTokenRef.current !== token) return;
        setError(track.external
          ? "This external source can't be streamed here. Open the original link or try another source."
          : "Playback couldn't start. Please try again.");
      });
    };
    if (track.external) {
      setPeaks(null);
      if (!track.src) { setError("This link has no playable URL."); return; }
      beginPlayback(track.src);
      return;
    }
    const cached = peakCache.current.get(track.id);
    setPeaks(cached || null);
    void (async () => {
      // Private files are fetched with the account cookie (the API is
      // cross-origin, so a plain <audio src> would never authenticate) and
      // played from an in-memory object URL — the pattern Photo Studio uses
      // for private images.
      try {
        const blob = await loadAudioSpaceFile(track.id);
        const url = URL.createObjectURL(blob);
        if (loadTokenRef.current !== token) { URL.revokeObjectURL(url); return; }
        objectUrlRef.current = url;
        beginPlayback(url);
      } catch {
        if (loadTokenRef.current === token) setError("This audio couldn't be loaded. Please try again.");
        return;
      }
      if (cached) return;
      const item = itemsRef.current.get(track.id);
      if (!item) return;
      const computed = await computePeaks(item);
      if (!computed) return;
      peakCache.current.set(track.id, computed);
      if (currentRef.current?.id === track.id) setPeaks(computed);
    })();
  }, [releaseObjectUrl]);

  const itemsRef = useRef(new Map<string, AudioSpaceItem>());
  const registerItems = useCallback((items: AudioSpaceItem[]) => {
    const map = itemsRef.current;
    map.clear();
    for (const item of items) map.set(item.id, item);
    // Drop cached peaks for deleted items so the cache can't grow unbounded.
    for (const id of peakCache.current.keys()) {
      if (!map.has(id)) peakCache.current.delete(id);
    }
  }, []);

  const playTrack = useCallback((track: PlayerTrack, nextQueue: PlayerTrack[]) => {
    setQueue(nextQueue);
    if (currentRef.current?.id === track.id) {
      const audio = audioRef.current;
      if (!audio || !audio.getAttribute("src")) return; // still loading — nothing to toggle yet
      if (audio.paused) void audio.play().catch(() => undefined);
      else audio.pause();
      return;
    }
    startTrack(track);
  }, [startTrack]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.getAttribute("src") || !currentRef.current) return;
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
    setCurrentTime(audio.currentTime);
  }, []);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seek(audio.currentTime + delta);
  }, [seek]);

  const next = useCallback(() => {
    const active = currentRef.current;
    if (!active || queue.length < 2) return;
    const index = queue.findIndex((track) => track.id === active.id);
    if (index < 0) return;
    const track = queue[(index + 1) % queue.length];
    if (track) startTrack(track);
  }, [queue, startTrack]);

  const previous = useCallback(() => {
    const active = currentRef.current;
    if (!active) return;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) { seek(0); return; }
    if (queue.length < 2) { seek(0); return; }
    const index = queue.findIndex((track) => track.id === active.id);
    if (index < 0) return;
    const track = queue[(index - 1 + queue.length) % queue.length];
    if (track) startTrack(track);
  }, [queue, seek, startTrack]);

  const nextRef = useRef(next);
  nextRef.current = next;

  const setVolume = useCallback((value: number) => setVolumeState(Math.max(0, Math.min(1, value))), []);
  const setRate = useCallback((value: number) => setRateState(value), []);

  const close = useCallback(() => {
    loadTokenRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    releaseObjectUrl();
    setCurrent(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPeaks(null);
    setError("");
    setQueue([]);
  }, [releaseObjectUrl]);

  const peaksFor = useCallback((id: string) => peakCache.current.get(id) || null, []);

  return {
    current, playing, currentTime, duration, volume, rate, peaks, error, queue,
    playTrack, toggle, seek, skip, next, previous, setVolume, setRate, close,
    peaksFor, registerItems,
  };
}

export function WaveformBars({ peaks, progress, className = "" }: { peaks: number[] | null; progress: number; className?: string }) {
  const bars = peaks || [];
  return <div className={`as-waveform ${className}`.trim()} aria-hidden="true">
    {bars.length
      ? bars.map((value, index) => (
        <span key={index} className={index / bars.length <= progress ? "as-wave-bar is-played" : "as-wave-bar"} style={{ height: `${Math.round(value * 100)}%` }} />
      ))
      : Array.from({ length: 28 }, (_, index) => <span key={index} className="as-wave-bar is-idle" style={{ height: `${18 + ((index * 37) % 60)}%` }} />)}
  </div>;
}

interface BarProps {
  player: AudioPlayerApi;
  onNavigateItem?: (id: string) => void;
}

export default function AudioPlayerBar({ player, onNavigateItem }: BarProps) {
  const { current, playing, currentTime, duration, volume, rate, peaks, error, queue } = player;
  const total = duration || current?.durationSeconds || 0;
  const progress = total > 0 ? Math.min(1, currentTime / total) : 0;
  const volumeIcon = volume <= 0 ? <VolumeX size={15}/> : volume < 0.5 ? <Volume1 size={15}/> : <Volume2 size={15}/>;
  const queueIndex = useMemo(() => queue.findIndex((track) => track.id === current?.id), [queue, current]);
  if (!current) return null;
  return <div className="as-player" role="region" aria-label="Audio player">
    {error ? <div className="as-player-error" role="alert"><AlertTriangle size={13}/> {error}</div> : null}
    <div className="as-player-main">
      <button type="button" className="as-player-thumb" onClick={() => onNavigateItem?.(current.id)} title={current.title}>
        <ListMusic size={17}/>
      </button>
      <div className="as-player-info">
        <b title={current.title}>{current.title}</b>
        <small>{current.source === "recording" ? "Recording" : current.source === "link" ? "Audio link" : "Upload"}{queue.length > 1 && queueIndex >= 0 ? ` · ${queueIndex + 1} of ${queue.length}` : ""}</small>
      </div>
      <div className="as-player-controls">
        <button type="button" className="as-icon-button" onClick={player.previous} disabled={queue.length < 2} aria-label="Previous audio" title="Previous"><SkipBack size={15}/></button>
        <button type="button" className="as-icon-button" onClick={() => player.skip(-10)} aria-label="Skip backward 10 seconds" title="Back 10s"><ChevronLeft size={15}/></button>
        <button type="button" className="as-play-button" onClick={player.toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}
        </button>
        <button type="button" className="as-icon-button" onClick={() => player.skip(10)} aria-label="Skip forward 10 seconds" title="Forward 10s"><ChevronRight size={15}/></button>
        <button type="button" className="as-icon-button" onClick={player.next} disabled={queue.length < 2} aria-label="Next audio" title="Next"><SkipForward size={15}/></button>
      </div>
      <div className="as-player-seek">
        <span className="as-player-time">{formatDuration(currentTime)}</span>
        <div className="as-seek-wrap">
          <WaveformBars peaks={peaks} progress={progress} className="as-player-wave"/>
          <input
            type="range"
            className="as-seek-range"
            min={0}
            max={Math.max(1, total)}
            step={0.1}
            value={Math.min(currentTime, Math.max(1, total))}
            onChange={(event) => player.seek(Number(event.target.value))}
            aria-label="Seek"
          />
        </div>
        <span className="as-player-time">{formatDuration(total)}</span>
      </div>
      <div className="as-player-extra">
        <select className="as-rate-select" value={rate} onChange={(event) => player.setRate(Number(event.target.value))} aria-label="Playback speed" title="Playback speed">
          {RATES.map((value) => <option key={value} value={value}>{value}x</option>)}
        </select>
        <button type="button" className="as-icon-button" onClick={() => player.setVolume(volume <= 0 ? 1 : 0)} aria-label={volume <= 0 ? "Unmute" : "Mute"} title={volume <= 0 ? "Unmute" : "Mute"}>
          {volumeIcon}
        </button>
        <input
          type="range"
          className="as-volume-range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
          aria-label="Volume"
        />
        <button type="button" className="as-icon-button" onClick={player.close} aria-label="Close player" title="Close player"><X size={15}/></button>
      </div>
    </div>
  </div>;
}
