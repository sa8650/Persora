// Persora Table — save engine.
//
// The editor keeps two documents: `saved` (what the server last confirmed) and
// `current` (what the member sees). Edits replace only the objects they touch
// (sheets, records, meta), so the changes are found by comparing references.
//
// Rules this module enforces:
// - Saved is reported only after the server confirms a batch.
// - One batch in flight at a time; edits made meanwhile go into the next one.
// - A failed batch is re-sent unchanged (same batch id) until it is confirmed
//   or definitively refused, so a write whose response was lost is never
//   applied twice and never turns into a false conflict.
// - A conflict (the table changed elsewhere) stops saving; nothing is merged.
import type { Sheet, SmartMeta, TableRecord } from "../../../cloudflare/table-rules.js";
import type { SaveBatchBody, SaveResult } from "./table-api";

export type TableDoc =
  | { kind: "spreadsheet"; sheets: Sheet[] }
  | { kind: "smart"; meta: SmartMeta; records: TableRecord[] };

export type SaveStatus = "saved" | "pending" | "saving" | "retrying" | "error" | "conflict" | "gone";

export interface SaveState {
  status: SaveStatus;
  revision: number;
  message: string | null;
  lastSavedAt: number | null;
}

export interface SaverOptions {
  revision: number;
  saved: TableDoc;
  send: (batch: SaveBatchBody) => Promise<SaveResult>;
  onState?: (state: SaveState) => void;
  onSaved?: (doc: TableDoc, result: SaveResult) => void;
  debounceMs?: number;
  retryDelays?: number[];
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  newId?: () => string;
}

/** The change set that turns `saved` into `current` (empty sections omitted). */
export function diffDocs(saved: TableDoc, current: TableDoc): Omit<SaveBatchBody, "baseRevision" | "batchId"> | null {
  if (saved.kind === "spreadsheet" && current.kind === "spreadsheet") {
    const before = new Map(saved.sheets.map((sheet) => [sheet.id, sheet]));
    const upsert = current.sheets.filter((sheet) => before.get(sheet.id) !== sheet);
    const keep = new Set(current.sheets.map((sheet) => sheet.id));
    const remove = saved.sheets.filter((sheet) => !keep.has(sheet.id)).map((sheet) => sheet.id);
    if (!upsert.length && !remove.length) return null;
    return { sheets: { upsert, delete: remove } };
  }
  if (saved.kind === "smart" && current.kind === "smart") {
    const before = new Map(saved.records.map((record) => [record.id, record]));
    const upsert = current.records.filter((record) => before.get(record.id) !== record)
      .map((record) => ({ id: record.id, position: record.position, values: record.values, example: record.example === true }));
    const keep = new Set(current.records.map((record) => record.id));
    const remove = saved.records.filter((record) => !keep.has(record.id)).map((record) => record.id);
    const metaChanged = saved.meta !== current.meta;
    if (!upsert.length && !remove.length && !metaChanged) return null;
    return { ...(metaChanged ? { meta: current.meta } : {}), ...(upsert.length || remove.length ? { records: { upsert, delete: remove } } : {}) };
  }
  throw new Error("A table cannot change kind.");
}

export function isDirty(saved: TableDoc, current: TableDoc) {
  return saved !== current && diffDocs(saved, current) !== null;
}

/** Matches TABLE_LIMITS.saveBytes on the server (6 MB per save request). */
export const MAX_BATCH_BYTES = 6 * 1024 * 1024 - 64 * 1024;
export function batchBytes(body: unknown) {
  return new TextEncoder().encode(JSON.stringify(body)).byteLength;
}

interface Pending { body: SaveBatchBody; doc: TableDoc }

export class TableSaver {
  private saved: TableDoc;
  private current: TableDoc;
  private revision: number;
  private pending: Pending | null = null;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private attempt = 0;
  private stopped = false;
  private state: SaveState;
  private readonly opts: Required<Omit<SaverOptions, "onState" | "onSaved" | "saved" | "revision" | "send">> & Pick<SaverOptions, "onState" | "onSaved" | "send">;

  constructor(options: SaverOptions) {
    this.saved = options.saved;
    this.current = options.saved;
    this.revision = options.revision;
    this.opts = {
      send: options.send, onState: options.onState, onSaved: options.onSaved,
      debounceMs: options.debounceMs ?? 700,
      retryDelays: options.retryDelays ?? [2000, 5000, 10000, 30000],
      now: options.now ?? (() => Date.now()),
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
      newId: options.newId ?? (() => crypto.randomUUID()),
    };
    this.state = { status: "saved", revision: this.revision, message: null, lastSavedAt: null };
  }

  get snapshot(): SaveState { return this.state; }
  get savedDoc(): TableDoc { return this.saved; }
  get currentRevision(): number { return this.revision; }
  /** True while anything is not yet confirmed by the server. */
  get hasUnsaved(): boolean { return this.pending !== null || isDirty(this.saved, this.current); }

  private setState(patch: Partial<SaveState>) {
    this.state = { ...this.state, ...patch, revision: this.revision };
    this.opts.onState?.(this.state);
  }

  /** Called after every edit with the new document. */
  update(doc: TableDoc) {
    this.current = doc;
    if (this.stopped) return;
    if (!this.pending && !isDirty(this.saved, doc)) {
      this.clearTimer();
      if (this.state.status === "pending") this.setState({ status: "saved", message: null });
      return;
    }
    if (this.state.status === "saved" || this.state.status === "error") this.setState({ status: "pending", message: null });
    this.schedule(this.opts.debounceMs);
  }

  private clearTimer() {
    if (this.timer !== null) { this.opts.clearTimer(this.timer); this.timer = null; }
  }
  private schedule(ms: number) {
    this.clearTimer();
    this.timer = this.opts.setTimer(() => { this.timer = null; void this.flush(); }, ms);
  }

  /** Sends now (used on blur/visibility change and by "Retry"). Resolves when this round settles. */
  async flush(): Promise<void> {
    if (this.stopped) return;
    this.clearTimer();
    if (this.inFlight) { await this.inFlight; if (!this.stopped && (this.pending || isDirty(this.saved, this.current))) return this.flush(); return; }
    if (!this.pending) {
      const changes = diffDocs(this.saved, this.current);
      if (!changes) { if (this.state.status !== "saved") this.setState({ status: "saved", message: null }); return; }
      const body = { baseRevision: this.revision, batchId: this.opts.newId(), ...changes };
      if (batchBytes(body) > MAX_BATCH_BYTES) {
        this.setState({ status: "error", message: "This change is too large to save at once (over 6 MB). Undo it, or split the data into smaller tables." });
        return;
      }
      this.pending = { body, doc: this.current };
    }
    const pending = this.pending;
    this.setState({ status: this.attempt ? "retrying" : "saving" });
    this.inFlight = this.run(pending);
    try { await this.inFlight; } finally { this.inFlight = null; }
  }

  private async run(pending: Pending) {
    try {
      const result = await this.opts.send(pending.body);
      this.pending = null;
      this.attempt = 0;
      this.saved = pending.doc;
      this.revision = Number(result.table.revision) || this.revision;
      this.opts.onSaved?.(pending.doc, result);
      if (isDirty(this.saved, this.current)) {
        this.setState({ status: "pending", message: null, lastSavedAt: this.opts.now() });
        this.schedule(50);
      } else {
        this.setState({ status: "saved", message: null, lastSavedAt: this.opts.now() });
      }
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status === 409) {
        this.stopped = true;
        this.setState({ status: "conflict", message: "This table was changed in another tab or on another device. Nothing was saved over it." });
        return;
      }
      if (status === 404) {
        this.stopped = true;
        this.setState({ status: "gone", message: "This table is no longer in your account (it may have been deleted elsewhere)." });
        return;
      }
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        // Refused: the batch was not applied and re-sending it won't help.
        this.pending = null;
        this.attempt = 0;
        this.setState({ status: "error", message: error instanceof Error ? error.message : "The change could not be saved." });
        return;
      }
      // Network or server trouble: keep the exact batch and retry it.
      const delay = this.opts.retryDelays[Math.min(this.attempt, this.opts.retryDelays.length - 1)];
      this.attempt += 1;
      this.setState({ status: "retrying", message: "Unable to save. Your changes are kept on this device and will be retried." });
      this.schedule(delay);
    }
  }

  /** After a conflict or reload: start over from a document the server just returned. */
  reset(doc: TableDoc, revision: number) {
    this.clearTimer();
    this.saved = doc;
    this.current = doc;
    this.revision = revision;
    this.pending = null;
    this.attempt = 0;
    this.stopped = false;
    this.setState({ status: "saved", message: null });
  }

  /** Revision bumps from outside the save loop (e.g. none today) are not expected; exposed for polling checks. */
  isBehind(serverRevision: number) {
    return serverRevision > this.revision && !this.inFlight;
  }

  dispose() {
    this.stopped = true;
    this.clearTimer();
  }
}
