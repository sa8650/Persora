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
