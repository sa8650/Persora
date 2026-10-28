import * as React from "react"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { Menubar as MenubarPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

if (typeof window !== "undefined" && "happyDOM" in window && globalThis.Event !== window.Event) {
  globalThis.Event = window.Event
  if (window.CustomEvent) globalThis.CustomEvent = window.CustomEvent
}

function Menubar({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return (
    <MenubarPrimitive.Root
      data-slot="menubar"
      className={cn(
        "ds-reui-menubar flex h-8 items-center gap-0.5 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border)] bg-[var(--ds-card-bg)] p-0.5 text-[var(--ds-text)] shadow-[var(--ds-shadow-xs)]",
        className
      )}
      {...props}
    />
  )
}

function MenubarMenu({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu data-slot="menubar-menu" {...props} />
}

function MenubarGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Group>) {
  return <MenubarPrimitive.Group data-slot="menubar-group" {...props} />
}

function MenubarPortal({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Portal>) {
  return <MenubarPrimitive.Portal data-slot="menubar-portal" {...props} />
}

function MenubarRadioGroup({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioGroup>) {
  return (
    <MenubarPrimitive.RadioGroup data-slot="menubar-radio-group" {...props} />
  )
}

function MenubarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      data-slot="menubar-trigger"
      className={cn(
        "ds-reui-menubar-trigger flex cursor-pointer items-center rounded-[var(--ds-radius-xs)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--ds-text-secondary)] outline-none select-none transition-colors hover:bg-[var(--ds-subtle-bg)] hover:text-[var(--ds-text)] focus-visible:bg-[var(--ds-subtle-bg)] focus-visible:text-[var(--ds-text)] data-[state=open]:bg-[var(--ds-primary-soft)] data-[state=open]:text-[var(--ds-sidebar-active-text)]",
        className
      )}
      {...props}
    />
  )
}

function MenubarContent({
  className,
  align = "start",
  alignOffset = -4,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPortal>
      <MenubarPrimitive.Content
        data-slot="menubar-content"
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        className={cn(
          "ds-reui-menu-content z-[280] max-h-(--radix-menubar-content-available-height) min-w-[13rem] origin-(--radix-menubar-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-[var(--ds-radius-md)] border border-[var(--ds-border-strong)] bg-[var(--ds-overlay-bg)] p-1 text-[var(--ds-text)] shadow-[var(--ds-shadow-popover)]",
          className
        )}
        {...props}
      />
    </MenubarPortal>
  )
}

function MenubarItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenubarPrimitive.Item
      data-slot="menubar-item"
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

function MenubarCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.CheckboxItem>) {
  return (
    <MenubarPrimitive.CheckboxItem
      data-slot="menubar-checkbox-item"
      className={cn(
        "ds-reui-menu-item relative flex cursor-default items-center gap-2 rounded-[var(--ds-radius-xs)] py-1.5 pr-2.5 pl-8 text-[13px] font-medium text-[var(--ds-text)] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--ds-subtle-bg)] data-[highlighted]:text-[var(--ds-text)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2.5 flex size-3.5 items-center justify-center text-[var(--ds-primary)]">
        <MenubarPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" strokeWidth={2.5} />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.CheckboxItem>
  )
}

function MenubarRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.RadioItem>) {
  return (
    <MenubarPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn(
        "ds-reui-menu-item relative flex cursor-default items-center gap-2 rounded-[var(--ds-radius-xs)] py-1.5 pr-2.5 pl-8 text-[13px] font-medium text-[var(--ds-text)] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--ds-subtle-bg)] data-[highlighted]:text-[var(--ds-text)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2.5 flex size-3.5 items-center justify-center text-[var(--ds-primary)]">
        <MenubarPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenubarPrimitive.ItemIndicator>
      </span>
      {children}
    </MenubarPrimitive.RadioItem>
  )
}

function MenubarLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.Label
      data-slot="menubar-label"
      data-inset={inset}
      className={cn(
        "px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[var(--ds-text-muted)] uppercase data-[inset=true]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function MenubarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Separator>) {
  return (
    <MenubarPrimitive.Separator
      data-slot="menubar-separator"
      className={cn("-mx-1 my-1 h-px bg-[var(--ds-divider)]", className)}
      {...props}
    />
  )
}

function MenubarShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        "ml-auto pl-4 text-[11px] font-medium tracking-tight text-[var(--ds-text-soft)]",
        className
      )}
      {...props}
    />
  )
}

function MenubarSub({
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Sub>) {
  return <MenubarPrimitive.Sub data-slot="menubar-sub" {...props} />
}

function MenubarSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <MenubarPrimitive.SubTrigger
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      className={cn(
        "ds-reui-menu-item flex cursor-default items-center gap-2 rounded-[var(--ds-radius-xs)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--ds-text)] outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--ds-subtle-bg)] data-[highlighted]:text-[var(--ds-text)] data-[inset=true]:pl-8 data-[state=open]:bg-[var(--ds-subtle-bg)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-[var(--ds-text-muted)]",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3.5 text-[var(--ds-text-soft)]" />
    </MenubarPrimitive.SubTrigger>
  )
}

function MenubarSubContent({
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.SubContent>) {
  return (
    <MenubarPortal>
      <MenubarPrimitive.SubContent
        data-slot="menubar-sub-content"
        className={cn(
          "ds-reui-menu-content z-[280] min-w-[11rem] origin-(--radix-menubar-content-transform-origin) overflow-hidden rounded-[var(--ds-radius-md)] border border-[var(--ds-border-strong)] bg-[var(--ds-overlay-bg)] p-1 text-[var(--ds-text)] shadow-[var(--ds-shadow-popover)]",
          className
        )}
        {...props}
      />
    </MenubarPortal>
  )
}

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
}
