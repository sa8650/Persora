// Persora Docs — Editable document downloads (.docx OOXML Word, .html, .md, .txt).
// Pure TypeScript with zero external dependencies.
import {
  DOC_FONT_FAMILIES,
  cleanDocTitle,
  escapeDocHtml,
  getDocPageSetup,
  getPageDimensions,
  normalizeFontFamily,
  normalizeFontSize,
  normalizeHexColor,
  renderDocPrintableHtml,
  sanitizeDocContent,
  type DocBlockNode,
  type DocContent,
  type DocInlineNode,
} from "../../cloudflare/docs-rules.js";

export type DocDownloadFormat = "pdf" | "docx" | "html" | "md" | "txt";

// ---- Minimal IEEE 802.3 CRC-32 + STORE ZIP writer for OOXML .docx -----------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildStoreZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const sum = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // Compression method: 0 = STORE
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, sum, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of localParts) {
    out.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    out.set(part, pos);
    pos += part.length;
  }
  out.set(eocd, pos);
  return out;
}

function escapeXml(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(clean, "base64"));
}

function docxFontName(fontId: string | null | undefined): string {
  const norm = normalizeFontFamily(fontId);
  if (!norm) return "Calibri";
  const map: Record<string, string> = {
    sans: "Arial",
    arial: "Arial",
    georgia: "Georgia",
    times: "Times New Roman",
    merriweather: "Cambria",
    trebuchet: "Trebuchet MS",
    verdana: "Verdana",
    mono: "Courier New",
  };
  return map[norm] || DOC_FONT_FAMILIES.find((f) => f.id === norm)?.label || "Calibri";
}

/**
 * Generates a valid Microsoft Word OOXML (.docx) file from sanitized Persora Doc content.
 */
export function buildDocxBytes(rawTitle: string, rawDoc: DocContent): Uint8Array {
  const title = cleanDocTitle(rawTitle, { allowEmptyDefault: true });
  const doc = sanitizeDocContent(rawDoc);
  const setup = getDocPageSetup(doc);
  const dims = getPageDimensions(setup);
  const encoder = new TextEncoder();

  const rels: Array<{ id: string; type: string; target: string; targetMode?: string }> = [
    {
      id: "rIdStyles",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
      target: "styles.xml",
    },
    {
      id: "rIdHeader1",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
      target: "header1.xml",
    },
    {
      id: "rIdFooter1",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
      target: "footer1.xml",
    },
  ];
  const mediaEntries: Array<{ name: string; data: Uint8Array; ext: string }> = [];
  let relSeq = 1;

  function registerLinkRel(href: string): string {
    const id = `rIdLink${relSeq++}`;
    rels.push({
      id,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      target: href,
      targetMode: "External",
    });
    return id;
  }

  function registerImageMedia(src: string): { relId: string; docPrId: number } | null {
    const match = src.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i);
    if (!match) return null;
    const rawMime = match[1].toLowerCase();
    const ext = rawMime === "jpeg" ? "jpg" : rawMime;
    const idx = mediaEntries.length + 1;
    const filename = `image${idx}.${ext}`;
    mediaEntries.push({
      name: `word/media/${filename}`,
      data: decodeBase64(match[2]),
      ext,
    });
    const relId = `rIdImg${relSeq++}`;
    rels.push({
      id: relId,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: `media/${filename}`,
    });
    return { relId, docPrId: idx };
  }

  function renderRunsXml(
    nodes: DocInlineNode[] | undefined,
    defaults: { szHalfPt?: number; bold?: boolean; colorHex?: string },
  ): string {
    if (!nodes || nodes.length === 0) return "";
    let xml = "";
    for (const n of nodes) {
      if (n.type === "hardBreak") {
        xml += "<w:r><w:br/></w:r>";
        continue;
      }
      if (n.type !== "text" || !n.text) continue;

      let bold = Boolean(defaults.bold);
      let italic = false;
      let underline = false;
      let strike = false;
      let colorHex = defaults.colorHex || "";
      let shdHex = "";
      let szHalfPt = defaults.szHalfPt || 22;
      let fontName = "";
      let linkHref = "";

      for (const m of n.marks || []) {
        if (m.type === "bold") bold = true;
        else if (m.type === "italic") italic = true;
        else if (m.type === "underline") underline = true;
        else if (m.type === "strike") strike = true;
        else if (m.type === "textStyle") {
          const c = normalizeHexColor(m.attrs?.color);
          if (c) colorHex = c.slice(1).toUpperCase();
          const sz = normalizeFontSize(m.attrs?.fontSize);
          if (sz) szHalfPt = Math.round(Number(sz.replace("pt", "")) * 2);
          if (m.attrs?.fontFamily) fontName = docxFontName(m.attrs.fontFamily);
        } else if (m.type === "highlight") {
          const hc = normalizeHexColor(m.attrs?.color);
          if (hc) shdHex = hc.slice(1).toUpperCase();
        } else if (m.type === "link" && m.attrs?.href) {
          linkHref = m.attrs.href;
          underline = true;
          if (!colorHex) colorHex = "1A73E8";
        }
      }

      const rPr: string[] = [];
      if (fontName) {
        const ef = escapeXml(fontName);
        rPr.push(`<w:rFonts w:ascii="${ef}" w:hAnsi="${ef}" w:cs="${ef}"/>`);
      }
      if (bold) rPr.push("<w:b/>");
      if (italic) rPr.push("<w:i/>");
      if (underline) rPr.push('<w:u w:val="single"/>');
      if (strike) rPr.push("<w:strike/>");
      if (colorHex) rPr.push(`<w:color w:val="${colorHex}"/>`);
      if (shdHex) rPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shdHex}"/>`);
      if (szHalfPt) {
        rPr.push(`<w:sz w:val="${szHalfPt}"/><w:szCs w:val="${szHalfPt}"/>`);
      }

      const runXml = `<w:r>${rPr.length ? `<w:rPr>${rPr.join("")}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(n.text)}</w:t></w:r>`;
      if (linkHref) {
        const rId = registerLinkRel(linkHref);
        xml += `<w:hyperlink r:id="${rId}">${runXml}</w:hyperlink>`;
      } else {
        xml += runXml;
      }
    }
    return xml;
  }

  function alignToJc(align?: string): string {
    if (align === "center") return "center";
    if (align === "right") return "right";
    if (align === "justify") return "both";
    return "left";
  }

  function renderBlocksXml(blocks: DocBlockNode[], prefix?: (idx: number) => string): string {
    let out = "";
    blocks.forEach((b, idx) => {
      if (b.type === "paragraph") {
        const variant = b.attrs?.variant || "normal";
        const jc = alignToJc(b.attrs?.textAlign);
        const lhRatio = Number(b.attrs?.lineHeight) || 1.5;
        const lineTwips = Math.round(lhRatio * 240);
        const pPr: string[] = [];
        if (variant === "title") pPr.push('<w:pStyle w:val="Title"/>');
        else if (variant === "subtitle") pPr.push('<w:pStyle w:val="Subtitle"/>');
        if (jc !== "left") pPr.push(`<w:jc w:val="${jc}"/>`);
        pPr.push(`<w:spacing w:after="120" w:line="${lineTwips}" w:lineRule="auto"/>`);

        const pfx = prefix ? prefix(idx) : "";
        const pfxRun = pfx
          ? `<w:r><w:t xml:space="preserve">${escapeXml(pfx)} </w:t></w:r>`
          : "";
        const runs = renderRunsXml(b.content, {
          szHalfPt: variant === "title" ? 48 : variant === "subtitle" ? 27 : 22,
          bold: variant === "title",
          colorHex: variant === "subtitle" ? "475569" : "1F2937",
        });
        out += `<w:p><w:pPr>${pPr.join("")}</w:pPr>${pfxRun}${runs}</w:p>`;
      } else if (b.type === "heading") {
        const lvl = b.attrs.level;
        const jc = alignToJc(b.attrs.textAlign);
        const pPr = [`<w:pStyle w:val="Heading${lvl}"/>`];
        if (jc !== "left") pPr.push(`<w:jc w:val="${jc}"/>`);
        pPr.push('<w:spacing w:before="200" w:after="80"/>');
        const runs = renderRunsXml(b.content, {
          szHalfPt: lvl === 1 ? 36 : lvl === 2 ? 29 : 24,
          bold: true,
          colorHex: "0F172A",
        });
        out += `<w:p><w:pPr>${pPr.join("")}</w:pPr>${runs}</w:p>`;
      } else if (b.type === "bulletList") {
        for (const li of b.content) {
          out += renderBlocksXml(li.content, (i) => (i === 0 ? "•" : ""));
        }
      } else if (b.type === "orderedList") {
        const start = b.attrs?.start ?? 1;
        b.content.forEach((li, liIdx) => {
          out += renderBlocksXml(li.content, (i) => (i === 0 ? `${start + liIdx}.` : ""));
        });
      } else if (b.type === "blockquote") {
        out += renderBlocksXml(b.content, () => "│");
      } else if (b.type === "table") {
        const rowsXml = (b.content || [])
          .map((row) => {
            const cellsXml = (row.content || [])
              .map((cell) => {
                const tcPr: string[] = [];
                if (cell.attrs?.colspan && cell.attrs.colspan > 1) {
                  tcPr.push(`<w:gridSpan w:val="${cell.attrs.colspan}"/>`);
                }
                const fill = normalizeHexColor(cell.attrs?.backgroundColor);
                if (fill) {
                  tcPr.push(
                    `<w:shd w:val="clear" w:color="auto" w:fill="${fill.slice(1).toUpperCase()}"/>`,
                  );
                } else if (cell.type === "tableHeader") {
                  tcPr.push('<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>');
                }
                const inner = renderBlocksXml(cell.content || []) || "<w:p/>";
                return `<w:tc>${tcPr.length ? `<w:tcPr>${tcPr.join("")}</w:tcPr>` : ""}${inner}</w:tc>`;
              })
              .join("");
            return `<w:tr>${cellsXml}</w:tr>`;
          })
          .join("");
        out += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr>${rowsXml}</w:tbl>`;
      } else if (b.type === "docImage") {
        const imgReg = registerImageMedia(b.attrs.src);
        if (imgReg) {
          // 1 CSS px (96dpi) = 9525 EMUs
          const cx = Math.round((b.attrs.width || 320) * 9525);
          const cy = Math.round((b.attrs.height || Math.round((b.attrs.width || 320) * 0.7)) * 9525);
          const jc = alignToJc(b.attrs.align);
          out += `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgReg.docPrId}" name="Image ${imgReg.docPrId}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imgReg.docPrId}" name="Image ${imgReg.docPrId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${imgReg.relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
        }
      } else if (b.type === "horizontalRule") {
        out +=
          '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr></w:pPr></w:p>';
      } else if (b.type === "pageBreak") {
        out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
    });
    return out;
  }

  let bodyXml = renderBlocksXml(doc.content);
  if (Array.isArray(doc.shapes) && doc.shapes.length > 0) {
    for (const s of doc.shapes) {
      if (s.text) {
        bodyXml += `<w:p><w:r><w:rPr><w:i/><w:color w:val="334155"/></w:rPr><w:t xml:space="preserve">[Shape: ${escapeXml(s.text)}]</w:t></w:r></w:p>`;
      }
    }
  }

  const pgW = Math.round(dims.widthPt * 20);
  const pgH = Math.round(dims.heightPt * 20);
  const orientAttr = setup.orientation === "landscape" ? ' w:orient="landscape"' : "";
  const mTop = Math.round(setup.margins.top * 20);
  const mBottom = Math.round(setup.margins.bottom * 20);
  const mLeft = Math.round(setup.margins.left * 20);
  const mRight = Math.round(setup.margins.right * 20);
  const firstPageBg = normalizeHexColor(setup.pageColors["0"]);
  const bgXml =
    firstPageBg && firstPageBg !== "#ffffff"
      ? `<w:background w:color="${firstPageBg.slice(1).toUpperCase()}"/>`
      : "";

  const headerPageFields =
    setup.showPageNumbers && setup.pageNumberPosition.startsWith("header-")
      ? '<w:r><w:t xml:space="preserve">  Page </w:t></w:r><w:fldSimple w:instr="PAGE"/>'
      : "";
  const footerPageFields =
    setup.showPageNumbers && setup.pageNumberPosition.startsWith("footer-")
      ? '<w:r><w:t xml:space="preserve">  Page </w:t></w:r><w:fldSimple w:instr="PAGE"/><w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr="NUMPAGES"/>'
      : "";

  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="${alignToJc(setup.headerAlign)}"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${escapeXml(setup.headerText || "")}</w:t></w:r>${headerPageFields}</w:p>
</w:hdr>`;

  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="${alignToJc(setup.footerAlign)}"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${escapeXml(setup.footerText || "")}</w:t></w:r>${footerPageFields}</w:p>
</w:ftr>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${bgXml}
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rIdHeader1"/>
      <w:footerReference w:type="default" r:id="rIdFooter1"/>
      <w:pgSz w:w="${pgW}" w:h="${pgH}"${orientAttr}/>
      <w:pgMar w:top="${mTop}" w:right="${mRight}" w:bottom="${mBottom}" w:left="${mLeft}" w:header="480" w:footer="480" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="475569"/><w:sz w:val="27"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="29"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`;

  const corePropsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>Persora Docs</dc:creator>
</cp:coreProperties>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeXml(r.target)}"${r.targetMode ? ` TargetMode="${r.targetMode}"` : ""}/>`,
    )
    .join("\n  ")}
</Relationships>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Default Extension="webp" ContentType="image/webp"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  return buildStoreZip([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml) },
    { name: "_rels/.rels", data: encoder.encode(rootRelsXml) },
    { name: "docProps/core.xml", data: encoder.encode(corePropsXml) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "word/styles.xml", data: encoder.encode(stylesXml) },
    { name: "word/header1.xml", data: encoder.encode(headerXml) },
    { name: "word/footer1.xml", data: encoder.encode(footerXml) },
    { name: "word/_rels/document.xml.rels", data: encoder.encode(docRelsXml) },
    ...mediaEntries.map((m) => ({ name: m.name, data: m.data })),
  ]);
}

export function buildEditableHtmlDocument(rawTitle: string, rawDoc: DocContent): string {
  const safeDoc = sanitizeDocContent(rawDoc);
  const printable = renderDocPrintableHtml(rawTitle, safeDoc);
  const embeddedJson = escapeDocHtml(JSON.stringify(safeDoc));
  return printable.replace(
    "</body>",
    `<script type="application/persora-doc+json" id="persora-doc-source">${embeddedJson}</script></body>`,
  );
}

function inlineToMarkdown(nodes: DocInlineNode[] | undefined, plain = false): string {
  if (!nodes) return "";
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "\n";
      if (n.type !== "text" || !n.text) return "";
      if (plain) return n.text;
      let t = n.text;
      for (const m of n.marks || []) {
        if (m.type === "bold") t = `**${t}**`;
        else if (m.type === "italic") t = `*${t}*`;
        else if (m.type === "strike") t = `~~${t}~~`;
        else if (m.type === "link" && m.attrs?.href) t = `[${t}](${m.attrs.href})`;
      }
      return t;
    })
    .join("");
}

export function buildTextOrMarkdownDocument(
  rawTitle: string,
  rawDoc: DocContent,
  mode: "md" | "txt",
): string {
  const title = cleanDocTitle(rawTitle, { allowEmptyDefault: true });
  const doc = sanitizeDocContent(rawDoc);
  const plain = mode === "txt";
  const lines: string[] = [plain ? title : `# ${title}`, ""];

  const walk = (blocks: DocBlockNode[], indent = "") => {
    for (const b of blocks) {
      if (b.type === "paragraph") {
        lines.push(`${indent}${inlineToMarkdown(b.content, plain)}`);
        lines.push("");
      } else if (b.type === "heading") {
        const hashes = plain ? "" : `${"#".repeat(b.attrs.level)} `;
        lines.push(`${indent}${hashes}${inlineToMarkdown(b.content, plain)}`);
        lines.push("");
      } else if (b.type === "bulletList") {
        for (const li of b.content) {
          const first = li.content[0];
          if (first && (first.type === "paragraph" || first.type === "heading")) {
            lines.push(`${indent}- ${inlineToMarkdown(first.content, plain)}`);
            walk(li.content.slice(1), `${indent}  `);
          }
        }
        lines.push("");
      } else if (b.type === "orderedList") {
        const start = b.attrs?.start ?? 1;
        b.content.forEach((li, idx) => {
          const first = li.content[0];
          if (first && (first.type === "paragraph" || first.type === "heading")) {
            lines.push(`${indent}${start + idx}. ${inlineToMarkdown(first.content, plain)}`);
            walk(li.content.slice(1), `${indent}   `);
          }
        });
        lines.push("");
      } else if (b.type === "blockquote") {
        for (const inner of b.content) {
          if (inner.type === "paragraph" || inner.type === "heading") {
            lines.push(`${indent}> ${inlineToMarkdown(inner.content, plain)}`);
          }
        }
        lines.push("");
      } else if (b.type === "table") {
        b.content.forEach((row, rIdx) => {
          const cells = row.content.map((c) =>
            c.content
              .map((cb) =>
                cb.type === "paragraph" || cb.type === "heading"
                  ? inlineToMarkdown(cb.content, plain)
                  : "",
              )
              .join(" ")
              .trim(),
          );
          if (plain) {
            lines.push(cells.join("\t"));
          } else {
            lines.push(`| ${cells.join(" | ")} |`);
            if (rIdx === 0) {
              lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
            }
          }
        });
        lines.push("");
      } else if (b.type === "horizontalRule" || b.type === "pageBreak") {
        lines.push(plain ? "----------------------------------------" : "---");
        lines.push("");
      }
    }
  };

  walk(doc.content);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function triggerBlobDownload(bytesOrText: Uint8Array | string, mimeType: string, filename: string) {
  const blob = new Blob([bytesOrText as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function safeBaseFilename(rawTitle: string): string {
  const title = cleanDocTitle(rawTitle, { allowEmptyDefault: true });
  return (
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "document"
  );
}

export function downloadDocAsEditable(
  format: Exclude<DocDownloadFormat, "pdf">,
  rawTitle: string,
  rawDoc: DocContent,
): void {
  const base = safeBaseFilename(rawTitle);
  if (format === "docx") {
    const bytes = buildDocxBytes(rawTitle, rawDoc);
    triggerBlobDownload(
      bytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      `${base}.docx`,
    );
    return;
  }
  if (format === "html") {
    const html = buildEditableHtmlDocument(rawTitle, rawDoc);
    triggerBlobDownload(html, "text/html;charset=utf-8", `${base}.html`);
    return;
  }
  if (format === "md") {
    const md = buildTextOrMarkdownDocument(rawTitle, rawDoc, "md");
    triggerBlobDownload(md, "text/markdown;charset=utf-8", `${base}.md`);
    return;
  }
  const txt = buildTextOrMarkdownDocument(rawTitle, rawDoc, "txt");
  triggerBlobDownload(txt, "text/plain;charset=utf-8", `${base}.txt`);
}
