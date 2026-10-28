// Title: Attachment
// Description: A file attached to a message, upload field, or record — a chip before send and a card after.
"use client"

import type { ComponentProps } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { PaperclipIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const attachmentGroupVariants = cva("flex", {
  variants: {
    variant: {
      stack: "flex-col gap-2",
      grid: "flex-wrap items-start gap-2",
      inline:
        "scroll-fade-x flex-nowrap items-center gap-1.5 overflow-x-auto scrollbar-none",
    },
  },
  defaultVariants: {
    variant: "stack",
  },
})

function AttachmentGroup({
  className,
  variant = "stack",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof attachmentGroupVariants>) {
  return (
    <div
      data-slot="attachment-group"
      data-variant={variant}
      className={cn(attachmentGroupVariants({ variant }), className)}
      {...props}
    />
  )
}

const attachmentVariants = cva(
  [
    "group/attachment relative flex items-center text-sm transition-colors",
    "has-[>[data-slot=attachment-trigger]]:cursor-pointer",
  ],
  {
    variants: {
      variant: {
        outline:
          "border border-border bg-card has-[>[data-slot=attachment-trigger]:hover]:bg-accent/50",
        soft: "border border-transparent bg-muted/60 has-[>[data-slot=attachment-trigger]:hover]:bg-muted",
        ghost:
          "border border-transparent has-[>[data-slot=attachment-trigger]:hover]:bg-accent",
      },
      size: {
        default: [
          "min-h-14 gap-3 rounded-lg p-2.5",
          "[--attachment-media-size:--spacing(9)] [--attachment-icon-size:--spacing(4)]",
          "**:data-[slot=attachment-content]:gap-0.5 **:data-[slot=attachment-description]:block",
        ],
        sm: [
          "min-h-10 gap-2.5 rounded-lg px-2.5 py-1.5",
          "[--attachment-media-size:--spacing(7)] [--attachment-icon-size:--spacing(3.5)]",
          "**:data-[slot=attachment-content]:flex-row **:data-[slot=attachment-content]:items-baseline **:data-[slot=attachment-content]:gap-2",
        ],
        xs: [
          "h-7 shrink-0 gap-1.5 rounded-md px-2 text-xs",
          "[--attachment-media-size:--spacing(4)] [--attachment-icon-size:--spacing(3.5)]",
          "**:data-[slot=attachment-media]:border-0 **:data-[slot=attachment-media]:bg-transparent **:data-[slot=attachment-media]:rounded-xs",
          "**:data-[slot=attachment-description]:hidden",
        ],
      },
      state: {
        idle: "border-dashed bg-transparent has-[>[data-slot=attachment-trigger]:hover]:border-ring/50",
        uploading:
          "**:data-[slot=attachment-title]:opacity-70 **:data-[slot=attachment-media]:text-muted-foreground",
        processing: [
          "**:data-[slot=attachment-title]:shimmer **:data-[slot=attachment-title]:[--shimmer-spread:3ch]",
          "**:data-[slot=attachment-media]:text-muted-foreground",
        ],
        error: [
          "border-destructive/40 bg-destructive/5 has-[>[data-slot=attachment-trigger]:hover]:bg-destructive/10",
          "**:data-[slot=attachment-description]:text-destructive",
          "**:data-[slot=attachment-media]:border-destructive/30 **:data-[slot=attachment-media]:bg-destructive/10 **:data-[slot=attachment-media]:text-destructive",
        ],
        done: "",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
      state: "done",
    },
  }
)

function Attachment({
  className,
  variant = "outline",
  size = "default",
  state = "done",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof attachmentVariants>) {
  return (
    <div
      data-slot="attachment"
      data-variant={variant}
      data-size={size}
      data-state={state}
      className={cn(attachmentVariants({ variant, size, state }), className)}
      {...props}
    />
  )
}

const attachmentMediaVariants = cva(
  "relative flex size-(--attachment-media-size) shrink-0 items-center justify-center overflow-hidden rounded-md",
  {
    variants: {
      variant: {
        default: [
          "border border-border bg-muted text-muted-foreground",
          "[&_svg:not([class*='size-'])]:size-(--attachment-icon-size)",
          "has-[[data-slot=file-type]]:border-0 has-[[data-slot=file-type]]:bg-transparent has-[[data-slot=file-type]]:overflow-visible",
        ],
        image:
          "bg-muted [&_img]:size-full [&_img]:object-cover [&_svg:not([class*='size-'])]:size-(--attachment-icon-size)",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function AttachmentMedia({
  className,
  variant = "default",
  children,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(attachmentMediaVariants({ variant }), className)}
      {...props}
    >
      {children ?? <PaperclipIcon />}
    </div>
  )
}

function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  )
}

function AttachmentTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-title"
      className={cn("truncate font-medium text-foreground", className)}
      {...props}
    />
  )
}

function AttachmentDescription({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-description"
      className={cn(
        "shrink-0 truncate text-xs text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function AttachmentActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn("relative z-10 flex shrink-0 items-center gap-0.5", className)}
      {...props}
    />
  )
}

function AttachmentAction({
  className,
  variant = "ghost",
  size = "icon-xs",
  type = "button",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type={type}
      data-slot="attachment-action"
      variant={variant}
      size={size}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      {...props}
    />
  )
}

function AttachmentTrigger({
  className,
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type={type}
      data-slot="attachment-trigger"
      className={cn(
        "absolute inset-0 z-0 rounded-[inherit] outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
  attachmentGroupVariants,
  attachmentVariants,
}
