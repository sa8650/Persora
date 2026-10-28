import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2 as Buildings,
  MessageSquare as ChatTeardropText,
  Check as Checks,
  Mail as EnvelopeSimple,
  FileText as FileArrowDown,
  List as ListPlus,
  Search as MagnifyingGlass,
  Plus,
  Circle as RadioButton,
  Share2 as ShareFat,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Badge } from "./reui/badge";
import { IconTile } from "./reui/icon-tile";

/**
 * Search Modal
 *
 * A minimalist command-palette panel: a search bar that live-filters the result
 * list, removable "I'm looking for…" tags, people/results rows with per-row
 * actions, a quick-actions list with keyboard hints, and a files section.
 *
 * Ported from the vanilla "CodeGrid Modern Minimalist Search Modal" into a
 * single, self-contained, prop-driven React component. Every section is data
 * driven and optional, icons are Phosphor, and it adapts to light and dark mode.
 */

export interface SearchTag {
  label: string;
  icon?: React.ReactNode;
}

export interface SearchResultAction {
  icon: React.ReactNode;
  label?: string;
  onClick?: () => void;
}

export interface SearchResult {
  /** Primary label (also matched against the query). */
  name: string;
  /** Secondary text such as an email or context (also matched). */
  meta?: string;
  /** Hidden searchable text (for matching saved metadata without displaying it). */
  searchText?: string;
  /** Avatar image URL. Falls back to a neutral circle. */
  avatar?: string;
  /** Link target for the row. */
  href?: string;
  /** Trailing action icons. */
  actions?: SearchResultAction[];
}

export interface QuickAction {
  label: string;
  icon?: React.ReactNode;
  /** Keyboard hint shown on the right (e.g. "E"). */
  shortcut?: string;
  onClick?: () => void;
}

export interface SearchFile {
  name: string;
  /** File extension shown dimmed after the name (e.g. ".pdf"). */
  ext?: string;
  icon?: React.ReactNode;
  /** Show the green "verified" checks next to the name. */
  verified?: boolean;
  onOpen?: () => void;
  onShare?: () => void;
}

export interface SearchModalProps {
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Removable filter tags. */
  tags?: SearchTag[];
  /** Result rows, live-filtered by the query. */
  results?: SearchResult[];
  /** Quick-action rows. */
  quickActions?: QuickAction[];
  /** File rows. */
  files?: SearchFile[];
  /** Initial query value. */
  defaultQuery?: string;
  /** Called as the query changes. */
  onQueryChange?: (query: string) => void;
  /** Called when a result row is clicked. */
  onSelectResult?: (result: SearchResult, index: number) => void;
  /** Extra classes for the root panel. */
  className?: string;

  /** Render as a centered overlay with a backdrop instead of an inline panel. */
  modal?: boolean;
  /** Controlled open state (modal mode). */
  open?: boolean;
  /** Uncontrolled initial open state (modal mode). Defaults to false. */
  defaultOpen?: boolean;
  /** Called when the modal opens (true) or closes (false). */
  onOpenChange?: (open: boolean) => void;
  /** Key (pressed with ⌘/Ctrl) that toggles the modal. Defaults to "k"; set null to disable. */
  hotkey?: string | null;
  /** Close the modal on Escape. Defaults to true. */
  closeOnEscape?: boolean;
  /** Extra classes for the overlay wrapper (e.g. override `fixed` with `absolute` to scope it). */
  overlayClassName?: string;
}

const ICON = "h-[18px] w-[18px] text-neutral-400 dark:text-neutral-500";

const DEFAULT_TAGS: SearchTag[] = [
  { label: "Reactions", icon: <RadioButton className="h-4 w-4" /> },
  { label: "People", icon: <Users className="h-4 w-4" /> },
  { label: "Companies", icon: <Buildings className="h-4 w-4" /> },
];

const DEFAULT_RESULTS: SearchResult[] = [
  {
    name: "Jason Woordheart",
    meta: "jason@dribbble.com",
    actions: [
      { icon: <ChatTeardropText className="h-4 w-4" />, label: "Message" },
      { icon: <ListPlus className="h-4 w-4" />, label: "Add to list" },
    ],
  },
  {
    name: "Rob Miller",
    meta: "rob@icloud.com",
    actions: [{ icon: <ListPlus className="h-4 w-4" />, label: "Add to list" }],
  },
  {
    name: "Hannah Steward",
    meta: "replied on thread",
    actions: [
      { icon: <EnvelopeSimple className="h-4 w-4" />, label: "Email" },
      { icon: <ListPlus className="h-4 w-4" />, label: "Add to list" },
    ],
  },
];

const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: "Create new task", shortcut: "E" },
  { label: "Create note", shortcut: "S" },
  { label: "Add member", shortcut: "R" },
];

const DEFAULT_FILES: SearchFile[] = [
  { name: "Invoice", ext: ".pdf", verified: true },
];

export function SearchModal({
  placeholder = "Search for action, people, instruments",
  tags = DEFAULT_TAGS,
  results = DEFAULT_RESULTS,
  quickActions = DEFAULT_QUICK_ACTIONS,
  files = DEFAULT_FILES,
  defaultQuery = "",
  onQueryChange,
  onSelectResult,
  className,
  modal = false,
  open,
  defaultOpen = false,
  onOpenChange,
  hotkey = "k",
  closeOnEscape = true,
  overlayClassName,
}: SearchModalProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [activeTags, setActiveTags] = useState<SearchTag[]>(tags);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(defaultQuery), [defaultQuery]);

  // Open state — controlled via `open`, otherwise internal.
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const actualOpen = isControlled ? open : internalOpen;

  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange],
  );

  // Keep the latest open state / setter reachable from the one-time listener.
  const openRef = useRef(actualOpen);
  const setOpenRef = useRef(setOpen);
  useEffect(() => {
    openRef.current = actualOpen;
    setOpenRef.current = setOpen;
  });

  // ⌘K / Ctrl+K to toggle, Escape to close.
  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (hotkey && e.key.toLowerCase() === hotkey.toLowerCase() && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpenRef.current(!openRef.current);
      } else if (closeOnEscape && e.key === "Escape" && openRef.current) {
        setOpenRef.current(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal, hotkey, closeOnEscape]);

  // Focus the input when the modal opens.
  useEffect(() => {
    if (modal && actualOpen) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [modal, actualOpen]);

  const filteredResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return results;
    return results.filter((r) => `${r.name} ${r.meta ?? ""} ${r.searchText ?? ""}`.toLowerCase().includes(q));
  }, [query, results]);
  const displayedResults = useMemo(() => filteredResults.slice(0, 8), [filteredResults]);
  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? files.filter((file) => `${file.name} ${file.ext ?? ""}`.toLowerCase().includes(q)) : files;
  }, [query, files]);

  const handleQuery = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
  };

  const removeTag = (index: number) =>
    setActiveTags((prev) => prev.filter((_, i) => i !== index));

  const panel = (
    <div
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? true : undefined}
      className={cn(
        "mx-auto max-h-[78vh] w-full max-w-xl overflow-x-hidden overflow-y-auto rounded-2xl border",
        "border-border bg-popover text-popover-foreground shadow-[var(--ds-shadow-modal)]",
        className,
      )}
    >
      {/* Search bar */}
      <div className="flex items-center gap-1 border-b border-border px-4 py-3.5">
        <MagnifyingGlass className={ICON} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="Search"
          className="min-w-0 flex-1 bg-transparent px-3 text-sm text-current outline-none placeholder:text-muted-foreground"
        />
        <div className="flex shrink-0 items-center gap-2.5">
          <button type="button" aria-label="Filters" className="text-muted-foreground transition-colors hover:text-foreground">
            <SlidersHorizontal className="h-[18px] w-[18px]" />
          </button>
          <kbd className="flex items-center gap-0.5 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground">
            <span className="text-[13px] leading-none">⌘</span>
            {modal && hotkey ? hotkey.toUpperCase() : "F"}
          </kbd>
        </div>
      </div>

      {/* Tags */}
      {activeTags.length > 0 ? (
        <div className="border-b border-border px-4 py-3.5">
          <span className="text-[13px] text-muted-foreground">I&apos;m looking for...</span>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeTags.map((tag, i) => (
              <Badge
                key={`${tag.label}-${i}`}
                variant="secondary"
                size="default"
                radius="full"
                className="gap-1.5 py-1 pl-2.5 pr-1.5 text-[13px] font-medium"
              >
                {tag.icon}
                <span>{tag.label}</span>
                <button
                  type="button"
                  onClick={() => removeTag(i)}
                  aria-label={`Remove ${tag.label}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {/* Results */}
      {results.length > 0 ? (
        <div className="border-b border-border">
          <p className="px-4 pt-3.5 pb-2 text-[13px] text-muted-foreground">
            Last search&nbsp;&nbsp;<span className="text-foreground">{filteredResults.length}</span>
          </p>
          <ul className="px-1.5 pb-1.5">
            {displayedResults.map((result, i) => (
              <li key={`${result.href || result.name}-${i}`}>
                <a
                  href={result.href ?? "#"}
                  onClick={(event) => {
                    if (onSelectResult) {
                      event.preventDefault();
                      onSelectResult(result, i);
                      if (modal) setOpen(false);
                    }
                  }}
                  className="group relative flex items-center rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/60"
                >
                  {result.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={result.avatar}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-border"
                    />
                  ) : (
                    <IconTile variant="soft" size="xs" radius="full" className="shrink-0 text-primary">
                      <FileArrowDown className="size-3.5" />
                    </IconTile>
                  )}
                  <span className="ml-2.5 truncate text-sm">
                    {result.name}
                    {result.meta ? <span className="pl-1.5 text-muted-foreground">{result.meta}</span> : null}
                  </span>
                  {result.actions && result.actions.length > 0 ? (
                    <span className="ml-auto flex items-center gap-2.5 pl-3 text-muted-foreground opacity-70 transition-opacity group-hover:opacity-100">
                      {result.actions.map((action, ai) => (
                        <button
                          key={ai}
                          type="button"
                          aria-label={action.label}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            action.onClick?.();
                            if (modal) setOpen(false);
                          }}
                          className="transition-colors hover:text-foreground"
                        >
                          {action.icon}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
          {!filteredResults.length && <p className="px-4 pb-3 text-sm text-muted-foreground">No matching results. Try another search.</p>}
        </div>
      ) : null}

      {/* Quick actions */}
      {quickActions.length > 0 ? (
        <div className="border-b border-border px-1.5 py-1.5">
          <p className="px-2.5 pt-2 pb-1 text-[13px] text-muted-foreground">Quick actions</p>
          {quickActions.map((action, i) => (
            <button
              key={`${action.label}-${i}`}
              type="button"
              onClick={() => { action.onClick?.(); if (modal) setOpen(false); }}
              className="relative flex w-full items-center rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <IconTile variant="soft" size="xs" className="text-muted-foreground">
                {action.icon ?? <Plus className="h-[15px] w-[15px]" />}
              </IconTile>
              <span className="pl-3 text-sm">{action.label}</span>
              {action.shortcut ? (
                <kbd className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-muted/60 font-sans text-[13px] text-muted-foreground">
                  {action.shortcut}
                </kbd>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Files */}
      {filteredFiles.length > 0 ? (
        <div className="px-1.5 py-1.5">
          <p className="px-2.5 pt-2 pb-1 text-[13px] text-muted-foreground">
            Files&nbsp;&nbsp;<span className="text-foreground">{filteredFiles.length}</span>
          </p>
          {filteredFiles.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="group relative flex items-center rounded-lg px-2.5 py-2 transition-colors hover:bg-muted/60"
            >
              <button
                type="button"
                disabled={!file.onOpen}
                onClick={() => { file.onOpen?.(); if (modal) setOpen(false); }}
                className="flex min-w-0 flex-1 items-center text-left disabled:cursor-default"
              >
                <IconTile variant="soft" size="xs" className="text-muted-foreground">
                  {file.icon ?? <FileArrowDown className="h-[15px] w-[15px]" />}
                </IconTile>
                <span className="flex min-w-0 items-center gap-1.5 truncate pl-3 text-sm">
                  <span className="truncate">
                    {file.name}
                    {file.ext ? <span className="text-muted-foreground">{file.ext}</span> : null}
                  </span>
                  {file.verified ? <Checks className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
                </span>
              </button>
              {file.onShare && <button
                type="button"
                onClick={() => { file.onShare?.(); if (modal) setOpen(false); }}
                className="ml-3 flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground opacity-80 transition-all hover:text-foreground group-hover:opacity-100"
              >
                <ShareFat className="h-4 w-4" />
                <span>Share</span>
              </button>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (!modal) return panel;

  return (
    <div
      onClick={() => setOpen(false)}
      aria-hidden={!actualOpen}
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh] transition-opacity duration-200",
        actualOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        overlayClassName,
      )}
    >
      <div className="absolute inset-0 bg-[var(--ds-scrim)]" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative z-10 w-full max-w-xl transition-all duration-200 ease-out",
          actualOpen ? "translate-y-0 scale-100 opacity-100" : "-translate-y-2 scale-[0.98] opacity-0",
        )}
      >
        {panel}
      </div>
    </div>
  );
}

export default SearchModal;
