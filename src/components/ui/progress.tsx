import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

interface ProgressProps
  extends Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "value"> {
  value?: number | null
  indicatorClassName?: string
}

function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: ProgressProps) {
  const isDeterminate = typeof value === "number" && Number.isFinite(value)
  const clamped = isDeterminate ? Math.min(100, Math.max(0, Math.round(value))) : null

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={clamped}
      className={cn(
        "relative flex h-1.5 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "size-full flex-1 bg-primary transition-all",
          clamped === null &&
            "w-2/5 flex-none rounded-full animate-[reui-progress-indeterminate_1.35s_ease-in-out_infinite]",
          indicatorClassName
        )}
        style={
          clamped === null
            ? undefined
            : { transform: `translateX(-${100 - clamped}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress, type ProgressProps }
