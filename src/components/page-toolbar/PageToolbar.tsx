import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./page-toolbar.css";

/**
 * Full-width page toolbar.
 *
 * A page renders `<PageToolbar>` anywhere in its own tree; the bar itself is
 * portaled into the workspace shell's top slot (`top: 0`, zero top gap), while
 * the dynamic island floats cleanly over its centre. Controls stay in the
 * page's React tree, so context and handlers are unchanged.
 */

type ToolbarPalette = "habits" | "loans" | "calendar";
type ToolbarSlots = {
  start: HTMLElement | null;
  tools: HTMLElement | null;
  end: HTMLElement | null;
  setPalette: (palette: ToolbarPalette | null) => void;
  setActive: (delta: 1 | -1) => void;
};

const ToolbarSlotContext = createContext<ToolbarSlots | null>(null);

/**
 * Rendered by the workspace shell: provides the full-width strip and wraps the
 * workspace content, so any page inside it can mount its tools here.
 */
export function PageToolbarHost({ children }: { children?: ReactNode }) {
  const startRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  // The active page tells the bar which palette (and border colour) to wear,
  // because the tools render outside that page's own root element.
  const [palette, setPalette] = useState<ToolbarPalette | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [slots, setSlots] = useState<ToolbarSlots>({ start: null, tools: null, end: null, setPalette, setActive: () => undefined });
  const setPaletteStable = useCallback((next: ToolbarPalette | null) => setPalette(next), []);
  const setActiveStable = useCallback((delta: 1 | -1) => setActiveCount((count) => Math.max(0, count + delta)), []);

  // Publish the slot nodes once they exist. Stable refs keep this from
  // re-attaching on every render.
  useEffect(() => {
    setSlots({ start: startRef.current, tools: toolsRef.current, end: endRef.current, setPalette: setPaletteStable, setActive: setActiveStable });
  }, [setPaletteStable, setActiveStable]);

  return (
    <ToolbarSlotContext.Provider value={slots}>
      {/* Pages without tools render no bar at all. */}
      <div className={`page-toolbar-host${palette ? ` is-${palette}` : ""}${activeCount === 0 ? " is-empty" : ""}`.trim()}>
        <div className="page-toolbar-start" ref={startRef} />
        <div className="page-toolbar-tools" ref={toolsRef} />
        <div className="page-toolbar-end" ref={endRef} />
      </div>
      {children}
    </ToolbarSlotContext.Provider>
  );
}

export default function PageToolbar({
  label,
  palette,
  start,
  children,
  end,
}: {
  /** Accessible name of the toolbar. */
  label: string;
  /** The page's own palette, applied to the bar. */
  palette?: ToolbarPalette;
  /** Leading tools (page navigation, date steppers, headings). */
  start?: ReactNode;
  /** Main tools. */
  children?: ReactNode;
  /** Trailing tools (primary action). */
  end?: ReactNode;
}) {
  const slots = useContext(ToolbarSlotContext);
  const [ready, setReady] = useState(false);

  // The host's refs land after their first render; mount the portals afterwards.
  useEffect(() => { setReady(true); }, []);

  useEffect(() => {
    slots?.setActive(1);
    return () => slots?.setActive(-1);
  }, [slots]);

  useEffect(() => {
    slots?.setPalette(palette ?? null);
    return () => slots?.setPalette(null);
  }, [slots, palette]);

  // Wait for the host's slots; a bar without them renders nothing.
  if (!slots?.start || !slots.tools || !slots.end) return null;
  if (!ready) return null;

  return (
    <>
      {createPortal(<div className="page-toolbar-label" role="toolbar" aria-label={label}>{start}</div>, slots.start)}
      {createPortal(children, slots.tools)}
      {createPortal(end, slots.end)}
    </>
  );
}
