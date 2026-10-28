// Persora Docs — clean multi-page vector PDF export using pdf-lib.
// Preserves paragraph variants (Title, Subtitle, Normal), Headings 1–3, custom font
// sizes, Bold/Italic/Underline/Strikethrough, Text color, Highlight color, Alignment,
// Bulleted & Numbered lists, Blockquotes, Horizontal rules, and Hyperlink styling.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  cleanDocTitle,
  normalizeFontSize,
  normalizeHexColor,
  sanitizeDocContent,
  type DocBlockNode,
  type DocContent,
  type DocInlineNode,
  type DocTextAlign,
} from "../../cloudflare/docs-rules.js";

const PAGE_WIDTH = 612; // US Letter 8.5in * 72pt
const PAGE_HEIGHT = 792; // US Letter 11in * 72pt
const MARGIN_X = 64;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 64;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

interface StyledRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: [number, number, number];
  highlight: [number, number, number] | null;
  fontSize: number;
  isLink: boolean;
}

interface MeasuredWord {
  text: string;
  width: number;
  isSpace: boolean;
  run: StyledRun;
  font: PDFFont;
}

function hexToRgb01(hex: string | null | undefined, fallback: [number, number, number]): [number, number, number] {
  const norm = normalizeHexColor(hex);
  if (!norm) return fallback;
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  return [r, g, b];
}

/** Standard WinAnsi fallback for common Unicode punctuation/bullets so pdf-lib StandardFonts never throw. */
function toWinAnsiSafe(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2014/g, "--")
    .replace(/\u2013/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, "");
}

function parsePt(fontSizeStr: string | null | undefined, defaultPt: number): number {
  const norm = normalizeFontSize(fontSizeStr);
  if (!norm) return defaultPt;
  const n = Number(norm.replace("pt", ""));
  return Number.isFinite(n) && n >= 8 && n <= 48 ? n : defaultPt;
}

export async function buildDocPdfBytes(rawTitle: string, rawDoc: DocContent): Promise<Uint8Array> {
  const title = cleanDocTitle(rawTitle, { allowEmptyDefault: true });
  const doc = sanitizeDocContent(rawDoc);

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Persora Docs");
  pdf.setProducer("Persora");

  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);

  const pickFont = (bold: boolean, italic: boolean): PDFFont => {
    if (bold && italic) return fontBoldItalic;
    if (bold) return fontBold;
    if (italic) return fontItalic;
    return fontRegular;
  };

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN_TOP;

  const ensureSpace = (neededHeight: number) => {
    if (cursorY - neededHeight < MARGIN_BOTTOM) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursorY = PAGE_HEIGHT - MARGIN_TOP;
    }
  };

  function inlineToRuns(
    nodes: DocInlineNode[] | undefined,
    defaults: { fontSize: number; bold: boolean; color: [number, number, number] },
  ): Array<StyledRun | { hardBreak: true }> {
    if (!nodes || nodes.length === 0) return [];
    const out: Array<StyledRun | { hardBreak: true }> = [];

    for (const node of nodes) {
      if (node.type === "hardBreak") {
        out.push({ hardBreak: true });
        continue;
      }
      if (node.type !== "text" || !node.text) continue;
      const safeText = toWinAnsiSafe(node.text);
      if (!safeText) continue;

      let bold = defaults.bold;
      let italic = false;
      let underline = false;
      let strike = false;
      let isLink = false;
      let color: [number, number, number] = defaults.color;
      let highlight: [number, number, number] | null = null;
      let fontSize = defaults.fontSize;

      for (const mark of node.marks || []) {
        if (mark.type === "bold") bold = true;
        else if (mark.type === "italic") italic = true;
        else if (mark.type === "underline") underline = true;
        else if (mark.type === "strike") strike = true;
        else if (mark.type === "link") {
          isLink = true;
          underline = true;
          color = [0.1, 0.45, 0.91];
        } else if (mark.type === "textStyle") {
          if (mark.attrs?.color) color = hexToRgb01(mark.attrs.color, color);
          if (mark.attrs?.fontSize) fontSize = parsePt(mark.attrs.fontSize, fontSize);
        } else if (mark.type === "highlight") {
          highlight = hexToRgb01(mark.attrs?.color, [0.996, 0.941, 0.541]);
        }
      }

      out.push({
        text: safeText,
        bold,
        italic,
        underline,
        strike,
        color,
        highlight,
        fontSize,
        isLink,
      });
    }
    return out;
  }

  function renderStyledParagraph(options: {
    nodes: DocInlineNode[] | undefined;
    baseFontSize: number;
    baseBold: boolean;
    baseColor: [number, number, number];
    align: DocTextAlign;
    indentLeft: number;
    spaceBefore: number;
    spaceAfter: number;
    prefix?: string;
    quoteBar?: boolean;
  }) {
    const {
      nodes,
      baseFontSize,
      baseBold,
      baseColor,
      align,
      indentLeft,
      spaceBefore,
      spaceAfter,
      prefix,
      quoteBar,
    } = options;

    if (spaceBefore > 0 && cursorY < PAGE_HEIGHT - MARGIN_TOP - 2) {
      cursorY -= spaceBefore;
    }

    const maxWidth = Math.max(120, CONTENT_WIDTH - indentLeft);
    const items = inlineToRuns(nodes, {
      fontSize: baseFontSize,
      bold: baseBold,
      color: baseColor,
    });

    if (items.length === 0) {
      const emptyLineH = baseFontSize * 1.48;
      ensureSpace(emptyLineH);
      if (prefix) {
        const pFont = pickFont(baseBold, false);
        page.drawText(toWinAnsiSafe(prefix), {
          x: MARGIN_X + Math.max(0, indentLeft - 16),
          y: cursorY - baseFontSize,
          size: baseFontSize,
          font: pFont,
          color: rgb(baseColor[0], baseColor[1], baseColor[2]),
        });
      }
      cursorY -= emptyLineH + spaceAfter;
      return;
    }

    // Break runs into lines of MeasuredWords
    const lines: MeasuredWord[][] = [[]];
    for (const item of items) {
      if ("hardBreak" in item) {
        lines.push([]);
        continue;
      }
      const font = pickFont(item.bold, item.italic);
      const tokens = item.text.match(/(\s+|\S+)/g) || [];
      for (const tok of tokens) {
        const isSpace = /^\s+$/.test(tok);
        const normalizedTok = isSpace ? " " : tok;
        const w = font.widthOfTextAtSize(normalizedTok, item.fontSize);
        const currentLine = lines[lines.length - 1];
        const currentWidth = currentLine.reduce((acc, m) => acc + m.width, 0);

        if (!isSpace && currentLine.length > 0 && currentWidth + w > maxWidth) {
          // Trim trailing space on previous line
          while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
            currentLine.pop();
          }
          lines.push([{ text: normalizedTok, width: w, isSpace: false, run: item, font }]);
        } else if (isSpace && currentLine.length === 0) {
          // Skip leading whitespace on wrapped line
          continue;
        } else {
          currentLine.push({ text: normalizedTok, width: w, isSpace, run: item, font });
        }
      }
    }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
      const line = lines[lineIdx];
      while (line.length > 0 && line[line.length - 1].isSpace) {
        line.pop();
      }
      const maxPt = line.reduce((m, w) => Math.max(m, w.run.fontSize), baseFontSize);
      const lineHeight = maxPt * 1.48;
      ensureSpace(lineHeight);

      const baselineY = cursorY - maxPt;

      if (quoteBar) {
        page.drawRectangle({
          x: MARGIN_X + indentLeft - 10,
          y: baselineY - 3,
          width: 2.5,
          height: lineHeight,
          color: rgb(0.78, 0.83, 0.89),
        });
      }

      if (lineIdx === 0 && prefix) {
        const pFont = pickFont(false, false);
        page.drawText(toWinAnsiSafe(prefix), {
          x: MARGIN_X + Math.max(0, indentLeft - 18),
          y: baselineY,
          size: baseFontSize,
          font: pFont,
          color: rgb(baseColor[0], baseColor[1], baseColor[2]),
        });
      }

      const totalWidth = line.reduce((acc, m) => acc + m.width, 0);
      const spaceCount = line.filter((m) => m.isSpace).length;
      const isLastLine = lineIdx === lines.length - 1;
      const extraPerSpace =
        align === "justify" && !isLastLine && spaceCount > 0 && totalWidth < maxWidth
          ? (maxWidth - totalWidth) / spaceCount
          : 0;

      let x = MARGIN_X + indentLeft;
      if (align === "center") {
        x += Math.max(0, (maxWidth - totalWidth) / 2);
      } else if (align === "right") {
        x += Math.max(0, maxWidth - totalWidth);
      }

      for (const word of line) {
        const drawW = word.width + (word.isSpace ? extraPerSpace : 0);
        if (word.run.highlight) {
          const [hr, hg, hb] = word.run.highlight;
          page.drawRectangle({
            x,
            y: baselineY - word.run.fontSize * 0.2,
            width: drawW,
            height: word.run.fontSize * 1.15,
            color: rgb(hr, hg, hb),
          });
        }
        if (!word.isSpace && word.text) {
          const [cr, cg, cb] = word.run.color;
          page.drawText(word.text, {
            x,
            y: baselineY,
            size: word.run.fontSize,
            font: word.font,
            color: rgb(cr, cg, cb),
          });
        }
        if (word.run.underline && (!word.isSpace || extraPerSpace === 0)) {
          const [cr, cg, cb] = word.run.color;
          page.drawLine({
            start: { x, y: baselineY - 1.6 },
            end: { x: x + drawW, y: baselineY - 1.6 },
            thickness: Math.max(0.65, word.run.fontSize * 0.055),
            color: rgb(cr, cg, cb),
          });
        }
        if (word.run.strike && !word.isSpace) {
          const [cr, cg, cb] = word.run.color;
          page.drawLine({
            start: { x, y: baselineY + word.run.fontSize * 0.3 },
            end: { x: x + drawW, y: baselineY + word.run.fontSize * 0.3 },
            thickness: Math.max(0.65, word.run.fontSize * 0.055),
            color: rgb(cr, cg, cb),
          });
        }
        x += drawW;
      }

      cursorY -= lineHeight;
    }

    cursorY -= spaceAfter;
  }

  function renderBlocks(
    blocks: DocBlockNode[],
    ctx: { indent: number; quote: boolean; listPrefix?: (idx: number) => string },
  ) {
    blocks.forEach((block, idx) => {
      if (block.type === "paragraph") {
        const variant = block.attrs?.variant || "normal";
        const align = block.attrs?.textAlign || "left";
        const prefix = ctx.listPrefix ? ctx.listPrefix(idx) : undefined;
        if (variant === "title") {
          renderStyledParagraph({
            nodes: block.content,
            baseFontSize: 24,
            baseBold: true,
            baseColor: [0.06, 0.09, 0.16],
            align,
            indentLeft: ctx.indent,
            spaceBefore: 2,
            spaceAfter: 6,
            prefix,
            quoteBar: ctx.quote,
          });
        } else if (variant === "subtitle") {
          renderStyledParagraph({
            nodes: block.content,
            baseFontSize: 13.5,
            baseBold: false,
            baseColor: [0.28, 0.33, 0.41],
            align,
            indentLeft: ctx.indent,
            spaceBefore: 0,
            spaceAfter: 12,
            prefix,
            quoteBar: ctx.quote,
          });
        } else {
          renderStyledParagraph({
            nodes: block.content,
            baseFontSize: 11,
            baseBold: false,
            baseColor: ctx.quote ? [0.28, 0.33, 0.41] : [0.12, 0.16, 0.22],
            align,
            indentLeft: ctx.indent,
            spaceBefore: 0,
            spaceAfter: ctx.listPrefix ? 3 : 7,
            prefix,
            quoteBar: ctx.quote,
          });
        }
      } else if (block.type === "heading") {
        const level = block.attrs.level;
        const size = level === 1 ? 18 : level === 2 ? 14.5 : 12;
        const before = level === 1 ? 12 : level === 2 ? 10 : 8;
        renderStyledParagraph({
          nodes: block.content,
          baseFontSize: size,
          baseBold: true,
          baseColor: [0.06, 0.09, 0.16],
          align: block.attrs.textAlign || "left",
          indentLeft: ctx.indent,
          spaceBefore: before,
          spaceAfter: 5,
          quoteBar: ctx.quote,
        });
      } else if (block.type === "bulletList") {
        for (const li of block.content) {
          renderBlocks(li.content, {
            indent: ctx.indent + 20,
            quote: ctx.quote,
            listPrefix: (innerIdx) => (innerIdx === 0 ? "•" : ""),
          });
        }
        cursorY -= 4;
      } else if (block.type === "orderedList") {
        const start = block.attrs?.start ?? 1;
        block.content.forEach((li, liIdx) => {
          const num = start + liIdx;
          renderBlocks(li.content, {
            indent: ctx.indent + 22,
            quote: ctx.quote,
            listPrefix: (innerIdx) => (innerIdx === 0 ? `${num}.` : ""),
          });
        });
        cursorY -= 4;
      } else if (block.type === "blockquote") {
        renderBlocks(block.content, {
          indent: ctx.indent + 16,
          quote: true,
        });
        cursorY -= 4;
      } else if (block.type === "horizontalRule") {
        ensureSpace(16);
        cursorY -= 6;
        page.drawLine({
          start: { x: MARGIN_X + ctx.indent, y: cursorY },
          end: { x: PAGE_WIDTH - MARGIN_X, y: cursorY },
          thickness: 0.75,
          color: rgb(0.8, 0.84, 0.88),
        });
        cursorY -= 10;
      }
    });
  }

  renderBlocks(doc.content, { indent: 0, quote: false });

  return pdf.save();
}

export async function downloadDocAsPdf(rawTitle: string, rawDoc: DocContent): Promise<void> {
  const title = cleanDocTitle(rawTitle, { allowEmptyDefault: true });
  const bytes = await buildDocPdfBytes(title, rawDoc);
  const safeFileBase =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "Untitled document";
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFileBase}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}
