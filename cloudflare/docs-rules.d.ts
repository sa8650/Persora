// Type declarations for cloudflare/docs-rules.js (shared across Worker and React client).

export class DocRuleError extends Error {
  status: number;
  constructor(message: string, status?: number);
}

export type DocTextAlign = "left" | "center" | "right" | "justify";
export type DocParagraphVariant = "normal" | "title" | "subtitle";
export type DocFontSize =
  | "9pt"
  | "10pt"
  | "11pt"
  | "12pt"
  | "14pt"
  | "16pt"
  | "18pt"
  | "24pt"
  | "30pt"
  | "36pt";

export type DocPreviewBlockStyle =
  | "title"
  | "subtitle"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "quote"
  | "rule"
  | "body";

export interface DocPreviewBlock {
  style: DocPreviewBlockStyle;
  text: string;
  align?: DocTextAlign;
}

export type DocMark =
  | { type: "bold" | "italic" | "underline" | "strike" }
  | { type: "textStyle"; attrs: { color?: string; fontSize?: DocFontSize } }
  | { type: "highlight"; attrs: { color: string } }
  | { type: "link"; attrs: { href: string; target?: "_blank"; rel?: string } };

export type DocInlineNode =
  | { type: "text"; text: string; marks?: DocMark[] }
  | { type: "hardBreak" };

export type DocBlockNode =
  | {
      type: "paragraph";
      attrs?: { textAlign?: DocTextAlign; variant?: DocParagraphVariant };
      content?: DocInlineNode[];
    }
  | {
      type: "heading";
      attrs: { level: 1 | 2 | 3; textAlign?: DocTextAlign };
      content?: DocInlineNode[];
    }
  | { type: "bulletList"; content: Array<{ type: "listItem"; content: DocBlockNode[] }> }
  | {
      type: "orderedList";
      attrs?: { start?: number };
      content: Array<{ type: "listItem"; content: DocBlockNode[] }>;
    }
  | { type: "blockquote"; content: DocBlockNode[] }
  | { type: "horizontalRule" };

export interface DocContent {
  type: "doc";
  content: DocBlockNode[];
}

export interface DocColorSwatch {
  id: string;
  label: string;
  hex: string;
}

export interface DocTemplateInfo {
  id:
    | "meeting-notes"
    | "project-proposal"
    | "personal-letter"
    | "resume"
    | "weekly-journal"
    | "study-notes"
    | "decision-memo";
  label: string;
  description: string;
}

export const DOC_LIMITS: Readonly<{
  docs: number;
  maxTitleChars: number;
  maxJsonBytes: number;
  maxBlocks: number;
  maxDepth: number;
  maxTextNodeChars: number;
  maxPreviewBlocks: number;
  maxPreviewBlockChars: number;
  maxSnippetChars: number;
}>;

export const DOC_FONT_SIZES: readonly DocFontSize[];
export const DOC_TEXT_COLORS: readonly DocColorSwatch[];
export const DOC_HIGHLIGHT_COLORS: readonly DocColorSwatch[];
export const DOC_TEMPLATES: readonly DocTemplateInfo[];

export function cleanDocTitle(raw: unknown, options?: { allowEmptyDefault?: boolean }): string;
export function normalizeHexColor(raw: unknown): string | null;
export function normalizeFontSize(raw: unknown): DocFontSize | null;
export function sanitizeDocHref(raw: unknown, options?: { autoHttps?: boolean }): string | null;
export function blankDocContent(): DocContent;
export function sanitizeDocContent(input: unknown): DocContent;
export function extractDocSummaryMeta(doc: DocContent): {
  previewBlocks: DocPreviewBlock[];
  snippet: string;
  wordCount: number;
};
export function sanitizePreviewBlocks(raw: unknown): DocPreviewBlock[];
export function escapeHtml(str: unknown): string;
export function renderDocBodySafeHtml(doc: unknown): string;
export function renderDocPrintableHtml(title: string, doc: unknown): string;
export function buildDocTemplate(
  templateId: DocTemplateInfo["id"] | "blank",
  todayIso?: string,
): { title: string; content: DocContent };
