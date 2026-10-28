// Persora Docs — lightweight, read-only miniature document previews for dashboard
// & starter template cards.
// Never mounts TipTap / ProseMirror editors on the dashboard.
import { useEffect, useRef, useState } from "react";
import {
  extractDocSummaryMeta,
  type DocContent,
  type DocPreviewBlock,
} from "../../../cloudflare/docs-rules.js";
import { getDocPreview, type DocSummary } from "../../lib/docs-api";

const MAX_CONCURRENT = 4;
const previewCache = new Map<string, DocPreviewBlock[]>();
const inFlight = new Map<string, Promise<DocPreviewBlock[]>>();
let activeCount = 0;
const queue: Array<() => void> = [];

function pump() {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    if (next) next();
  }
}

function fetchPreviewBlocks(docId: string, revision: number): Promise<DocPreviewBlock[]> {
  const key = `${docId}:${revision}`;
  const hit = previewCache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inFlight.get(key);
  if (running) return running;

  const p = new Promise<DocPreviewBlock[]>((resolve, reject) => {
    const run = () => {
      activeCount += 1;
      getDocPreview(docId)
        .then((detail) => {
          const blocks =
            detail.previewBlocks?.length > 0
              ? detail.previewBlocks
              : extractDocSummaryMeta(detail.content).previewBlocks;
          for (const existing of previewCache.keys()) {
            if (existing.startsWith(`${docId}:`) && existing !== key) {
              previewCache.delete(existing);
            }
          }
          previewCache.set(key, blocks);
          resolve(blocks);
        })
        .catch(reject)
        .finally(() => {
          activeCount = Math.max(0, activeCount - 1);
          inFlight.delete(key);
          pump();
        });
    };
    if (activeCount < MAX_CONCURRENT) run();
    else queue.push(run);
  });

  inFlight.set(key, p);
  return p;
}

export function clearDocPreviewCache(docId?: string) {
  if (!docId) {
    previewCache.clear();
    return;
  }
  for (const k of previewCache.keys()) {
    if (k.startsWith(`${docId}:`)) previewCache.delete(k);
  }
}

export function BlankDocArtwork() {
  return (
    <div className="pd-mini-paper pd-mini-blank-paper" aria-hidden="true">
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M19 8H25V19H19V8Z" fill="#4285F4" />
        <path d="M25 19H36V25H25V19Z" fill="#FBBC04" />
        <path d="M19 25H25V36H19V25Z" fill="#34A853" />
        <path d="M8 19H19V25H8V19Z" fill="#EA4335" />
        <path d="M19 19H25V25H19V19Z" fill="#1A73E8" />
      </svg>
    </div>
  );
}

export function DocContentMiniature({
  blocks,
  content,
  snippet,
}: {
  blocks?: DocPreviewBlock[];
  content?: DocContent;
  snippet?: string;
}) {
  const resolved: DocPreviewBlock[] =
    blocks && blocks.length > 0
      ? blocks
      : content
        ? extractDocSummaryMeta(content).previewBlocks
        : snippet?.trim()
          ? [{ style: "body", text: snippet.trim() }]
          : [];

  return (
    <div className="pd-mini-paper" aria-hidden="true">
      {resolved.length === 0 ? (
        <div className="pd-mini-empty-page">
          <span className="pd-mini-empty-cursor" />
          <span className="pd-mini-empty-hint">Empty document</span>
        </div>
      ) : (
        <div className="pd-mini-flow">
          {resolved.slice(0, 6).map((block, index) => {
            if (block.style === "rule") {
              return <div key={index} className="pd-mini-rule" />;
            }
            const alignStyle =
              block.align && block.align !== "left"
                ? ({ textAlign: block.align } as const)
                : undefined;
            if (block.style === "bullet") {
              return (
                <div key={index} className="pd-mini-list-row" style={alignStyle}>
                  <span className="pd-mini-bullet">•</span>
                  <span className="pd-mini-line pd-mini-body">{block.text}</span>
                </div>
              );
            }
            return (
              <div
                key={index}
                className={`pd-mini-line pd-mini-${block.style}`}
                style={alignStyle}
              >
                {block.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DocCardPreview({ doc }: { doc: DocSummary }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [fetchedBlocks, setFetchedBlocks] = useState<DocPreviewBlock[] | null>(null);

  const hasSummaryBlocks = Array.isArray(doc.previewBlocks) && doc.previewBlocks.length > 0;
  const needsLazyFetch = !hasSummaryBlocks && doc.wordCount > 0;

  useEffect(() => {
    setFetchedBlocks(null);
    if (!needsLazyFetch) return;
    const node = hostRef.current;
    let cancelled = false;

    const trigger = () => {
      fetchPreviewBlocks(doc.id, doc.revision)
        .then((blocks) => {
          if (!cancelled) setFetchedBlocks(blocks);
        })
        .catch(() => {
          /* fall back to snippet cleanly */
        });
    };

    if (!node || typeof IntersectionObserver === "undefined") {
      trigger();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          trigger();
        }
      },
      { rootMargin: "180px" },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [doc.id, doc.revision, needsLazyFetch]);

  return (
    <div ref={hostRef} className="pd-mini-host">
      <DocContentMiniature
        blocks={hasSummaryBlocks ? doc.previewBlocks : fetchedBlocks ?? undefined}
        snippet={doc.snippet}
      />
    </div>
  );
}
