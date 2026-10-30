// AudioSpace — browser-side helpers shared by the AudioSpace views.
//
// Pure formatting, filtering and validation logic (kept out of the components
// so tests can cover it). Format sniffing and external-link safety rules are
// shared with the Pages Functions through cloudflare/audio-format.js.
import type { AudioSpaceItem, VaultFolder } from "../types";
import {
  AUDIO_FORMATS as SHARED_AUDIO_FORMATS,
  detectAudioFormat as sharedDetectAudioFormat,
  isSafeExternalAudioUrl,
  normalizeExternalUrl,
  sniffAudioFormat as sharedSniffAudioFormat,
} from "../../cloudflare/audio-format.js";

export const AUDIO_FORMATS = SHARED_AUDIO_FORMATS;
export const detectAudioFormat = sharedDetectAudioFormat;
export const sniffAudioFormat = sharedSniffAudioFormat;
export { isSafeExternalAudioUrl, normalizeExternalUrl };

/** Accept attribute for audio file pickers (spec formats + WebM recordings). */
export const AUDIO_UPLOAD_ACCEPT = [
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac",
  "audio/ogg", "audio/flac", "audio/webm",
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".flac", ".webm",
].join(",");

/** Formats AudioSpace saves, for picker hints and empty-state copy. */
export const SUPPORTED_AUDIO_LABEL = "MP3, WAV, M4A, AAC, OGG, FLAC";

export type AudioSort = "newest" | "oldest" | "title" | "longest" | "shortest";
export type AudioSection = "all" | "recent" | "favorites" | "recordings" | "links";

export const AUDIO_SECTIONS: { id: AudioSection; label: string }[] = [
  { id: "all", label: "All Audio" },
  { id: "recent", label: "Recent" },
  { id: "favorites", label: "Favorites" },
  { id: "recordings", label: "My Recordings" },
  { id: "links", label: "Audio Links" },
];

/** "3:07" or "1:02:33" — whole seconds, no leading zero on the hour part. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—:—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** File-size display reusing the vault's human-size formatting. */
export function formatAudioBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** A readable default title from a file name (extension stripped). */
export function defaultAudioTitleFromFileName(name: string): string {
  const base = String(name || "").normalize("NFKC").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").replace(/^[.\s]+/, "").trim();
  return (base || "Recording").slice(0, 120);
}

/** Parses a comma-separated tag field into normalized, de-duplicated tags. */
export function tagsFromInput(value: string): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const piece of String(value || "").split(",")) {
    const tag = piece.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
    if (output.length >= 24) break;
  }
  return output;
}

/** Renders a tag list back into the comma-separated edit field. */
export function tagsToInput(tags: string[]): string {
  return tags.join(", ");
}

/** Quick client-side link sanity check (the server performs the real probe). */
export function checkAudioLinkInput(rawUrl: string): string | null {
  try {
    normalizeExternalUrl(rawUrl);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "That audio link is not valid.";
  }
}

/** Total bytes of the private (uploaded/recorded) items in a list. */
export function privateStorageBytes(items: AudioSpaceItem[]): number {
  return items.reduce((sum, item) => sum + (item.fileSize || 0), 0);
}

/** Per-folder counts ("all" = every item) for the folder shelf. */
export function folderCounts(items: AudioSpaceItem[]): Record<string, number> {
  const counts: Record<string, number> = { all: items.length };
  for (const item of items) {
    const key = item.folderId || "none";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function matchesQuery(item: AudioSpaceItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [item.title, item.description, item.fileName || "", item.externalUrl || "", item.tags.join(" ")]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

function withinSection(item: AudioSpaceItem, section: AudioSection): boolean {
  switch (section) {
    case "favorites": return item.favorite;
    case "recordings": return item.source === "recording";
    case "links": return item.source === "link";
    case "recent": return true;
    default: return true;
  }
}

/** Sort comparator for the chosen library ordering. */
export function sortAudioItems(items: AudioSpaceItem[], sort: AudioSort): AudioSpaceItem[] {
  const copy = [...items];
  switch (sort) {
    case "oldest": return copy.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    case "title": return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    case "longest": return copy.sort((a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1));
    case "shortest": return copy.sort((a, b) => (a.durationSeconds ?? Number.POSITIVE_INFINITY) - (b.durationSeconds ?? Number.POSITIVE_INFINITY));
    default: return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
}

export interface AudioFilterOptions {
  section: AudioSection;
  query: string;
  folderId: string;
  tag?: string;
  sort: AudioSort;
}

/**
 * Section + folder + search + tag filtering with sorting.
 * The Recent section orders by the newest of added/recorded/played first.
 */
export function filterAudioItems(items: AudioSpaceItem[], options: AudioFilterOptions): AudioSpaceItem[] {
  const scoped = items.filter((item) => withinSection(item, options.section))
    .filter((item) => (options.folderId ? item.folderId === options.folderId : true))
    .filter((item) => (options.tag ? item.tags.some((tag) => tag.toLocaleLowerCase() === options.tag!.toLocaleLowerCase()) : true))
    .filter((item) => matchesQuery(item, options.query));
  if (options.section === "recent") {
    const recency = (item: AudioSpaceItem) => Math.max(Date.parse(item.createdAt) || 0, item.lastPlayedAt ? Date.parse(item.lastPlayedAt) || 0 : 0);
    return scoped.sort((a, b) => recency(b) - recency(a));
  }
  return sortAudioItems(scoped, options.sort);
}

/** Section counts for the dashboard tabs. */
export function sectionCounts(items: AudioSpaceItem[]): Record<AudioSection, number> {
  return {
    all: items.length,
    recent: items.length,
    favorites: items.filter((item) => item.favorite).length,
    recordings: items.filter((item) => item.source === "recording").length,
    links: items.filter((item) => item.source === "link").length,
  };
}

/** Source label used on cards and detail rows. */
export function sourceLabel(item: AudioSpaceItem): string {
  return item.source === "recording" ? "Recording" : item.source === "link" ? "Audio link" : "Upload";
}

/** Folder name lookup helper. */
export function folderName(folders: VaultFolder[], id: string | null): string {
  if (!id) return "";
  return folders.find((folder) => folder.id === id)?.name || "";
}

/** "Today · 3:07 PM"-style stamp used in compact metadata lines. */
export function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
