import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./template-card.css";

export const START_SHELF_EXPANDED_SIDEBAR_LIMIT = 5;
export const START_SHELF_COLLAPSED_SIDEBAR_LIMIT = 6;
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "persora.sidebar.collapsed";

const WorkspaceSidebarContext = createContext<boolean | null>(null);

export function WorkspaceSidebarProvider({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: ReactNode;
}) {
  return (
    <WorkspaceSidebarContext.Provider value={collapsed}>
      {children}
    </WorkspaceSidebarContext.Provider>
  );
}

function readDomOrStoredSidebarCollapsed(): boolean {
  if (typeof document !== "undefined") {
    const sidebar = document.querySelector(".workspace-sidebar");
    if (sidebar) {
      return sidebar.classList.contains("is-collapsed");
    }
  }
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Tracks whether the workspace navigation sidebar is collapsed.
 * Inside `<Workspace>`, reads synchronous React context so card limits
 * recalculate in the exact same render pass without reloading the page.
 * Outside `<Workspace>` (e.g. standalone tests), observes `.workspace-sidebar.is-collapsed`
 * and `localStorage["persora.sidebar.collapsed"]`.
 */
export function useWorkspaceSidebarCollapsed(): boolean {
  const provided = useContext(WorkspaceSidebarContext);
  const [fallbackCollapsed, setFallbackCollapsed] = useState<boolean>(() =>
    provided !== null ? provided : readDomOrStoredSidebarCollapsed(),
  );

  useEffect(() => {
    if (provided !== null || typeof document === "undefined") return;

    const sync = () => {
      setFallbackCollapsed(readDomOrStoredSidebarCollapsed());
    };
    sync();

    const observer =
      typeof MutationObserver !== "undefined" && document.body
        ? new MutationObserver(sync)
        : null;
    observer?.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });

    window.addEventListener("storage", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("storage", sync);
    };
  }, [provided]);

  return provided !== null ? provided : fallbackCollapsed;
}

/**
 * Computes the number of visible cards on the start shelf:
 * - Expanded sidebar + collapsed gallery: maximum 5 cards
 * - Collapsed sidebar + collapsed gallery: maximum 6 cards
 * - Expanded gallery (any sidebar state): all available cards
 */
export function getStartShelfVisibleLimit({
  sidebarCollapsed,
  galleryExpanded,
  totalCards,
}: {
  sidebarCollapsed: boolean;
  galleryExpanded: boolean;
  totalCards: number;
}): number {
  const safeTotal = Number.isFinite(totalCards) ? Math.max(0, Math.trunc(totalCards)) : 0;
  if (galleryExpanded) return safeTotal;
  const maxForSidebar = sidebarCollapsed
    ? START_SHELF_COLLAPSED_SIDEBAR_LIMIT
    : START_SHELF_EXPANDED_SIDEBAR_LIMIT;
  return Math.min(safeTotal, maxForSidebar);
}

export interface StartShelfItem {
  key: string;
  render: () => ReactNode;
}

export interface StartShelfProps {
  headingId: string;
  heading: string;
  items: readonly StartShelfItem[];
  shelfClassName?: string;
  headClassName?: string;
  titleClassName?: string;
  controlsClassName?: string;
  toggleClassName?: string;
  gridClassName?: string;
  itemClassName?: string;
  collapsedLabel?: string;
  expandedLabel?: string;
}

/**
 * Shared Start Shelf component used identically across Persora Table,
 * Persora Forms, and Persora Docs.
 *
 * - Default state: displays at most 5 cards (expanded sidebar) or 6 cards
 *   (collapsed sidebar) in a single row without wrapping.
 * - Clicking the Template Gallery button manually expands/collapses all
 *   available templates and updates both its label and chevron indicator.
 * - Sidebar state changes immediately recalculate the default card limit
 *   without reloading the page and never auto-expand or auto-collapse
 *   an explicitly expanded gallery.
 */
export function StartShelf({
  headingId,
  heading,
  items,
  shelfClassName = "",
  headClassName = "",
  titleClassName = "",
  controlsClassName = "",
  toggleClassName = "",
  gridClassName = "",
  itemClassName = "",
  collapsedLabel = "Template gallery",
  expandedLabel = "Collapse gallery",
}: StartShelfProps) {
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const sidebarCollapsed = useWorkspaceSidebarCollapsed();
  const rawGridId = useId();
  const gridId = `start-shelf-grid-${rawGridId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const visibleLimit = getStartShelfVisibleLimit({
    sidebarCollapsed,
    galleryExpanded,
    totalCards: items.length,
  });
  const visibleItems = items.slice(0, visibleLimit);

  const sectionClass = ["ds-start-shelf", shelfClassName].filter(Boolean).join(" ");
  const headerClass = ["ds-start-shelf-head", headClassName].filter(Boolean).join(" ");
  const h2Class = ["ds-start-shelf-title", titleClassName].filter(Boolean).join(" ");
  const controlsClass = ["ds-start-shelf-controls", controlsClassName].filter(Boolean).join(" ");
  const buttonClass = [
    "ds-start-shelf-toggle",
    toggleClassName,
    galleryExpanded ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const listClass = [
    "ds-start-shelf-grid",
    gridClassName,
    galleryExpanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const liClass = ["ds-start-shelf-item", itemClassName].filter(Boolean).join(" ");

  return (
    <section
      className={sectionClass}
      aria-labelledby={headingId}
      data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}
      data-gallery-state={galleryExpanded ? "expanded" : "collapsed"}
    >
      <div className={headerClass}>
        <h2 className={h2Class} id={headingId}>
          {heading}
        </h2>
        <div className={controlsClass}>
          <button
            type="button"
            className={buttonClass}
            aria-expanded={galleryExpanded}
            aria-controls={gridId}
            data-gallery-expanded={galleryExpanded ? "true" : "false"}
            onClick={() => setGalleryExpanded((prev) => !prev)}
          >
            <span className="ds-start-shelf-toggle-label">
              {galleryExpanded ? expandedLabel : collapsedLabel}
            </span>
            {galleryExpanded ? (
              <ChevronUp
                size={14}
                aria-hidden="true"
                className="ds-start-shelf-toggle-icon is-open"
                data-indicator="collapse"
              />
            ) : (
              <ChevronDown
                size={14}
                aria-hidden="true"
                className="ds-start-shelf-toggle-icon"
                data-indicator="expand"
              />
            )}
          </button>
        </div>
      </div>

      <ul id={gridId} className={listClass}>
        {visibleItems.map((item) => (
          <li key={item.key} className={liClass}>
            {item.render()}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default StartShelf;
