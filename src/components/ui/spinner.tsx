import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 shrink-0 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
