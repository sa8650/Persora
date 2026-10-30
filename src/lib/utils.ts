import type { VaultItem } from "../types";

export function formatDate(value?: string): string {
  if (!value) return "Not set";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatRelativeDate(value?: string): string {
  if (!value) return "No date added";
  const target = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayCount = Math.round((target - today.getTime()) / 86_400_000);
  if (dayCount < 0) return `Expired ${Math.abs(dayCount)}d ago`;
  if (dayCount === 0) return "Today";
  if (dayCount === 1) return "Tomorrow";
  if (dayCount <= 30) return `In ${dayCount} days`;
  return formatDate(value);
}

export function humanSize(size?: number): string {
  if (!size) return "";
  if (size < 1_000_000) return `${Math.max(1, Math.round(size / 1_000))} KB`;
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
}

const NOTE_MARKUP = /<\/?(?:p|div|br|strong|b|em|i|u|s|ul|ol|li|input|blockquote|figure|figcaption|img)\b[^>]*>/i;
const NOTE_TAGS = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "BLOCKQUOTE"]);
const IMG_SRC_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i;
const NOTE_STYLE_DIMENSION = /^(-?\d+(\.\d+)?(px|%|em|rem|vh|vw)|auto)$/i;

/** Keep only Persora-safe inline style properties (image layouts inside notes). */
function safeNoteStyle(raw: string | null, allowed: ReadonlySet<string>): string {
  if (!raw) return "";
  const kept: string[] = [];
  for (const declaration of raw.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().toLowerCase();
    if (!allowed.has(prop) || !value) continue;
    if (prop === "float") {
      if (!["left", "right", "none"].includes(value)) continue;
    } else if (prop === "display") {
      if (!["block", "inline-block", "inline"].includes(value)) continue;
    } else if (prop === "text-align") {
      if (!["left", "center", "right", "justify"].includes(value)) continue;
    } else if (prop === "clear") {
      if (!["left", "right", "both", "none"].includes(value)) continue;
    } else if (!NOTE_STYLE_DIMENSION.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}
const FIGURE_STYLE_PROPS = new Set(["width", "max-width", "min-width", "height", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "float", "display", "clear", "text-align"]);
const IMG_STYLE_PROPS = new Set(["width", "max-width", "min-width", "height", "border-radius", "display", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"]);

/** Return a safe, deliberately small rich-text subset for Persora notes. */
export function sanitizeNoteHtml(value?: string, readOnly = false): string {
  const input = String(value || "");
  if (!input) return "";
  if (!NOTE_MARKUP.test(input)) return escapeNoteText(input).replace(/\r?\n/g, "<br>");
  if (typeof DOMParser === "undefined" || typeof document === "undefined") return escapeNoteText(input).replace(/\r?\n/g, "<br>");
  const parsed = new DOMParser().parseFromString(input, "text/html");
  const clean = document.createDocumentFragment();
  const copy = (source: Node, target: Node) => {
    source.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) { target.appendChild(document.createTextNode(child.textContent || "")); return; }
      if (!(child instanceof Element)) return;
      const tag = child.tagName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "SVG" || tag === "IFRAME" || tag === "OBJECT") return;
      if (tag === "INPUT") {
        if (child.getAttribute("type")?.toLowerCase() !== "checkbox") return;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = child.hasAttribute("checked");
        if (readOnly) { checkbox.disabled = true; checkbox.setAttribute("aria-label", checkbox.checked ? "Completed task" : "Task"); }
        target.appendChild(checkbox);
        return;
      }
      if (tag === "IMG") {
        // Images are allowed only as inline data URLs produced by the note
        // editor — never remote sources, so notes stay self-contained and
        // cannot be used to track readers or load external content.
        const src = (child.getAttribute("src") || "").replace(/\s/g, "");
        if (!IMG_SRC_RE.test(src)) return;
        const img = document.createElement("img");
        img.setAttribute("src", src);
        img.setAttribute("alt", (child.getAttribute("alt") || "").slice(0, 300));
        const imgStyle = safeNoteStyle(child.getAttribute("style"), IMG_STYLE_PROPS);
        if (imgStyle) img.setAttribute("style", imgStyle);
        target.appendChild(img);
        return;
      }
      if (tag === "FIGURE" || tag === "FIGCAPTION") {
        const wrap = document.createElement(tag.toLowerCase());
        const className = child.getAttribute("class") || "";
        if (tag === "FIGURE" && className.split(/\s+/).includes("note-image")) wrap.setAttribute("class", "note-image");
        const wrapStyle = safeNoteStyle(child.getAttribute("style"), FIGURE_STYLE_PROPS);
        if (wrapStyle) wrap.setAttribute("style", wrapStyle);
        target.appendChild(wrap);
        copy(child, wrap);
        return;
      }
      if (!NOTE_TAGS.has(tag)) { copy(child, target); return; }
      const safe = document.createElement(tag.toLowerCase());
      target.appendChild(safe);
      copy(child, safe);
    });
  };
  copy(parsed.body, clean);
  const container = document.createElement("div");
  container.appendChild(clean);
  return container.innerHTML;
}

export function notePlainText(value?: string): string {
  const input = String(value || "");
  if (typeof DOMParser === "undefined") return input.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
  const parsed = new DOMParser().parseFromString(sanitizeNoteHtml(input), "text/html");
  return (parsed.body.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * Downscale and re-encode an image file into a data URL small enough to be
 * stored inside note HTML (notes persist as HTML, so the bytes must survive
 * sanitization — the sanitizer only accepts data:image URLs).
 */
export async function compressNoteImage(file: File, maxEdge = 1600, maxDataUrlChars = 3_000_000): Promise<string> {
  const readDirect = () => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
  // Small files (and animated GIFs) are kept untouched for fidelity.
  if (file.size <= 512 * 1024) return readDirect();

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file);
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This file does not look like a supported image.")); };
      img.src = url;
    });
  }
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process this image in your browser.");
  context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  if ("close" in source && typeof source.close === "function") source.close();

  const candidates = file.type === "image/png" ? ["image/webp", "image/png"] : ["image/webp", "image/jpeg"];
  for (const type of candidates) {
    const dataUrl = canvas.toDataURL(type, 0.85);
    if (dataUrl.startsWith(`data:${type}`) && dataUrl.length <= maxDataUrlChars) return dataUrl;
    if (dataUrl.startsWith(`data:${type}`) && type === "image/jpeg" && dataUrl.length <= maxDataUrlChars * 1.2) return dataUrl;
  }
  throw new Error("This image is too large to embed in a note. Try a smaller image.");
}

function escapeNoteText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function daysUntil(value?: string): number | null {
  if (!value) return null;
  const target = new Date(`${value.slice(0, 10)}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / 86_400_000);
}


function escapeVCard(value?: string): string {
  return (value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function makeVCard(item: VaultItem): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVCard(item.title)}`];
  const values: [string, string | undefined][] = [
    ["ORG", item.metadata.company],
    ["TITLE", item.metadata.jobTitle],
    ["TEL;TYPE=CELL", item.metadata.phone],
    ["EMAIL;TYPE=INTERNET", item.metadata.email],
    ["URL", item.metadata.website],
    ["URL;TYPE=LinkedIn", item.metadata.linkedin],
  ];
  values.forEach(([key, value]) => { if (value?.trim()) lines.push(`${key}:${escapeVCard(value.trim())}`); });
  if (item.metadata.location) lines.push(`ADR;TYPE=WORK:;;${escapeVCard(item.metadata.location)};;;;`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export { cn } from "cn";
