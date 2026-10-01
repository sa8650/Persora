import type { ContactImportProgress, TransferProgress } from "../types";

export function formatRemaining(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Estimating time left…";
  if (seconds <= 1) return "Almost done";
  if (seconds < 60) return `About ${Math.ceil(seconds)} sec left`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.ceil(seconds % 60);
  return remainder ? `About ${minutes} min ${remainder} sec left` : `About ${minutes} min left`;
}

export function TransferProgressIndicator({ progress, label, detail }: { progress: TransferProgress; label: string; detail?: string }) {
  return <div className="progress-indicator" aria-live="polite">
    <div className="progress-indicator-heading"><b>{label}</b><span>{Math.round(progress.percent)}%</span></div>
    <div className="progress-indicator-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.percent)}><i style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}/></div>
    <div className="progress-indicator-meta"><span>{detail || formatRemaining(progress.remainingSeconds)}</span>{detail && <span>{formatRemaining(progress.remainingSeconds)}</span>}</div>
  </div>;
}

export function ImportProgressIndicator({ progress, label = "Importing contacts" }: { progress: ContactImportProgress; label?: string }) {
  return <div className="progress-indicator import-progress-indicator" aria-live="polite">
    <div className="progress-indicator-heading"><b>{label}</b><span>{progress.percent}%</span></div>
    <div className="progress-indicator-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}/></div>
    <div className="progress-indicator-meta"><span>{progress.currentName ? `Saving ${progress.currentName} · contact ${Math.min(progress.total, progress.completed + 1)} of ${progress.total}` : `${progress.completed} of ${progress.total} contacts saved`}</span><span>{formatRemaining(progress.remainingSeconds)}</span></div>
  </div>;
}
