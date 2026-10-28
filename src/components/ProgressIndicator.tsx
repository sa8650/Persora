import type { ReactNode } from "react"
import { CheckCircle2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import type { ContactImportProgress, TransferProgress } from "@/types"

export function formatRemaining(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Estimating time left…"
  if (seconds <= 1) return "Almost done"
  if (seconds < 60) return `About ${Math.ceil(seconds)}s left`
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return secs > 0 ? `About ${mins}m ${secs}s left` : `About ${mins}m left`
}

export function TransferProgressIndicator({
  label = "Uploading file…",
  progress,
  detail,
  className,
}: {
  label?: string
  progress: TransferProgress
  detail?: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.percent)))
  const complete = pct >= 100

  return (
    <div
      data-slot="transfer-progress"
      aria-live="polite"
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {complete ? (
            <CheckCircle2Icon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <Spinner className="size-3.5 text-primary" />
          )}
          <span className="truncate font-medium text-foreground">{label}</span>
        </div>
        <span className="shrink-0 font-semibold text-foreground tabular-nums">
          {pct}%
        </span>
      </div>
      <Progress value={pct} aria-label={label} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {detail || formatRemaining(progress.remainingSeconds)}
        </span>
        {detail ? (
          <span className="shrink-0 tabular-nums">
            {formatRemaining(progress.remainingSeconds)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function ImportProgressIndicator({
  label = "Importing contacts…",
  progress,
  className,
}: {
  label?: string
  progress: ContactImportProgress
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress.percent)))
  const complete = pct >= 100 && progress.completed >= progress.total

  return (
    <div
      data-slot="import-progress"
      aria-live="polite"
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {complete ? (
            <CheckCircle2Icon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <Spinner className="size-3.5 text-primary" />
          )}
          <span className="truncate font-medium text-foreground">{label}</span>
        </div>
        <span className="shrink-0 font-semibold text-foreground tabular-nums">
          {pct}%
        </span>
      </div>
      <Progress value={pct} aria-label={label} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          {progress.currentName
            ? `Saving ${progress.currentName} · contact ${Math.min(progress.total, progress.completed + 1)} of ${progress.total}`
            : `${progress.completed} of ${progress.total} contacts saved`}
        </span>
        <span className="shrink-0 tabular-nums">
          {formatRemaining(progress.remainingSeconds)}
        </span>
      </div>
    </div>
  )
}

export function StageProgressIndicator({
  label,
  percent,
  detail,
  className,
}: {
  label: string
  percent?: number | null
  detail?: ReactNode
  className?: string
}) {
  const isDeterminate = typeof percent === "number" && Number.isFinite(percent)
  const pct = isDeterminate
    ? Math.max(0, Math.min(100, Math.round(percent)))
    : null

  return (
    <div
      data-slot="stage-progress"
      aria-live="polite"
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Spinner className="size-3.5 text-primary" />
          <span className="truncate font-medium text-foreground">{label}</span>
        </div>
        {pct !== null ? (
          <span className="shrink-0 font-semibold text-foreground tabular-nums">
            {pct}%
          </span>
        ) : null}
      </div>
      <Progress value={pct} aria-label={label} />
      {detail ? (
        <div className="text-[11px] text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  )
}
