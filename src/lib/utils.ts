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

const NOTE_MARKUP = /<\/?(?:p|div|br|strong|b|em|i|u|s|ul|ol|li|input|blockquote)\b[^>]*>/i;
const NOTE_TAGS = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "BLOCKQUOTE"]);

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
