// Persora Docs — short-debounce autosave coordinator with idempotent retry,
// conflict detection, and preservation of unsaved edits during transient network errors.
import type { DocContent } from "../../cloudflare/docs-rules.js";
import type { DocSummary, SaveDocBody, SaveDocResult } from "./docs-api";
import { PagesApiError } from "./cloud";

export type DocSaveStatus = "saved" | "saving" | "failed" | "conflict";

export interface DocSaveState {
  status: DocSaveStatus;
  revision: number;
  message: string | null;
  lastSavedAt: number | null;
}

export interface DocSnapshot {
  title: string;
  content: DocContent;
}

function makeBatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function serializeSnapshot(snap: DocSnapshot): string {
  return JSON.stringify([snap.title, snap.content]);
}

function isRetryableNetworkOrServerError(error: unknown): boolean {
  if (error instanceof PagesApiError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  // Browser fetch throws TypeError on offline / DNS / connection reset
  return true;
}

export class DocSaver {
  private revision: number;
  private savedKey: string;
  private latest: DocSnapshot;
  private latestKey: string;
  private inFlight = false;
  private disposed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private pendingBatch: { batchId: string; targetKey: string; payload: DocSnapshot } | null = null;
  private state: DocSaveState;

  private readonly debounceMs: number;
  private readonly send: (body: SaveDocBody) => Promise<SaveDocResult>;
  private readonly onState: (state: DocSaveState) => void;
  private readonly onSaved?: (summary: DocSummary) => void;
  private readonly onlineHandler: () => void;

  constructor(options: {
    revision: number;
    initial: DocSnapshot;
    debounceMs?: number;
    send: (body: SaveDocBody) => Promise<SaveDocResult>;
    onState: (state: DocSaveState) => void;
    onSaved?: (summary: DocSummary) => void;
  }) {
    this.revision = options.revision;
    this.latest = options.initial;
    this.savedKey = serializeSnapshot(options.initial);
    this.latestKey = this.savedKey;
    this.debounceMs = options.debounceMs ?? 650;
    this.send = options.send;
    this.onState = options.onState;
    this.onSaved = options.onSaved;
    this.state = {
      status: "saved",
      revision: options.revision,
      message: null,
      lastSavedAt: null,
    };

    this.onlineHandler = () => {
      if (!this.disposed && this.state.status === "failed" && this.hasUnsaved) {
        this.retry();
      }
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this.onlineHandler);
    }
  }

  get snapshot(): DocSaveState {
    return this.state;
  }

  get currentRevision(): number {
    return this.revision;
  }

  get hasUnsaved(): boolean {
    return this.latestKey !== this.savedKey || this.inFlight;
  }

  private emit(next: Partial<DocSaveState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    this.onState(this.state);
  }

  private clearTimers() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  update(next: DocSnapshot) {
    if (this.disposed || this.state.status === "conflict") return;
    this.latest = next;
    const nextKey = serializeSnapshot(next);
    this.latestKey = nextKey;

    if (nextKey === this.savedKey && !this.inFlight) {
      this.clearTimers();
      this.pendingBatch = null;
      this.retryAttempt = 0;
      this.emit({ status: "saved", message: null });
      return;
    }

    // If a newer edit supersedes a failed batch before it was sent, mint a fresh batch on send
    if (this.pendingBatch && this.pendingBatch.targetKey !== nextKey && !this.inFlight) {
      this.pendingBatch = null;
    }

    this.retryAttempt = 0;
    this.clearTimers();
    this.emit({ status: "saving", message: null });
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSave();
    }, this.debounceMs);
  }

  /** Immediately flushes any pending edit without waiting for the debounce timer. */
  async flush(): Promise<void> {
    if (this.disposed || this.state.status === "conflict") return;
    this.clearTimers();
    if (this.latestKey === this.savedKey && !this.inFlight) return;
    await this.runSave();
  }

  /** Safe manual retry after a network or server error, reusing the exact batchId if unchanged. */
  retry(): void {
    if (this.disposed) return;
    if (this.latestKey === this.savedKey) {
      this.emit({ status: "saved", message: null });
      return;
    }
    this.clearTimers();
    this.retryAttempt = 0;
    this.emit({ status: "saving", message: null });
    void this.runSave();
  }

  private async runSave(): Promise<void> {
    if (this.disposed || this.inFlight || this.state.status === "conflict") return;
    if (this.latestKey === this.savedKey) {
      this.emit({ status: "saved", message: null });
      return;
    }

    const batch =
      this.pendingBatch && this.pendingBatch.targetKey === this.latestKey
        ? this.pendingBatch
        : {
            batchId: makeBatchId(),
            targetKey: this.latestKey,
            payload: this.latest,
          };
    this.pendingBatch = batch;
    this.inFlight = true;
    this.emit({ status: "saving", message: null });

    try {
      const res = await this.send({
        baseRevision: this.revision,
        batchId: batch.batchId,
        title: batch.payload.title,
        content: batch.payload.content,
      });

      this.inFlight = false;
      if (this.disposed) return;

      this.revision = res.doc.revision;
      this.savedKey = batch.targetKey;
      this.pendingBatch = null;
      this.retryAttempt = 0;
      this.onSaved?.(res.doc);

      if (this.latestKey !== this.savedKey) {
        // User kept typing while the request was in flight — schedule the follow-up wave
        this.emit({ status: "saving", revision: this.revision, message: null });
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          void this.runSave();
        }, Math.min(350, this.debounceMs));
      } else {
        this.emit({
          status: "saved",
          revision: this.revision,
          message: null,
          lastSavedAt: Date.now(),
        });
      }
    } catch (error) {
      this.inFlight = false;
      if (this.disposed) return;

      if (error instanceof PagesApiError && error.status === 409) {
        this.pendingBatch = null;
        this.emit({
          status: "conflict",
          message:
            error.message ||
            "This document was updated in another tab or session. Copy or reload before continuing.",
        });
        return;
      }

      if (!isRetryableNetworkOrServerError(error)) {
        // Validation error (400/403/413): preserve user's unsaved text in editor and surface Save failed
        this.pendingBatch = null;
        const msg =
          error instanceof Error && error.message
            ? error.message
            : "Changes could not be saved.";
        this.emit({ status: "failed", message: msg });
        return;
      }

      this.retryAttempt += 1;
      const msg = "Network error — unsaved edits are preserved in the editor.";
      this.emit({ status: "failed", message: msg });

      // Automatic background retry up to 3 attempts with gentle backoff (2s, 5s, 10s)
      if (this.retryAttempt <= 3) {
        const delayMs = this.retryAttempt === 1 ? 2_000 : this.retryAttempt === 2 ? 5_000 : 10_000;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.disposed && this.state.status === "failed" && this.latestKey !== this.savedKey) {
            void this.runSave();
          }
        }, delayMs);
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.onlineHandler);
    }
  }
}
