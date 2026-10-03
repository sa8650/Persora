import { useMemo, useState } from "react";
import { ExternalLink, ZoomIn, ZoomOut } from "lucide-react";
import "../pdf-preview.css";

interface Props {
  src: string;
  name: string;
}

function withPdfViewerOptions(src: string, zoom: number | null) {
  try {
    const url = new URL(src, window.location.href);
    const options = new URLSearchParams(url.hash.replace(/^#/, ""));
    options.set("toolbar", "1");
    options.set("navpanes", "0");
    options.set("scrollbar", "1");
    options.set("view", "FitH");
    options.set("zoom", zoom === null ? "page-width" : String(zoom));
    url.hash = options.toString();
    return url.toString();
  } catch {
    const fragment = `toolbar=1&navpanes=0&scrollbar=1&view=FitH&zoom=${zoom === null ? "page-width" : zoom}`;
    return `${src}${src.includes("#") ? "&" : "#"}${fragment}`;
  }
}

export default function PdfPreview({ src, name }: Props) {
  const [zoom, setZoom] = useState<number | null>(null);
  const viewerSrc = useMemo(() => withPdfViewerOptions(src, zoom), [src, zoom]);
  const label = name || "PDF document";

  return <section className="pdf-preview-viewer" aria-label={`PDF preview: ${label}`}>
    <div className="pdf-preview-toolbar">
      <div className="pdf-preview-file">
        <span className="pdf-preview-file-icon"><span>PDF</span></span>
        <span className="pdf-preview-file-copy"><b title={label}>{label}</b><small>PDF preview</small></span>
      </div>
      <div className="pdf-preview-controls" role="group" aria-label="PDF preview controls">
        <button type="button" onClick={() => setZoom((current) => Math.max(50, (current ?? 100) - 25))} disabled={zoom !== null && zoom <= 50} aria-label="Zoom out" title="Zoom out"><ZoomOut size={15}/></button>
        <span className="pdf-preview-zoom">{zoom === null ? "Fit" : `${zoom}%`}</span>
        <button type="button" onClick={() => setZoom((current) => Math.min(200, (current ?? 100) + 25))} disabled={zoom !== null && zoom >= 200} aria-label="Zoom in" title="Zoom in"><ZoomIn size={15}/></button>
        <i aria-hidden="true"/>
        <button type="button" className="pdf-preview-fit" onClick={() => setZoom(null)} aria-label="Fit PDF to width" title="Fit to width">Fit</button>
        <a href={viewerSrc} target="_blank" rel="noopener noreferrer" aria-label="Open PDF in a new tab" title="Open in new tab"><ExternalLink size={14}/></a>
      </div>
    </div>
    <iframe className="pdf-preview-frame" src={viewerSrc} title={`PDF preview: ${label}`} loading="lazy" />
  </section>;
}
