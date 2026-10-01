import type { TimelineEvent, VaultItem } from "../types";

function dateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function autoEvent(item: VaultItem, field: string, date: string, label: string, title?: string): TimelineEvent {
  const key = `auto:${item.id}:${field}:${date}`;
  return { id: key, eventType: "automatic", eventDate: date, title: title || `${item.title} · ${label}`, description: `Persora automatically added this ${label.toLowerCase()} event from your linked record.`, eventKey: key, recordId: item.id, linkedRecordIds: [item.id], createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` };
}

/** Builds local catch-up events. The server repeats this date scan before saving, so offline dates are deduplicated on reconnect. */
export function deriveAutomaticTimelineEvents(items: VaultItem[], timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", now = new Date()): TimelineEvent[] {
  const today = dateInTimeZone(now, timeZone);
  const events: TimelineEvent[] = [];
  const fixedFields: Record<string, [string, string][]> = {
    documents: [["issueDate", "Issue date"], ["expiryDate", "Expiry date"]],
    academics: [["paymentDate", "Payment date"]],
    subscriptions: [["startDate", "Subscription start date"], ["renewalDate", "Renewal date"]],
    purchases: [["purchaseDate", "Purchase date"], ["warrantyExpiry", "Warranty expiry"]],
    memberships: [["startDate", "Membership start date"], ["expiryDate", "Membership expiry"]],
    accounts: [["registered", "Account registration"]],
  };
  for (const item of items) {
    const type = item.metadata.recordType;
    if (item.section === "notes") {
      if (type === "todo" && item.metadata.completed !== "true" && validDate(item.metadata.dueDate || "") && item.metadata.dueDate! <= today) {
        events.push(autoEvent(item, "dueDate", item.metadata.dueDate!, "Task due date"));
      } else if (type === "reminder" && item.metadata.enabled !== "false" && item.metadata.reminderAt) {
        const scheduled = new Date(item.metadata.reminderAt);
        if (!Number.isNaN(scheduled.getTime())) {
          const day = dateInTimeZone(scheduled, timeZone);
          if (day <= today) events.push(autoEvent(item, "reminderAt", day, "Reminder", `${item.title} · Reminder`));
        }
      }
    }
    for (const [field, label] of fixedFields[item.section] || []) {
      const date = item.metadata[field] || "";
      if (validDate(date) && date <= today) events.push(autoEvent(item, field, date, label));
    }
    if (item.section === "family" && item.metadata.dateOfBirth) {
      const birthday = item.metadata.dateOfBirth.slice(5, 10);
      if (/^\d{2}-\d{2}$/.test(birthday)) {
        const thisYear = `${today.slice(0, 4)}-${birthday}`;
        if (validDate(thisYear) && thisYear <= today) events.push(autoEvent(item, "dateOfBirth", thisYear, "Birthday", `${item.title} · Birthday`));
      }
    }
  }
  return events;
}

export function mergeTimelineEvents(saved: TimelineEvent[], automatic: TimelineEvent[], online: boolean): TimelineEvent[] {
  const visibleSaved = saved.filter((event) => !(event.eventType === "automatic" && /:alarm(?:Date)?:/i.test(event.eventKey || "")));
  const savedKeys = new Set(visibleSaved.map((event) => event.eventKey).filter(Boolean));
  const pending = automatic.filter((event) => !savedKeys.has(event.eventKey)).map((event) => ({ ...event, pending: !online }));
  const merged = [...visibleSaved, ...pending];
  const byId = new Map(merged.map((event) => [event.id, event]));
  return [...byId.values()].sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.createdAt.localeCompare(b.createdAt));
}
