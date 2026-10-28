// Persora Docs — shared, dependency-free schema validation, sanitization,
// lightweight card preview extraction, safe HTML serialization, and starter templates.
// Used identically by the Cloudflare Pages API (cloudflare/docs.js) and the React client.

export class DocRuleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "DocRuleError";
    this.status = status;
  }
}

export const DOC_LIMITS = Object.freeze({
  docs: 300,
  maxTitleChars: 160,
  maxJsonBytes: 512_000,
  maxBlocks: 2_500,
  maxDepth: 8,
  maxTextNodeChars: 32_000,
  maxPreviewBlocks: 7,
  maxPreviewBlockChars: 120,
  maxSnippetChars: 280,
});

export const DOC_FONT_SIZES = Object.freeze([
  "9pt",
  "10pt",
  "11pt",
  "12pt",
  "14pt",
  "16pt",
  "18pt",
  "24pt",
  "30pt",
  "36pt",
]);

const FONT_SIZE_SET = new Set(DOC_FONT_SIZES);

export const DOC_TEXT_COLORS = Object.freeze([
  { id: "ink", label: "Default ink", hex: "#1f2937" },
  { id: "slate", label: "Muted slate", hex: "#475569" },
  { id: "gray", label: "Soft gray", hex: "#6b7280" },
  { id: "blue", label: "Persora blue", hex: "#1a73e8" },
  { id: "navy", label: "Deep navy", hex: "#1e3a8a" },
  { id: "teal", label: "Teal", hex: "#0f766e" },
  { id: "green", label: "Forest green", hex: "#15803d" },
  { id: "amber", label: "Warm amber", hex: "#b45309" },
  { id: "red", label: "Crimson", hex: "#dc2626" },
  { id: "purple", label: "Royal purple", hex: "#7e22ce" },
]);

export const DOC_HIGHLIGHT_COLORS = Object.freeze([
  { id: "yellow", label: "Soft yellow", hex: "#fef08a" },
  { id: "green", label: "Mint highlight", hex: "#bbf7d0" },
  { id: "blue", label: "Sky highlight", hex: "#bfdbfe" },
  { id: "purple", label: "Lavender", hex: "#e9d5ff" },
  { id: "pink", label: "Rose highlight", hex: "#fbcfe8" },
  { id: "orange", label: "Peach", hex: "#fed7aa" },
  { id: "gray", label: "Neutral gray", hex: "#e5e7eb" },
]);

const ALIGN_SET = new Set(["left", "center", "right", "justify"]);
const PARAGRAPH_VARIANTS = new Set(["normal", "title", "subtitle"]);
const PREVIEW_STYLES = new Set([
  "title",
  "subtitle",
  "h1",
  "h2",
  "h3",
  "bullet",
  "ordered",
  "quote",
  "rule",
  "body",
]);

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanDocTitle(raw, { allowEmptyDefault = false } = {}) {
  if (raw === undefined || raw === null) {
    if (allowEmptyDefault) return "Untitled document";
    throw new DocRuleError("Enter a document title.");
  }
  if (typeof raw !== "string") {
    throw new DocRuleError("Document title must be text.");
  }
  const cleaned = raw.replace(CONTROL_CHARS_RE, "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    if (allowEmptyDefault) return "Untitled document";
    throw new DocRuleError("Document title cannot be empty.");
  }
  if (cleaned.length > DOC_LIMITS.maxTitleChars) {
    throw new DocRuleError(`Document title must be ${DOC_LIMITS.maxTitleChars} characters or fewer.`);
  }
  return cleaned;
}

export function normalizeHexColor(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgbMatch = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) {
    const parts = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    if (parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return null;
}

export function normalizeFontSize(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (FONT_SIZE_SET.has(trimmed)) return trimmed;
  const ptMatch = trimmed.match(/^(\d+(?:\.\d+)?)pt$/);
  if (ptMatch) {
    const pt = Number(ptMatch[1]);
    return closestFontSizePt(pt);
  }
  const pxMatch = trimmed.match(/^(\d+(?:\.\d+)?)px$/);
  if (pxMatch) {
    const pt = (Number(pxMatch[1]) * 72) / 96;
    return closestFontSizePt(pt);
  }
  return null;
}

function closestFontSizePt(pt) {
  if (!Number.isFinite(pt) || pt <= 0) return null;
  const choices = [9, 10, 11, 12, 14, 16, 18, 24, 30, 36];
  let best = choices[0];
  let bestDiff = Math.abs(pt - best);
  for (const c of choices) {
    const diff = Math.abs(pt - c);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return `${best}pt`;
}

/**
 * Strictly validates and normalizes a hyperlink URL.
 * Rejects javascript:, data:, vbscript:, file:, blob:, control chars, or malformed URLs.
 */
export function sanitizeDocHref(raw, { autoHttps = false } = {}) {
  if (typeof raw !== "string") return null;
  let candidate = raw.replace(CONTROL_CHARS_RE, "").trim();
  if (!candidate || candidate.length > 2048) return null;

  if (autoHttps && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate) && !candidate.startsWith("//")) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      candidate = `mailto:${candidate}`;
    } else {
      candidate = `https://${candidate}`;
    }
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:" && protocol !== "mailto:") {
    return null;
  }
  if ((protocol === "https:" || protocol === "http:") && !parsed.hostname) {
    return null;
  }
  return parsed.toString();
}

export function blankDocContent() {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

function sanitizeMarks(rawMarks) {
  if (!Array.isArray(rawMarks) || rawMarks.length === 0) return undefined;
  const out = [];
  const seen = new Set();

  for (const mark of rawMarks) {
    if (!mark || typeof mark !== "object" || typeof mark.type !== "string") continue;
    const type = mark.type;
    if (type === "bold" || type === "italic" || type === "underline" || type === "strike") {
      if (!seen.has(type)) {
        seen.add(type);
        out.push({ type });
      }
      continue;
    }
    if (type === "textStyle") {
      if (seen.has("textStyle")) continue;
      const rawAttrs = mark.attrs && typeof mark.attrs === "object" ? mark.attrs : {};
      const color = normalizeHexColor(rawAttrs.color);
      const fontSize = normalizeFontSize(rawAttrs.fontSize);
      const attrs = {};
      if (color) attrs.color = color;
      if (fontSize) attrs.fontSize = fontSize;
      if (Object.keys(attrs).length > 0) {
        seen.add("textStyle");
        out.push({ type: "textStyle", attrs });
      }
      continue;
    }
    if (type === "highlight") {
      if (seen.has("highlight")) continue;
      const rawAttrs = mark.attrs && typeof mark.attrs === "object" ? mark.attrs : {};
      const color = normalizeHexColor(rawAttrs.color) || "#fef08a";
      seen.add("highlight");
      out.push({ type: "highlight", attrs: { color } });
      continue;
    }
    if (type === "link") {
      if (seen.has("link")) continue;
      const rawAttrs = mark.attrs && typeof mark.attrs === "object" ? mark.attrs : {};
      const href = sanitizeDocHref(rawAttrs.href);
      if (href) {
        seen.add("link");
        out.push({
          type: "link",
          attrs: {
            href,
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        });
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeInlineNodes(rawContent) {
  if (!Array.isArray(rawContent) || rawContent.length === 0) return undefined;
  const out = [];
  for (const child of rawContent) {
    if (!child || typeof child !== "object" || typeof child.type !== "string") continue;
    if (child.type === "hardBreak") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (child.type === "text" && typeof child.text === "string") {
      const cleanedText = child.text.replace(CONTROL_CHARS_RE, "");
      if (!cleanedText) continue;
      if (cleanedText.length > DOC_LIMITS.maxTextNodeChars) {
        throw new DocRuleError("A single text segment in this document exceeds the maximum allowed length.");
      }
      const marks = sanitizeMarks(child.marks);
      const node = { type: "text", text: cleanedText };
      if (marks) node.marks = marks;
      out.push(node);
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeAlign(attrs) {
  if (!attrs || typeof attrs !== "object") return undefined;
  const align = typeof attrs.textAlign === "string" ? attrs.textAlign.trim().toLowerCase() : "";
  if (ALIGN_SET.has(align) && align !== "left") return align;
  return undefined;
}

export function sanitizeDocContent(input) {
  if (input === undefined || input === null) {
    return blankDocContent();
  }
  if (typeof input !== "object" || Array.isArray(input) || input.type !== "doc") {
    throw new DocRuleError("Document content must be a valid structured Persora document.");
  }

  let rawJson;
  try {
    rawJson = JSON.stringify(input);
  } catch {
    throw new DocRuleError("Document content could not be serialized.");
  }
  if (rawJson.length > DOC_LIMITS.maxJsonBytes) {
    throw new DocRuleError("This document exceeds the maximum size limit (500 KB).");
  }

  const state = { blocks: 0 };

  function walkBlockList(nodes, depth) {
    if (depth > DOC_LIMITS.maxDepth) {
      throw new DocRuleError("Document formatting is nested too deeply.");
    }
    if (!Array.isArray(nodes)) return [];
    const out = [];
    for (const node of nodes) {
      const cleaned = sanitizeBlock(node, depth);
      if (cleaned) out.push(cleaned);
    }
    return out;
  }

  function sanitizeBlock(node, depth) {
    if (!node || typeof node !== "object" || typeof node.type !== "object" && typeof node.type !== "string") {
      return null;
    }
    if (typeof node.type !== "string") return null;

    state.blocks += 1;
    if (state.blocks > DOC_LIMITS.maxBlocks) {
      throw new DocRuleError(`Documents can contain up to ${DOC_LIMITS.maxBlocks} blocks.`);
    }

    const type = node.type;
    const rawAttrs = node.attrs && typeof node.attrs === "object" ? node.attrs : {};

    if (type === "paragraph") {
      const attrs = {};
      const align = sanitizeAlign(rawAttrs);
      const variant = typeof rawAttrs.variant === "string" && PARAGRAPH_VARIANTS.has(rawAttrs.variant)
        ? rawAttrs.variant
        : "normal";
      if (align) attrs.textAlign = align;
      if (variant !== "normal") attrs.variant = variant;
      const content = sanitizeInlineNodes(node.content);
      const out = { type: "paragraph" };
      if (Object.keys(attrs).length > 0) out.attrs = attrs;
      if (content) out.content = content;
      return out;
    }

    if (type === "heading") {
      const levelNum = Number(rawAttrs.level);
      const level = levelNum === 1 || levelNum === 2 || levelNum === 3 ? levelNum : 1;
      const attrs = { level };
      const align = sanitizeAlign(rawAttrs);
      if (align) attrs.textAlign = align;
      const content = sanitizeInlineNodes(node.content);
      const out = { type: "heading", attrs };
      if (content) out.content = content;
      return out;
    }

    if (type === "bulletList") {
      if (depth + 1 > DOC_LIMITS.maxDepth) {
        throw new DocRuleError("List nesting exceeds the maximum depth.");
      }
      const items = sanitizeListItems(node.content, depth + 1);
      if (items.length === 0) return null;
      return { type: "bulletList", content: items };
    }

    if (type === "orderedList") {
      if (depth + 1 > DOC_LIMITS.maxDepth) {
        throw new DocRuleError("List nesting exceeds the maximum depth.");
      }
      const items = sanitizeListItems(node.content, depth + 1);
      if (items.length === 0) return null;
      const startNum = Number(rawAttrs.start);
      const start = Number.isInteger(startNum) && startNum >= 1 && startNum <= 9999 ? startNum : 1;
      const out = { type: "orderedList", content: items };
      if (start !== 1) out.attrs = { start };
      return out;
    }

    if (type === "blockquote") {
      const inner = walkBlockList(node.content, depth + 1);
      return {
        type: "blockquote",
        content: inner.length > 0 ? inner : [{ type: "paragraph" }],
      };
    }

    if (type === "horizontalRule") {
      return { type: "horizontalRule" };
    }

    return null;
  }

  function sanitizeListItems(rawItems, depth) {
    if (!Array.isArray(rawItems)) return [];
    const items = [];
    for (const item of rawItems) {
      if (!item || typeof item !== "object" || item.type !== "listItem") continue;
      state.blocks += 1;
      if (state.blocks > DOC_LIMITS.maxBlocks) {
        throw new DocRuleError(`Documents can contain up to ${DOC_LIMITS.maxBlocks} blocks.`);
      }
      const inner = walkBlockList(item.content, depth + 1);
      items.push({
        type: "listItem",
        content: inner.length > 0 ? inner : [{ type: "paragraph" }],
      });
    }
    return items;
  }

  const topBlocks = walkBlockList(input.content, 1);
  return {
    type: "doc",
    content: topBlocks.length > 0 ? topBlocks : [{ type: "paragraph" }],
  };
}

function inlineTextOf(content) {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const child of content) {
    if (!child || typeof child !== "object") continue;
    if (child.type === "text" && typeof child.text === "string") {
      out += child.text;
    } else if (child.type === "hardBreak") {
      out += " ";
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

export function extractDocSummaryMeta(doc) {
  const safe = doc && typeof doc === "object" && Array.isArray(doc.content) ? doc : blankDocContent();
  const previewBlocks = [];
  const allSegments = [];

  function pushPreview(style, text, align) {
    if (text) allSegments.push(text);
    if (previewBlocks.length >= DOC_LIMITS.maxPreviewBlocks) return;
    if (style === "rule") {
      previewBlocks.push({ style: "rule", text: "" });
      return;
    }
    if (!text) return;
    const entry = {
      style: PREVIEW_STYLES.has(style) ? style : "body",
      text: text.slice(0, DOC_LIMITS.maxPreviewBlockChars),
    };
    if (align && ALIGN_SET.has(align) && align !== "left") {
      entry.align = align;
    }
    previewBlocks.push(entry);
  }

  function visitBlocks(blocks, listKind = null, listIndexStart = 1) {
    if (!Array.isArray(blocks)) return;
    let idx = listIndexStart;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "paragraph") {
        const text = inlineTextOf(block.content);
        const variant = block.attrs?.variant;
        const align = block.attrs?.textAlign;
        const style = listKind
          ? listKind
          : variant === "title"
            ? "title"
            : variant === "subtitle"
              ? "subtitle"
              : "body";
        pushPreview(style, listKind === "ordered" && text ? `${idx}. ${text}` : text, align);
      } else if (block.type === "heading") {
        const text = inlineTextOf(block.content);
        const level = block.attrs?.level === 2 ? "h2" : block.attrs?.level === 3 ? "h3" : "h1";
        pushPreview(level, text, block.attrs?.textAlign);
      } else if (block.type === "bulletList") {
        if (Array.isArray(block.content)) {
          for (const li of block.content) {
            if (li?.type === "listItem") visitBlocks(li.content, "bullet");
          }
        }
      } else if (block.type === "orderedList") {
        let n = Number(block.attrs?.start) || 1;
        if (Array.isArray(block.content)) {
          for (const li of block.content) {
            if (li?.type === "listItem") {
              visitBlocks(li.content, "ordered", n);
              n += 1;
            }
          }
        }
      } else if (block.type === "blockquote") {
        if (Array.isArray(block.content)) {
          for (const inner of block.content) {
            if (inner?.type === "paragraph" || inner?.type === "heading") {
              pushPreview("quote", inlineTextOf(inner.content), inner.attrs?.textAlign);
            } else {
              visitBlocks([inner]);
            }
          }
        }
      } else if (block.type === "horizontalRule") {
        pushPreview("rule", "");
      }
      idx += 1;
    }
  }

  visitBlocks(safe.content);

  const joined = allSegments.join(" ").replace(/\s+/g, " ").trim();
  const wordCount = joined ? joined.split(/\s+/).filter(Boolean).length : 0;
  const snippet = joined.slice(0, DOC_LIMITS.maxSnippetChars);

  return {
    previewBlocks,
    snippet,
    wordCount,
  };
}

export function sanitizePreviewBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, DOC_LIMITS.maxPreviewBlocks)) {
    if (!item || typeof item !== "object") continue;
    const style = typeof item.style === "string" && PREVIEW_STYLES.has(item.style) ? item.style : "body";
    const text = typeof item.text === "string"
      ? item.text.replace(CONTROL_CHARS_RE, "").slice(0, DOC_LIMITS.maxPreviewBlockChars)
      : "";
    if (style !== "rule" && !text) continue;
    const entry = { style, text: style === "rule" ? "" : text };
    if (typeof item.align === "string" && ALIGN_SET.has(item.align) && item.align !== "left") {
      entry.align = item.align;
    }
    out.push(entry);
  }
  return out;
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineToSafeHtml(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return "<br>";
  let html = "";
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (node.type === "hardBreak") {
      html += "<br>";
      continue;
    }
    if (node.type !== "text" || typeof node.text !== "string") continue;
    let chunk = escapeHtml(node.text);
    const marks = sanitizeMarks(node.marks) || [];
    for (const mark of marks) {
      if (mark.type === "bold") chunk = `<strong>${chunk}</strong>`;
      else if (mark.type === "italic") chunk = `<em>${chunk}</em>`;
      else if (mark.type === "underline") chunk = `<u>${chunk}</u>`;
      else if (mark.type === "strike") chunk = `<s>${chunk}</s>`;
      else if (mark.type === "highlight") {
        const bg = normalizeHexColor(mark.attrs?.color) || "#fef08a";
        chunk = `<mark style="background-color:${bg};color:inherit;padding:0 2px;border-radius:2px">${chunk}</mark>`;
      } else if (mark.type === "textStyle") {
        const styles = [];
        const color = normalizeHexColor(mark.attrs?.color);
        const fontSize = normalizeFontSize(mark.attrs?.fontSize);
        if (color) styles.push(`color:${color}`);
        if (fontSize) styles.push(`font-size:${fontSize}`);
        if (styles.length > 0) chunk = `<span style="${styles.join(";")}">${chunk}</span>`;
      } else if (mark.type === "link") {
        const href = sanitizeDocHref(mark.attrs?.href);
        if (href) {
          chunk = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${chunk}</a>`;
        }
      }
    }
    html += chunk;
  }
  return html || "<br>";
}

function renderBlocksToSafeHtml(blocks) {
  if (!Array.isArray(blocks)) return "";
  let html = "";
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const align = sanitizeAlign(block.attrs);
    const alignAttr = align ? ` style="text-align:${align}"` : "";

    if (block.type === "paragraph") {
      const variant = block.attrs?.variant === "title" || block.attrs?.variant === "subtitle"
        ? block.attrs.variant
        : "normal";
      const cls = variant !== "normal" ? ` class="pd-doc-${variant}"` : "";
      html += `<p${cls}${alignAttr}>${renderInlineToSafeHtml(block.content)}</p>`;
    } else if (block.type === "heading") {
      const level = block.attrs?.level === 2 ? 2 : block.attrs?.level === 3 ? 3 : 1;
      html += `<h${level}${alignAttr}>${renderInlineToSafeHtml(block.content)}</h${level}>`;
    } else if (block.type === "bulletList") {
      const items = Array.isArray(block.content)
        ? block.content.map((li) => `<li>${renderBlocksToSafeHtml(li.content)}</li>`).join("")
        : "";
      html += `<ul>${items}</ul>`;
    } else if (block.type === "orderedList") {
      const start = Number.isInteger(block.attrs?.start) && block.attrs.start > 1 ? ` start="${block.attrs.start}"` : "";
      const items = Array.isArray(block.content)
        ? block.content.map((li) => `<li>${renderBlocksToSafeHtml(li.content)}</li>`).join("")
        : "";
      html += `<ol${start}>${items}</ol>`;
    } else if (block.type === "blockquote") {
      html += `<blockquote>${renderBlocksToSafeHtml(block.content)}</blockquote>`;
    } else if (block.type === "horizontalRule") {
      html += `<hr>`;
    }
  }
  return html;
}

export function renderDocBodySafeHtml(doc) {
  const safe = sanitizeDocContent(doc);
  return renderBlocksToSafeHtml(safe.content);
}

export function renderDocPrintableHtml(title, doc) {
  const safeTitle = escapeHtml(cleanDocTitle(title, { allowEmptyDefault: true }));
  const bodyHtml = renderDocBodySafeHtml(doc);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: letter; margin: 20mm 22mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #1f2937;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 11pt;
    line-height: 1.62;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-print-root { max-width: 100%; }
  p { margin: 0 0 8pt; }
  p.pd-doc-title { font-size: 24pt; font-weight: 700; line-height: 1.22; letter-spacing: -0.02em; color: #0f172a; margin: 0 0 4pt; }
  p.pd-doc-subtitle { font-size: 13.5pt; font-weight: 400; line-height: 1.4; color: #475569; margin: 0 0 14pt; }
  h1 { font-size: 18pt; font-weight: 700; line-height: 1.3; color: #0f172a; margin: 16pt 0 6pt; }
  h2 { font-size: 14.5pt; font-weight: 650; line-height: 1.35; color: #0f172a; margin: 14pt 0 5pt; }
  h3 { font-size: 12pt; font-weight: 650; line-height: 1.4; color: #1e293b; margin: 11pt 0 4pt; }
  ul, ol { margin: 0 0 9pt; padding-left: 20pt; }
  li { margin: 0 0 3pt; }
  li > p { margin: 0; }
  blockquote { margin: 8pt 0; padding: 4pt 0 4pt 12pt; border-left: 3pt solid #cbd5e1; color: #475569; }
  hr { border: 0; border-top: 1px solid #cbd5e1; margin: 14pt 0; }
  a { color: #1a73e8; text-decoration: underline; }
</style>
</head>
<body>
<main class="doc-print-root">${bodyHtml}</main>
</body>
</html>`;
}

// ============================================================================
// Starter Templates for Persora Docs Start Shelf
// ============================================================================

export const DOC_TEMPLATES = Object.freeze([
  {
    id: "meeting-notes",
    label: "Meeting Notes",
    description: "Agenda, discussion notes, and clear action items",
  },
  {
    id: "project-proposal",
    label: "Project Proposal",
    description: "Structured overview, objectives, and milestone plan",
  },
  {
    id: "personal-letter",
    label: "Personal Letter",
    description: "Clean correspondence layout with header and sign-off",
  },
  {
    id: "resume",
    label: "Resume",
    description: "Crisp one-page profile, experience, and skills",
  },
  {
    id: "weekly-journal",
    label: "Weekly Plan & Notes",
    description: "Top priorities, focus areas, and weekly reflections",
  },
  {
    id: "study-notes",
    label: "Study & Lecture Notes",
    description: "Structured key concepts, definitions, and review summary",
  },
  {
    id: "decision-memo",
    label: "Decision Memo",
    description: "Context, options considered, recommendation, and next steps",
  },
]);

const txt = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const para = (content, attrs) => {
  const out = { type: "paragraph" };
  if (attrs && Object.keys(attrs).length) out.attrs = attrs;
  if (content && content.length) out.content = content;
  return out;
};
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [txt(text)] });
const bullets = (items) => ({
  type: "bulletList",
  content: items.map((line) => ({
    type: "listItem",
    content: [para(typeof line === "string" ? [txt(line)] : line)],
  })),
});
const numbered = (items) => ({
  type: "orderedList",
  content: items.map((line) => ({
    type: "listItem",
    content: [para(typeof line === "string" ? [txt(line)] : line)],
  })),
});

export function buildDocTemplate(templateId, todayIso = "2026-10-28") {
  if (templateId === "meeting-notes") {
    return {
      title: "Meeting Notes",
      content: sanitizeDocContent({
        type: "doc",
        content: [
          para([txt("Weekly Team Sync")], { variant: "title" }),
          para([txt(`Date: ${todayIso} · Attendees: Core team`)], { variant: "subtitle" }),
          h(2, "Agenda"),
          bullets([
            "Review progress on active deliverables and blockers",
            "Align on upcoming launch priorities for the week",
            "Confirm owners and target dates for open items",
          ]),
          h(2, "Key Discussion Notes"),
          para([
            txt("Summarize key decisions and context captured during the meeting so everyone has a single clear reference."),
          ]),
          h(2, "Action Items"),
          numbered([
            [txt("Finalize draft specification ", [{ type: "bold" }]), txt("— Owner · Friday")],
            [txt("Share updated timeline with stakeholders ", [{ type: "bold" }]), txt("— Owner · Monday")],
          ]),
        ],
      }),
    };
  }

  if (templateId === "project-proposal") {
    return {
      title: "Project Proposal",
      content: sanitizeDocContent({
        type: "doc",
        content: [
          para([txt("New Initiative Proposal")], { variant: "title" }),
          para([txt(`Prepared ${todayIso} · Draft for review`)], { variant: "subtitle" }),
          h(1, "Overview"),
          para([
            txt("Outline the problem being solved, why it matters right now, and the outcome this project will deliver."),
          ]),
          h(1, "Objectives & Scope"),
          bullets([
            "Deliver a focused, reliable experience with clear user value",
            "Keep architecture simple, maintainable, and fast",
            "Measure adoption and gather feedback in the first two weeks",
          ]),
          h(1, "Milestones"),
          numbered([
            "Phase 1: Discovery and requirements sign-off",
            "Phase 2: Core implementation and internal testing",
            "Phase 3: Rollout and post-launch review",
          ]),
        ],
      }),
    };
  }

  if (templateId === "personal-letter") {
    return {
      title: "Personal Letter",
      content: sanitizeDocContent({
        type: "doc",
        content: [
          para([txt("Your Name", [{ type: "bold" }])], {}),
          para([txt("City, Country · email@example.com")]),
          para([txt(todayIso)]),
          para([]),
          para([txt("Dear Recipient,")]),
          para([
            txt("I hope this note finds you well. Write your opening paragraph here with the main purpose of your letter in clear, warm language."),
          ]),
          para([
            txt("Add supporting details, dates, or next steps in a second concise paragraph so your reader can respond easily."),
          ]),
          para([txt("Warm regards,")]),
          para([txt("Your Name", [{ type: "bold" }])]),
        ],
      }),
    };
  }

  if (templateId === "resume") {
    return {
      title: "Resume",
      content: sanitizeDocContent({
        type: "doc",
        content: [
          para([txt("Alex Morgan")], { variant: "title" }),
          para([txt("Product Designer & Engineer · email@example.com · City, Country")], { variant: "subtitle" }),
          h(2, "Summary"),
          para([
            txt("Thoughtful builder focused on calm, reliable software products, clear writing, and accessible user interfaces."),
          ]),
          h(2, "Experience"),
          para([
            txt("Senior Product Specialist", [{ type: "bold" }]),
            txt(" · Studio Name (2023 – Present)"),
          ]),
          bullets([
            "Led end-to-end design and delivery across core workspace tools",
            "Improved reliability and reduced page load latency by 35%",
          ]),
          h(2, "Education & Skills"),
          bullets([
            "B.Sc. in Computer Science",
            "Product Strategy, TypeScript, React, Systems Design, Technical Writing",
          ]),
        ],
      }),
    };
  }

  if (templateId === "weekly-journal") {
    return {
      title: "Weekly Plan & Notes",
      content: sanitizeDocContent({
        type: "doc",
        content: [
          para([txt("Weekly Focus & Notes")], { variant: "title" }),
          para([txt(`Week of ${todayIso}`)], { variant: "subtitle" }),
          h(2, "Top 3 Priorities"),
          numbered([
            "Complete primary deliverable with full quality review",
            "Clear inbox and follow up on pending commitments",
            "Protect dedicated time for deep focus and reading",
          ]),
          h(2, "Notes & Reflections"),
          para([
            txt("Capture ideas, lessons learned, and highlights from the week here."),
          ]),
        ],
      }),
    };
  }

  if (templateId === "study-notes") {
    return {
      title: "Study & Lecture Notes",
      content: sanitizeDocContent({
        type: "doc",
        content: [
          para([txt("Topic: Core Systems & Concepts")], { variant: "title" }),
          para([txt(`Session Date: ${todayIso} · Course / Subject`)], { variant: "subtitle" }),
          h(2, "Key Concepts"),
          bullets([
            "Primary principle and how it applies in practice",
            "Important definitions, formulas, or mental models",
          ]),
          h(2, "Summary & Review Questions"),
          para([
            txt("Write a short synthesis in your own words to reinforce retention before your next review."),
          ]),
        ],
      }),
    };
  }

  if (templateId === "decision-memo") {
    return {
      title: "Decision Memo",
      content: sanitizeDocContent({
        type: "doc",
        content: [
          para([txt("Decision Memo")], { variant: "title" }),
          para([txt(`Date: ${todayIso} · Status: Proposed`)], { variant: "subtitle" }),
          h(2, "Context"),
          para([
            txt("State the question being decided and the constraints that matter."),
          ]),
          h(2, "Options & Recommendation"),
          numbered([
            "Option A — Minimal scope with fastest delivery",
            "Option B — Recommended balanced approach",
          ]),
        ],
      }),
    };
  }

  return {
    title: "Untitled document",
    content: blankDocContent(),
  };
}
