# Persora Calendar

A private, personal calendar in the Persora workspace (**Workspace → Calendar**). It uses Persora's sign-in, Pages API, Supabase database and design system. It adds no new external service and no new npm dependency.

## What members can do

- **Views:** Week (the default on desktop and tablet), Month, Day and Agenda (the default on phones). The choice is remembered per member and device.
- **Navigation:** **Today**, previous/next (per view) and a range heading that opens a date picker. On wide screens there is also a collapsible mini-calendar. Navigation never reloads the page.
- **Keyboard shortcuts:**

  | Key | Action |
  | --- | --- |
  | `t` | Today |
  | `←` / `→` | Previous / next |
  | `d`, `w`, `m`, `a` | Day, Week, Month, Agenda |
  | `c` | New event |
  | `/` | Search |

- **Create:**
  - Click a Week/Day time slot (top half → `:00`, bottom half → `:30`) or a Month date (an all-day event) for **quick create**. Choose **More options** for the full form.
  - Or use **New event**. Its chevron (**More create options**) opens **Quick add** (natural language) and **Create event**, **Create task** and **Schedule appointment**.
- **Event fields:**
  - Title (required).
  - Start/end, or all-day.
  - Optional location, description and category colour (Default, Personal, Work, Family, Health, Travel, Social, Other).
  - Optional reminder.
  - Optional repeat: daily, weekly or monthly; every *n*; ending never, on a date, or after *n* times.
- **Edit and delete:**
  - Clicking an event opens its details, with **Edit** and **Delete**.
  - For a repeating event, Persora asks **This event** or **All events**.
- **Search:** searches your event titles only (case-insensitive, up to 100 matches). Choosing a result opens its date and briefly highlights the event.
- **States:** a loading indicator, empty states (no events in range, no search results), inline validation and clear error messages. Times are always shown with a note naming the time zone ("Times shown in Asia/Dhaka…").

Validation (in the browser, the API and the database):
- The title is 1–200 characters.
- The end can't be before the start, and a timed event must end after it starts.
- A timed event can last up to 31 days; an all-day event up to 366 days.
- The location is up to 300 characters and the description up to 2,000.
- The repeat interval is 1–99 and the count 1–999.

## Smart scheduling

### Natural-language quick add (no AI)

Type into quick create (a slot, a date, or **More create options → Quick add**), e.g. "Meeting tomorrow at 3 PM", "Study every Friday from 7 to 9 PM", "Submit assignment next Monday, due at 11 AM", "Doctor appointment on November 5 at 10 AM, remind me 30 minutes before".

- `src/lib/calendar-nlp.js` is a deterministic parser (regular expressions and date rules) that runs in the browser. There are no AI models, external APIs or paid services.
- It extracts the title, date, start/end, all-day, reminder, repeat and type: "due", "submit", "deadline" or "todo" → task; "appointment", "doctor", "dentist" and similar → appointment.
- Relative dates use your profile time zone. Weeks start on Sunday, so "next Monday" is the Monday after this week's.
- **Editable preview.** Every value is shown in editable fields before saving. Saving goes through the normal API validation.
- **It asks instead of guessing.** Persora shows a question with one-tap answers when something is ambiguous or unsupported. Saving waits until every question is answered. Questions cover:
  - AM/PM ("at 7");
  - day/month order (`5/11`);
  - impossible dates and a weekday that doesn't match the date;
  - "next Wednesday" when it could mean this week;
  - "9 to 11" without AM/PM;
  - repeats it can't store (e.g. "every Monday and Wednesday");
  - reminder times that aren't presets;
  - a repeating task, and an appointment without a time.
- A slot's own date and time fill in whatever the text doesn't say.

### Events, tasks and appointments

The type is chosen when an item is created and then stays fixed.

| | Event | Task | Appointment |
| --- | --- | --- | --- |
| **Time** | Timed or all-day | A scheduled time (default 30 min), or **No set time (due date only)** | Always timed, date + time + duration (default 30 min) |
| **Fields** | Location, description | Optional description | Location, notes |
| **Shared** | Category, reminder | Category, reminder | Category, reminder |
| **Repeats** | Yes | No | No |
| **Extras** | — | **Mark complete / Reopen** (details or edit form) | — |
| **Look** | Filled block | Circle icon; struck through and faded when done | Outlined block with a clock icon |

- Completing a task cancels its pending reminder; reopening schedules it again.
- Moving or editing a task never changes its completion. Only the completion action does.
- Tasks are deliberately lightweight: no projects, boards, assignees or subtasks.
- Appointments are personal entries, not a booking page.

### Move and resize

- **Week/Day:** drag an item to another time or day (15-minute snapping, with auto-scroll near the edges). Drag the bottom edge to resize.
- **Month and the all-day row:** drag to another date. This moves by whole days and keeps the time of day.
- **Mouse:** the drag starts after a few pixels, so a click still opens the item.
- **Touch:** press and hold for about 350 ms, then drag. A normal swipe still scrolls.
- **Escape** cancels a drag.
- **Keyboard and screen readers:** use **Reschedule** in the item's details (date, start time, duration) instead of dragging.
- **While saving:** the item shows at its new place and is marked "Saving". If the save fails, it goes back and an error explains why.
- **Revision checks:**
  - Moves send `expectedRevision`.
  - Occurrence moves also send `seriesRevision`.
  - A change made elsewhere (another tab or device) wins with a 409. Nothing is overwritten, and the calendar reloads.
- **Time zones:** times are computed in the item's own time zone, so moves across a DST change keep the wall-clock time.
- **Repeating events** ask **This event** (an exception, like editing one occurrence) or **All events**. All events shifts the whole series by the same day/time change and replaces single-occurrence changes; the dialog warns first.
- **What a move keeps:** a task keeps its completion, and an appointment keeps its location, notes, category and reminder. Reminders are rescheduled to the new time.

### Conflict warnings

- **What counts:** overlaps with your own timed events, appointments and open scheduled tasks. All-day items, completed tasks and cancelled occurrences are ignored. Touching edges (10–11 and 11–12) are not a conflict.
- **Where it's checked:**
  - On create and edit, the forms check as you type (debounced) and list every overlap with its title and time.
  - On a move or resize, a dialog lists the overlaps and offers **Keep original time** or **Move anyway**.
- **Free slots:** up to three nearby free times of the same length (07:00–22:00, today and the next day, never in the past) can be applied with one tap. They are not offered for repeating items.
- **Server-side check:** the check runs on the server (`POST /api/calendar/conflicts`) against saved data, so every device gives the same answer. A repeating item is checked across its next 62 days (up to 60 occurrences).
- **It never blocks saving.**

### Filters

- **The Filters button** (next to the views) shows or hides Events, Tasks, Appointments, completed tasks and each colour. Choices combine.
- **Active filters** show as a count on the button and as a strip with **Reset**. Filtered empty states say so.
- **Consistent everywhere:** Week, Month, Day, Agenda and search. Search reports "N hidden by filters".
- **Display-only:** filters never change, delete or omit data, and backups always contain everything.
- **Sync:**
  - Saved in `calendar_preferences` and also on the device.
  - The newest copy wins, so filters follow you across devices and still work offline.
  - The filter menu shows the sync state.

## Time zones

- Events are **shown in the member's profile time zone** (Settings, IANA name, default `Asia/Dhaka`). If the time zone changes, the same events are shown at the new local times.
- **Timed events** are stored as UTC instants (`start_at`, `end_at`) together with the IANA zone they were saved in (`time_zone`).
  - Repeats keep the **local wall-clock time** in that zone. For example, a 09:00 weekly event stays at 09:00 across daylight-saving changes.
  - A monthly event on the 31st skips months without a 31st.
- **All-day events are dates**, not midnight timestamps: `start_date`, plus an `end_date` stored exclusive (the form shows it inclusive). They never shift when the time zone changes.
- Week and month ranges are computed in the member's zone. The API pads each fetch by a day on both sides, so events near midnight are never missed.
- Editing sends local date/time fields, not converted timestamps, so saving without changes never shifts an event.

## Repeating events: "this event" vs "all events"

Persora uses the same model as Google Calendar and iCalendar (a series plus exceptions):

- A **series** row stores the rule: `recurrence_freq`, `recurrence_interval`, and the end as `recurrence_until` or `recurrence_count`.
- **Editing one occurrence** creates an **exception** row. Its `series_id` points to the series and `original_start_at` / `original_start_date` identifies the occurrence. The series row is not modified.
- **Deleting one occurrence** stores a cancelled exception (`status = 'cancelled'`).
- **Editing all events:**
  - Title, location, description, category or reminder changes apply to the series. Occurrences you customised keep their own values for the fields you changed there.
  - Date, time or repeat-rule changes rebuild the series and discard its exceptions (the API reports how many). This prevents occurrences that no longer exist from lingering.
- **Deleting all events** removes the series with its exceptions and pending reminders.
- Every event has a `revision`. If an event changed in another tab, a stale edit is refused (HTTP 409) and the calendar reloads.

## Reminders

Presets: none, 5, 15 or 30 minutes, 1 hour, or 1 day before. All-day events are reminded relative to 09:00 local time on their first day.

**Server-side scheduling** (works with the browser closed):

1. When an event is saved, the API computes its **next** reminder (skipping past and cancelled or overridden occurrences). It stores the reminder in `calendar_reminders`, under a unique `dedupe_key` of event + occurrence + reminder time.
2. A dispatcher claims due reminders with `FOR UPDATE SKIP LOCKED` and delivers them. After delivery it schedules the series' next occurrence. Sent reminders are never re-sent: re-saving an event can't revive them, and a second claim of the same row finds nothing.
3. **Delivery:**
   - **In-app notification:** always; it appears in Persora's bell on any device.
   - **Email:** if the member enabled "Also email me" for that event, Brevo (`BREVO_API_KEY`) is configured, and their email is verified. The email links back to the calendar.
   - Emails that would arrive more than 15 minutes late and after the event started are skipped. The reason is recorded on the reminder (`email_status` / `email_note`).
4. **Editing or deleting an event:** changing the time, the rule or the reminder cancels the pending reminder and schedules a new one. Deleting removes pending reminders. The reminder for a cancelled occurrence is skipped.

**What triggers the dispatcher**, any of which is enough:

- **pg_cron** (when available) runs `persora_calendar_dispatch_ping()` every minute. When something is due, it calls the API's dispatcher through `pg_net`. This needs two Supabase Vault secrets; see [DEPLOYMENT.md](./DEPLOYMENT.md#calendar-reminders).
- An **external scheduler** calling `POST /api/internal/calendar-reminders` with header `x-persora-cron-token: <CALENDAR_REMINDER_TOKEN>`. Without that Pages secret, the endpoint is a 404.
- The API itself: after signed-in session checks (at most once a minute per worker), and whenever an open Persora tab polls reminders (every 30 seconds and on focus).

**Browser notifications:**
- While Persora is open in a tab, a due reminder also shows a desktop notification, if the member granted permission. When a reminder is chosen, the event form shows the browser's permission state:
  - not yet asked: an **Allow desktop notifications** link;
  - on;
  - blocked in the browser's settings;
  - not supported by this browser.
- Each reminder is notified at most once per browser.
- Without permission, reminders still appear in the bell and by email.

## Data and security

- **Migration:** `supabase/migrations/202610250001_calendar.sql`.
  - Tables: `calendar_events`, `calendar_reminders`.
  - Indexes: owner + dates, owner + series, and title search. It uses `pg_trgm` when available; otherwise there is a btree title index.
  - Functions: SECURITY DEFINER.
  - Optionally creates the pg_cron job. Its guards make it apply cleanly where pg_cron, pg_net or Vault are missing.
- **Ownership:** every row has `user_id` (cascade-deleted with the account). Every function takes the signed-in owner from the server session, never from the request body, and scopes every statement to that owner. Another member's event is reported as "not found" (404).
- **RLS and privileges:** RLS is on, and every table and function privilege is revoked from `anon` / `authenticated`, so browsers can't reach the tables even with the public API URL. Internal helpers are revoked from `service_role` as well.
- **Secrets:** only the Pages Function holds the Supabase secret key, the Brevo key and the cron token. None are in browser code.
- **Smart scheduling migration:** `supabase/migrations/202610260001_calendar_items.sql`. It is backward compatible and rerunnable, and it only adds:
  - `calendar_events.item_type` (`event` default, `task`, `appointment`) and `completed_at`. Existing rows become events, unchanged.
  - Check constraints that every existing row already satisfies: valid type, completion only on tasks, appointments timed, tasks and appointments don't repeat.
  - The `calendar_preferences` table (one private row per member, RLS on, no browser privileges, ≤ 4 KB).
  - `persora_calendar_save_event` replaced so it understands the type. Updates keep the stored type and completion, and a completed task gets no reminder.
  - The new revision-checked `persora_calendar_set_task_completion` (service role only).
- **Account backup:** **Settings → Download a backup** includes `calendarEvents` (series, exceptions and cancelled occurrences, with `item_type` and `completed_at`), `calendarReminders` and `calendarPreferences` in `persora-export.json`.
- **Future sync:** `source` / `external_id` columns are reserved for importing from Google or Microsoft calendars later. Nothing uses them yet.

## API (same-origin, signed-in)

| Method and path | Purpose |
| --- | --- |
| `GET /api/calendar/meta` | Profile zone, email-reminder availability (with reason), presets, limits |
| `GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD` | Events overlapping the range (`to` exclusive, at most 100 days): single events, series and exceptions. The client expands repeats with `cloudflare/calendar-rules.js`, the same code the server uses |
| `GET /api/calendar/events/search?q=` | Title search |
| `POST /api/calendar/events` | Create (`201`) |
| `GET/PATCH/DELETE /api/calendar/events/:id` | Read, edit (`scope`: `series` or one occurrence via `occurrenceKey`, plus `expectedRevision` and optional `seriesRevision`), delete. Moves use the same PATCH |
| `POST /api/calendar/events/:id/completion` | `{completed, expectedRevision}`: mark a task complete or reopen it (tasks only) |
| `POST /api/calendar/conflicts` | `{event, ignore, completed}` → overlapping items and free-slot suggestions (warnings only) |
| `GET/PUT /api/calendar/preferences` | Display filters `{filters}` → `{filters, updatedAt, saved}` |
| `GET /api/calendar/reminders`, `PATCH /api/calendar/reminders[/:id]` | Delivered reminders (last 7 days); mark read |
| `POST /api/internal/calendar-reminders` | Dispatcher for schedulers (token-gated) |

## Tests

- `npm test` runs these:
  - `tests/calendar-rules.test.mjs`: recurrence, DST, all-day, reminders and validation.
  - `tests/calendar-db.test.mjs`: the real migration under PGlite. Covers privileges/RLS, isolation, search escaping, revisions, exceptions, and the reminder queue (claim, dedupe, roll-forward, stale claims, cascade).
  - `tests/calendar-routes.test.mjs`: API validation, ownership, scopes, dispatcher outcomes, token gate and account export. Also covers task/appointment creation, completion, moves keeping completion and appointment fields, stale `seriesRevision` (409), conflicts and suggestions, and preferences.
  - `tests/calendar-items-db.test.mjs`: a real upgrade from the first Calendar schema with existing events, exceptions and reminders. Covers:
    - no data changes and rerunnability;
    - constraints and type and completion preservation;
    - the completion RPC (revision, owner, tasks only, privileges);
    - completed tasks getting no reminder;
    - private preferences.
  - `tests/calendar-nlp.test.mjs`: the parser examples, questions for ambiguous and unsupported input, slot context, time zones and overnight ranges.
  - The rules tests also cover conflicts, free slots (including DST), filter combinations, item-type validation and move timing (DST-safe series shifts).
- `npm run test:e2e:calendar` runs a full browser flow against local Postgres 17 + PostgREST. It covers:
  - navigation and all views, validation, quick and detailed create;
  - this/all edits and deletes, all-day events, search;
  - a time-zone change;
  - reminder email + bell + desktop notification exactly once, and re-scheduling on edit and cancellation on delete;
  - isolation between members, account backups;
  - phone and tablet layouts, overlapping events, light and dark themes, and no console or HTTP errors.

- `npm run test:e2e:calendar-smart` runs the smart-scheduling browser flow:
  - natural-language quick add and an AM/PM question, a task from text, an appointment form;
  - conflict warnings with a picked free slot, and saving despite an overlap;
  - completion;
  - mouse drag and resize in Week, Escape cancelling, a simulated 500 restoring the item, a stale 409, and the conflict dialog;
  - a completed task moving, recurring this/all moves, Month drag with its reminder following, and Reschedule;
  - filters across views, search, reload and a second device;
  - backup contents;
  - phone Reschedule, tap vs long-press touch drag, and dark theme.

  Set `PG_BIN`, `POSTGREST_BIN` and `PLAYWRIGHT_MODULE` as for the other e2e suites.

## Limitations

- Resizing changes the end time only (drag the bottom edge). Multi-day timed items can be moved but not resized from the grid; use the form.
- The natural-language parser understands English phrasing only. Anything else becomes the title, with date and time taken from the slot or asked for.
- Conflict checks cover your own calendar only. Repeating items are checked over the next 62 days, and free slots aren't suggested for them.
- Tasks have no subtasks, priorities or lists, and don't repeat. Appointments are personal entries, with no booking page or invitations.
- Desktop notifications appear only while a Persora tab is open; there is no web push or service worker. With the browser closed, reminders still arrive by email (when enabled) and wait in the bell.
- Reminder timing depends on the trigger. With pg_cron or an external scheduler it is within about a minute. Without either, it happens on the next signed-in request or open tab.
- Repeats are daily, weekly or monthly with an interval. There are no weekday sets, "last Friday" rules or per-event time zone picker; events use your profile zone when saved.
- Personal calendars only: no sharing, invitations, team calendars or external calendar sync.
