// TypeScript declarations for shared Persora Docs validation & AST utilities.

export class DocRuleError extends Error {
  status: number;
  code: string;
  constructor(message: string, status?: number, code?: string);
}

export const DOC_LIMITS: Readonly<{
  docs: number;
  maxTitleChars: number;
  maxTitleLength: number;
  maxJsonBytes: number;
  maxBlocks: number;
  maxDepth: number;
  maxTextChars: number;
  maxPreviewBlocks: number;
  maxSnippetChars: number;
  maxShapes: number;
  maxComments: number;
  maxImageDataChars: number;
}>;

export type DocFontFamilyId =
  | "sans"
  | "arial"
  | "georgia"
  | "times"
  | "merriweather"
  | "trebuchet"
  | "verdana"
  | "mono";

export interface DocFontFamilyOption {
  id: DocFontFamilyId;
  label: string;
  css: string;
  pdfFamily: "sans" | "serif" | "mono";
}

export const DOC_FONT_FAMILIES: readonly DocFontFamilyOption[];

export const DOC_FONT_SIZES: readonly [
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
];
export type DocFontSize = (typeof DOC_FONT_SIZES)[number];

export interface DocLineHeightOption {
  id: string;
  label: string;
  value: string;
}
export const DOC_LINE_HEIGHTS: readonly DocLineHeightOption[];

export type DocPaperSizeId = "letter" | "a4" | "legal";
export type DocPageOrientation = "portrait" | "landscape";

export interface DocPaperSizeSpec {
  id: DocPaperSizeId;
  label: string;
  widthPt: number;
  heightPt: number;
}
export const DOC_PAPER_SIZES: Readonly<Record<DocPaperSizeId, DocPaperSizeSpec>>;

export interface DocColorSwatch {
  id: string;
  label: string;
  hex: string;
}

export const DOC_PAGE_COLORS: readonly DocColorSwatch[];
export const DOC_TEXT_COLORS: readonly DocColorSwatch[];
export const DOC_HIGHLIGHT_COLORS: readonly DocColorSwatch[];

export type DocShapeType =
  | "rectangle"
  | "roundedRect"
  | "circle"
  | "oval"
  | "triangle"
  | "diamond"
  | "pentagon"
  | "star"
  | "callout"
  | "line"
  | "arrow";

export const DOC_SHAPE_TYPES: readonly DocShapeType[];

export interface DocShape {
  id: string;
  shapeType: DocShapeType;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  text?: string;
  textColor?: string;
  fontSize?: number;
  zIndex?: number;
}

export interface DocCommentReply {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface DocCommentThread {
  id: string;
  quote: string;
  authorName: string;
  text: string;
  createdAt: string;
  resolved?: boolean;
  replies?: DocCommentReply[];
}

export type DocPageNumberPosition =
  | "header-right"
  | "header-center"
  | "footer-right"
  | "footer-center"
  | "footer-left";

export type DocPageNumberFormat = "number" | "page-x" | "page-x-of-n";

export interface DocMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DocPageSetup {
  paperSize: DocPaperSizeId;
  orientation: DocPageOrientation;
  margins: DocMargins;
  showRuler: boolean;
  commentsEnabled: boolean;
  pageColors: Record<string, string>;
  headerText: string;
  headerAlign: "left" | "center" | "right";
  footerText: string;
  footerAlign: "left" | "center" | "right";
  showPageNumbers: boolean;
  pageNumberPosition: DocPageNumberPosition;
  pageNumberFormat: DocPageNumberFormat;
  pageNumberStart: number;
  differentFirstPage: boolean;
}

export const DEFAULT_DOC_PAGE_SETUP: Readonly<DocPageSetup>;

export type DocTextAlign = "left" | "center" | "right" | "justify";
export type DocParagraphVariant = "normal" | "title" | "subtitle";
export type DocImageWrap = "inline" | "wrap-left" | "wrap-right" | "break-text";

export type DocMark =
  | { type: "bold" | "italic" | "underline" | "strike" }
  | { type: "textStyle"; attrs: { color?: string; fontSize?: DocFontSize; fontFamily?: DocFontFamilyId } }
  | { type: "highlight"; attrs: { color: string } }
  | { type: "link"; attrs: { href: string; target?: string; rel?: string } }
  | { type: "comment"; attrs: { commentId: string } };

export type DocInlineNode =
  | { type: "text"; text: string; marks?: DocMark[] }
  | { type: "hardBreak" };

export interface DocTableCellNode {
  type: "tableCell" | "tableHeader";
  attrs?: {
    colspan?: number;
    rowspan?: number;
    colwidth?: number[];
    backgroundColor?: string;
    borderColor?: string;
  };
  content: DocBlockNode[];
}

export interface DocTableRowNode {
  type: "tableRow";
  content: DocTableCellNode[];
}

export type DocBlockNode =
  | {
      type: "paragraph";
      attrs?: {
        variant?: DocParagraphVariant;
        textAlign?: DocTextAlign;
        lineHeight?: string;
        spaceAfter?: number;
      };
      content?: DocInlineNode[];
    }
  | {
      type: "heading";
      attrs: { level: 1 | 2 | 3; textAlign?: DocTextAlign; lineHeight?: string };
      content?: DocInlineNode[];
    }
  | {
      type: "bulletList";
      content: Array<{ type: "listItem"; content: DocBlockNode[] }>;
    }
  | {
      type: "orderedList";
      attrs?: { start?: number };
      content: Array<{ type: "listItem"; content: DocBlockNode[] }>;
    }
  | {
      type: "blockquote";
      content: DocBlockNode[];
    }
  | {
      type: "table";
      content: DocTableRowNode[];
    }
  | {
      type: "docImage";
      attrs: {
        src: string;
        alt: string;
        width: number;
        height?: number;
        wrap: DocImageWrap;
        align: "left" | "center" | "right";
      };
    }
  | { type: "horizontalRule" }
  | { type: "pageBreak" };

export interface DocContent {
  type: "doc";
  attrs?: {
    pageSetup?: DocPageSetup;
  };
  shapes?: DocShape[];
  comments?: DocCommentThread[];
  content: DocBlockNode[];
}

export type DocPreviewBlockStyle =
  | "title"
  | "subtitle"
  | "h1"
  | "h2"
  | "h3"
  | "body"
  | "bullet"
  | "quote"
  | "rule";

export interface DocPreviewBlock {
  style: DocPreviewBlockStyle;
  text: string;
  align?: DocTextAlign;
}

export interface DocSummaryMeta {
  previewBlocks: DocPreviewBlock[];
  snippet: string;
  wordCount: number;
}

export interface DocTemplateDefinition {
  id: string;
  label: string;
  name: string;
  subtitle: string;
  defaultTitle: string;
  featured: boolean;
  build: (todayLabel: string) => DocContent;
}

export type DocTemplateInfo = DocTemplateDefinition;

export interface DocPageDimensions {
  widthPt: number;
  heightPt: number;
  widthPx: number;
  heightPx: number;
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
}

export interface DocPrintableHtmlOptions {
  pageBlocks?: DocBlockNode[][];
  pageRangeIndices?: number[];
  paperSize?: DocPaperSizeId;
  orientation?: DocPageOrientation;
  margins?: DocMargins;
  scale?: number;
  includeHeadersFooters?: boolean;
  backgroundGraphics?: boolean;
}

export const DOC_TEMPLATES: readonly DocTemplateDefinition[];

export function cleanDocUuid(raw: unknown, label?: string): string;
export function cleanDocTitle(raw: unknown, options?: { allowEmptyDefault?: boolean }): string;
export function normalizeHexColor(raw: unknown): string | null;
export function normalizeColorOrTransparent(raw: unknown, fallback: string): string;
export function normalizeFontFamily(raw: unknown): DocFontFamilyId | null;
export function resolveFontFamilyCss(raw: unknown): string | null;
export function normalizeFontSize(raw: unknown): DocFontSize | null;
export function normalizeLineHeight(raw: unknown): string | null;
export function sanitizeDocHref(raw: unknown, options?: { autoHttps?: boolean }): string | null;
export function sanitizeDocImageSrc(raw: unknown): string | null;
export function normalizeDocPageSetup(raw: unknown): DocPageSetup;
export function getDocPageSetup(doc: unknown): DocPageSetup;
export function getPageDimensions(pageSetup: unknown): DocPageDimensions;
export function formatDocPageNumber(
  pageSetup: unknown,
  pageIndex: number,
  totalPages: number,
): string;
export function sanitizeDocShapes(rawShapes: unknown): DocShape[];
export function sanitizeDocComments(rawComments: unknown): DocCommentThread[];
export function blankDocContent(): DocContent;
export function sanitizeDocContent(raw: unknown): DocContent;
export function extractDocSummaryMeta(doc: DocContent): DocSummaryMeta;
export function sanitizePreviewBlocks(raw: unknown): DocPreviewBlock[];
export function escapeDocHtml(value: unknown): string;
export function renderDocShapeHtml(
  shape: DocShape,
  opts?: { backgroundGraphics?: boolean },
): string;
export function renderSingleBlockSafeHtml(
  block: DocBlockNode,
  opts?: { backgroundGraphics?: boolean },
): string;
export function renderDocBodySafeHtml(rawDoc: unknown): string;
export function renderDocPrintableHtml(
  title: string,
  rawDoc: unknown,
  printOptions?: DocPrintableHtmlOptions,
): string;
export function buildDocTemplate(
  templateId: string,
  todayLabel?: string,
): { title: string; content: DocContent };
