import * as React from "react"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

if (typeof window !== "undefined" && "happyDOM" in window && globalThis.Event !== window.Event) {
  globalThis.Event = window.Event
  if (window.CustomEvent) globalThis.CustomEvent = window.CustomEvent
}

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  )
}

function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  )
}

function ContextMenuPortal({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "ds-reui-menu-item flex cursor-default items-center gap-2 rounded-[var(--ds-radius-xs)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--ds-text)] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--ds-subtle-bg)] data-[highlighted]:text-[var(--ds-text)] data-[inset=true]:pl-8 data-[state=open]:bg-[var(--ds-subtle-bg)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-[var(--ds-text-muted)]",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3.5 text-[var(--ds-text-soft)]" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-slot="context-menu-sub-content"
        className={cn(
          "ds-reui-menu-content z-[280] min-w-[11rem] origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-[var(--ds-radius-md)] border border-[var(--ds-border-strong)] bg-[var(--ds-overlay-bg)] p-1 text-[var(--ds-text)] shadow-[var(--ds-shadow-popover)]",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "ds-reui-menu-content z-[280] max-h-(--radix-context-menu-content-available-height) min-w-[13.5rem] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[var(--ds-radius-md)] border border-[var(--ds-border-strong)] bg-[var(--ds-overlay-bg)] p-1 text-[var(--ds-text)] shadow-[var(--ds-shadow-popover)]",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "ds-reui-menu-item relative flex cursor-default items-center gap-2 rounded-[var(--ds-radius-xs)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--ds-text)] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--ds-subtle-bg)] data-[highlighted]:text-[var(--ds-text)] data-[inset=true]:pl-8 data-[variant=destructive]:text-[var(--ds-danger)] data-[variant=destructive]:data-[highlighted]:bg-[var(--ds-danger-soft)] data-[variant=destructive]:data-[highlighted]:text-[var(--ds-danger)] data-[variant=destructive]:*:[svg]:!text-[var(--ds-danger)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-[var(--ds-text-muted)]",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(
        "ds-reui-menu-item relative flex cursor-default items-center gap-2 rounded-[var(--ds-radius-xs)] py-1.5 pr-2.5 pl-8 text-[13px] font-medium text-[var(--ds-text)] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--ds-subtle-bg)] data-[highlighted]:text-[var(--ds-text)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2.5 flex size-3.5 items-center justify-center text-[var(--ds-primary)]">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" strokeWidth={2.5} />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        "ds-reui-menu-item relative flex cursor-default items-center gap-2 rounded-[var(--ds-radius-xs)] py-1.5 pr-2.5 pl-8 text-[13px] font-medium text-[var(--ds-text)] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--ds-subtle-bg)] data-[highlighted]:text-[var(--ds-text)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2.5 flex size-3.5 items-center justify-center text-[var(--ds-primary)]">
        <ContextMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[var(--ds-text-muted)] uppercase data-[inset=true]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-[var(--ds-divider)]", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto pl-4 text-[11px] font-medium tracking-tight text-[var(--ds-text-soft)]",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
