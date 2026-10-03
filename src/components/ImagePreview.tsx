import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

interface Props {
  src: string;
  name: string;
}

/** A private attachment viewer with fit, zoom, rotate, pan, and browser fullscreen controls. */
export default function ImagePreview({ src, name }: Props) {
  const viewerRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState("");
  const [dragging, setDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setDimensions("");
  }, [src]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const zoomBy = (direction: -1 | 1) => {
    const next = Math.min(4, Math.max(0.5, Math.round((zoom + direction * 0.25) * 100) / 100));
    setZoom(next);
    if (next <= 1) setPan({ x: 0, y: 0 });
  };
  const resetView = () => { setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }); };
  const rotate = (direction: -1 | 1) => { setRotation((current) => (current + direction * 90 + 360) % 360); setPan({ x: 0, y: 0 }); };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewerRef.current?.requestFullscreen();
    } catch { /* Fullscreen is optional; the inline viewer remains usable. */ }
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    const maxX = Math.max(0, bounds.width * (zoom - 1) / 2);
    const maxY = Math.max(0, bounds.height * (zoom - 1) / 2);
    const nextX = dragStart.current.panX + event.clientX - dragStart.current.x;
    const nextY = dragStart.current.panY + event.clientY - dragStart.current.y;
    setPan({ x: Math.max(-maxX, Math.min(maxX, nextX)), y: Math.max(-maxY, Math.min(maxY, nextY)) });
  };
  const stopDrag = () => { dragStart.current = null; setDragging(false); };

  return <section ref={viewerRef} className="document-image-viewer" aria-label={`Image preview: ${name}`}>
    <header className="document-image-toolbar">
      <div className="document-image-info"><b>{name}</b><span>{dimensions || "Image preview"}</span></div>
      <div className="document-image-controls" role="group" aria-label="Image controls">
        <button type="button" onClick={() => zoomBy(-1)} disabled={zoom <= 0.5} title="Zoom out" aria-label="Zoom out"><ZoomOut size={15}/></button>
        <span className="document-image-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1)} disabled={zoom >= 4} title="Zoom in" aria-label="Zoom in"><ZoomIn size={15}/></button>
        <i aria-hidden="true"/>
        <button type="button" onClick={() => rotate(-1)} title="Rotate left" aria-label="Rotate left"><RotateCcw size={15}/></button>
        <button type="button" onClick={() => rotate(1)} title="Rotate right" aria-label="Rotate right"><RotateCw size={15}/></button>
        <button type="button" onClick={resetView} title="Fit image" aria-label="Fit image"><span>Fit</span></button>
        <button type="button" onClick={() => void toggleFullscreen()} title={isFullscreen ? "Exit fullscreen" : "View fullscreen"} aria-label={isFullscreen ? "Exit fullscreen" : "View fullscreen"}><Maximize size={15}/></button>
      </div>
    </header>
    <div
      ref={viewportRef}
      className={`document-image-viewport ${zoom > 1 ? "can-pan" : ""} ${dragging ? "is-dragging" : ""}`}
      role="img"
      aria-label={`${name}${dimensions ? `, ${dimensions}` : ""}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <img
        src={src}
        alt={name}
        draggable={false}
        onLoad={(event) => setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`, transition: dragging ? "none" : undefined }}
      />
    </div>
  </section>;
}
