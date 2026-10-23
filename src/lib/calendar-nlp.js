// Persora Calendar — deterministic natural-language quick add.
//
// Turns text such as "Study every Friday from 7 to 9 PM" into calendar fields
// with plain date/time rules and regular expressions. No AI model, API or
// network call is involved: the same input, time zone and "now" always give
// the same result, which the tests pin down.
//
// The parser never guesses silently. When something is ambiguous (3 without
// AM/PM, 5/11, "next Wednesday" when that could mean two dates), missing (a
// time with no day) or unsupported (every Monday and Wednesday), it returns a
// question with concrete options. The Calendar shows those and won't save
// until each one is answered or the field is set by hand. Everything parsed is
// shown as editable fields and validated again by the Calendar API.

import { addDays, addMonths, daysInMonth, formatDate, isDateString, localDateOf, localTimeOf, parseDate, startOfWeek, weekdayOf } from "../../cloudflare/calendar-rules.js";

export const REMINDER_CHOICES = Object.freeze([5, 15, 30, 60, 1440]);
export const DEFAULT_DURATIONS = Object.freeze({ event: 60, task: 30, appointment: 30 });

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ALIASES = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45 };

const FULL_WEEKDAY = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday)";
const ANY_WEEKDAY = "(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)";
const MONTH_NAME = "(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)";
const NUMBER = "(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|half\\s+an?)";
// A clock time: 3, 3pm, 3:30, 3:30 pm, 15:00, noon, midnight.
const CLOCK = "(noon|midday|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?(?:\\s*o'?clock)?)";
const B = "(?<![\\p{L}\\p{N}])"; // start-of-word guard (Unicode aware)
const E = "(?![\\p{L}\\p{N}])"; // end-of-word guard

const pad = (value) => String(value).padStart(2, "0");
const toTime = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const re = (source) => new RegExp(source, "giu");

function numberValue(token) {
  const value = String(token).trim().toLowerCase().replace(/\s+/g, " ");
  if (/^half an?$/.test(value)) return 0.5;
  if (value in NUMBER_WORDS) return NUMBER_WORDS[value];
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unitMinutes(unit) {
  const value = unit.toLowerCase();
  if (/^(m|mins?|minutes?)$/.test(value)) return 1;
  if (/^(h|hrs?|hours?)$/.test(value)) return 60;
  if (/^(d|days?)$/.test(value)) return 1440;
  if (/^(w|weeks?)$/.test(value)) return 10080;
  return null;
}

/** "3", "3pm", "3:30 p.m.", "15:00", "noon" → { minutes, meridiem: "am"|"pm"|null, explicit24 } or null. */
function readClock(raw) {
  const text = String(raw).toLowerCase().replace(/\s*o'?clock/, "").trim();
  if (text === "noon" || text === "midday") return { minutes: 12 * 60, meridiem: "pm", explicit24: true };
  if (text === "midnight") return { minutes: 0, meridiem: "am", explicit24: true };
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!match) return null;
  const hour = Number(match[1]); const minute = match[2] ? Number(match[2]) : 0;
  if (minute > 59) return null;
  const meridiem = match[3] ? (match[3][0] === "a" ? "am" : "pm") : null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return { minutes: ((hour % 12) + (meridiem === "pm" ? 12 : 0)) * 60 + minute, meridiem, explicit24: true };
  }
  if (hour > 23) return null;
  // 0:xx, 13–23 and "09:30"-style are unambiguous 24-hour times.
  if (hour === 0 || hour >= 13 || (match[2] && match[1].length === 2 && match[1][0] === "0")) return { minutes: hour * 60 + minute, meridiem: null, explicit24: true };
  return { minutes: hour * 60 + minute, meridiem: null, explicit24: false, hour12: hour };
}

/** Apply AM/PM to an hour written without it. */
const withMeridiem = (clock, meridiem) => ({ minutes: ((clock.hour12 % 12) + (meridiem === "pm" ? 12 : 0)) * 60 + (clock.minutes % 60), meridiem, explicit24: true });

function timeLabel(minutes) {
  const hour = Math.floor(minutes / 60) % 24; const minute = minutes % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${minute ? `:${pad(minute)}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}
function dayLabel(date, today) {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  const { year, month, day } = parseDate(date);
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", ...(year !== parseDate(today).year ? { year: "numeric" } : {}), timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
const reminderText = (minutes) => ({ 5: "5 minutes before", 15: "15 minutes before", 30: "30 minutes before", 60: "1 hour before", 1440: "1 day before" })[minutes];

/** Nearest date on or after `from` with this weekday. */
const upcomingWeekday = (from, weekday) => addDays(from, (weekday - weekdayOf(from) + 7) % 7);

/** Next date with this month/day (this year if not passed, else next year), or null if it never exists. */
function upcomingMonthDay(today, month, day, year = null) {
  const base = parseDate(today);
  if (year !== null) return day <= daysInMonth(year, month) ? formatDate(year, month, day) : null;
  for (let y = base.year; y <= base.year + 8; y += 1) {
    if (day > daysInMonth(y, month)) continue;
    const date = formatDate(y, month, day);
    if (date >= today) return date;
  }
  return null;
}

/**
 * Parse quick-add text.
 * @param {string} text
 * @param {{ now?: number, zone?: string, context?: { date: string, time: string|null, allDay?: boolean } | null, itemType?: "event"|"task"|"appointment"|null, weekStartsOn?: number }} [options]
 */
export function parseQuickAdd(text, { now = Date.now(), zone = "UTC", context = null, itemType = null, weekStartsOn = 0 } = {}) {
  const input = String(text || "").slice(0, 300);
  // Same length as the input so match offsets map back onto the original text.
  const lower = input.toLowerCase().replace(/[\u2013\u2014]/g, "-").replace(/[\u2019]/g, "'");
  const consumed = new Array(lower.length).fill(false);
  const recognized = [];
  const questions = [];
  const today = localDateOf(now, zone);
  const nowMinutes = (() => { const [h, m] = localTimeOf(now, zone).split(":").map(Number); return h * 60 + m; })();

  const state = {
    type: null, typeFromPrefix: false,
    date: null, dateKind: null, weekday: null, explicitDate: null,
    start: null, end: null, duration: null, partOfDay: null,
    recurrence: null, repeatEnd: null, reminder: undefined,
  };

  const free = (start, end) => { for (let i = start; i < end; i += 1) if (consumed[i]) return false; return true; };
  const consume = (start, end) => { for (let i = start; i < end; i += 1) consumed[i] = true; };
  /** Run a global regex; the handler returns false to skip a match (left in the title). */
  const scan = (pattern, kind, handler) => {
    for (const match of lower.matchAll(re(pattern))) {
      const start = match.index; const end = start + match[0].length;
      if (!match[0].trim() || !free(start, end)) continue;
      if (handler(match) === false) continue;
      consume(start, end);
      recognized.push({ kind, text: input.slice(start, end).trim() });
    }
  };
  const ask = (question) => { if (!questions.some((entry) => entry.id === question.id)) questions.push({ blocking: true, ...question }); };

  // 1. Type prefix ("task: …", "todo - …").
  const prefix = lower.match(/^\s*(task|todo|to-do|to do|appointment|appt)\s*[:-]\s*/u);
  if (prefix) {
    state.type = /^(appointment|appt)$/.test(prefix[1]) ? "appointment" : "task";
    state.typeFromPrefix = true;
    consume(0, prefix[0].length);
  }

  // 2. Reminders ("remind me 30 minutes before", "remind me the day before", "15 min reminder").
  const setReminder = (minutes, raw) => {
    if (REMINDER_CHOICES.includes(minutes)) { state.reminder = minutes; return; }
    state.reminder = null;
    const nearest = [...REMINDER_CHOICES].sort((a, b) => Math.abs(a - minutes) - Math.abs(b - minutes)).slice(0, 2).sort((a, b) => a - b);
    ask({
      id: "reminder", field: "reminder",
      message: `Reminders can be 5, 15 or 30 minutes, 1 hour or 1 day before — “${raw.trim()}” isn't one of them.`,
      options: nearest.map((value) => ({ label: reminderText(value), patch: { reminderMinutes: value } })),
    });
  };
  scan(`(?:,\\s*|\\s+and\\s+|\\s+with\\s+)?${B}(?:remind(?:er)?|alert)(?:\\s+me)?\\s+${NUMBER}\\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?)${E}(?:\\s+(?:before|ahead|earlier|early|prior|beforehand|in advance))?`, "reminder", (match) => {
    const amount = numberValue(match[1]); const unit = unitMinutes(match[2]);
    if (amount === null || unit === null) return false;
    setReminder(Math.round(amount * unit), match[0]);
  });
  scan(`(?:,\\s*|\\s+and\\s+|\\s+with\\s+)?${B}(?:remind(?:er)?|alert)(?:\\s+me)?\\s+(?:a|one|the)\\s+day\\s+(?:before|ahead|earlier|prior)${E}`, "reminder", () => { state.reminder = 1440; });
  scan(`(?:,\\s*|\\s+with\\s+)?${B}(?:an?\\s+)?${NUMBER}[\\s-]*(minutes?|mins?|hours?|hrs?|days?)\\s+(?:reminder|alert)${E}`, "reminder", (match) => {
    const amount = numberValue(match[1]); const unit = unitMinutes(match[2]);
    if (amount === null || unit === null) return false;
    setReminder(Math.round(amount * unit), match[0]);
  });
  scan(`(?:,\\s*|\\s+and\\s+|\\s+with\\s+)?${B}(?:remind\\s+me|(?:with\\s+)?(?:a\\s+)?reminder)${E}`, "reminder", () => {
    if (state.reminder !== undefined) return false;
    state.reminder = null;
    ask({ id: "reminder", field: "reminder", message: "When should Persora remind you?", options: REMINDER_CHOICES.map((value) => ({ label: reminderText(value), patch: { reminderMinutes: value } })) });
  });

  // 3. Repeats.
  const unsupportedRepeat = (raw, message) => ask({
    id: "repeat", field: "repeat", message: `${message} (“${raw.trim()}”)`,
    options: [
      { label: "Daily", patch: { recurrence: { freq: "daily", interval: 1 } } },
      { label: "Weekly", patch: { recurrence: { freq: "weekly", interval: 1 } } },
      { label: "Don't repeat", patch: { recurrence: null } },
    ],
  });
  scan(`${B}every\\s+(?:other\\s+)?${ANY_WEEKDAY}s?(?:\\s*(?:,|and|&)\\s*${ANY_WEEKDAY}s?)+${E}`, "repeat", (match) => {
    unsupportedRepeat(match[0], "Repeating on several weekdays isn't supported. Choose one weekday, or repeat daily or weekly");
  });
  scan(`${B}(?:every\\s+(?:week\\s*day|weekday)s?|on\\s+weekdays|weekdays\\s+only|every\\s+weekends?|on\\s+weekends)${E}`, "repeat", (match) => {
    unsupportedRepeat(match[0], "Weekday-only or weekend-only repeats aren't supported");
  });
  scan(`${B}(?:every\\s+(?:other\\s+|\\d+\\s+)?years?|yearly|annually|every\\s+(?:first|second|third|fourth|last)\\s+\\w+)${E}`, "repeat", (match) => {
    unsupportedRepeat(match[0], "That kind of repeat isn't supported — Calendar repeats daily, weekly or monthly");
  });
  scan(`${B}bi-?weekly${E}`, "repeat", (match) => {
    state.recurrence = null;
    ask({ id: "repeat", field: "repeat", message: `“${match[0]}” can mean twice a week or every two weeks.`, options: [
      { label: "Every 2 weeks", patch: { recurrence: { freq: "weekly", interval: 2 } } },
      { label: "Weekly", patch: { recurrence: { freq: "weekly", interval: 1 } } },
      { label: "Don't repeat", patch: { recurrence: null } },
    ] });
  });
  scan(`${B}every\\s+(other\\s+)?${ANY_WEEKDAY}s?${E}`, "repeat", (match) => {
    state.recurrence = { freq: "weekly", interval: match[1] ? 2 : 1 };
    state.weekday = WEEKDAY_ALIASES[match[2]];
  });
  scan(`${B}(?:on\\s+)?${FULL_WEEKDAY}s${E}`, "repeat", (match) => {
    if (state.recurrence) return false;
    state.recurrence = { freq: "weekly", interval: 1 };
    state.weekday = WEEKDAY_ALIASES[match[1]];
  });
  scan(`${B}every\\s+(other\\s+|\\d+\\s+|two\\s+|three\\s+)?(day|week|month)s?${E}`, "repeat", (match) => {
    if (state.recurrence) return false;
    const raw = (match[1] || "").trim();
    const interval = raw === "other" ? 2 : raw ? numberValue(raw) : 1;
    if (!interval || interval > 99) return false;
    state.recurrence = { freq: { day: "daily", week: "weekly", month: "monthly" }[match[2]], interval };
  });
  scan(`${B}(daily|weekly|monthly|fortnightly|every\\s+fortnight)${E}`, "repeat", (match) => {
    if (state.recurrence) return false;
    state.recurrence = match[1].includes("fortnight") ? { freq: "weekly", interval: 2 } : { freq: match[1], interval: 1 };
  });

  // 4. Durations ("for 2 hours", "for 45 minutes", "for an hour and a half") and repeat counts ("for 6 weeks", "10 times").
  scan(`${B}for\\s+${NUMBER}\\s*(hours?|hrs?|h|minutes?|mins?|m)(?:\\s+and\\s+(?:a\\s+half|(\\d+)\\s*(?:minutes?|mins?)))?${E}`, "duration", (match) => {
    const amount = numberValue(match[1]); const unit = unitMinutes(match[2]);
    if (amount === null || unit === null) return false;
    let minutes = amount * unit;
    if (/and\s+a\s+half/.test(match[0])) minutes += unit / 2;
    if (match[3]) minutes += Number(match[3]);
    minutes = Math.round(minutes);
    if (minutes < 5 || minutes > 24 * 60) return false;
    state.duration = minutes;
  });
  scan(`${B}(?:for\\s+)?(\\d{1,3})\\s+(times|occurrences|sessions)${E}`, "repeat", (match) => { state.repeatEnd = { count: Number(match[1]) }; });
  scan(`${B}for\\s+${NUMBER}\\s+(days?|weeks?|months?)${E}`, "repeat", (match) => {
    const amount = numberValue(match[1]);
    if (!amount || amount > 999 || amount !== Math.floor(amount)) return false;
    state.repeatEnd = { span: { amount, unit: match[2].replace(/s$/, "") } };
  });

  scan(`${B}until\\s+(?:${MONTH_NAME}\\.?\\s+(\\d{1,2})|(\\d{4}-\\d{2}-\\d{2}))${E}`, "repeat", (match) => {
    if (!state.recurrence) return false;
    const date = match[3] ? (isDateString(match[3]) ? match[3] : null) : upcomingMonthDay(today, MONTHS[match[1]], Number(match[2]));
    if (!date) return false;
    state.repeatEnd = { until: date };
  });


  // 5. Times. Ranges first ("from 7 to 9 PM", "7-9pm", "between 2 and 4"), then single times.
  const rangeQuestion = (startClock, endClock, raw) => {
    const startPm = withMeridiem(startClock, "pm"); const startAm = withMeridiem(startClock, "am");
    const endPm = endClock.explicit24 ? endClock : withMeridiem(endClock, "pm"); const endAm = endClock.explicit24 ? endClock : withMeridiem(endClock, "am");
    ask({ id: "time", field: "time", message: `Is “${raw.trim()}” in the morning or the afternoon/evening?`, options: [
      { label: `${timeLabel(startAm.minutes)} – ${timeLabel(endAm.minutes > startAm.minutes ? endAm.minutes : endPm.minutes)}`, patch: { startTime: toTime(startAm.minutes), endTime: toTime(endAm.minutes > startAm.minutes ? endAm.minutes : endPm.minutes), allDay: false } },
      { label: `${timeLabel(startPm.minutes)} – ${timeLabel(endPm.minutes)}`, patch: { startTime: toTime(startPm.minutes), endTime: toTime(endPm.minutes), allDay: false } },
    ] });
  };
  const setRange = (startClock, endClock, raw) => {
    let start = startClock; let end = endClock;
    if (!start.explicit24 && end.explicit24 && end.meridiem) {
      // "7 to 9 PM" → 7 PM; "11 to 1 PM" → 11 AM.
      const same = withMeridiem(start, end.meridiem);
      start = same.minutes < end.minutes ? same : withMeridiem(start, end.meridiem === "pm" ? "am" : "pm");
    } else if (!start.explicit24 && end.explicit24) {
      const am = withMeridiem(start, "am"); const pm = withMeridiem(start, "pm");
      start = pm.minutes < end.minutes && end.minutes - pm.minutes <= 12 * 60 ? pm : am;
    }
    if (start.explicit24 && !end.explicit24) {
      const am = withMeridiem(end, "am"); const pm = withMeridiem(end, "pm");
      end = [am, pm].filter((option) => option.minutes > start.minutes).sort((a, b) => a.minutes - b.minutes)[0] || am;
    }
    if (!start.explicit24 && !end.explicit24) { state.pendingRange = { startClock, endClock, raw }; return; }
    state.start = start.minutes; state.end = end.minutes;
  };
  const hasPartOfDay = /(?<![\p{L}])(morning|afternoon|evening|tonight)(?![\p{L}])/u.test(lower);
  scan(`(?:${B}(?:from|between)\\s+)?${B}${CLOCK}\\s*(?:-|to|until|till|and)\\s*${CLOCK}${E}`, "time", (match) => {
    const hasLead = /^(from|between)\s/.test(match[0].trim());
    if (/\sand\s/.test(match[0]) && !/^between\s/.test(match[0].trim())) return false;
    const startClock = readClock(match[1]); const endClock = readClock(match[2]);
    if (!startClock || !endClock) return false;
    const strong = hasLead || /[ap]\.?m|:|noon|midnight|o'?clock/.test(match[0]) || hasPartOfDay;
    if (!strong) return false;
    setRange(startClock, endClock, match[0]);
  });
  scan(`(?:${B}(?:at|@|by|around|starting\\s+at|start(?:s|ing)?\\s+at|due(?:\\s+(?:at|by))?)\\s*)?${B}${CLOCK}${E}`, "time", (match) => {
    const lead = match[0].trim().match(/^(at|@|by|around|starting\s+at|starts?\s+at|starting|due(?:\s+(?:at|by))?)\b/);
    const clock = readClock(match[1]);
    if (!clock) return false;
    const strong = Boolean(lead) || /[ap]\.?m|:|noon|midnight|o'?clock/.test(match[0]);
    if (!strong) return false;
    if (state.start !== null || state.pendingSingle) return false;
    if (/^due/.test(match[0].trim()) && !state.typeFromPrefix) state.dueHint = true;
    if (clock.explicit24) state.start = clock.minutes;
    else state.pendingSingle = { clock, raw: match[0] };
  });
  scan(`${B}(?:until|till|to)\\s+${CLOCK}${E}`, "time", (match) => {
    const clock = readClock(match[1]);
    if (!clock || (state.start === null && !state.pendingSingle)) return false;
    state.pendingEnd = clock;
  });
  scan(`${B}(?:noon|midday|midnight)${E}`, "time", (match) => {
    if (state.start !== null) return false;
    state.start = readClock(match[0]).minutes;
  });
  scan(`${B}in\\s+${NUMBER}\\s*(minutes?|mins?|hours?|hrs?)${E}`, "time", (match) => {
    const amount = numberValue(match[1]); const unit = unitMinutes(match[2]);
    if (amount === null || unit === null || state.start !== null) return false;
    const total = nowMinutes + Math.round(amount * unit);
    const rounded = Math.ceil(total / 5) * 5;
    state.relativeDayShift = Math.floor(rounded / 1440);
    state.start = rounded % 1440;
  });
  scan(`${B}(?:this\\s+|in\\s+the\\s+)?(morning|afternoon|evening|tonight|night)${E}`, "time", (match) => {
    state.partOfDay = match[1] === "morning" ? "am" : "pm";
    state.partOfDayWord = match[1];
    if (match[1] === "tonight" || /^this\s/.test(match[0].trim())) state.date = state.date || today;
  });

  // 6. Dates.
  const setDate = (date, kind) => {
    if (!date) return false;
    if (state.explicitDate && state.explicitDate !== date) return false;
    state.explicitDate = date; state.dateKind = kind;
  };
  scan(`${B}(\\d{4})-(\\d{2})-(\\d{2})${E}`, "date", (match) => (isDateString(match[0]) ? setDate(match[0], "iso") : false));
  scan(`${B}(?:on\\s+)?(?:${ANY_WEEKDAY},?\\s+)?${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}`, "date", (match) => {
    const month = MONTHS[match[2]]; const day = Number(match[3]); const year = match[4] ? Number(match[4]) : null;
    const date = day >= 1 ? upcomingMonthDay(today, month, day, year) : null;
    if (!date) { ask({ id: "date", field: "date", message: `${match[2][0].toUpperCase()}${match[2].slice(1)} ${day} isn't a valid date. Choose the day.`, options: [] }); return; }
    if (match[1]) state.namedWeekday = WEEKDAY_ALIASES[match[1]];
    setDate(date, "month-day");
  });
  scan(`${B}(?:on\\s+)?(?:(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?)${MONTH_NAME}(?:,?\\s+(\\d{4}))?${E}`, "date", (match) => {
    const day = Number(match[1]); const month = MONTHS[match[2]]; const year = match[3] ? Number(match[3]) : null;
    const date = day >= 1 ? upcomingMonthDay(today, month, day, year) : null;
    if (!date) return false;
    setDate(date, "month-day");
  });
  scan(`${B}(?:on\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?${E}`, "date", (match) => {
    const a = Number(match[1]); const b = Number(match[2]);
    let year = match[3] ? Number(match[3]) : null;
    if (year !== null && year < 100) year += 2000;
    const asDayMonth = a <= 31 && b <= 12 ? upcomingMonthDay(today, b, a, year) : null;
    const asMonthDay = a <= 12 && b <= 31 ? upcomingMonthDay(today, a, b, year) : null;
    if (!asDayMonth && !asMonthDay) {
      ask({ id: "date", field: "date", message: `${match[0].replace(/^on\s+/, "")} isn't a valid date. Choose the day.`, options: [] });
      return;
    }
    if (asDayMonth && asMonthDay && asDayMonth !== asMonthDay) {
      state.dateQuestion = true;
      ask({ id: "date", field: "date", message: `Is ${match[1]}/${match[2]} day/month or month/day?`, options: [
        { label: dayLabel(asDayMonth, today), patch: { date: asDayMonth } },
        { label: dayLabel(asMonthDay, today), patch: { date: asMonthDay } },
      ] });
      return;
    }
    setDate(asDayMonth || asMonthDay, "numeric");
  });
  scan(`${B}(?:on\\s+)?(?:the\\s+)(\\d{1,2})(?:st|nd|rd|th)${E}`, "date", (match) => {
    const day = Number(match[1]);
    if (day < 1 || day > 31) return false;
    const base = parseDate(today);
    for (let offset = 0; offset < 14; offset += 1) {
      const monthStart = addMonths(formatDate(base.year, base.month, 1), offset);
      const { year, month } = parseDate(monthStart);
      if (day > daysInMonth(year, month)) continue;
      const date = formatDate(year, month, day);
      if (date >= today) return setDate(date, "day-of-month");
    }
    return false;
  });
  scan(`${B}(?:the\\s+)?day\\s+after\\s+tomorrow${E}`, "date", () => setDate(addDays(today, 2), "relative"));
  scan(`${B}(?:today|tonight)${E}`, "date", (match) => { if (match[0] === "tonight") { state.partOfDay = "pm"; state.partOfDayWord = "tonight"; } return setDate(today, "relative"); });
  scan(`${B}(?:tomorrow|tmrw|tmr|tomorow)${E}`, "date", () => setDate(addDays(today, 1), "relative"));
  scan(`${B}in\\s+${NUMBER}\\s+(days?|weeks?|months?)${E}`, "date", (match) => {
    const amount = numberValue(match[1]);
    if (!amount || amount !== Math.floor(amount) || amount > 365) return false;
    const unit = match[2].replace(/s$/, "");
    return setDate(unit === "month" ? addMonths(today, amount) : addDays(today, amount * (unit === "week" ? 7 : 1)), "relative");
  });
  scan(`${B}next\\s+${ANY_WEEKDAY}${E}`, "date", (match) => {
    const weekday = WEEKDAY_ALIASES[match[1]];
    const nearest = addDays(today, ((weekday - weekdayOf(today) + 7) % 7) || 7);
    const nextWeek = addDays(addDays(startOfWeek(today, weekStartsOn), 7), (weekday - weekStartsOn + 7) % 7);
    if (nearest === nextWeek) return setDate(nearest, "weekday");
    state.dateQuestion = true;
    const name = WEEKDAYS[weekday][0].toUpperCase() + WEEKDAYS[weekday].slice(1);
    ask({ id: "date", field: "date", message: `Which ${name} do you mean by “next ${name}”?`, options: [
      { label: `${dayLabel(nearest, today)} (this coming ${name})`, patch: { date: nearest } },
      { label: `${dayLabel(nextWeek, today)} (the week after)`, patch: { date: nextWeek } },
    ] });
  });
  scan(`${B}(?:(?:this|coming|on)\\s+${ANY_WEEKDAY}|${FULL_WEEKDAY})${E}`, "date", (match) => {
    const weekday = WEEKDAY_ALIASES[match[1] || match[2]];
    if (state.recurrence?.freq === "weekly" && state.weekday === weekday) return;
    return setDate(upcomingWeekday(today, weekday), "weekday");
  });
  scan(`${B}next\\s+(week|month)${E}`, "date", (match) => {
    state.dateQuestion = true;
    const sameDay = match[1] === "week" ? addDays(today, 7) : addMonths(today, 1);
    const first = match[1] === "week" ? addDays(startOfWeek(today, weekStartsOn), 7) : addMonths(formatDate(parseDate(today).year, parseDate(today).month, 1), 1);
    ask({ id: "date", field: "date", message: `Which day next ${match[1]}?`, options: [
      { label: dayLabel(first, today), patch: { date: first } },
      ...(first !== sameDay ? [{ label: dayLabel(sameDay, today), patch: { date: sameDay } }] : []),
    ] });
  });
  // 7. Item type hints (the selected type in the UI always wins).
  if (!state.type) {
    if (state.dueHint || /(?<![\p{L}])(due|deadline|submit|hand in|turn in|to-?do)(?![\p{L}])/u.test(lower)) state.type = "task";
    else if (/(?<![\p{L}])(appointment|appt|doctor|dentist|dental|clinic|check-?up|physio|consultation|haircut)(?![\p{L}])/u.test(lower)) state.type = "appointment";
  }
  const type = itemType || state.type || "event";

  // 8. Resolve the date.
  let date = state.explicitDate;
  if (!date && state.date) date = state.date;
  if (state.relativeDayShift !== undefined && !date) date = addDays(today, state.relativeDayShift);
  if (!date && state.recurrence?.freq === "weekly" && state.weekday !== undefined && state.weekday !== null) date = upcomingWeekday(context?.date && context.date > today ? context.date : today, state.weekday);
  if (date && state.namedWeekday !== undefined && weekdayOf(date) !== state.namedWeekday) {
    const byName = upcomingWeekday(today, state.namedWeekday);
    ask({ id: "date", field: "date", message: `${dayLabel(date, today)} isn't a ${WEEKDAYS[state.namedWeekday]}. Which day do you mean?`, options: [
      { label: dayLabel(date, today), patch: { date } },
      { label: dayLabel(byName, today), patch: { date: byName } },
    ] });
  }

  // 9. Resolve times (part of day settles AM/PM).
  if (state.pendingRange) {
    const { startClock, endClock, raw } = state.pendingRange;
    if (state.partOfDay) { const s = withMeridiem(startClock, state.partOfDay); let e = withMeridiem(endClock, state.partOfDay); if (e.minutes <= s.minutes) e = withMeridiem(endClock, "pm"); state.start = s.minutes; state.end = e.minutes; }
    else rangeQuestion(startClock, endClock, raw);
  }
  if (state.pendingSingle) {
    const { clock, raw } = state.pendingSingle;
    if (state.partOfDay) state.start = withMeridiem(clock, state.partOfDay).minutes;
    else {
      const am = withMeridiem(clock, "am"); const pm = withMeridiem(clock, "pm");
      ask({ id: "time", field: "time", message: `Is “${raw.trim()}” AM or PM?`, options: [
        { label: timeLabel(am.minutes), patch: { startTime: toTime(am.minutes), allDay: false } },
        { label: timeLabel(pm.minutes), patch: { startTime: toTime(pm.minutes), allDay: false } },
      ] });
    }
  }
  if (state.pendingEnd && state.start !== null) {
    const clock = state.pendingEnd;
    let end = clock.explicit24 ? clock.minutes : null;
    if (end === null) {
      const options = [withMeridiem(clock, "am").minutes, withMeridiem(clock, "pm").minutes].filter((value) => value > state.start).sort((a, b) => a - b);
      end = options[0] ?? withMeridiem(clock, "am").minutes;
    }
    state.end = end;
  }
  if (state.partOfDay && state.start === null && !questions.some((entry) => entry.field === "time")) {
    const choices = state.partOfDay === "am" ? [8, 9, 10] : state.partOfDayWord === "afternoon" ? [13, 14, 15] : [18, 19, 20];
    ask({ id: "time", field: "time", message: `What time ${state.partOfDayWord === "tonight" ? "tonight" : `in the ${state.partOfDayWord}`}?`, options: choices.map((hour) => ({ label: timeLabel(hour * 60), patch: { startTime: toTime(hour * 60), allDay: false } })) });
  }

  const hasTime = state.start !== null;
  const timeQuestion = questions.some((entry) => entry.field === "time");
  const hasSchedule = Boolean(date || hasTime || state.recurrence || timeQuestion || state.dateQuestion);

  // Missing pieces: never invent them.
  if ((hasTime || timeQuestion) && !date && !state.dateQuestion) {
    if (context?.date) date = context.date;
    else {
      const later = hasTime && state.start > nowMinutes;
      ask({ id: "date", field: "date", message: state.recurrence ? "Which day should it start?" : "Which day?", options: [
        ...(later || !hasTime || state.recurrence ? [{ label: "Today", patch: { date: today } }] : []),
        { label: "Tomorrow", patch: { date: addDays(today, 1) } },
      ] });
    }
  }
  if (!date && state.recurrence && context?.date) date = context.date;
  if (!date && state.recurrence && !questions.some((entry) => entry.field === "date")) {
    ask({ id: "date", field: "date", message: "Which day should it start?", options: [
      { label: "Today", patch: { date: today } },
      { label: "Tomorrow", patch: { date: addDays(today, 1) } },
    ] });
  }
  if (!hasSchedule && !context) {
    ask({ id: "date", field: "date", message: "When is it? Add a day or time, or pick one:", options: [
      { label: "Today", patch: { date: today, allDay: true } },
      { label: "Tomorrow", patch: { date: addDays(today, 1), allDay: true } },
    ] });
  }

  // From a clicked slot, the slot's day applies unless the text named another (or a date question is open).
  if (!date && context?.date && !questions.some((entry) => entry.field === "date")) date = context.date;

  let allDay = null;
  let startTime = hasTime ? toTime(state.start) : null;
  let endTime = state.end !== null && state.end !== undefined ? toTime(state.end) : null;
  let endDate = null;
  if (hasTime) {
    allDay = false;
    const duration = state.duration || (state.end !== null && state.end !== undefined ? null : DEFAULT_DURATIONS[type]);
    if (duration) {
      const endMinutes = state.start + duration;
      endTime = toTime(endMinutes % 1440);
      if (date) endDate = addDays(date, Math.floor(endMinutes / 1440));
    } else if (date) {
      endDate = state.end <= state.start ? addDays(date, 1) : date;
    }
  } else if (date && !timeQuestion) {
    if (context?.time && !context.allDay) { startTime = context.time; allDay = false; }
    else if (type === "appointment") ask({ id: "time", field: "time", message: "What time is the appointment? Set a start time.", options: [] });
    else allDay = true;
  }

  // Repeat end.
  let recurrence = null;
  if (state.recurrence) {
    if (type !== "event") {
      ask({ id: "repeat", field: "repeat", message: `${type === "task" ? "Tasks" : "Appointments"} can't repeat. Save it as an event to repeat it, or don't repeat.`, options: [
        { label: "Make it an event", patch: { itemType: "event" } },
        { label: "Don't repeat", patch: { recurrence: null } },
      ] });
    }
    recurrence = { freq: state.recurrence.freq, interval: state.recurrence.interval, until: null, count: null };
    if (state.repeatEnd?.count) recurrence.count = Math.min(999, state.repeatEnd.count);
    else if (state.repeatEnd?.until) recurrence.until = state.repeatEnd.until;
    else if (state.repeatEnd?.span && date) {
      const { amount, unit } = state.repeatEnd.span;
      recurrence.until = addDays(unit === "month" ? addMonths(date, amount) : addDays(date, amount * (unit === "week" ? 7 : 1)), -1);
    }
  }

  // Title: what's left, minus dangling connector words and punctuation.
  let title = "";
  for (let index = 0; index < input.length; index += 1) title += consumed[index] ? " " : input[index];
  const connector = /^(?:on|at|from|by|due|for|in|starting|with|and|until|till|to|every|this|next|the|@|,|;|-|\.|:)$/i;
  let words = title.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const trimPunct = (word) => word.replace(/^[,;:.\-@]+|[,;:.\-@!?]+$/g, "");
  while (words.length && (connector.test(words[words.length - 1]) || !trimPunct(words[words.length - 1]))) words.pop();
  while (words.length && (connector.test(words[0]) || !trimPunct(words[0]))) words.shift();
  if (words.length) { words[words.length - 1] = words[words.length - 1].replace(/[,;:\-@]+$/g, "").replace(/\.+$/g, ""); words[0] = words[0].replace(/^[,;:.\-@]+/, ""); }
  title = words.join(" ").replace(/\s+([,;.!?])/g, "$1").replace(/,+$/g, "").trim();

  return {
    input,
    title,
    itemType: state.type,
    date: date || null,
    allDay,
    startTime,
    endTime,
    endDate,
    durationMinutes: state.duration,
    recurrence,
    reminderMinutes: state.reminder === undefined ? undefined : state.reminder,
    questions,
    recognized,
    hasSchedule: hasSchedule || state.reminder !== undefined,
  };
}

/**
 * Apply answers to a parse result.
 * `answers` maps question ids to the chosen option's patch; `touched` lists
 * preview fields the member edited by hand (an edit also settles the question
 * about that field). Returns the resolved fields and the questions still open.
 */
export function resolveQuickAdd(result, { answers = {}, touched = [], itemType = null } = {}) {
  const fields = {
    title: result.title,
    itemType: itemType || result.itemType || "event",
    date: result.date,
    allDay: result.allDay,
    startTime: result.startTime,
    endTime: result.endTime,
    recurrence: result.recurrence,
    reminderMinutes: result.reminderMinutes,
  };
  for (const question of result.questions) {
    const patch = answers[question.id];
    if (!patch) continue;
    if (patch.itemType) fields.itemType = patch.itemType;
    if (patch.date) fields.date = patch.date;
    if (patch.reminderMinutes !== undefined) fields.reminderMinutes = patch.reminderMinutes;
    if ("recurrence" in patch) fields.recurrence = patch.recurrence ? { until: null, count: null, ...(fields.recurrence || {}), ...patch.recurrence } : null;
    if (patch.startTime) {
      fields.startTime = patch.startTime;
      fields.allDay = false;
      if (patch.endTime) fields.endTime = patch.endTime;
      else {
        const [h, m] = patch.startTime.split(":").map(Number);
        fields.endTime = toTime((h * 60 + m + (result.durationMinutes || DEFAULT_DURATIONS[fields.itemType])) % 1440);
      }
    }
  }
  const typeSettled = (question) => question.id === "repeat" && question.options.some((option) => option.patch.itemType) && (fields.itemType === "event" || fields.recurrence === null);
  const open = result.questions.filter((question) => !answers[question.id] && !touched.includes(question.field) && !typeSettled(question));
  // A date with no time is all-day — unless a time question is still open.
  if (fields.date && fields.allDay === null && !fields.startTime && fields.itemType !== "appointment" && !open.some((question) => question.field === "time")) fields.allDay = true;
  return { fields, open };
}

/**
 * Resolved fields → the Calendar API's EventInput. Times are wall-clock times
 * in `zone`; the server turns them into instants (DST included) and validates
 * everything again. Returns null while the date (or an appointment's time) is
 * still missing or it is not yet settled whether the item is all-day.
 */
export function quickAddToInput(fields, { zone, defaults = {} } = {}) {
  if (!fields.date || fields.allDay === null || fields.allDay === undefined) return null;
  const itemType = fields.itemType || "event";
  const timed = fields.allDay === false && Boolean(fields.startTime);
  if (itemType === "appointment" && !timed) return null;
  let end;
  if (timed) {
    const startTime = fields.startTime;
    const endTime = fields.endTime || (() => { const [h, m] = startTime.split(":").map(Number); return toTime((h * 60 + m + DEFAULT_DURATIONS[itemType]) % 1440); })();
    end = { date: endTime <= startTime ? addDays(fields.date, 1) : fields.date, time: endTime };
  } else end = { date: fields.date };
  return {
    itemType,
    title: fields.title || "",
    description: defaults.description || "",
    location: defaults.location || "",
    category: defaults.category || null,
    allDay: !timed,
    timeZone: zone,
    start: timed ? { date: fields.date, time: fields.startTime } : { date: fields.date },
    end,
    recurrence: itemType === "event" && fields.recurrence ? { freq: fields.recurrence.freq, interval: fields.recurrence.interval || 1, until: fields.recurrence.until || null, count: fields.recurrence.count || null } : null,
    reminderMinutes: typeof fields.reminderMinutes === "number" ? fields.reminderMinutes : null,
    reminderEmail: false,
  };
}
