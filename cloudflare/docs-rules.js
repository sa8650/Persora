// Persora Docs — shared validation, TipTap/ProseMirror JSON AST sanitization,
// multi-page setup, tables, images, shapes, comments, headers/footers,
// preview metadata extraction, starter templates, and safe printable HTML renderer.
// Pure ES module with zero external dependencies so it runs identically in
// Cloudflare Pages Functions, the Vite browser bundle, and Node tests.

export class DocRuleError extends Error {
  /**
   * @param {string} message
   * @param {number} [status=400]
   * @param {string} [code="BAD_REQUEST"]
   */
  constructor(message, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "DocRuleError";
    this.status = status;
    this.code = code;
  }
}

export const DOC_LIMITS = Object.freeze({
  docs: 500,
  maxTitleChars: 160,
  maxTitleLength: 160,
  maxJsonBytes: 6_000_000,
  maxBlocks: 5_000,
  maxDepth: 12,
  maxTextChars: 300_000,
  maxPreviewBlocks: 6,
  maxSnippetChars: 240,
  maxShapes: 250,
  maxComments: 300,
  maxImageDataChars: 4_500_000,
});

export const DOC_FONT_FAMILIES = Object.freeze([
  {
    id: "sans",
    label: "Sans Serif (Geist)",
    css: '"Geist Variable", "Geist Sans", ui-sans-serif, system-ui, -apple-system, sans-serif',
    pdfFamily: "sans",
  },
  {
    id: "arial",
    label: "Arial",
    css: 'Arial, "Helvetica Neue", Helvetica, sans-serif',
    pdfFamily: "sans",
  },
  {
    id: "georgia",
    label: "Georgia",
    css: 'Georgia, Cambria, "Times New Roman", Times, serif',
    pdfFamily: "serif",
  },
  {
    id: "times",
    label: "Times New Roman",
    css: '"Times New Roman", Times, Georgia, serif',
    pdfFamily: "serif",
  },
  {
    id: "merriweather",
    label: "Cambria Serif",
    css: 'Cambria, Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
    pdfFamily: "serif",
  },
  {
    id: "trebuchet",
    label: "Trebuchet MS",
    css: '"Trebuchet MS", "Segoe UI", Tahoma, sans-serif',
    pdfFamily: "sans",
  },
  {
    id: "verdana",
    label: "Verdana",
    css: "Verdana, Geneva, Tahoma, sans-serif",
    pdfFamily: "sans",
  },
  {
    id: "mono",
    label: "Monospace",
    css: '"Geist Mono", "Courier New", Courier, ui-monospace, monospace',
    pdfFamily: "mono",
  },
]);

export const DOC_FONT_SIZES = Object.freeze([
  "8pt",
  "9pt",
  "10pt",
  "11pt",
  "12pt",
  "14pt",
  "16pt",
  "18pt",
  "20pt",
  "24pt",
  "28pt",
  "32pt",
  "36pt",
  "48pt",
  "60pt",
  "72pt",
]);

export const DOC_LINE_HEIGHTS = Object.freeze([
  { id: "1", label: "Single (1.0)", value: "1" },
  { id: "1.15", label: "1.15", value: "1.15" },
  { id: "1.5", label: "1.5", value: "1.5" },
  { id: "1.62", label: "Default (1.62)", value: "1.62" },
  { id: "2", label: "Double (2.0)", value: "2" },
]);

export const DOC_PAPER_SIZES = Object.freeze({
  letter: { id: "letter", label: 'Letter (8.5" × 11")', widthPt: 612, heightPt: 792 },
  a4: { id: "a4", label: "A4 (210 × 297 mm)", widthPt: 595, heightPt: 842 },
  legal: { id: "legal", label: 'Legal (8.5" × 14")', widthPt: 612, heightPt: 1008 },
});

export const DOC_PAGE_COLORS = Object.freeze([
  { id: "white", label: "White", hex: "#ffffff" },
  { id: "alabaster", label: "Soft Gray", hex: "#f8fafc" },
  { id: "ivory", label: "Warm Ivory", hex: "#fefce8" },
  { id: "cream", label: "Butter Cream", hex: "#fef3c7" },
  { id: "peach", label: "Soft Peach", hex: "#ffedd5" },
  { id: "blush", label: "Rose Blush", hex: "#fee2e2" },
  { id: "pink", label: "Petal Pink", hex: "#fce7f3" },
  { id: "lavender", label: "Lavender Mist", hex: "#f3e8ff" },
  { id: "periwinkle", label: "Ice Indigo", hex: "#e0e7ff" },
  { id: "sky", label: "Sky Tint", hex: "#e0f2fe" },
  { id: "mint", label: "Mint Leaf", hex: "#dcfce7" },
  { id: "sage", label: "Cool Slate", hex: "#f1f5f9" },
]);

export const DOC_TEXT_COLORS = Object.freeze([
  { id: "ink", label: "Default ink", hex: "#1f2937" },
  { id: "slate", label: "Muted slate", hex: "#64748b" },
  { id: "blue", label: "Blue", hex: "#1a73e8" },
  { id: "indigo", label: "Indigo", hex: "#4f46e5" },
  { id: "violet", label: "Purple", hex: "#7c3aed" },
  { id: "emerald", label: "Green", hex: "#15803d" },
  { id: "teal", label: "Teal", hex: "#0f766e" },
  { id: "amber", label: "Amber", hex: "#b45309" },
  { id: "orange", label: "Orange", hex: "#c2410c" },
  { id: "red", label: "Red", hex: "#dc2626" },
]);

export const DOC_HIGHLIGHT_COLORS = Object.freeze([
  { id: "yellow", label: "Soft yellow", hex: "#fef08a" },
  { id: "green", label: "Mint green", hex: "#bbf7d0" },
  { id: "blue", label: "Sky blue", hex: "#bfdbfe" },
  { id: "purple", label: "Lavender", hex: "#e9d5ff" },
  { id: "pink", label: "Rose pink", hex: "#fbcfe8" },
  { id: "orange", label: "Peach", hex: "#fed7aa" },
  { id: "gray", label: "Light gray", hex: "#e2e8f0" },
]);

export const DOC_SHAPE_TYPES = Object.freeze([
  "rectangle",
  "roundedRect",
  "circle",
  "oval",
  "triangle",
  "diamond",
  "pentagon",
  "star",
  "callout",
  "line",
  "arrow",
]);

const FONT_SIZE_SET = new Set(DOC_FONT_SIZES);
const FONT_FAMILY_MAP = new Map(DOC_FONT_FAMILIES.map((f) => [f.id, f]));
const LINE_HEIGHT_SET = new Set(DOC_LINE_HEIGHTS.map((l) => l.value));
const SHAPE_TYPE_SET = new Set(DOC_SHAPE_TYPES);
const ALIGN_SET = new Set(["left", "center", "right", "justify"]);
const PARAGRAPH_VARIANT_SET = new Set(["normal", "title", "subtitle"]);
const IMAGE_WRAP_SET = new Set(["inline", "wrap-left", "wrap-right", "break-text"]);
const PAGE_NUM_POS_SET = new Set([
  "header-right",
  "header-center",
  "footer-right",
  "footer-center",
  "footer-left",
]);
const PAGE_NUM_FMT_SET = new Set(["number", "page-x", "page-x-of-n"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{2,80}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

export const DEFAULT_DOC_PAGE_SETUP = Object.freeze({
  paperSize: "letter",
  orientation: "portrait",
  margins: Object.freeze({
    top: 54,
    bottom: 54,
    left: 63,
    right: 63,
  }),
  showRuler: true,
  commentsEnabled: false,
  pageColors: Object.freeze({}),
  headerText: "",
  headerAlign: "left",
  footerText: "",
  footerAlign: "left",
  showPageNumbers: false,
  pageNumberPosition: "footer-right",
  pageNumberFormat: "page-x-of-n",
  pageNumberStart: 1,
  differentFirstPage: false,
});

/**
 * Validates a UUID identifier.
 * @param {unknown} raw
 * @param {string} [label="Document ID"]
 * @returns {string}
 */
export function cleanDocUuid(raw, label = "Document ID") {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!UUID_RE.test(s)) {
    throw new DocRuleError(`Invalid ${label}.`, 400, "INVALID_UUID");
  }
  return s;
}

/**
 * Normalizes a document title (strips control chars, trims, enforces length).
 * @param {unknown} raw
 * @param {{ allowEmptyDefault?: boolean }} [options]
 * @returns {string}
 */
export function cleanDocTitle(raw, { allowEmptyDefault = true } = {}) {
  const cleaned = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    if (allowEmptyDefault) return "Untitled document";
    throw new DocRuleError("Document title cannot be empty.", 400, "EMPTY_TITLE");
  }
  if (cleaned.length > DOC_LIMITS.maxTitleLength) {
    return cleaned.slice(0, DOC_LIMITS.maxTitleLength).trim();
  }
  return cleaned;
}

/**
 * Normalizes a CSS hex color (#rgb or #rrggbb) to lowercase #rrggbb, or null if unsafe.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeHexColor(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!HEX_COLOR_RE.test(s)) return null;
  if (s.length === 4) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  return s;
}

/**
 * Normalizes a hex color or `"transparent"`.
 * @param {unknown} raw
 * @param {string} fallback
 * @returns {string}
 */
export function normalizeColorOrTransparent(raw, fallback) {
  if (typeof raw === "string" && raw.trim().toLowerCase() === "transparent") {
    return "transparent";
  }
  return normalizeHexColor(raw) || fallback;
}

/**
 * Normalizes a font family id or CSS string to one of DOC_FONT_FAMILIES ids, or null.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeFontFamily(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (FONT_FAMILY_MAP.has(lower)) return lower;
  for (const fam of DOC_FONT_FAMILIES) {
    if (
      fam.label.toLowerCase() === lower ||
      fam.css.toLowerCase() === lower ||
      lower.includes(fam.id)
    ) {
      return fam.id;
    }
  }
  if (lower.includes("times")) return "times";
  if (lower.includes("georgia")) return "georgia";
  if (lower.includes("cambria") || lower.includes("palatino")) return "merriweather";
  if (lower.includes("courier") || lower.includes("mono")) return "mono";
  if (lower.includes("trebuchet")) return "trebuchet";
  if (lower.includes("verdana")) return "verdana";
  if (lower.includes("arial") || lower.includes("helvetica")) return "arial";
  if (lower.includes("geist") || lower.includes("inter") || lower.includes("sans")) return "sans";
  return null;
}

/**
 * Resolves a font family id to its CSS font-family stack.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function resolveFontFamilyCss(raw) {
  const id = normalizeFontFamily(raw);
  if (!id) return null;
  return FONT_FAMILY_MAP.get(id)?.css || null;
}

/**
 * Normalizes a font size string to an allowed pt value (e.g. "12pt") or null.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeFontSize(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (FONT_SIZE_SET.has(s)) return s;
  const match = s.match(/^(\d+(?:\.\d+)?)\s*(pt|px)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] || "pt";
  if (!Number.isFinite(value) || value <= 0) return null;
  const pt = unit === "px" ? value * 0.75 : value;
  let closest = DOC_FONT_SIZES[0];
  let bestDiff = Infinity;
  for (const candidate of DOC_FONT_SIZES) {
    const candidatePt = Number(candidate.replace("pt", ""));
    const diff = Math.abs(candidatePt - pt);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = candidate;
    }
  }
  return closest;
}

/**
 * Normalizes a line-height string to an allowed value or null.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeLineHeight(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (LINE_HEIGHT_SET.has(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0.9 || n > 3) return null;
  let best = "1.62";
  let bestDiff = Infinity;
  for (const item of DOC_LINE_HEIGHTS) {
    const d = Math.abs(Number(item.value) - n);
    if (d < bestDiff) {
      bestDiff = d;
      best = item.value;
    }
  }
  return best;
}

/**
 * Sanitizes a hyperlink href. Blocks javascript:, data:, vbscript:, file:, etc.
 * Allows http://, https://, and mailto:.
 * @param {unknown} raw
 * @param {{ autoHttps?: boolean }} [options]
 * @returns {string | null}
 */
export function sanitizeDocHref(raw, { autoHttps = false } = {}) {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!s || s.length > 2048) return null;

  if (autoHttps && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    if (s.includes("@") && !s.includes("/")) {
      s = `mailto:${s}`;
    } else {
      s = `https://${s}`;
    }
  }

  try {
    const parsed = new URL(s);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      if (!parsed.hostname) return null;
      return parsed.toString();
    }
    if (protocol === "mailto:") {
      const address = parsed.pathname.trim();
      if (!address || /[<>"'\s]/.test(address)) return null;
      return `mailto:${address}${parsed.search || ""}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sanitizes an image src. Allows safe bitmap data URIs (png/jpeg/webp/gif) or https/http URLs.
 * Never allows raw SVG data URIs or script schemes.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function sanitizeDocImageSrc(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > DOC_LIMITS.maxImageDataChars) return null;
  if (SAFE_DATA_IMAGE_RE.test(trimmed)) {
    return trimmed.replace(/\s+/g, "");
  }
  const url = sanitizeDocHref(trimmed);
  if (url && (url.startsWith("https://") || url.startsWith("http://"))) {
    return url;
  }
  return null;
}

function clampNum(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanShortText(raw, maxLen = 400) {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maxLen);
}

/**
 * Normalizes page setup configuration with safe defaults and bounds.
 * @param {unknown} raw
 */
export function normalizeDocPageSetup(raw) {
  const src = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  const paperSize =
    src.paperSize === "a4" || src.paperSize === "legal" ? src.paperSize : "letter";
  const orientation = src.orientation === "landscape" ? "landscape" : "portrait";

  const rawMargins = src.margins && typeof src.margins === "object" ? src.margins : {};
  const margins = {
    top: Math.round(clampNum(rawMargins.top, 18, 180, DEFAULT_DOC_PAGE_SETUP.margins.top)),
    bottom: Math.round(clampNum(rawMargins.bottom, 18, 180, DEFAULT_DOC_PAGE_SETUP.margins.bottom)),
    left: Math.round(clampNum(rawMargins.left, 18, 180, DEFAULT_DOC_PAGE_SETUP.margins.left)),
    right: Math.round(clampNum(rawMargins.right, 18, 180, DEFAULT_DOC_PAGE_SETUP.margins.right)),
  };

  const showRuler = src.showRuler !== undefined ? Boolean(src.showRuler) : true;
  const commentsEnabled = src.commentsEnabled !== undefined ? Boolean(src.commentsEnabled) : false;

  /** @type {Record<string, string>} */
  const pageColors = {};
  if (src.pageColors && typeof src.pageColors === "object") {
    for (const [k, v] of Object.entries(src.pageColors)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx > 500) continue;
      const hex = normalizeHexColor(v);
      if (hex && hex !== "#ffffff") {
        pageColors[String(idx)] = hex;
      }
    }
  }

  const headerText = cleanShortText(src.headerText, 300);
  const headerAlign =
    src.headerAlign === "center" || src.headerAlign === "right" ? src.headerAlign : "left";
  const footerText = cleanShortText(src.footerText, 300);
  const footerAlign =
    src.footerAlign === "center" || src.footerAlign === "right" ? src.footerAlign : "left";
  const showPageNumbers = Boolean(src.showPageNumbers);
  const pageNumberPosition = PAGE_NUM_POS_SET.has(src.pageNumberPosition)
    ? src.pageNumberPosition
    : "footer-right";
  const pageNumberFormat = PAGE_NUM_FMT_SET.has(src.pageNumberFormat)
    ? src.pageNumberFormat
    : "page-x-of-n";
  const pageNumberStart = Math.round(clampNum(src.pageNumberStart, 1, 9999, 1));
  const differentFirstPage = Boolean(src.differentFirstPage);

  return {
    paperSize,
    orientation,
    margins,
    showRuler,
    commentsEnabled,
    pageColors,
    headerText,
    headerAlign,
    footerText,
    footerAlign,
    showPageNumbers,
    pageNumberPosition,
    pageNumberFormat,
    pageNumberStart,
    differentFirstPage,
  };
}

/**
 * Extracts normalized page setup from a DocContent object.
 * @param {any} doc
 */
export function getDocPageSetup(doc) {
  return normalizeDocPageSetup(doc?.attrs?.pageSetup);
}

/**
 * Returns paper dimensions in PDF points (72 dpi) and CSS pixels (96 dpi) for a pageSetup.
 * @param {any} pageSetup
 */
export function getPageDimensions(pageSetup) {
  const norm = normalizeDocPageSetup(pageSetup);
  const base = DOC_PAPER_SIZES[norm.paperSize] || DOC_PAPER_SIZES.letter;
  const widthPt = norm.orientation === "landscape" ? base.heightPt : base.widthPt;
  const heightPt = norm.orientation === "landscape" ? base.widthPt : base.heightPt;
  const pxPerPt = 96 / 72;
  return {
    widthPt,
    heightPt,
    widthPx: Math.round(widthPt * pxPerPt),
    heightPx: Math.round(heightPt * pxPerPt),
    marginTopPx: Math.round(norm.margins.top * pxPerPt),
    marginBottomPx: Math.round(norm.margins.bottom * pxPerPt),
    marginLeftPx: Math.round(norm.margins.left * pxPerPt),
    marginRightPx: Math.round(norm.margins.right * pxPerPt),
  };
}

/**
 * Formats a page number label for a 0-based pageIndex.
 * @param {any} pageSetup
 * @param {number} pageIndex
 * @param {number} totalPages
 * @returns {string}
 */
export function formatDocPageNumber(pageSetup, pageIndex, totalPages) {
  const norm = normalizeDocPageSetup(pageSetup);
  if (!norm.showPageNumbers) return "";
  if (norm.differentFirstPage && pageIndex === 0) return "";
  const num = norm.pageNumberStart + pageIndex;
  const totalDisplay = Math.max(num, norm.pageNumberStart + totalPages - 1);
  if (norm.pageNumberFormat === "number") return String(num);
  if (norm.pageNumberFormat === "page-x") return `Page ${num}`;
  return `Page ${num} of ${totalDisplay}`;
}

function sanitizeSafeId(raw, prefix = "id") {
  const s = String(raw ?? "").trim();
  if (SAFE_ID_RE.test(s)) return s;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sanitizes geometric shapes array on a document.
 * @param {unknown} rawShapes
 */
export function sanitizeDocShapes(rawShapes) {
  if (!Array.isArray(rawShapes)) return [];
  const out = [];
  for (const item of rawShapes.slice(0, DOC_LIMITS.maxShapes)) {
    if (!item || typeof item !== "object") continue;
    const shapeType = SHAPE_TYPE_SET.has(item.shapeType) ? item.shapeType : "rectangle";
    const id = sanitizeSafeId(item.id, "shape");
    const pageIndex = Math.round(clampNum(item.pageIndex, 0, 500, 0));
    const x = Math.round(clampNum(item.x, 0, 1200, 72) * 10) / 10;
    const y = Math.round(clampNum(item.y, 0, 1400, 72) * 10) / 10;
    const width = Math.round(clampNum(item.width, 16, 1100, 140) * 10) / 10;
    const height = Math.round(clampNum(item.height, 12, 1100, 84) * 10) / 10;
    const rotation = Math.round(clampNum(item.rotation, -360, 360, 0) * 10) / 10;
    const fillColor = normalizeColorOrTransparent(
      item.fillColor,
      shapeType === "line" || shapeType === "arrow" ? "transparent" : "#e8f0fe",
    );
    const strokeColor = normalizeColorOrTransparent(item.strokeColor, "#1a73e8");
    const strokeWidth = Math.round(clampNum(item.strokeWidth, 0, 16, 2) * 10) / 10;
    const text = cleanShortText(item.text, 500);
    const textColor = normalizeHexColor(item.textColor) || "#0f172a";
    const fontSize = Math.round(clampNum(item.fontSize, 8, 48, 11));
    /** @type {Record<string, any>} */
    const clean = {
      id,
      shapeType,
      pageIndex,
      x,
      y,
      width,
      height,
      rotation,
      fillColor,
      strokeColor,
      strokeWidth,
      textColor,
      fontSize,
    };
    if (text) clean.text = text;
    if (typeof item.zIndex === "number" && Number.isFinite(item.zIndex)) {
      clean.zIndex = Math.round(clampNum(item.zIndex, 0, 1000, 1));
    }
    out.push(clean);
  }
  return out;
}

/**
 * Sanitizes anchored comment threads on a document.
 * @param {unknown} rawComments
 */
export function sanitizeDocComments(rawComments) {
  if (!Array.isArray(rawComments)) return [];
  const out = [];
  for (const item of rawComments.slice(0, DOC_LIMITS.maxComments)) {
    if (!item || typeof item !== "object") continue;
    const text = cleanShortText(item.text, 2000).trim();
    if (!text) continue;
    const id = sanitizeSafeId(item.id, "cmt");
    const quote = cleanShortText(item.quote, 300).trim();
    const authorName = cleanShortText(item.authorName, 100).trim() || "Member";
    const createdAt =
      typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt))
        ? new Date(item.createdAt).toISOString()
        : new Date().toISOString();
    const resolved = Boolean(item.resolved);
    const replies = [];
    if (Array.isArray(item.replies)) {
      for (const r of item.replies.slice(0, 50)) {
        if (!r || typeof r !== "object") continue;
        const rText = cleanShortText(r.text, 1500).trim();
        if (!rText) continue;
        replies.push({
          id: sanitizeSafeId(r.id, "rpl"),
          authorName: cleanShortText(r.authorName, 100).trim() || "Member",
          text: rText,
          createdAt:
            typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt))
              ? new Date(r.createdAt).toISOString()
              : createdAt,
        });
      }
    }
    /** @type {Record<string, any>} */
    const clean = {
      id,
      quote,
      authorName,
      text,
      createdAt,
    };
    if (resolved) clean.resolved = true;
    if (replies.length > 0) clean.replies = replies;
    out.push(clean);
  }
  return out;
}

/**
 * Returns the canonical blank Persora Doc JSON AST.
 * @returns {{ type: "doc", content: Array<{ type: "paragraph" }> }}
 */
export function blankDocContent() {
  return {
    type: "doc",
    content: [{ type: "paragraph" }],
  };
}

function sanitizeTextAlign(raw) {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  return ALIGN_SET.has(s) && s !== "left" ? s : undefined;
}

function sanitizeInlineMarks(rawMarks) {
  if (!Array.isArray(rawMarks) || rawMarks.length === 0) return undefined;
  const seen = new Set();
  const out = [];

  for (const m of rawMarks) {
    if (!m || typeof m !== "object" || typeof m.type !== "string") continue;
    const type = m.type;
    if (type === "bold" || type === "italic" || type === "underline" || type === "strike") {
      if (seen.has(type)) continue;
      seen.add(type);
      out.push({ type });
    } else if (type === "textStyle") {
      if (seen.has("textStyle")) continue;
      const color = normalizeHexColor(m.attrs?.color);
      const fontSize = normalizeFontSize(m.attrs?.fontSize);
      const fontFamily = normalizeFontFamily(m.attrs?.fontFamily);
      if (!color && !fontSize && !fontFamily) continue;
      seen.add("textStyle");
      /** @type {Record<string, string>} */
      const attrs = {};
      if (color) attrs.color = color;
      if (fontSize) attrs.fontSize = fontSize;
      if (fontFamily) attrs.fontFamily = fontFamily;
      out.push({ type: "textStyle", attrs });
    } else if (type === "highlight") {
      if (seen.has("highlight")) continue;
      const color = normalizeHexColor(m.attrs?.color) || "#fef08a";
      seen.add("highlight");
      out.push({ type: "highlight", attrs: { color } });
    } else if (type === "link") {
      if (seen.has("link")) continue;
      const href = sanitizeDocHref(m.attrs?.href);
      if (!href) continue;
      seen.add("link");
      out.push({
        type: "link",
        attrs: {
          href,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      });
    } else if (type === "comment") {
      const cid = typeof m.attrs?.commentId === "string" ? m.attrs.commentId.trim() : "";
      if (!SAFE_ID_RE.test(cid)) continue;
      const key = `comment:${cid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "comment", attrs: { commentId: cid } });
    }
  }

  return out.length > 0 ? out : undefined;
}

function sanitizeInlineContent(rawNodes, counters) {
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return undefined;
  const out = [];

  for (const child of rawNodes) {
    if (!child || typeof child !== "object") continue;
    if (child.type === "hardBreak") {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (child.type === "text" && typeof child.text === "string") {
      const cleanedText = child.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
      if (!cleanedText) continue;
      counters.chars += cleanedText.length;
      if (counters.chars > DOC_LIMITS.maxTextChars) {
        throw new DocRuleError("Document exceeds the maximum supported text length.", 400, "DOC_TOO_LARGE");
      }
      const marks = sanitizeInlineMarks(child.marks);
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.type === "text" &&
        JSON.stringify(prev.marks || null) === JSON.stringify(marks || null)
      ) {
        prev.text += cleanedText;
      } else {
        out.push(marks ? { type: "text", text: cleanedText, marks } : { type: "text", text: cleanedText });
      }
    }
  }

  return out.length > 0 ? out : undefined;
}

function sanitizeTableCellNode(node, depth, counters) {
  if (!node || typeof node !== "object") return null;
  const cellType = node.type === "tableHeader" ? "tableHeader" : "tableCell";
  counters.blocks += 1;
  if (counters.blocks > DOC_LIMITS.maxBlocks) {
    throw new DocRuleError("Document has too many blocks.", 400, "DOC_TOO_MANY_BLOCKS");
  }

  const rawAttrs = node.attrs && typeof node.attrs === "object" ? node.attrs : {};
  const colspan = Math.round(clampNum(rawAttrs.colspan, 1, 20, 1));
  const rowspan = Math.round(clampNum(rawAttrs.rowspan, 1, 50, 1));
  const backgroundColor = normalizeHexColor(rawAttrs.backgroundColor);
  const borderColor = normalizeHexColor(rawAttrs.borderColor);
  let colwidth = null;
  if (Array.isArray(rawAttrs.colwidth) && rawAttrs.colwidth.length > 0) {
    const cleanedWidths = rawAttrs.colwidth
      .slice(0, 20)
      .map((w) => (typeof w === "number" && Number.isFinite(w) && w >= 24 ? Math.round(w) : null));
    if (cleanedWidths.some((w) => w !== null)) {
      colwidth = cleanedWidths.map((w) => w ?? 120);
    }
  }

  const childBlocks = [];
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const sanitized = sanitizeBlockNode(child, depth + 1, counters);
      if (sanitized && sanitized.type !== "table" && sanitized.type !== "pageBreak") {
        childBlocks.push(sanitized);
      }
    }
  }
  if (childBlocks.length === 0) {
    childBlocks.push({ type: "paragraph" });
  }

  /** @type {Record<string, any>} */
  const attrs = {};
  if (colspan > 1) attrs.colspan = colspan;
  if (rowspan > 1) attrs.rowspan = rowspan;
  if (colwidth) attrs.colwidth = colwidth;
  if (backgroundColor) attrs.backgroundColor = backgroundColor;
  if (borderColor) attrs.borderColor = borderColor;

  return Object.keys(attrs).length > 0
    ? { type: cellType, attrs, content: childBlocks }
    : { type: cellType, content: childBlocks };
}

function sanitizeBlockNode(node, depth, counters) {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return null;
  if (depth > DOC_LIMITS.maxDepth) return null;

  counters.blocks += 1;
  if (counters.blocks > DOC_LIMITS.maxBlocks) {
    throw new DocRuleError("Document has too many blocks.", 400, "DOC_TOO_MANY_BLOCKS");
  }

  switch (node.type) {
    case "paragraph": {
      const rawVariant = node.attrs?.variant || node.attrs?.docStyle;
      const variant =
        typeof rawVariant === "string" && PARAGRAPH_VARIANT_SET.has(rawVariant) && rawVariant !== "normal"
          ? rawVariant
          : undefined;
      const textAlign = sanitizeTextAlign(node.attrs?.textAlign);
      const lineHeight = normalizeLineHeight(node.attrs?.lineHeight);
      const spaceAfter =
        typeof node.attrs?.spaceAfter === "number" && Number.isFinite(node.attrs.spaceAfter)
          ? Math.round(clampNum(node.attrs.spaceAfter, 0, 36, 8))
          : undefined;
      const content = sanitizeInlineContent(node.content, counters);
      /** @type {Record<string, any>} */
      const attrs = {};
      if (variant) attrs.variant = variant;
      if (textAlign) attrs.textAlign = textAlign;
      if (lineHeight && lineHeight !== "1.62") attrs.lineHeight = lineHeight;
      if (spaceAfter !== undefined && spaceAfter !== 8) attrs.spaceAfter = spaceAfter;
      const out = { type: "paragraph" };
      if (Object.keys(attrs).length > 0) out.attrs = attrs;
      if (content) out.content = content;
      return out;
    }

    case "heading": {
      const rawLevel = Number(node.attrs?.level);
      const level = rawLevel === 1 || rawLevel === 2 || rawLevel === 3 ? rawLevel : 1;
      const textAlign = sanitizeTextAlign(node.attrs?.textAlign);
      const lineHeight = normalizeLineHeight(node.attrs?.lineHeight);
      const content = sanitizeInlineContent(node.content, counters);
      /** @type {Record<string, any>} */
      const attrs = { level };
      if (textAlign) attrs.textAlign = textAlign;
      if (lineHeight) attrs.lineHeight = lineHeight;
      const out = { type: "heading", attrs };
      if (content) out.content = content;
      return out;
    }

    case "bulletList":
    case "orderedList": {
      if (!Array.isArray(node.content) || node.content.length === 0) return null;
      const items = [];
      for (const li of node.content) {
        if (!li || typeof li !== "object" || li.type !== "listItem") continue;
        const itemBlocks = [];
        if (Array.isArray(li.content)) {
          for (const inner of li.content) {
            const sanitized = sanitizeBlockNode(inner, depth + 1, counters);
            if (sanitized) itemBlocks.push(sanitized);
          }
        }
        if (itemBlocks.length === 0) {
          itemBlocks.push({ type: "paragraph" });
        }
        items.push({ type: "listItem", content: itemBlocks });
      }
      if (items.length === 0) return null;
      if (node.type === "orderedList") {
        const start = Number(node.attrs?.start);
        const safeStart = Number.isInteger(start) && start >= 1 && start <= 9999 ? start : 1;
        return safeStart !== 1
          ? { type: "orderedList", attrs: { start: safeStart }, content: items }
          : { type: "orderedList", content: items };
      }
      return { type: "bulletList", content: items };
    }

    case "blockquote": {
      const innerBlocks = [];
      if (Array.isArray(node.content)) {
        for (const inner of node.content) {
          if (inner?.type === "blockquote") continue;
          const sanitized = sanitizeBlockNode(inner, depth + 1, counters);
          if (sanitized) innerBlocks.push(sanitized);
        }
      }
      if (innerBlocks.length === 0) {
        innerBlocks.push({ type: "paragraph" });
      }
      return { type: "blockquote", content: innerBlocks };
    }

    case "table": {
      if (!Array.isArray(node.content) || node.content.length === 0) return null;
      const rows = [];
      for (const row of node.content.slice(0, 80)) {
        if (!row || typeof row !== "object" || row.type !== "tableRow") continue;
        if (!Array.isArray(row.content) || row.content.length === 0) continue;
        const cells = [];
        for (const cell of row.content.slice(0, 20)) {
          if (!cell || (cell.type !== "tableCell" && cell.type !== "tableHeader")) continue;
          const sanitizedCell = sanitizeTableCellNode(cell, depth + 1, counters);
          if (sanitizedCell) cells.push(sanitizedCell);
        }
        if (cells.length > 0) {
          rows.push({ type: "tableRow", content: cells });
        }
      }
      if (rows.length === 0) return null;
      return { type: "table", content: rows };
    }

    case "docImage": {
      const src = sanitizeDocImageSrc(node.attrs?.src);
      if (!src) return null;
      const alt = cleanShortText(node.attrs?.alt, 200);
      const width = Math.round(clampNum(node.attrs?.width, 40, 960, 320));
      const height =
        typeof node.attrs?.height === "number" && Number.isFinite(node.attrs.height) && node.attrs.height >= 24
          ? Math.round(clampNum(node.attrs.height, 24, 1200, 240))
          : null;
      const wrap = IMAGE_WRAP_SET.has(node.attrs?.wrap) ? node.attrs.wrap : "inline";
      const align =
        node.attrs?.align === "center" || node.attrs?.align === "right" ? node.attrs.align : "left";
      /** @type {Record<string, any>} */
      const attrs = { src, alt, width, wrap, align };
      if (height !== null) attrs.height = height;
      return { type: "docImage", attrs };
    }

    case "horizontalRule":
      return { type: "horizontalRule" };

    case "pageBreak":
      return { type: "pageBreak" };

    default:
      return null;
  }
}

/**
 * Validates and sanitizes a TipTap/ProseMirror JSON document.
 * Strips unknown nodes, unknown marks, event handlers, and unsafe link/image URLs.
 * Preserves pageSetup, shapes, and comments when present.
 * @param {unknown} raw
 */
export function sanitizeDocContent(raw) {
  if (raw == null) return blankDocContent();
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new DocRuleError("Document content must be a JSON object.", 400, "INVALID_CONTENT");
  }
  const serializedSize = JSON.stringify(raw).length;
  if (serializedSize > DOC_LIMITS.maxJsonBytes) {
    throw new DocRuleError("Document exceeds the maximum supported size.", 400, "DOC_TOO_LARGE");
  }
  const docObj = /** @type {{ type?: unknown, content?: unknown, attrs?: any, shapes?: unknown, comments?: unknown }} */ (raw);
  if (docObj.type !== "doc") {
    throw new DocRuleError('Document root must have type "doc".', 400, "INVALID_DOC_ROOT");
  }

  const counters = { blocks: 0, chars: 0 };
  const blocks = [];
  if (Array.isArray(docObj.content)) {
    for (const child of docObj.content) {
      const sanitized = sanitizeBlockNode(child, 1, counters);
      if (sanitized) blocks.push(sanitized);
    }
  }
  if (blocks.length === 0) {
    blocks.push({ type: "paragraph" });
  }

  /** @type {Record<string, any>} */
  const result = { type: "doc", content: blocks };

  if (docObj.attrs && typeof docObj.attrs === "object" && docObj.attrs.pageSetup) {
    result.attrs = { pageSetup: normalizeDocPageSetup(docObj.attrs.pageSetup) };
  }
  if (Array.isArray(docObj.shapes) && docObj.shapes.length > 0) {
    const shapes = sanitizeDocShapes(docObj.shapes);
    if (shapes.length > 0) result.shapes = shapes;
  }
  if (Array.isArray(docObj.comments) && docObj.comments.length > 0) {
    const comments = sanitizeDocComments(docObj.comments);
    if (comments.length > 0) result.comments = comments;
  }

  return result;
}

function inlineText(inlineNodes) {
  if (!Array.isArray(inlineNodes)) return "";
  let out = "";
  for (const n of inlineNodes) {
    if (n?.type === "text" && typeof n.text === "string") out += n.text;
    else if (n?.type === "hardBreak") out += " ";
  }
  return out;
}

function countWordsInString(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * Extracts lightweight card preview blocks, snippet text, and word count from a sanitized doc.
 * @param {{ type: "doc", content?: Array<any>, shapes?: Array<any> }} doc
 * @returns {{
 *   previewBlocks: Array<{ style: string, text: string, align?: string }>,
 *   snippet: string,
 *   wordCount: number
 * }}
 */
export function extractDocSummaryMeta(doc) {
  const previewBlocks = [];
  const textParts = [];
  let wordCount = 0;

  function pushText(t) {
    const normalized = String(t || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    wordCount += countWordsInString(normalized);
    if (textParts.length < 16) textParts.push(normalized);
    return normalized;
  }

  function walk(nodes, listMode = null) {
    if (!Array.isArray(nodes)) return;
    let index = 0;
    for (const node of nodes) {
      index += 1;
      if (!node || typeof node !== "object") continue;

      if (node.type === "paragraph") {
        const normalized = pushText(inlineText(node.content));
        if (!normalized) continue;
        if (previewBlocks.length < DOC_LIMITS.maxPreviewBlocks) {
          const variant = node.attrs?.variant;
          const style = listMode
            ? listMode
            : variant === "title"
              ? "title"
              : variant === "subtitle"
                ? "subtitle"
                : "body";
          const block = {
            style,
            text: normalized.slice(0, 140),
          };
          if (node.attrs?.textAlign) block.align = node.attrs.textAlign;
          previewBlocks.push(block);
        }
      } else if (node.type === "heading") {
        const normalized = pushText(inlineText(node.content));
        if (!normalized) continue;
        if (previewBlocks.length < DOC_LIMITS.maxPreviewBlocks) {
          const lvl = node.attrs?.level || 1;
          const block = {
            style: `h${lvl}`,
            text: normalized.slice(0, 140),
          };
          if (node.attrs?.textAlign) block.align = node.attrs.textAlign;
          previewBlocks.push(block);
        }
      } else if (node.type === "bulletList") {
        for (const li of node.content || []) {
          walk(li.content, "bullet");
        }
      } else if (node.type === "orderedList") {
        let num = node.attrs?.start || 1;
        for (const li of node.content || []) {
          const before = previewBlocks.length;
          walk(li.content, "bullet");
          if (previewBlocks.length > before && previewBlocks[before]?.style === "bullet") {
            previewBlocks[before].text = `${num}. ${previewBlocks[before].text}`.slice(0, 140);
            previewBlocks[before].style = "body";
          }
          num += 1;
        }
      } else if (node.type === "blockquote") {
        const before = previewBlocks.length;
        walk(node.content, null);
        for (let i = before; i < previewBlocks.length; i += 1) {
          previewBlocks[i].style = "quote";
        }
      } else if (node.type === "table") {
        for (const row of node.content || []) {
          const rowTexts = [];
          for (const cell of row.content || []) {
            const cellParts = [];
            for (const b of cell.content || []) {
              const t = inlineText(b.content).trim();
              if (t) {
                pushText(t);
                cellParts.push(t);
              }
            }
            if (cellParts.length > 0) rowTexts.push(cellParts.join(" "));
          }
          if (rowTexts.length > 0 && previewBlocks.length < DOC_LIMITS.maxPreviewBlocks) {
            previewBlocks.push({
              style: "body",
              text: rowTexts.join(" · ").slice(0, 140),
            });
          }
        }
      } else if (node.type === "horizontalRule") {
        if (previewBlocks.length < DOC_LIMITS.maxPreviewBlocks && index > 1) {
          previewBlocks.push({ style: "rule", text: "" });
        }
      }
    }
  }

  walk(doc?.content || []);

  if (Array.isArray(doc?.shapes)) {
    for (const s of doc.shapes) {
      if (s?.text) pushText(s.text);
    }
  }

  const snippet = textParts.join(" · ").slice(0, DOC_LIMITS.maxSnippetChars);
  return { previewBlocks, snippet, wordCount };
}

const PREVIEW_STYLE_SET = new Set([
  "title",
  "subtitle",
  "h1",
  "h2",
  "h3",
  "body",
  "bullet",
  "quote",
  "rule",
]);

/**
 * Sanitizes stored previewBlocks from database rows.
 * @param {unknown} raw
 */
export function sanitizePreviewBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, DOC_LIMITS.maxPreviewBlocks)) {
    if (!item || typeof item !== "object") continue;
    const style = PREVIEW_STYLE_SET.has(item.style) ? item.style : "body";
    const text =
      style === "rule"
        ? ""
        : String(item.text ?? "")
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 140);
    if (style !== "rule" && !text) continue;
    const clean = { style, text };
    if (typeof item.align === "string" && ALIGN_SET.has(item.align) && item.align !== "left") {
      clean.align = item.align;
    }
    out.push(clean);
  }
  return out;
}

// ============================================================================
// Safe HTML Serializer (strictly escapes text; only emits whitelisted tags/styles)
// ============================================================================

export function escapeDocHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineHtml(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return "";
  let html = "";
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      html += "<br />";
      continue;
    }
    if (node.type !== "text" || typeof node.text !== "string") continue;
    let chunk = escapeDocHtml(node.text);
    const marks = Array.isArray(node.marks) ? node.marks : [];

    for (const mark of marks) {
      if (mark.type === "bold") {
        chunk = `<strong>${chunk}</strong>`;
      } else if (mark.type === "italic") {
        chunk = `<em>${chunk}</em>`;
      } else if (mark.type === "underline") {
        chunk = `<u>${chunk}</u>`;
      } else if (mark.type === "strike") {
        chunk = `<s>${chunk}</s>`;
      } else if (mark.type === "highlight") {
        const bg = normalizeHexColor(mark.attrs?.color) || "#fef08a";
        chunk = `<mark style="background-color:${bg};color:inherit;padding:0 2px;border-radius:2px;">${chunk}</mark>`;
      } else if (mark.type === "textStyle") {
        const styles = [];
        const color = normalizeHexColor(mark.attrs?.color);
        const fontSize = normalizeFontSize(mark.attrs?.fontSize);
        const fontCss = resolveFontFamilyCss(mark.attrs?.fontFamily);
        if (color) styles.push(`color:${color}`);
        if (fontSize) styles.push(`font-size:${fontSize}`);
        if (fontCss) styles.push(`font-family:${escapeDocHtml(fontCss)}`);
        if (styles.length > 0) {
          chunk = `<span style="${styles.join(";")}">${chunk}</span>`;
        }
      } else if (mark.type === "link") {
        const href = sanitizeDocHref(mark.attrs?.href);
        if (href) {
          chunk = `<a href="${escapeDocHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${chunk}</a>`;
        }
      }
    }
    html += chunk;
  }
  return html;
}

/**
 * Renders a single geometric shape as safe SVG + centered text HTML.
 * @param {any} shape
 * @param {{ backgroundGraphics?: boolean }} [opts]
 */
export function renderDocShapeHtml(shape, opts = {}) {
  const showBg = opts.backgroundGraphics !== false;
  const xPt = Number(shape.x) || 0;
  const yPt = Number(shape.y) || 0;
  const wPt = Math.max(16, Number(shape.width) || 120);
  const hPt = Math.max(12, Number(shape.height) || 72);
  const rot = Number(shape.rotation) || 0;
  const fill =
    !showBg || shape.fillColor === "transparent"
      ? "none"
      : normalizeHexColor(shape.fillColor) || "#e8f0fe";
  const stroke =
    shape.strokeColor === "transparent"
      ? "none"
      : normalizeHexColor(shape.strokeColor) || "#1a73e8";
  const sw = Math.max(0, Number(shape.strokeWidth) ?? 2);
  const pad = Math.ceil(sw / 2) + 2;

  let svgInner = "";
  const iw = Math.max(4, wPt - pad * 2);
  const ih = Math.max(4, hPt - pad * 2);

  switch (shape.shapeType) {
    case "roundedRect":
      svgInner = `<rect x="${pad}" y="${pad}" width="${iw}" height="${ih}" rx="${Math.min(18, iw / 4, ih / 4)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
      break;
    case "circle": {
      const r = Math.min(iw, ih) / 2;
      svgInner = `<circle cx="${wPt / 2}" cy="${hPt / 2}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
      break;
    }
    case "oval":
      svgInner = `<ellipse cx="${wPt / 2}" cy="${hPt / 2}" rx="${iw / 2}" ry="${ih / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
      break;
    case "triangle":
      svgInner = `<polygon points="${wPt / 2},${pad} ${wPt - pad},${hPt - pad} ${pad},${hPt - pad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
      break;
    case "diamond":
      svgInner = `<polygon points="${wPt / 2},${pad} ${wPt - pad},${hPt / 2} ${wPt / 2},${hPt - pad} ${pad},${hPt / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
      break;
    case "pentagon":
      svgInner = `<polygon points="${wPt * 0.5},${pad} ${wPt - pad},${hPt * 0.38} ${wPt * 0.81},${hPt - pad} ${wPt * 0.19},${hPt - pad} ${pad},${hPt * 0.38}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
      break;
    case "star": {
      const cx = wPt / 2;
      const cy = hPt / 2;
      const outerR = Math.min(iw, ih) / 2;
      const innerR = outerR * 0.42;
      const pts = [];
      for (let i = 0; i < 10; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r).toFixed(1)}`);
      }
      svgInner = `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
      break;
    }
    case "callout": {
      const bodyBottom = Math.max(pad + 12, hPt - pad - Math.min(18, ih * 0.24));
      svgInner = `<polygon points="${pad},${pad} ${wPt - pad},${pad} ${wPt - pad},${bodyBottom} ${wPt * 0.42},${bodyBottom} ${wPt * 0.24},${hPt - pad} ${wPt * 0.28},${bodyBottom} ${pad},${bodyBottom}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" />`;
      break;
    }
    case "line":
      svgInner = `<line x1="${pad}" y1="${hPt / 2}" x2="${wPt - pad}" y2="${hPt / 2}" stroke="${stroke === "none" ? "#1a73e8" : stroke}" stroke-width="${Math.max(1.5, sw)}" stroke-linecap="round" />`;
      break;
    case "arrow": {
      const lineStroke = stroke === "none" ? "#1a73e8" : stroke;
      const headLen = Math.min(16, Math.max(8, sw * 3.5));
      const cy = hPt / 2;
      const endX = wPt - pad;
      svgInner = `<line x1="${pad}" y1="${cy}" x2="${Math.max(pad, endX - headLen * 0.7)}" y2="${cy}" stroke="${lineStroke}" stroke-width="${Math.max(1.5, sw)}" stroke-linecap="round" /><polygon points="${endX},${cy} ${endX - headLen},${cy - headLen * 0.58} ${endX - headLen},${cy + headLen * 0.58}" fill="${lineStroke}" />`;
      break;
    }
    default:
      svgInner = `<rect x="${pad}" y="${pad}" width="${iw}" height="${ih}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
      break;
  }

  const textHtml =
    shape.text && shape.shapeType !== "line" && shape.shapeType !== "arrow"
      ? `<div style="position:absolute;inset:6pt;display:flex;align-items:center;justify-content:center;text-align:center;color:${normalizeHexColor(shape.textColor) || "#0f172a"};font-size:${clampNum(shape.fontSize, 8, 48, 11)}pt;line-height:1.25;overflow:hidden;word-break:break-word;pointer-events:none;">${escapeDocHtml(shape.text)}</div>`
      : "";

  return `<div class="pd-print-shape" style="position:absolute;left:${xPt}pt;top:${yPt}pt;width:${wPt}pt;height:${hPt}pt;transform:rotate(${rot}deg);transform-origin:center center;pointer-events:none;z-index:${shape.zIndex || 2};"><svg width="100%" height="100%" viewBox="0 0 ${wPt} ${hPt}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${svgInner}</svg>${textHtml}</div>`;
}

export function renderSingleBlockSafeHtml(block, opts = {}) {
  const showBg = opts.backgroundGraphics !== false;
  if (!block || typeof block !== "object") return "";
  switch (block.type) {
    case "paragraph": {
      const styles = [];
      if (block.attrs?.textAlign) styles.push(`text-align:${block.attrs.textAlign}`);
      if (block.attrs?.lineHeight) styles.push(`line-height:${block.attrs.lineHeight}`);
      if (typeof block.attrs?.spaceAfter === "number") {
        styles.push(`margin-bottom:${block.attrs.spaceAfter}pt`);
      }
      const styleAttr = styles.length > 0 ? ` style="${styles.join(";")}"` : "";
      const variant = block.attrs?.variant;
      const cls =
        variant === "title"
          ? ' class="doc-title"'
          : variant === "subtitle"
            ? ' class="doc-subtitle"'
            : "";
      const inner = renderInlineHtml(block.content) || "<br />";
      return `<p${cls}${styleAttr}>${inner}</p>`;
    }
    case "heading": {
      const lvl = block.attrs?.level === 2 ? 2 : block.attrs?.level === 3 ? 3 : 1;
      const styles = [];
      if (block.attrs?.textAlign) styles.push(`text-align:${block.attrs.textAlign}`);
      if (block.attrs?.lineHeight) styles.push(`line-height:${block.attrs.lineHeight}`);
      const styleAttr = styles.length > 0 ? ` style="${styles.join(";")}"` : "";
      const inner = renderInlineHtml(block.content) || "<br />";
      return `<h${lvl}${styleAttr}>${inner}</h${lvl}>`;
    }
    case "bulletList": {
      const lis = (block.content || [])
        .map((li) => `<li>${renderBlocksHtml(li.content, opts)}</li>`)
        .join("");
      return `<ul>${lis}</ul>`;
    }
    case "orderedList": {
      const start = block.attrs?.start && block.attrs.start !== 1 ? ` start="${block.attrs.start}"` : "";
      const lis = (block.content || [])
        .map((li) => `<li>${renderBlocksHtml(li.content, opts)}</li>`)
        .join("");
      return `<ol${start}>${lis}</ol>`;
    }
    case "blockquote":
      return `<blockquote>${renderBlocksHtml(block.content, opts)}</blockquote>`;
    case "table": {
      const rowsHtml = (block.content || [])
        .map((row) => {
          const cellsHtml = (row.content || [])
            .map((cell) => {
              const tag = cell.type === "tableHeader" ? "th" : "td";
              const cellAttrs = [];
              if (cell.attrs?.colspan > 1) cellAttrs.push(`colspan="${cell.attrs.colspan}"`);
              if (cell.attrs?.rowspan > 1) cellAttrs.push(`rowspan="${cell.attrs.rowspan}"`);
              const cellStyles = [];
              if (showBg && cell.attrs?.backgroundColor) {
                cellStyles.push(`background-color:${cell.attrs.backgroundColor}`);
              } else if (showBg && tag === "th") {
                cellStyles.push("background-color:#f8fafc");
              }
              if (cell.attrs?.borderColor) {
                cellStyles.push(`border-color:${cell.attrs.borderColor}`);
              }
              if (Array.isArray(cell.attrs?.colwidth) && cell.attrs.colwidth[0]) {
                cellStyles.push(`width:${Math.round(cell.attrs.colwidth[0] * 0.75)}pt`);
              }
              if (cellStyles.length > 0) cellAttrs.push(`style="${cellStyles.join(";")}"`);
              const attrStr = cellAttrs.length > 0 ? ` ${cellAttrs.join(" ")}` : "";
              return `<${tag}${attrStr}>${renderBlocksHtml(cell.content, opts)}</${tag}>`;
            })
            .join("");
          return `<tr>${cellsHtml}</tr>`;
        })
        .join("");
      return `<table class="doc-table"><tbody>${rowsHtml}</tbody></table>`;
    }
    case "docImage": {
      const src = sanitizeDocImageSrc(block.attrs?.src);
      if (!src) return "";
      const alt = escapeDocHtml(block.attrs?.alt || "");
      const wPt = Math.round((Number(block.attrs?.width) || 320) * 0.75);
      const hStyle =
        typeof block.attrs?.height === "number"
          ? `height:${Math.round(block.attrs.height * 0.75)}pt;`
          : "height:auto;";
      const wrap = block.attrs?.wrap || "inline";
      const align = block.attrs?.align || "left";
      let wrapStyle = "margin:6pt 0;";
      if (wrap === "wrap-left") {
        wrapStyle = "float:left;margin:4pt 12pt 8pt 0;";
      } else if (wrap === "wrap-right") {
        wrapStyle = "float:right;margin:4pt 0 8pt 12pt;";
      } else if (align === "center") {
        wrapStyle = "display:block;margin:8pt auto;";
      } else if (align === "right") {
        wrapStyle = "display:block;margin:8pt 0 8pt auto;";
      }
      return `<img src="${escapeDocHtml(src)}" alt="${alt}" style="max-width:100%;width:${wPt}pt;${hStyle}${wrapStyle}border-radius:2pt;" />`;
    }
    case "horizontalRule":
      return "<hr />";
    case "pageBreak":
      return '<div class="doc-page-break" style="page-break-after:always;break-after:page;height:0;"></div>';
    default:
      return "";
  }
}

function renderBlocksHtml(blocks, opts = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  return blocks.map((b) => renderSingleBlockSafeHtml(b, opts)).join("");
}

/**
 * Renders sanitized DocContent into safe semantic HTML fragment (no <script>, no raw HTML).
 * @param {unknown} rawDoc
 * @returns {string}
 */
export function renderDocBodySafeHtml(rawDoc) {
  const safe = sanitizeDocContent(rawDoc);
  return renderBlocksHtml(safe.content);
}

/**
 * Splits blocks into estimated pages for standalone printable HTML when explicit per-page block slices
 * aren't supplied by the live DOM paginator.
 * @param {Array<any>} blocks
 * @param {number} bodyHeightPt
 */
function paginateBlocksApprox(blocks, bodyHeightPt) {
  const pages = [[]];
  let usedPt = 0;
  const maxPt = Math.max(180, bodyHeightPt);

  const estimatePt = (block) => {
    if (!block) return 18;
    if (block.type === "pageBreak") return Infinity;
    if (block.type === "horizontalRule") return 22;
    if (block.type === "docImage") {
      const hPx = Number(block.attrs?.height) || Math.round((Number(block.attrs?.width) || 320) * 0.66);
      return Math.min(maxPt * 0.9, hPx * 0.75 + 14);
    }
    if (block.type === "table") {
      return Math.min(maxPt * 0.95, (block.content?.length || 1) * 28 + 14);
    }
    const txt =
      block.type === "paragraph" || block.type === "heading"
        ? inlineText(block.content)
        : JSON.stringify(block.content || "");
    const lineCount = Math.max(1, Math.ceil((txt.length || 1) / 78));
    if (block.type === "heading") return lineCount * 24 + 16;
    if (block.attrs?.variant === "title") return lineCount * 32 + 12;
    return lineCount * 18 + 8;
  };

  for (const block of blocks || []) {
    if (block.type === "pageBreak") {
      pages.push([]);
      usedPt = 0;
      continue;
    }
    const est = estimatePt(block);
    if (pages[pages.length - 1].length > 0 && usedPt + est > maxPt) {
      pages.push([block]);
      usedPt = est;
    } else {
      pages[pages.length - 1].push(block);
      usedPt += est;
    }
  }
  return pages;
}

/**
 * Builds a complete, standalone printable HTML document preserving multi-page layout,
 * per-page background colors, headers, footers, page numbers, tables, images, and shapes.
 * @param {string} title
 * @param {unknown} rawDoc
 * @param {{
 *   pageBlocks?: Array<Array<any>>,
 *   pageRangeIndices?: Array<number>,
 *   paperSize?: "letter" | "a4" | "legal",
 *   orientation?: "portrait" | "landscape",
 *   margins?: { top: number, bottom: number, left: number, right: number },
 *   scale?: number,
 *   includeHeadersFooters?: boolean,
 *   backgroundGraphics?: boolean
 * }} [printOptions]
 * @returns {string}
 */
export function renderDocPrintableHtml(title, rawDoc, printOptions = {}) {
  const safeTitle = escapeDocHtml(cleanDocTitle(title, { allowEmptyDefault: true }));
  const safeDoc = sanitizeDocContent(rawDoc);
  const baseSetup = getDocPageSetup(safeDoc);
  const mergedSetup = normalizeDocPageSetup({
    ...baseSetup,
    ...(printOptions.paperSize ? { paperSize: printOptions.paperSize } : {}),
    ...(printOptions.orientation ? { orientation: printOptions.orientation } : {}),
    ...(printOptions.margins ? { margins: printOptions.margins } : {}),
  });

  const dims = getPageDimensions(mergedSetup);
  const bodyHeightPt = dims.heightPt - mergedSetup.margins.top - mergedSetup.margins.bottom;
  const shapes = Array.isArray(safeDoc.shapes) ? safeDoc.shapes : [];

  const rawPages =
    Array.isArray(printOptions.pageBlocks) && printOptions.pageBlocks.length > 0
      ? printOptions.pageBlocks
      : paginateBlocksApprox(safeDoc.content, bodyHeightPt);

  let maxPageIdx = rawPages.length - 1;
  for (const s of shapes) {
    if (typeof s.pageIndex === "number" && s.pageIndex > maxPageIdx) maxPageIdx = s.pageIndex;
  }
  for (const k of Object.keys(mergedSetup.pageColors || {})) {
    const idx = Number(k);
    if (Number.isInteger(idx) && idx > maxPageIdx && idx < rawPages.length + 5) {
      maxPageIdx = Math.max(maxPageIdx, idx);
    }
  }
  while (rawPages.length <= maxPageIdx) {
    rawPages.push([]);
  }

  const totalPages = Math.max(1, rawPages.length);
  const selectedIndices =
    Array.isArray(printOptions.pageRangeIndices) && printOptions.pageRangeIndices.length > 0
      ? printOptions.pageRangeIndices.filter((i) => i >= 0 && i < totalPages)
      : Array.from({ length: totalPages }, (_, i) => i);

  const includeHF = printOptions.includeHeadersFooters !== false;
  const showBg = printOptions.backgroundGraphics !== false;
  const scaleFactor = clampNum(printOptions.scale ?? 100, 50, 200, 100) / 100;

  const pagesHtml = selectedIndices
    .map((pageIdx) => {
      const pageBg = showBg ? mergedSetup.pageColors[String(pageIdx)] || "#ffffff" : "#ffffff";
      const pageNumLabel = includeHF
        ? formatDocPageNumber(mergedSetup, pageIdx, totalPages)
        : "";
      const hideFirst = mergedSetup.differentFirstPage && pageIdx === 0;
      const headerTxt = includeHF && !hideFirst ? escapeDocHtml(mergedSetup.headerText) : "";
      const footerTxt = includeHF && !hideFirst ? escapeDocHtml(mergedSetup.footerText) : "";

      const headerPageNum =
        pageNumLabel && mergedSetup.pageNumberPosition.startsWith("header-") ? pageNumLabel : "";
      const footerPageNum =
        pageNumLabel && mergedSetup.pageNumberPosition.startsWith("footer-") ? pageNumLabel : "";

      const pageShapesHtml = shapes
        .filter((s) => (s.pageIndex || 0) === pageIdx)
        .map((s) => renderDocShapeHtml(s, { backgroundGraphics: showBg }))
        .join("");

      const blocksHtml = renderBlocksHtml(rawPages[pageIdx] || [], {
        backgroundGraphics: showBg,
      });

      return `<section class="print-page" data-page-number="${pageIdx + 1}" style="background-color:${pageBg};width:${dims.widthPt}pt;min-height:${dims.heightPt}pt;padding:${mergedSetup.margins.top}pt ${mergedSetup.margins.right}pt ${mergedSetup.margins.bottom}pt ${mergedSetup.margins.left}pt;">
  ${
    includeHF && (headerTxt || headerPageNum)
      ? `<header class="print-header" style="height:${Math.max(18, mergedSetup.margins.top - 14)}pt;"><span style="text-align:${mergedSetup.headerAlign};flex:1;">${headerTxt}</span>${headerPageNum ? `<span class="print-pagenum">${escapeDocHtml(headerPageNum)}</span>` : ""}</header>`
      : ""
  }
  <div class="print-body" style="${scaleFactor !== 1 ? `zoom:${scaleFactor};` : ""}">${blocksHtml}</div>
  ${pageShapesHtml}
  ${
    includeHF && (footerTxt || footerPageNum)
      ? `<footer class="print-footer" style="height:${Math.max(18, mergedSetup.margins.bottom - 14)}pt;"><span style="text-align:${mergedSetup.footerAlign};flex:1;">${footerTxt}</span>${footerPageNum ? `<span class="print-pagenum">${escapeDocHtml(footerPageNum)}</span>` : ""}</footer>`
      : ""
  }
</section>`;
    })
    .join("\n");

  const cssSize = `${dims.widthPt}pt ${dims.heightPt}pt`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { size: ${cssSize}; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: #1f2937;
    background: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.62;
    -webkit-print-color-adjust: ${showBg ? "exact" : "economy"};
    print-color-adjust: ${showBg ? "exact" : "economy"};
  }
  .print-page {
    position: relative;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .print-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .print-header {
    position: absolute;
    top: 10pt;
    left: ${mergedSetup.margins.left}pt;
    right: ${mergedSetup.margins.right}pt;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12pt;
    font-size: 9.5pt;
    color: #64748b;
  }
  .print-footer {
    position: absolute;
    bottom: 10pt;
    left: ${mergedSetup.margins.left}pt;
    right: ${mergedSetup.margins.right}pt;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12pt;
    font-size: 9.5pt;
    color: #64748b;
  }
  .print-body::after { content: ""; display: table; clear: both; }
  p { margin: 0 0 8pt; }
  p.doc-title { font-size: 24pt; font-weight: 700; line-height: 1.22; color: #0f172a; margin: 0 0 4pt; letter-spacing: -0.02em; }
  p.doc-subtitle { font-size: 13.5pt; font-weight: 400; line-height: 1.4; color: #475569; margin: 0 0 14pt; }
  h1 { font-size: 18pt; font-weight: 700; line-height: 1.3; color: #0f172a; margin: 16pt 0 6pt; }
  h2 { font-size: 14.5pt; font-weight: 650; line-height: 1.35; color: #0f172a; margin: 14pt 0 5pt; }
  h3 { font-size: 12pt; font-weight: 650; line-height: 1.4; color: #1e293b; margin: 11pt 0 4pt; }
  ul, ol { margin: 0 0 9pt; padding-left: 20pt; }
  li { margin: 0 0 3pt; }
  li > p { margin: 0; }
  blockquote {
    margin: 8pt 0;
    padding: 4pt 0 4pt 12pt;
    border-left: 2.5pt solid #cbd5e1;
    color: #475569;
  }
  table.doc-table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 10pt;
    table-layout: fixed;
  }
  table.doc-table th,
  table.doc-table td {
    border: 1pt solid #cbd5e1;
    padding: 6pt 8pt;
    vertical-align: top;
    word-break: break-word;
  }
  table.doc-table th {
    font-weight: 650;
    text-align: left;
  }
  table.doc-table td > p:last-child,
  table.doc-table th > p:last-child {
    margin-bottom: 0;
  }
  hr { border: 0; border-top: 1px solid #cbd5e1; margin: 14pt 0; }
  a { color: #1a73e8; text-decoration: underline; }
</style>
</head>
<body>${pagesHtml}</body>
</html>`;
}

// ============================================================================
// Starter Document Templates
// ============================================================================

const txt = (text, marks) => (marks ? { type: "text", text, marks } : { type: "text", text });
const p = (children, attrs) => {
  const node = { type: "paragraph" };
  if (attrs) node.attrs = attrs;
  if (children && children.length) node.content = children;
  return node;
};
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [txt(text)] });
const bullets = (items) => ({
  type: "bulletList",
  content: items.map((item) => ({
    type: "listItem",
    content: [typeof item === "string" ? p([txt(item)]) : item],
  })),
});
const numbered = (items) => ({
  type: "orderedList",
  content: items.map((item) => ({
    type: "listItem",
    content: [typeof item === "string" ? p([txt(item)]) : item],
  })),
});

export const DOC_TEMPLATES = Object.freeze([
  {
    id: "project-proposal",
    label: "Project Proposal",
    name: "Project Proposal",
    subtitle: "Structured brief & milestones",
    defaultTitle: "Project Proposal",
    featured: true,
    build: (todayLabel) => ({
      type: "doc",
      content: [
        p([txt("Project Proposal")], { variant: "title" }),
        p([txt(`Prepared on ${todayLabel} · Owner & Stakeholders`)], { variant: "subtitle" }),
        h(1, "Executive Summary"),
        p([
          txt(
            "Summarize the customer problem, the proposed solution, and the measurable outcome this initiative will deliver.",
          ),
        ]),
        h(1, "Goals & Success Metrics"),
        bullets([
          p([txt("Primary metric: ", [{ type: "bold" }]), txt("Define target improvement and baseline.")]),
          p([txt("User impact: ", [{ type: "bold" }]), txt("Describe who benefits and how workflow friction drops.")]),
          p([txt("Guardrails: ", [{ type: "bold" }]), txt("Reliability, security, and performance commitments.")]),
        ]),
        h(1, "Scope & Milestones"),
        numbered([
          "Discovery & technical design sign-off",
          "Core implementation & internal dogfooding",
          "Launch readiness, documentation, and rollout",
        ]),
        h(2, "Risks & Open Questions"),
        p([txt("Capture dependencies, edge cases, and decisions needed from leadership.")]),
      ],
    }),
  },
  {
    id: "meeting-notes",
    label: "Meeting Notes",
    name: "Meeting Notes",
    subtitle: "Agenda, decisions & action items",
    defaultTitle: "Meeting Notes",
    featured: true,
    build: (todayLabel) => ({
      type: "doc",
      content: [
        p([txt("Meeting Notes")], { variant: "title" }),
        p([txt(`${todayLabel} · Attendees: Team`)], { variant: "subtitle" }),
        h(1, "Agenda"),
        bullets([
          "Progress check on current priorities",
          "Blockers & cross-team dependencies",
          "Key decisions for this week",
        ]),
        h(1, "Discussion & Decisions"),
        p([txt("Record key context and final decisions reached during the conversation.")]),
        {
          type: "blockquote",
          content: [p([txt("Decision: Document agreed direction clearly so everyone stays aligned.")])],
        },
        h(1, "Action Items"),
        numbered([
          p([txt("@Owner", [{ type: "bold" }]), txt(" — Follow up on deliverable by Friday")]),
          p([txt("@Owner", [{ type: "bold" }]), txt(" — Share updated timeline with stakeholders")]),
        ]),
      ],
    }),
  },
  {
    id: "weekly-plan",
    label: "Weekly Plan",
    name: "Weekly Plan",
    subtitle: "Top priorities & daily focus",
    defaultTitle: "Weekly Plan",
    featured: true,
    build: (todayLabel) => ({
      type: "doc",
      content: [
        p([txt("Weekly Focus Plan")], { variant: "title" }),
        p([txt(`Week of ${todayLabel}`)], { variant: "subtitle" }),
        h(1, "Top 3 Outcomes for the Week"),
        numbered([
          "Ship highest-leverage milestone with full test verification",
          "Unblock pending reviews and stakeholder feedback",
          "Clear operational backlog & polish user experience",
        ]),
        { type: "horizontalRule" },
        h(2, "Daily Breakdown"),
        bullets([
          p([txt("Monday — ", [{ type: "bold" }]), txt("Planning, scoping, and deep-work kickoff")]),
          p([txt("Tuesday / Wednesday — ", [{ type: "bold" }]), txt("Core execution & iteration")]),
          p([txt("Thursday — ", [{ type: "bold" }]), txt("Quality pass, edge cases, and review")]),
          p([txt("Friday — ", [{ type: "bold" }]), txt("Wrap-up, demo notes, and next-week prep")]),
        ]),
        h(2, "Notes & Reflections"),
        p([txt("What went smoothly, and what should we adjust next week?")]),
      ],
    }),
  },
  {
    id: "product-spec",
    label: "Product Brief",
    name: "Product Brief",
    subtitle: "Problem, UX & requirements",
    defaultTitle: "Product Brief",
    featured: true,
    build: (todayLabel) => ({
      type: "doc",
      content: [
        p([txt("Product Specification")], { variant: "title" }),
        p([txt(`Draft · Updated ${todayLabel}`)], { variant: "subtitle" }),
        h(1, "Problem Statement"),
        p([txt("Explain what users struggle with today and why solving it matters right now.")]),
        h(1, "User Experience & Core Flows"),
        bullets([
          "Entry point and primary user journey",
          "Empty, loading, error, and recovery states",
          "Sharing, permissions, and mobile responsiveness",
        ]),
        h(1, "Non-Goals"),
        p([txt("Explicitly list out-of-scope items to keep the release focused and fast.")]),
      ],
    }),
  },
  {
    id: "personal-letter",
    label: "Clean Letter",
    name: "Clean Letter",
    subtitle: "Formal correspondence",
    defaultTitle: "Letter",
    featured: false,
    build: (todayLabel) => ({
      type: "doc",
      content: [
        p([txt(todayLabel)]),
        p([txt("Recipient Name")]),
        p([txt("Organization / Address")]),
        { type: "horizontalRule" },
        p([txt("Dear Recipient,", [{ type: "bold" }])]),
        p([
          txt(
            "Write your message clearly and concisely here. State your purpose in the opening paragraph, provide supporting details in the body, and close with a clear next step.",
          ),
        ]),
        p([txt("Sincerely,")]),
        p([txt("Your Name", [{ type: "bold" }])]),
      ],
    }),
  },
  {
    id: "research-memo",
    label: "Research Memo",
    name: "Research Memo",
    subtitle: "Findings, evidence & recommendation",
    defaultTitle: "Research Memo",
    featured: false,
    build: (todayLabel) => ({
      type: "doc",
      content: [
        p([txt("Research Synthesis & Recommendation")], { variant: "title" }),
        p([txt(`${todayLabel} · Prepared by Research`)], { variant: "subtitle" }),
        h(1, "Key Takeaways"),
        bullets([
          "Finding 1 — High-confidence pattern observed across interviews",
          "Finding 2 — Opportunity to simplify onboarding and retention",
          "Finding 3 — Clear user preference for fast, predictable workflows",
        ]),
        h(1, "Detailed Evidence"),
        p([txt("Summarize observations, supporting data, and representative customer quotes.")]),
        h(1, "Recommended Next Steps"),
        numbered(["Prioritize quick wins", "Validate prototype", "Measure post-launch adoption"]),
      ],
    }),
  },
]);

/**
 * Builds starter content & default title from a template id.
 * @param {string} templateId
 * @param {string} [todayLabel]
 */
export function buildDocTemplate(templateId, todayLabel) {
  const tpl = DOC_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) {
    throw new DocRuleError("Unknown document template.", 400, "INVALID_TEMPLATE");
  }
  const label =
    todayLabel ||
    new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return {
    title: tpl.defaultTitle,
    content: sanitizeDocContent(tpl.build(label)),
  };
}
