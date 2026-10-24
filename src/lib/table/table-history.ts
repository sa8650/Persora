// Persora Table — undo/redo as document snapshots. Edits share unchanged
// sheets/records with the previous document, so each entry is cheap.
export interface HistoryEntry<T> { doc: T; label: string }

export class DocHistory<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  constructor(private readonly limit = 100) {}

  /** Records the document as it was before a change labelled `label`. */
  push(before: T, label: string) {
    this.past.push({ doc: before, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: T): HistoryEntry<T> | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ doc: current, label: entry.label });
    return entry;
  }
  redo(current: T): HistoryEntry<T> | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ doc: current, label: entry.label });
    return entry;
  }
  clear() { this.past = []; this.future = []; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past[this.past.length - 1]?.label ?? null; }
  get redoLabel() { return this.future[this.future.length - 1]?.label ?? null; }
}
