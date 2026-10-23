// Habit Tracker — curated icons, colours and labels (no remote assets).
import {
  Apple, BedDouble, Bike, BookOpen, Brain, CheckCircle2, Code2, Droplet, Dumbbell, Flower2, Footprints, Heart, Languages, Leaf, Moon,
  Music, PenLine, Pill, Salad, Smile, Sparkles, Sun, Timer, Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { HabitCategory, HabitColor, HabitIcon } from "../../../cloudflare/habit-rules.js";
import type { Habit } from "../../lib/habit-api";

export const HABIT_ICON_COMPONENTS: Record<HabitIcon, LucideIcon> = {
  check: CheckCircle2, droplet: Droplet, book: BookOpen, dumbbell: Dumbbell, footprints: Footprints, bike: Bike, bed: BedDouble,
  apple: Apple, salad: Salad, leaf: Leaf, brain: Brain, pen: PenLine, code: Code2, music: Music, heart: Heart, sun: Sun, moon: Moon,
  pill: Pill, wallet: Wallet, sparkles: Sparkles, languages: Languages, flower: Flower2, timer: Timer, smile: Smile,
};

export const HABIT_ICON_LABELS: Record<HabitIcon, string> = {
  check: "Checkmark", droplet: "Water", book: "Book", dumbbell: "Weights", footprints: "Steps", bike: "Bike", bed: "Sleep",
  apple: "Fruit", salad: "Healthy meal", leaf: "Leaf", brain: "Mind", pen: "Writing", code: "Code", music: "Music", heart: "Heart",
  sun: "Morning", moon: "Evening", pill: "Medicine", wallet: "Money", sparkles: "Sparkle", languages: "Language", flower: "Flower",
  timer: "Timer", smile: "Mood",
};

export const HABIT_COLOR_LABELS: Record<HabitColor, string> = {
  blue: "Blue", teal: "Teal", green: "Green", lime: "Lime", amber: "Amber", orange: "Orange", red: "Red", pink: "Pink",
  violet: "Violet", indigo: "Indigo", slate: "Slate",
};

export const CATEGORY_LABELS: Record<HabitCategory, string> = {
  health: "Health", study: "Study", fitness: "Fitness", personal: "Personal", work: "Work",
};

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function HabitGlyph({ habit, size = 16 }: { habit: Pick<Habit, "icon" | "color">; size?: number }) {
  const Icon = HABIT_ICON_COMPONENTS[habit.icon] || CheckCircle2;
  return <span className={`hb-glyph hb-c-${habit.color}`} aria-hidden="true"><Icon size={size} strokeWidth={2.1}/></span>;
}

const formatNumber = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
export { formatNumber };

/** "Every day", "Mon, Wed, Fri", "3× per week". */
export function scheduleLabel(habit: Pick<Habit, "frequency" | "weekdays" | "weeklyTarget">): string {
  if (habit.frequency === "daily") return "Every day";
  if (habit.frequency === "weekly") return `${habit.weeklyTarget ?? 1}× per week`;
  const days = [...habit.weekdays].sort((a, b) => a - b);
  if (days.length === 7) return "Every day";
  if (days.join() === "1,2,3,4,5") return "Weekdays";
  if (days.join() === "0,6") return "Weekends";
  return days.map((day) => WEEKDAY_SHORT[day]).join(", ");
}

export function targetLabel(habit: Pick<Habit, "tracking" | "targetValue" | "unit">): string {
  if (habit.tracking !== "numeric" || !habit.targetValue) return "";
  return `${formatNumber(habit.targetValue)}${habit.unit ? ` ${habit.unit}` : ""}`;
}

export function streakLabel(count: number, unit: "day" | "week"): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** Formats a local "YYYY-MM-DD" without shifting it through a time zone. */
export function formatDay(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
