export type QuickAddItemType = "event" | "task" | "appointment";

export interface QuickAddRecurrence {
  freq: "daily" | "weekly" | "monthly";
  interval: number;
  until: string | null;
  count: number | null;
}

/** Fields an answer applies to the preview. */
export interface QuickAddPatch {
  date?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  recurrence?: { freq: "daily" | "weekly" | "monthly"; interval: number } | null;
  reminderMinutes?: number;
  itemType?: QuickAddItemType;
}

export interface QuickAddQuestion {
  id: string;
  field: "date" | "time" | "repeat" | "reminder";
  message: string;
  options: { label: string; patch: QuickAddPatch }[];
  blocking: boolean;
}

export interface QuickAddResult {
  input: string;
  title: string;
  /** Type suggested by the text (prefix or keywords), or null. */
  itemType: QuickAddItemType | null;
  date: string | null;
  allDay: boolean | null;
  startTime: string | null;
  endTime: string | null;
  endDate: string | null;
  durationMinutes: number | null;
  recurrence: QuickAddRecurrence | null;
  /** undefined = not mentioned; null = mentioned but needs an answer. */
  reminderMinutes: number | null | undefined;
  questions: QuickAddQuestion[];
  recognized: { kind: string; text: string }[];
  hasSchedule: boolean;
}

export declare const REMINDER_CHOICES: readonly number[];
export declare const DEFAULT_DURATIONS: Readonly<Record<QuickAddItemType, number>>;

export declare function parseQuickAdd(
  text: string,
  options?: {
    now?: number;
    zone?: string;
    context?: { date: string; time: string | null; allDay?: boolean } | null;
    itemType?: QuickAddItemType | null;
    weekStartsOn?: number;
  },
): QuickAddResult;

export interface QuickAddFields {
  title: string;
  itemType: QuickAddItemType;
  date: string | null;
  allDay: boolean | null;
  startTime: string | null;
  endTime: string | null;
  recurrence: QuickAddRecurrence | null;
  reminderMinutes: number | null | undefined;
}

export declare function resolveQuickAdd(
  result: QuickAddResult,
  options?: { answers?: Record<string, QuickAddPatch>; touched?: string[]; itemType?: QuickAddItemType | null },
): { fields: QuickAddFields; open: QuickAddQuestion[] };

export declare function quickAddToInput(
  fields: QuickAddFields,
  options: { zone: string; defaults?: { description?: string; location?: string; category?: import("../../cloudflare/calendar-rules.js").CalendarCategory | null } },
): import("../../cloudflare/calendar-rules.js").EventInput | null;
