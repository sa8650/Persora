// Persora Docs — multi-page vector PDF exporter using pdf-lib.
// Preserves paper size, Portrait/Landscape orientation, configurable margins,
// independent per-page background colors, headers, footers, page numbers,
// font families (sans/serif/mono), font sizes, line spacing, inline marks,
// alignment, lists, blockquotes, tables, embedded images, and geometric shapes.
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  DOC_FONT_FAMILIES,
  cleanDocTitle,
  formatDocPageNumber,
  getDocPageSetup,
  getPageDimensions,
  normalizeFontFamily,
  normalizeFontSize,
  normalizeHexColor,
  sanitizeDocContent,
  type DocBlockNode,
  type DocContent,
  type DocInlineNode,
  type DocShape,
  type DocTextAlign,
} from "../../cloudflare/docs-rules.js";

type PdfFontFamilyGroup = "sans" | "serif" | "mono";

interface StyledRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: [number, number, number];
  highlight: [number, number, number] | null;
  fontSize: number;
  fontGroup: PdfFontFamilyGroup;
  isLink: boolean;
}

interface MeasuredWord {
  text: string;
  width: number;
  isSpace: boolean;
  run: StyledRun;
  font: PDFFont;
}

function hexToRgb01(
  hex: string | null | undefined,
  fallback: [number, number, number],
): [number, number, number] {
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
    .replace(/\u2022/g, "\xB7")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E\xA1-\xFF]/g, "");
}

function parsePt(fontSizeStr: string | null | undefined, defaultPt: number): number {
  const norm = normalizeFontSize(fontSizeStr);
  if (!norm) return defaultPt;
  const n = Number(norm.replace("pt", ""));
  return Number.isFinite(n) && n >= 8 && n <= 72 ? n : defaultPt;
}

function resolvePdfFontGroup(fontFamilyAttr: string | null | undefined): PdfFontFamilyGroup {
  const id = normalizeFontFamily(fontFamilyAttr);
  if (!id) return "sans";
  const match = DOC_FONT_FAMILIES.find((f) => f.id === id);
  return match?.pdfFamily || "sans";
}

function decodeBase64Bytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return Uint8Array.from(Buffer.from(clean, "base64"));
}

async function embedDocImageSource(pdf: PDFDocument, src: string): Promise<PDFImage | null> {
  try {
    const pngMatch = src.match(/^data:image\/png;base64,(.+)$/i);
    if (pngMatch) {
      return await pdf.embedPng(decodeBase64Bytes(pngMatch[1]));
    }
    const jpgMatch = src.match(/^data:image\/jpe?g;base64,(.+)$/i);
    if (jpgMatch) {
      return await pdf.embedJpg(decodeBase64Bytes(jpgMatch[1]));
    }
    // Browser fallback for webp/gif or remote URLs via offscreen canvas -> PNG
    if (typeof document !== "undefined" && typeof Image !== "undefined") {
      const pngDataUrl = await new Promise<string | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, img.naturalWidth || 320);
            canvas.height = Math.max(1, img.naturalHeight || 240);
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL("image/png"));
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
      if (pngDataUrl) {
        const converted = pngDataUrl.match(/^data:image\/png;base64,(.+)$/i);
        if (converted) return await pdf.embedPng(decodeBase64Bytes(converted[1]));
      }
    }
    return null;
  } catch {
    return null;
  }
}

function rotatePointAround(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angleRad: number,
): { x: number; y: number } {
  if (Math.abs(angleRad) < 1e-4) return { x: px, y: py };
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = px - cx;
  const dy = py - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

export async function buildDocPdfBytes(rawTitle: string, rawDoc: DocContent): Promise<Uint8Array> {
  const title = cleanDocTitle(rawTitle, { allowEmptyDefault: true });
  const doc = sanitizeDocContent(rawDoc);
  const pageSetup = getDocPageSetup(doc);
  const dims = getPageDimensions(pageSetup);

  const pageWidth = dims.widthPt;
  const pageHeight = dims.heightPt;
  const marginLeft = pageSetup.margins.left;
  const marginRight = pageSetup.margins.right;
  const marginTop = pageSetup.margins.top;
  const marginBottom = pageSetup.margins.bottom;
  const contentWidth = Math.max(120, pageWidth - marginLeft - marginRight);

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Persora Docs");
  pdf.setProducer("Persora");

  const fonts: Record<
    PdfFontFamilyGroup,
    { reg: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont }
  > = {
    sans: {
      reg: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    },
    serif: {
      reg: await pdf.embedFont(StandardFonts.TimesRoman),
      bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
      italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
      boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    },
    mono: {
      reg: await pdf.embedFont(StandardFonts.Courier),
      bold: await pdf.embedFont(StandardFonts.CourierBold),
      italic: await pdf.embedFont(StandardFonts.CourierOblique),
      boldItalic: await pdf.embedFont(StandardFonts.CourierBoldOblique),
    },
  };

  const pickFont = (group: PdfFontFamilyGroup, bold: boolean, italic: boolean): PDFFont => {
    const family = fonts[group] || fonts.sans;
    if (bold && italic) return family.boldItalic;
    if (bold) return family.bold;
    if (italic) return family.italic;
    return family.reg;
  };

  const pages: PDFPage[] = [];

  const createStyledPage = (): PDFPage => {
    const pageIdx = pages.length;
    const p = pdf.addPage([pageWidth, pageHeight]);
    const pageHex = pageSetup.pageColors[String(pageIdx)];
    if (pageHex && pageHex !== "#ffffff") {
      const [r, g, b] = hexToRgb01(pageHex, [1, 1, 1]);
      p.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        color: rgb(r, g, b),
      });
    }
    pages.push(p);
    return p;
  };

  let page: PDFPage = createStyledPage();
  let cursorY = pageHeight - marginTop;

  const advanceToNewPage = () => {
    page = createStyledPage();
    cursorY = pageHeight - marginTop;
  };

  const ensureSpace = (neededHeight: number) => {
    if (cursorY - neededHeight < marginBottom) {
      advanceToNewPage();
    }
  };

  function inlineToRuns(
    nodes: DocInlineNode[] | undefined,
    defaults: {
      fontSize: number;
      bold: boolean;
      color: [number, number, number];
      fontGroup?: PdfFontFamilyGroup;
    },
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
      let fontGroup: PdfFontFamilyGroup = defaults.fontGroup || "sans";

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
          if (mark.attrs?.fontFamily) fontGroup = resolvePdfFontGroup(mark.attrs.fontFamily);
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
        fontGroup,
        isLink,
      });
    }
    return out;
  }

  function layoutRunsIntoLines(
    items: Array<StyledRun | { hardBreak: true }>,
    maxWidth: number,
  ): MeasuredWord[][] {
    const lines: MeasuredWord[][] = [[]];
    for (const item of items) {
      if ("hardBreak" in item) {
        lines.push([]);
        continue;
      }
      const font = pickFont(item.fontGroup, item.bold, item.italic);
      const tokens = item.text.match(/(\s+|\S+)/g) || [];
      for (const tok of tokens) {
        const isSpace = /^\s+$/.test(tok);
        const normalizedTok = isSpace ? " " : tok;
        const w = font.widthOfTextAtSize(normalizedTok, item.fontSize);
        const currentLine = lines[lines.length - 1];
        const currentWidth = currentLine.reduce((acc, m) => acc + m.width, 0);

        if (!isSpace && currentLine.length > 0 && currentWidth + w > maxWidth) {
          while (currentLine.length > 0 && currentLine[currentLine.length - 1].isSpace) {
            currentLine.pop();
          }
          lines.push([{ text: normalizedTok, width: w, isSpace: false, run: item, font }]);
        } else if (isSpace && currentLine.length === 0) {
          continue;
        } else {
          currentLine.push({ text: normalizedTok, width: w, isSpace, run: item, font });
        }
      }
    }
    for (const line of lines) {
      while (line.length > 0 && line[line.length - 1].isSpace) {
        line.pop();
      }
    }
    return lines;
  }

  function renderStyledParagraph(options: {
    nodes: DocInlineNode[] | undefined;
    baseFontSize: number;
    baseBold: boolean;
    baseColor: [number, number, number];
    align: DocTextAlign;
    lineHeightRatio: number;
    indentLeft: number;
    spaceBefore: number;
    spaceAfter: number;
    prefix?: string;
    quoteBar?: boolean;
    boxLeft?: number;
    boxWidth?: number;
    targetPage?: PDFPage;
    fixedStartY?: number;
  }): number {
    const {
      nodes,
      baseFontSize,
      baseBold,
      baseColor,
      align,
      lineHeightRatio,
      indentLeft,
      spaceBefore,
      spaceAfter,
      prefix,
      quoteBar,
      boxLeft,
      boxWidth,
      targetPage,
      fixedStartY,
    } = options;

    const originX = boxLeft ?? marginLeft;
    const availW = boxWidth ?? contentWidth;
    const inFixedBox = Boolean(targetPage && fixedStartY !== undefined);
    let localY = fixedStartY ?? cursorY;

    if (!inFixedBox && spaceBefore > 0 && cursorY < pageHeight - marginTop - 2) {
      cursorY -= spaceBefore;
      localY = cursorY;
    }

    const maxWidth = Math.max(48, availW - indentLeft);
    const items = inlineToRuns(nodes, {
      fontSize: baseFontSize,
      bold: baseBold,
      color: baseColor,
    });

    if (items.length === 0) {
      const emptyLineH = baseFontSize * lineHeightRatio;
      if (!inFixedBox) {
        ensureSpace(emptyLineH);
        localY = cursorY;
      }
      const drawPage = targetPage || page;
      if (prefix) {
        const pFont = pickFont("sans", baseBold, false);
        drawPage.drawText(toWinAnsiSafe(prefix), {
          x: originX + Math.max(0, indentLeft - 16),
          y: localY - baseFontSize,
          size: baseFontSize,
          font: pFont,
          color: rgb(baseColor[0], baseColor[1], baseColor[2]),
        });
      }
      localY -= emptyLineH + spaceAfter;
      if (!inFixedBox) cursorY = localY;
      return localY;
    }

    const lines = layoutRunsIntoLines(items, maxWidth);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
      const line = lines[lineIdx];
      const maxPt = line.reduce((m, w) => Math.max(m, w.run.fontSize), baseFontSize);
      const lineHeight = maxPt * lineHeightRatio;
      if (!inFixedBox) {
        ensureSpace(lineHeight);
        localY = cursorY;
      }
      const drawPage = targetPage || page;
      const baselineY = localY - maxPt;

      if (quoteBar) {
        drawPage.drawRectangle({
          x: originX + indentLeft - 10,
          y: baselineY - 3,
          width: 2.5,
          height: lineHeight,
          color: rgb(0.78, 0.83, 0.89),
        });
      }

      if (lineIdx === 0 && prefix) {
        const pFont = pickFont("sans", false, false);
        drawPage.drawText(toWinAnsiSafe(prefix), {
          x: originX + Math.max(0, indentLeft - 18),
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

      let x = originX + indentLeft;
      if (align === "center") {
        x += Math.max(0, (maxWidth - totalWidth) / 2);
      } else if (align === "right") {
        x += Math.max(0, maxWidth - totalWidth);
      }

      for (const word of line) {
        const drawW = word.width + (word.isSpace ? extraPerSpace : 0);
        if (word.run.highlight) {
          const [hr, hg, hb] = word.run.highlight;
          drawPage.drawRectangle({
            x,
            y: baselineY - word.run.fontSize * 0.2,
            width: drawW,
            height: word.run.fontSize * 1.15,
            color: rgb(hr, hg, hb),
          });
        }
        if (!word.isSpace && word.text) {
          const [cr, cg, cb] = word.run.color;
          drawPage.drawText(word.text, {
            x,
            y: baselineY,
            size: word.run.fontSize,
            font: word.font,
            color: rgb(cr, cg, cb),
          });
        }
        if (word.run.underline && (!word.isSpace || extraPerSpace === 0)) {
          const [cr, cg, cb] = word.run.color;
          drawPage.drawLine({
            start: { x, y: baselineY - 1.6 },
            end: { x: x + drawW, y: baselineY - 1.6 },
            thickness: Math.max(0.65, word.run.fontSize * 0.055),
            color: rgb(cr, cg, cb),
          });
        }
        if (word.run.strike && !word.isSpace) {
          const [cr, cg, cb] = word.run.color;
          drawPage.drawLine({
            start: { x, y: baselineY + word.run.fontSize * 0.3 },
            end: { x: x + drawW, y: baselineY + word.run.fontSize * 0.3 },
            thickness: Math.max(0.65, word.run.fontSize * 0.055),
            color: rgb(cr, cg, cb),
          });
        }
        x += drawW;
      }

      localY -= lineHeight;
      if (!inFixedBox) cursorY = localY;
    }

    localY -= spaceAfter;
    if (!inFixedBox) cursorY = localY;
    return localY;
  }

  function measureCellBlocksHeight(blocks: DocBlockNode[], innerWidth: number): number {
    let h = 0;
    for (const b of blocks) {
      if (b.type === "paragraph" || b.type === "heading") {
        const baseSz =
          b.type === "heading"
            ? b.attrs.level === 1
              ? 16
              : b.attrs.level === 2
                ? 13.5
                : 11.5
            : 10.5;
        const runs = inlineToRuns(b.content, {
          fontSize: baseSz,
          bold: b.type === "heading",
          color: [0.12, 0.16, 0.22],
        });
        if (runs.length === 0) {
          h += baseSz * 1.4 + 3;
        } else {
          const lines = layoutRunsIntoLines(runs, Math.max(36, innerWidth));
          for (const ln of lines) {
            const maxPt = ln.reduce((m, w) => Math.max(m, w.run.fontSize), baseSz);
            h += maxPt * 1.4;
          }
          h += 3;
        }
      } else if (b.type === "bulletList" || b.type === "orderedList") {
        for (const li of b.content) {
          h += measureCellBlocksHeight(li.content, Math.max(36, innerWidth - 14));
        }
      }
    }
    return Math.max(18, h);
  }

  async function renderBlocks(
    blocks: DocBlockNode[],
    ctx: { indent: number; quote: boolean; listPrefix?: (idx: number) => string },
  ) {
    for (let idx = 0; idx < blocks.length; idx += 1) {
      const block = blocks[idx];
      if (block.type === "paragraph") {
        const variant = block.attrs?.variant || "normal";
        const align = block.attrs?.textAlign || "left";
        const lh = Number(block.attrs?.lineHeight) || 1.48;
        const spAfter =
          typeof block.attrs?.spaceAfter === "number"
            ? block.attrs.spaceAfter
            : ctx.listPrefix
              ? 3
              : 7;
        const prefix = ctx.listPrefix ? ctx.listPrefix(idx) : undefined;
        if (variant === "title") {
          renderStyledParagraph({
            nodes: block.content,
            baseFontSize: 24,
            baseBold: true,
            baseColor: [0.06, 0.09, 0.16],
            align,
            lineHeightRatio: 1.25,
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
            lineHeightRatio: 1.38,
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
            lineHeightRatio: lh,
            indentLeft: ctx.indent,
            spaceBefore: 0,
            spaceAfter: spAfter,
            prefix,
            quoteBar: ctx.quote,
          });
        }
      } else if (block.type === "heading") {
        const level = block.attrs.level;
        const size = level === 1 ? 18 : level === 2 ? 14.5 : 12;
        const before = level === 1 ? 12 : level === 2 ? 10 : 8;
        const lh = Number(block.attrs.lineHeight) || 1.35;
        renderStyledParagraph({
          nodes: block.content,
          baseFontSize: size,
          baseBold: true,
          baseColor: [0.06, 0.09, 0.16],
          align: block.attrs.textAlign || "left",
          lineHeightRatio: lh,
          indentLeft: ctx.indent,
          spaceBefore: before,
          spaceAfter: 5,
          quoteBar: ctx.quote,
        });
      } else if (block.type === "bulletList") {
        for (const li of block.content) {
          await renderBlocks(li.content, {
            indent: ctx.indent + 20,
            quote: ctx.quote,
            listPrefix: (innerIdx) => (innerIdx === 0 ? "\xB7" : ""),
          });
        }
        cursorY -= 4;
      } else if (block.type === "orderedList") {
        const start = block.attrs?.start ?? 1;
        for (let liIdx = 0; liIdx < block.content.length; liIdx += 1) {
          const li = block.content[liIdx];
          const num = start + liIdx;
          await renderBlocks(li.content, {
            indent: ctx.indent + 22,
            quote: ctx.quote,
            listPrefix: (innerIdx) => (innerIdx === 0 ? `${num}.` : ""),
          });
        }
        cursorY -= 4;
      } else if (block.type === "blockquote") {
        await renderBlocks(block.content, {
          indent: ctx.indent + 16,
          quote: true,
        });
        cursorY -= 4;
      } else if (block.type === "table") {
        const rows = block.content || [];
        if (rows.length === 0) continue;
        const colCount = Math.max(
          1,
          ...rows.map((r) =>
            (r.content || []).reduce((sum, c) => sum + (c.attrs?.colspan || 1), 0),
          ),
        );
        const tableAvailW = Math.max(120, contentWidth - ctx.indent);
        const rawColWidths = new Array<number>(colCount).fill(0);
        for (const r of rows) {
          let cIdx = 0;
          for (const c of r.content || []) {
            const span = c.attrs?.colspan || 1;
            if (Array.isArray(c.attrs?.colwidth)) {
              for (let s = 0; s < span && cIdx + s < colCount; s += 1) {
                const wPx = c.attrs.colwidth[s];
                if (wPx && !rawColWidths[cIdx + s]) rawColWidths[cIdx + s] = wPx * 0.75;
              }
            }
            cIdx += span;
          }
        }
        const specifiedTotal = rawColWidths.reduce((a, b) => a + b, 0);
        const unsetCount = rawColWidths.filter((w) => w <= 0).length;
        const fallbackW =
          unsetCount > 0
            ? Math.max(36, (tableAvailW - specifiedTotal) / unsetCount)
            : tableAvailW / colCount;
        const unscaledWidths = rawColWidths.map((w) => (w > 0 ? w : fallbackW));
        const totalUnscaled = unscaledWidths.reduce((a, b) => a + b, 0) || tableAvailW;
        const colWidths = unscaledWidths.map((w) => (w / totalUnscaled) * tableAvailW);

        cursorY -= 4;
        const padX = 6;
        const padY = 5;

        for (const row of rows) {
          const cells = row.content || [];
          let rowHeight = 24;
          let colCursor = 0;
          const cellSpans: Array<{ cell: (typeof cells)[number]; x: number; w: number }> = [];
          for (const cell of cells) {
            const span = Math.max(1, cell.attrs?.colspan || 1);
            let cellW = 0;
            for (let s = 0; s < span && colCursor + s < colCount; s += 1) {
              cellW += colWidths[colCursor + s];
            }
            if (cellW <= 0) cellW = tableAvailW / colCount;
            const innerH = measureCellBlocksHeight(cell.content || [], cellW - padX * 2);
            rowHeight = Math.max(rowHeight, innerH + padY * 2);
            cellSpans.push({ cell, x: marginLeft + ctx.indent + colWidths.slice(0, colCursor).reduce((a, b) => a + b, 0), w: cellW });
            colCursor += span;
          }

          ensureSpace(Math.min(rowHeight, pageHeight - marginTop - marginBottom - 10));
          const rowTopY = cursorY;
          const rowBottomY = rowTopY - rowHeight;

          for (const { cell, x, w } of cellSpans) {
            const isHeader = cell.type === "tableHeader";
            const bgHex = cell.attrs?.backgroundColor || (isHeader ? "#f8fafc" : null);
            if (bgHex) {
              const [br, bg, bb] = hexToRgb01(bgHex, [0.97, 0.98, 0.99]);
              page.drawRectangle({
                x,
                y: rowBottomY,
                width: w,
                height: rowHeight,
                color: rgb(br, bg, bb),
              });
            }
            const [sr, sg, sb] = hexToRgb01(cell.attrs?.borderColor, [0.8, 0.84, 0.88]);
            page.drawRectangle({
              x,
              y: rowBottomY,
              width: w,
              height: rowHeight,
              borderColor: rgb(sr, sg, sb),
              borderWidth: 0.75,
            });

            let cellY = rowTopY - padY;
            for (const cb of cell.content || []) {
              if (cb.type === "paragraph" || cb.type === "heading") {
                const sz =
                  cb.type === "heading"
                    ? cb.attrs.level === 1
                      ? 15
                      : cb.attrs.level === 2
                        ? 13
                        : 11.5
                    : 10.5;
                cellY = renderStyledParagraph({
                  nodes: cb.content,
                  baseFontSize: sz,
                  baseBold: isHeader || cb.type === "heading",
                  baseColor: [0.1, 0.14, 0.2],
                  align: cb.attrs?.textAlign || "left",
                  lineHeightRatio: 1.38,
                  indentLeft: 0,
                  spaceBefore: 0,
                  spaceAfter: 3,
                  boxLeft: x + padX,
                  boxWidth: w - padX * 2,
                  targetPage: page,
                  fixedStartY: cellY,
                });
              }
            }
          }

          cursorY = rowBottomY;
        }
        cursorY -= 8;
      } else if (block.type === "docImage") {
        const embedded = await embedDocImageSource(pdf, block.attrs.src);
        if (!embedded) continue;
        const naturalRatio =
          embedded.width > 0 && embedded.height > 0 ? embedded.height / embedded.width : 0.75;
        const maxImgW = Math.max(60, contentWidth - ctx.indent);
        const wPt = Math.min(maxImgW, Math.max(36, (block.attrs.width || 320) * 0.75));
        const hPt = block.attrs.height
          ? Math.min((wPt / ((block.attrs.width || 320) * 0.75)) * (block.attrs.height * 0.75), pageHeight - marginTop - marginBottom - 16)
          : Math.min(wPt * naturalRatio, pageHeight - marginTop - marginBottom - 16);

        ensureSpace(hPt + 10);
        let drawX = marginLeft + ctx.indent;
        if (block.attrs.wrap === "wrap-right" || block.attrs.align === "right") {
          drawX = marginLeft + contentWidth - wPt;
        } else if (block.attrs.align === "center" && block.attrs.wrap !== "wrap-left") {
          drawX = marginLeft + ctx.indent + Math.max(0, (maxImgW - wPt) / 2);
        }
        page.drawImage(embedded, {
          x: drawX,
          y: cursorY - hPt - 2,
          width: wPt,
          height: hPt,
        });
        cursorY -= hPt + 10;
      } else if (block.type === "horizontalRule") {
        ensureSpace(16);
        cursorY -= 6;
        page.drawLine({
          start: { x: marginLeft + ctx.indent, y: cursorY },
          end: { x: pageWidth - marginRight, y: cursorY },
          thickness: 0.75,
          color: rgb(0.8, 0.84, 0.88),
        });
        cursorY -= 10;
      } else if (block.type === "pageBreak") {
        advanceToNewPage();
      }
    }
  }

  await renderBlocks(doc.content, { indent: 0, quote: false });

  // Ensure pages exist for any shapes or explicitly colored pages beyond flow content
  const shapes: DocShape[] = Array.isArray(doc.shapes) ? doc.shapes : [];
  let maxNeededPageIdx = pages.length - 1;
  for (const s of shapes) {
    if (s.pageIndex > maxNeededPageIdx) maxNeededPageIdx = s.pageIndex;
  }
  while (pages.length <= maxNeededPageIdx) {
    createStyledPage();
  }

  // Draw geometric shapes onto their assigned pages
  for (const s of shapes) {
    const target = pages[Math.min(pages.length - 1, Math.max(0, s.pageIndex || 0))];
    if (!target) continue;
    const x = s.x;
    const w = Math.max(12, s.width);
    const h = Math.max(10, s.height);
    const bottomY = pageHeight - s.y - h;
    const cx = x + w / 2;
    const cy = bottomY + h / 2;
    const angleDeg = -(s.rotation || 0);
    const angleRad = (angleDeg * Math.PI) / 180;

    const hasFill = s.fillColor && s.fillColor !== "transparent" && s.shapeType !== "line" && s.shapeType !== "arrow";
    const hasStroke = s.strokeColor && s.strokeColor !== "transparent" && (s.strokeWidth ?? 2) > 0;
    const [fr, fg, fb] = hexToRgb01(s.fillColor, [0.91, 0.94, 0.99]);
    const [sr, sg, sb] = hexToRgb01(s.strokeColor, [0.1, 0.45, 0.91]);
    const sw = Math.max(0.75, s.strokeWidth ?? 2);

    const drawPolygonPoints = (ptsPdf: Array<{ x: number; y: number }>) => {
      const rotated = ptsPdf.map((pt) => rotatePointAround(pt.x, pt.y, cx, cy, angleRad));
      if (rotated.length < 2) return;
      // Convert PDF bottom-up coords into SVG top-down path relative to (0, pageHeight) for drawSvgPath
      const pathParts = rotated.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${(pageHeight - pt.y).toFixed(2)}`);
      pathParts.push("Z");
      target.drawSvgPath(pathParts.join(" "), {
        x: 0,
        y: pageHeight,
        ...(hasFill ? { color: rgb(fr, fg, fb) } : {}),
        ...(hasStroke ? { borderColor: rgb(sr, sg, sb), borderWidth: sw } : {}),
      });
    };

    if (s.shapeType === "circle" || s.shapeType === "oval") {
      const xScale = s.shapeType === "circle" ? Math.min(w, h) / 2 : w / 2;
      const yScale = s.shapeType === "circle" ? Math.min(w, h) / 2 : h / 2;
      target.drawEllipse({
        x: cx,
        y: cy,
        xScale,
        yScale,
        rotate: degrees(angleDeg),
        ...(hasFill ? { color: rgb(fr, fg, fb) } : {}),
        ...(hasStroke ? { borderColor: rgb(sr, sg, sb), borderWidth: sw } : {}),
      });
    } else if (s.shapeType === "line" || s.shapeType === "arrow") {
      const p1 = rotatePointAround(x + 2, cy, cx, cy, angleRad);
      const p2 = rotatePointAround(x + w - 2, cy, cx, cy, angleRad);
      const strokeCol = hasStroke ? rgb(sr, sg, sb) : rgb(0.1, 0.45, 0.91);
      target.drawLine({
        start: p1,
        end: p2,
        thickness: sw,
        color: strokeCol,
      });
      if (s.shapeType === "arrow") {
        const head = Math.min(12, Math.max(7, sw * 3.2));
        const tip = rotatePointAround(x + w - 2, cy, cx, cy, angleRad);
        const wing1 = rotatePointAround(x + w - 2 - head, cy + head * 0.55, cx, cy, angleRad);
        const wing2 = rotatePointAround(x + w - 2 - head, cy - head * 0.55, cx, cy, angleRad);
        const pStr = `M ${tip.x.toFixed(2)} ${(pageHeight - tip.y).toFixed(2)} L ${wing1.x.toFixed(2)} ${(pageHeight - wing1.y).toFixed(2)} L ${wing2.x.toFixed(2)} ${(pageHeight - wing2.y).toFixed(2)} Z`;
        target.drawSvgPath(pStr, {
          x: 0,
          y: pageHeight,
          color: strokeCol,
        });
      }
    } else if (s.shapeType === "triangle") {
      drawPolygonPoints([
        { x: cx, y: bottomY + h },
        { x: x + w, y: bottomY },
        { x: x, y: bottomY },
      ]);
    } else if (s.shapeType === "diamond") {
      drawPolygonPoints([
        { x: cx, y: bottomY + h },
        { x: x + w, y: cy },
        { x: cx, y: bottomY },
        { x: x, y: cy },
      ]);
    } else if (s.shapeType === "pentagon") {
      drawPolygonPoints([
        { x: cx, y: bottomY + h },
        { x: x + w, y: bottomY + h * 0.62 },
        { x: x + w * 0.81, y: bottomY },
        { x: x + w * 0.19, y: bottomY },
        { x: x, y: bottomY + h * 0.62 },
      ]);
    } else if (s.shapeType === "star") {
      const outerR = Math.min(w, h) / 2;
      const innerR = outerR * 0.42;
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < 10; i += 1) {
        const a = Math.PI / 2 - (i * Math.PI) / 5;
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      drawPolygonPoints(pts);
    } else if (s.shapeType === "callout") {
      const tailH = Math.min(16, h * 0.24);
      const bodyBottom = bottomY + tailH;
      drawPolygonPoints([
        { x, y: bottomY + h },
        { x: x + w, y: bottomY + h },
        { x: x + w, y: bodyBottom },
        { x: x + w * 0.42, y: bodyBottom },
        { x: x + w * 0.24, y: bottomY },
        { x: x + w * 0.28, y: bodyBottom },
        { x, y: bodyBottom },
      ]);
    } else {
      // rectangle or roundedRect
      drawPolygonPoints([
        { x, y: bottomY + h },
        { x: x + w, y: bottomY + h },
        { x: x + w, y: bottomY },
        { x, y: bottomY },
      ]);
    }

    if (s.text && s.shapeType !== "line" && s.shapeType !== "arrow") {
      const safeShapeText = toWinAnsiSafe(s.text).trim();
      if (safeShapeText) {
        const fSz = Math.min(36, Math.max(8, s.fontSize || 11));
        const sFont = fonts.sans.reg;
        const tw = sFont.widthOfTextAtSize(safeShapeText, fSz);
        const [tr, tg, tb] = hexToRgb01(s.textColor, [0.06, 0.09, 0.16]);
        target.drawText(safeShapeText, {
          x: Math.max(x + 4, cx - tw / 2),
          y: cy - fSz * 0.35,
          size: fSz,
          font: sFont,
          color: rgb(tr, tg, tb),
        });
      }
    }
  }

  // Draw Headers, Footers & Page Numbers across all pages
  const totalPages = pages.length;
  const hfFont = fonts.sans.reg;
  const hfSize = 9.5;
  const hfColor = rgb(0.39, 0.45, 0.55);

  for (let pIdx = 0; pIdx < totalPages; pIdx += 1) {
    const p = pages[pIdx];
    const hideFirst = pageSetup.differentFirstPage && pIdx === 0;
    const headerTxt = !hideFirst ? toWinAnsiSafe(pageSetup.headerText || "").trim() : "";
    const footerTxt = !hideFirst ? toWinAnsiSafe(pageSetup.footerText || "").trim() : "";
    const pageNumStr = toWinAnsiSafe(formatDocPageNumber(pageSetup, pIdx, totalPages));

    if (headerTxt) {
      const tw = hfFont.widthOfTextAtSize(headerTxt, hfSize);
      const hx =
        pageSetup.headerAlign === "center"
          ? marginLeft + Math.max(0, (contentWidth - tw) / 2)
          : pageSetup.headerAlign === "right"
            ? pageWidth - marginRight - tw
            : marginLeft;
      p.drawText(headerTxt, {
        x: hx,
        y: pageHeight - Math.max(22, marginTop * 0.55),
        size: hfSize,
        font: hfFont,
        color: hfColor,
      });
    }

    if (footerTxt) {
      const tw = hfFont.widthOfTextAtSize(footerTxt, hfSize);
      const fx =
        pageSetup.footerAlign === "center"
          ? marginLeft + Math.max(0, (contentWidth - tw) / 2)
          : pageSetup.footerAlign === "right"
            ? pageWidth - marginRight - tw
            : marginLeft;
      p.drawText(footerTxt, {
        x: fx,
        y: Math.max(16, marginBottom * 0.45),
        size: hfSize,
        font: hfFont,
        color: hfColor,
      });
    }

    if (pageNumStr) {
      const nw = hfFont.widthOfTextAtSize(pageNumStr, hfSize);
      const pos = pageSetup.pageNumberPosition;
      const isHeader = pos.startsWith("header-");
      const ny = isHeader
        ? pageHeight - Math.max(22, marginTop * 0.55)
        : Math.max(16, marginBottom * 0.45);
      const nx = pos.endsWith("-center")
        ? marginLeft + Math.max(0, (contentWidth - nw) / 2)
        : pos.endsWith("-left")
          ? marginLeft
          : pageWidth - marginRight - nw;
      p.drawText(pageNumStr, {
        x: nx,
        y: ny,
        size: hfSize,
        font: hfFont,
        color: hfColor,
      });
    }
  }

  return pdf.save();
}

export async function downloadDocAsPdf(rawTitle: string, rawDoc: DocContent): Promise<void> {
  const title = cleanDocTitle(rawTitle, { allowEmptyDefault: true });
  const bytes = await buildDocPdfBytes(title, rawDoc);
  const safeFilename =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "document";

  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename}.pdf`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
