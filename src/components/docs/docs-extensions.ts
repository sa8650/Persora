// Persora Docs — TipTap / ProseMirror schema extensions, table commands,
// mark-preserving text case transformation, and real-time multi-page pagination plugin.
import {
  Extension,
  Mark,
  Node,
  callOrReturn,
  getExtensionField,
  mergeAttributes,
  type Editor,
} from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  TableView,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  columnResizing,
  deleteColumn,
  deleteRow,
  deleteTable,
  goToNextCell,
  mergeCells,
  setCellAttr,
  splitCell,
  tableEditing,
  toggleHeaderRow,
} from "@tiptap/pm/tables";
import {
  normalizeFontFamily,
  normalizeFontSize,
  normalizeHexColor,
  normalizeLineHeight,
  resolveFontFamilyCss,
  sanitizeDocHref,
  sanitizeDocImageSrc,
  type DocBlockNode,
  type DocPageDimensions,
  type DocParagraphVariant,
} from "../../../cloudflare/docs-rules.js";
import DocImageNodeView from "./DocImageNodeView";

export const PAGE_GAP_PX = 28;

// ---- Paragraph + Line Spacing ----------------------------------------------

const DocParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      variant: {
        default: "normal",
        parseHTML: (element) => {
          const attr = element.getAttribute("data-doc-style");
          if (attr === "title" || attr === "subtitle") return attr;
          if (element.classList.contains("pd-doc-title")) return "title";
          if (element.classList.contains("pd-doc-subtitle")) return "subtitle";
          return "normal";
        },
        renderHTML: (attributes) => {
          const variant = attributes.variant as DocParagraphVariant | undefined;
          if (variant === "title" || variant === "subtitle") {
            return {
              "data-doc-style": variant,
              class: `pd-doc-${variant}`,
            };
          }
          return {};
        },
      },
      lineHeight: {
        default: null,
        parseHTML: (element) => normalizeLineHeight(element.style.lineHeight),
        renderHTML: (attributes) => {
          const lh = normalizeLineHeight(attributes.lineHeight);
          if (!lh || lh === "1.62") return {};
          return { style: `line-height: ${lh}` };
        },
      },
      spaceAfter: {
        default: null,
        parseHTML: (element) => {
          const mb = element.style.marginBottom;
          if (!mb) return null;
          const n = parseFloat(mb);
          return Number.isFinite(n) ? Math.round(n) : null;
        },
        renderHTML: (attributes) => {
          if (typeof attributes.spaceAfter !== "number") return {};
          return { style: `margin-bottom: ${attributes.spaceAfter}pt` };
        },
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        const { $from, empty } = selection;
        if (!empty) return false;
        const parent = $from.parent;
        if (
          parent.type.name === "paragraph" &&
          (parent.attrs.variant === "title" || parent.attrs.variant === "subtitle") &&
          $from.parentOffset === parent.content.size
        ) {
          return editor
            .chain()
            .splitBlock({ keepMarks: false })
            .updateAttributes("paragraph", { variant: "normal" })
            .run();
        }
        return false;
      },
    };
  },
});

const HeadingLineHeightExtension = Extension.create({
  name: "persoraHeadingSpacing",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => normalizeLineHeight(element.style.lineHeight),
            renderHTML: (attributes) => {
              const lh = normalizeLineHeight(attributes.lineHeight);
              if (!lh) return {};
              return { style: `line-height: ${lh}` };
            },
          },
        },
      },
    ];
  },
});

// ---- Font Size & Font Family on textStyle ----------------------------------

const FontSizeExtension = Extension.create({
  name: "persoraFontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => normalizeFontSize(element.style.fontSize),
            renderHTML: (attributes) => {
              const size = normalizeFontSize(attributes.fontSize);
              if (!size) return {};
              return { style: `font-size: ${size}` };
            },
          },
          fontFamily: {
            default: null,
            parseHTML: (element) =>
              normalizeFontFamily(
                element.getAttribute("data-font-family") || element.style.fontFamily,
              ),
            renderHTML: (attributes) => {
              const id = normalizeFontFamily(attributes.fontFamily);
              const css = resolveFontFamilyCss(id);
              if (!id || !css) return {};
              return {
                "data-font-family": id,
                style: `font-family: ${css}`,
              };
            },
          },
        },
      },
    ];
  },
});

// ---- Inline Comment Anchor Mark --------------------------------------------

const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-comment-id"),
        renderHTML: (attrs) =>
          attrs.commentId ? { "data-comment-id": String(attrs.commentId) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "pd-comment-anchor" }),
      0,
    ];
  },
});

// ---- Explicit Page Break Block ---------------------------------------------

const PageBreakNode = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-doc-page-break="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-doc-page-break": "true",
        class: "pd-explicit-page-break",
        contenteditable: "false",
      }),
      ["span", { class: "pd-explicit-page-break-pill" }, "Page break"],
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": ({ editor }) => {
        if (!editor.isEditable) return false;
        return editor
          .chain()
          .focus()
          .insertContent([{ type: "pageBreak" }, { type: "paragraph" }])
          .run();
      },
    };
  },
});

// ---- Resizable & Wrappable Image Block -------------------------------------

const DocImageNode = Node.create({
  name: "docImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (el) => sanitizeDocImageSrc(el.getAttribute("src")) || "",
      },
      alt: {
        default: "",
        parseHTML: (el) => el.getAttribute("alt") || "",
      },
      width: {
        default: 320,
        parseHTML: (el) => Number(el.getAttribute("width")) || 320,
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const h = Number(el.getAttribute("height"));
          return Number.isFinite(h) && h > 0 ? h : null;
        },
      },
      wrap: {
        default: "inline",
        parseHTML: (el) => el.getAttribute("data-wrap") || "inline",
      },
      align: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-align") || "left",
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocImageNodeView);
  },
});

// ---- ProseMirror Tables (Cell Editing, Column Resizing & Formatting) -------

function cellSharedAttributes() {
  return {
    colspan: {
      default: 1,
      parseHTML: (el: HTMLElement) => Number(el.getAttribute("colspan")) || 1,
      renderHTML: (attrs: Record<string, any>) =>
        attrs.colspan && attrs.colspan > 1 ? { colspan: attrs.colspan } : {},
    },
    rowspan: {
      default: 1,
      parseHTML: (el: HTMLElement) => Number(el.getAttribute("rowspan")) || 1,
      renderHTML: (attrs: Record<string, any>) =>
        attrs.rowspan && attrs.rowspan > 1 ? { rowspan: attrs.rowspan } : {},
    },
    colwidth: {
      default: null,
      parseHTML: (el: HTMLElement) => {
        const attr = el.getAttribute("colwidth");
        if (!attr) return null;
        const nums = attr.split(",").map((s) => Number(s));
        return nums.every((n) => Number.isFinite(n) && n > 0) ? nums : null;
      },
      renderHTML: (attrs: Record<string, any>) => {
        if (!Array.isArray(attrs.colwidth) || attrs.colwidth.length === 0) return {};
        const total = attrs.colwidth.reduce((s: number, w: number) => s + (Number(w) || 0), 0);
        return {
          colwidth: attrs.colwidth.join(","),
          ...(total > 0 ? { style: `min-width: ${total}px` } : {}),
        };
      },
    },
    backgroundColor: {
      default: null,
      parseHTML: (el: HTMLElement) =>
        normalizeHexColor(el.getAttribute("data-bg") || el.style.backgroundColor),
      renderHTML: (attrs: Record<string, any>) => {
        const bg = normalizeHexColor(attrs.backgroundColor);
        if (!bg) return {};
        return {
          "data-bg": bg,
          style: `background-color: ${bg}`,
        };
      },
    },
    borderColor: {
      default: null,
      parseHTML: (el: HTMLElement) => normalizeHexColor(el.getAttribute("data-border")),
      renderHTML: (attrs: Record<string, any>) => {
        const bc = normalizeHexColor(attrs.borderColor);
        if (!bc) return {};
        return {
          "data-border": bc,
          style: `border-color: ${bc}`,
        };
      },
    },
  };
}

declare module "@tiptap/core" {
  interface NodeConfig<Options, Storage> {
    tableRole?:
      | string
      | ((this: {
          name: string;
          options: Options;
          storage: Storage;
        }) => string);
  }
}

const DocTable = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  tableRole: "table",
  isolating: true,

  extendNodeSchema(extension) {
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
    };
    return {
      tableRole: callOrReturn(getExtensionField(extension, "tableRole", context)),
    };
  },

  parseHTML() {
    return [{ tag: "table" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "table",
      mergeAttributes(HTMLAttributes, { class: "pd-doc-table" }),
      ["tbody", 0],
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (!editor.isActive("table")) return false;
        const moved = goToNextCell(1)(editor.state, editor.view.dispatch);
        if (moved) return true;
        // At the last cell of the table, Tab adds a new row and moves into it
        if (addRowAfter(editor.state, editor.view.dispatch)) {
          goToNextCell(1)(editor.state, editor.view.dispatch);
          return true;
        }
        return false;
      },
      "Shift-Tab": ({ editor }) => {
        if (!editor.isActive("table")) return false;
        return goToNextCell(-1)(editor.state, editor.view.dispatch);
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      columnResizing({
        handleWidth: 5,
        cellMinWidth: 48,
        View: TableView,
        lastColumnResizable: true,
      }),
      tableEditing(),
    ];
  },
});

const DocTableRow = Node.create({
  name: "tableRow",
  content: "(tableCell | tableHeader)*",
  tableRole: "row",

  parseHTML() {
    return [{ tag: "tr" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["tr", HTMLAttributes, 0];
  },
});

const DocTableHeader = Node.create({
  name: "tableHeader",
  content: "block+",
  tableRole: "header_cell",
  isolating: true,

  addAttributes() {
    return cellSharedAttributes();
  },

  parseHTML() {
    return [{ tag: "th" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["th", HTMLAttributes, 0];
  },
});

const DocTableCell = Node.create({
  name: "tableCell",
  content: "block+",
  tableRole: "cell",
  isolating: true,

  addAttributes() {
    return cellSharedAttributes();
  },

  parseHTML() {
    return [{ tag: "td" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["td", HTMLAttributes, 0];
  },
});

// ---- Table Helper Commands -------------------------------------------------

export function insertDocTable(
  editor: Editor,
  rows: number,
  cols: number,
  withHeaderRow = true,
): boolean {
  const safeRows = Math.max(1, Math.min(20, Math.round(rows)));
  const safeCols = Math.max(1, Math.min(12, Math.round(cols)));
  const rowNodes = Array.from({ length: safeRows }, (_, rIdx) => ({
    type: "tableRow",
    content: Array.from({ length: safeCols }, () => ({
      type: withHeaderRow && rIdx === 0 ? "tableHeader" : "tableCell",
      content: [{ type: "paragraph" }],
    })),
  }));

  const insertAt = editor.state.selection.from;
  const ok = editor
    .chain()
    .focus()
    .insertContent([
      {
        type: "table",
        content: rowNodes,
      },
      { type: "paragraph" },
    ])
    .run();

  if (ok) {
    // Move cursor directly into the first cell (row 0, col 0) of the newly inserted table
    const { state, view } = editor;
    let firstCellPos = -1;
    state.doc.nodesBetween(
      Math.max(0, insertAt - 2),
      Math.min(state.doc.content.size, state.selection.to),
      (node, pos) => {
        if (firstCellPos !== -1) return false;
        if (node.type.name === "tableHeader" || node.type.name === "tableCell") {
          firstCellPos = pos + 2; // inside first paragraph of first cell
          return false;
        }
        return true;
      },
    );
    if (firstCellPos !== -1 && firstCellPos <= state.doc.content.size) {
      const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(firstCellPos)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    }
  }
  return ok;
}

export type DocTableCommandId =
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "addColBefore"
  | "addColAfter"
  | "deleteCol"
  | "toggleHeaderRow"
  | "mergeCells"
  | "splitCell"
  | "deleteTable";

export function runDocTableCommand(editor: Editor, cmd: DocTableCommandId): boolean {
  editor.commands.focus();
  const { state } = editor;
  const dispatch = editor.view.dispatch;
  switch (cmd) {
    case "addRowBefore":
      return addRowBefore(state, dispatch);
    case "addRowAfter":
      return addRowAfter(state, dispatch);
    case "deleteRow":
      return deleteRow(state, dispatch);
    case "addColBefore":
      return addColumnBefore(state, dispatch);
    case "addColAfter":
      return addColumnAfter(state, dispatch);
    case "deleteCol":
      return deleteColumn(state, dispatch);
    case "toggleHeaderRow":
      return toggleHeaderRow(state, dispatch);
    case "mergeCells":
      return mergeCells(state, dispatch);
    case "splitCell":
      return splitCell(state, dispatch);
    case "deleteTable":
      return deleteTable(state, dispatch);
    default:
      return false;
  }
}

export function setDocTableCellAttr(
  editor: Editor,
  attrName: "backgroundColor" | "borderColor",
  value: string | null,
): boolean {
  editor.commands.focus();
  return setCellAttr(attrName, value)(editor.state, editor.view.dispatch);
}

// ---- Mark-Preserving Text Case Transformation ------------------------------

export type TextCaseMode = "uppercase" | "lowercase" | "capitalize" | "sentence";

function isWordCharacter(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

function transformStringWithWordState(
  input: string,
  mode: TextCaseMode,
  initialPrevWord: boolean,
  initialSentenceStart = true,
): { output: string; endPrevWord: boolean; endSentenceStart: boolean } {
  if (mode === "uppercase") {
    const chars = Array.from(input);
    const last = chars.length > 0 ? chars[chars.length - 1] : "";
    return {
      output: input.toUpperCase(),
      endPrevWord: last ? isWordCharacter(last) : initialPrevWord,
      endSentenceStart: initialSentenceStart,
    };
  }
  if (mode === "lowercase") {
    const chars = Array.from(input);
    const last = chars.length > 0 ? chars[chars.length - 1] : "";
    return {
      output: input.toLowerCase(),
      endPrevWord: last ? isWordCharacter(last) : initialPrevWord,
      endSentenceStart: initialSentenceStart,
    };
  }
  if (mode === "sentence") {
    let sentenceStart = initialSentenceStart;
    let prevWord = initialPrevWord;
    let out = "";
    for (const ch of Array.from(input)) {
      const wordChar = isWordCharacter(ch);
      if (wordChar) {
        if (sentenceStart) {
          out += ch.toUpperCase();
          sentenceStart = false;
        } else {
          out += ch.toLowerCase();
        }
        prevWord = true;
      } else {
        out += ch;
        if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
          sentenceStart = true;
        }
        prevWord = false;
      }
    }
    return { output: out, endPrevWord: prevWord, endSentenceStart: sentenceStart };
  }

  let prevWord = initialPrevWord;
  let out = "";
  for (const ch of Array.from(input)) {
    const wordChar = isWordCharacter(ch);
    const isInternalApostrophe = prevWord && (ch === "'" || ch === "\u2019");
    if (wordChar) {
      out += prevWord ? ch.toLowerCase() : ch.toUpperCase();
      prevWord = true;
    } else if (isInternalApostrophe) {
      out += ch;
      prevWord = true;
    } else {
      out += ch;
      prevWord = false;
    }
  }
  return { output: out, endPrevWord: prevWord, endSentenceStart: initialSentenceStart };
}

/**
 * Applies UPPERCASE, lowercase, or Capitalize Each Word to the selected range
 * (or the word under the cursor if selection is collapsed) while preserving
 * 100% of inline marks, links, colors, fonts, and block structure.
 */
export function transformEditorTextCase(editor: Editor, mode: TextCaseMode): boolean {
  const { state, view } = editor;
  let { from, to } = state.selection;
  const wasEmpty = from === to;

  if (wasEmpty) {
    // Expand collapsed selection to the word surrounding the cursor
    const $pos = state.selection.$from;
    const parent = $pos.parent;
    if (!parent.isTextblock) return false;
    const blockStart = $pos.start();
    const blockText = parent.textBetween(0, parent.content.size, "\0", "\0");
    const rel = $pos.parentOffset;
    let wStart = rel;
    let wEnd = rel;
    while (wStart > 0 && isWordCharacter(blockText[wStart - 1])) wStart -= 1;
    while (wEnd < blockText.length && isWordCharacter(blockText[wEnd])) wEnd += 1;
    if (wStart === wEnd) return false;
    from = blockStart + wStart;
    to = blockStart + wEnd;
  }

  const replacements: Array<{
    from: number;
    to: number;
    text: string;
    marks: readonly any[];
  }> = [];

  let prevWordInBlock = false;
  let sentenceStartInBlock = true;
  let currentBlockPos = -1;

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      currentBlockPos = pos;
      prevWordInBlock = false;
      sentenceStartInBlock = true;
      // Check character immediately before `from` if `from` starts inside this textblock
      if (from > pos + 1) {
        const beforeText = state.doc.textBetween(pos + 1, from, "", "");
        const beforeChar = state.doc.textBetween(from - 1, from, "", "");
        prevWordInBlock = Boolean(beforeChar && isWordCharacter(beforeChar));
        const trimmedBefore = beforeText.trimEnd();
        if (trimmedBefore.length > 0) {
          const lastNonSpace = trimmedBefore[trimmedBefore.length - 1];
          sentenceStartInBlock =
            lastNonSpace === "." || lastNonSpace === "!" || lastNonSpace === "?";
        }
      }
      return true;
    }
    if (node.isText && typeof node.text === "string" && currentBlockPos !== -1) {
      const nodeStart = pos;
      const sliceStart = Math.max(0, from - nodeStart);
      const sliceEnd = Math.min(node.text.length, to - nodeStart);
      if (sliceEnd > sliceStart) {
        const originalSlice = node.text.slice(sliceStart, sliceEnd);
        const { output, endPrevWord, endSentenceStart } = transformStringWithWordState(
          originalSlice,
          mode,
          prevWordInBlock,
          sentenceStartInBlock,
        );
        prevWordInBlock = endPrevWord;
        sentenceStartInBlock = endSentenceStart;
        if (output !== originalSlice) {
          replacements.push({
            from: nodeStart + sliceStart,
            to: nodeStart + sliceEnd,
            text: output,
            marks: node.marks,
          });
        }
      }
      return false;
    }
    return true;
  });

  if (replacements.length === 0) {
    editor.commands.focus();
    return false;
  }

  const tr = state.tr;
  // Apply from end to start so earlier positions never shift
  for (let i = replacements.length - 1; i >= 0; i -= 1) {
    const rep = replacements[i];
    tr.replaceWith(rep.from, rep.to, state.schema.text(rep.text, rep.marks));
  }

  const mappedFrom = tr.mapping.map(from, -1);
  const mappedTo = tr.mapping.map(to, 1);
  if (!wasEmpty) {
    tr.setSelection(TextSelection.between(tr.doc.resolve(mappedFrom), tr.doc.resolve(mappedTo)));
  } else {
    const caret = tr.mapping.map(state.selection.from, 1);
    tr.setSelection(TextSelection.between(tr.doc.resolve(caret), tr.doc.resolve(caret)));
  }

  view.dispatch(tr);
  view.focus();
  return true;
}

// ---- Real-Time Multi-Page Pagination Plugin --------------------------------

interface PageSpacerSpec {
  pos: number;
  heightPx: number;
  kind: "block" | "inline" | "table-row";
  nextPageNumber: number;
}

const paginationPluginKey = new PluginKey<{
  decorations: DecorationSet;
  signature: string;
}>("persoraDocPagination");

function createSpacerDom(spec: PageSpacerSpec): HTMLElement {
  if (spec.kind === "table-row") {
    const tr = document.createElement("tr");
    tr.className = "pd-page-break-spacer pd-table-row-spacer";
    tr.setAttribute("aria-hidden", "true");
    tr.setAttribute("data-next-page", String(spec.nextPageNumber));
    const td = document.createElement("td");
    td.colSpan = 20;
    td.style.height = `${spec.heightPx.toFixed(1)}px`;
    td.style.padding = "0";
    td.style.border = "0";
    td.style.background = "transparent";
    tr.appendChild(td);
    return tr;
  }
  const el = document.createElement(spec.kind === "inline" ? "span" : "div");
  el.className = `pd-page-break-spacer ${spec.kind === "inline" ? "pd-inline-spacer" : "pd-block-spacer"}`;
  el.setAttribute("contenteditable", "false");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-next-page", String(spec.nextPageNumber));
  el.style.height = `${spec.heightPx.toFixed(1)}px`;
  return el;
}

export const PaginationExtension = Extension.create({
  name: "persoraPagination",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paginationPluginKey,
        state: {
          init: () => ({
            decorations: DecorationSet.empty,
            signature: "",
          }),
          apply(tr, prev) {
            const meta = tr.getMeta(paginationPluginKey) as
              | { specs: PageSpacerSpec[]; signature: string }
              | undefined;
            if (meta) {
              const decos = meta.specs.map((spec) =>
                Decoration.widget(spec.pos, () => createSpacerDom(spec), {
                  side: -1,
                  key: `pb-${spec.pos}-${Math.round(spec.heightPx)}-${spec.kind}`,
                }),
              );
              return {
                decorations: DecorationSet.create(tr.doc, decos),
                signature: meta.signature,
              };
            }
            if (tr.docChanged) {
              return {
                decorations: prev.decorations.map(tr.mapping, tr.doc),
                signature: prev.signature,
              };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return paginationPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/**
 * Finds the first inline ProseMirror position within [textStartPos, textEndPos)
 * whose rendered line bottom exceeds `limitRawY` (relative to contentOriginTop).
 */
function findInlineLineOverflowPos(
  view: Editor["view"],
  textStartPos: number,
  textEndPos: number,
  contentOriginTopScreen: number,
  zoom: number,
  limitRawY: number,
): { pos: number; prevLineBottomRaw: number; nextLineTopRaw: number } | null {
  if (textEndPos - textStartPos < 2) return null;

  const measurePos = (pmPos: number): { topRaw: number; bottomRaw: number } | null => {
    try {
      const coords = view.coordsAtPos(pmPos);
      return {
        topRaw: (coords.top - contentOriginTopScreen) / zoom,
        bottomRaw: (coords.bottom - contentOriginTopScreen) / zoom,
      };
    } catch {
      return null;
    }
  };

  const firstCoords = measurePos(textStartPos);
  const lastCoords = measurePos(textEndPos);
  if (!firstCoords || !lastCoords) return null;
  if (lastCoords.bottomRaw <= limitRawY + 0.5) return null;
  if (firstCoords.bottomRaw > limitRawY + 0.5) {
    return {
      pos: textStartPos,
      prevLineBottomRaw: firstCoords.topRaw,
      nextLineTopRaw: firstCoords.topRaw,
    };
  }

  let lo = textStartPos;
  let hi = textEndPos;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const c = measurePos(mid);
    if (!c) break;
    if (c.bottomRaw > limitRawY + 0.5) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  // Snap `hi` back to the start of the overflowing visual line if mid-word
  let lineStart = hi;
  const overflowLine = measurePos(hi);
  if (!overflowLine) return null;

  while (lineStart > textStartPos) {
    const prevC = measurePos(lineStart - 1);
    if (!prevC || prevC.bottomRaw <= limitRawY + 0.5) {
      const prevBottom = prevC ? prevC.bottomRaw : overflowLine.topRaw;
      return {
        pos: lineStart,
        prevLineBottomRaw: prevBottom,
        nextLineTopRaw: overflowLine.topRaw,
      };
    }
    lineStart -= 1;
  }

  return {
    pos: hi,
    prevLineBottomRaw: overflowLine.topRaw,
    nextLineTopRaw: overflowLine.topRaw,
  };
}

export interface PaginationComputationResult {
  pageCount: number;
  activePageIndex: number;
  pageBlocks: DocBlockNode[][];
}

/**
 * Synchronously measures pure flow heights (temporarily hiding existing spacers
 * before browser paint), dispatches exact page-break spacer decorations so content
 * never clips or touches margins/inter-page gaps, and returns pageCount + activePageIndex.
 */
export function recomputeEditorPagination(
  editor: Editor,
  dims: DocPageDimensions,
  zoomScale: number,
  sanitizedBlocks?: DocBlockNode[],
): PaginationComputationResult {
  const { view, state } = editor;
  const pmEl = view.dom as HTMLElement | null;
  const safeZoom = Number.isFinite(zoomScale) && zoomScale > 0.1 ? zoomScale : 1;
  const bodyHeightPx = Math.max(160, dims.heightPx - dims.marginTopPx - dims.marginBottomPx);
  const breakGapPx = dims.marginBottomPx + PAGE_GAP_PX + dims.marginTopPx;
  const pageStridePx = dims.heightPx + PAGE_GAP_PX;

  if (!pmEl || !pmEl.isConnected) {
    return {
      pageCount: 1,
      activePageIndex: 0,
      pageBlocks: sanitizedBlocks ? [sanitizedBlocks] : [[]],
    };
  }

  pmEl.classList.add("pd-measuring");
  const specs: PageSpacerSpec[] = [];
  const topBlockStartPage: number[] = [];

  try {
    const pmRect = pmEl.getBoundingClientRect();
    const contentOriginTopScreen = pmRect.top + dims.marginTopPx * safeZoom;

    let pageIdx = 0;
    let pageStartRawY = 0;
    let prevBottomRaw = 0;
    let prevMarginBottom = 0;

    state.doc.forEach((topNode, offset, blockIndex) => {
      const domNode = view.nodeDOM(offset) as HTMLElement | null;
      if (!domNode || typeof domNode.getBoundingClientRect !== "function") {
        topBlockStartPage[blockIndex] = pageIdx;
        return;
      }

      if (topNode.type.name === "pageBreak") {
        topBlockStartPage[blockIndex] = pageIdx;
        const rect = domNode.getBoundingClientRect();
        const bottomRaw = (rect.bottom - contentOriginTopScreen) / safeZoom;
        const usedOnPage = Math.max(0, Math.min(bodyHeightPx, bottomRaw - pageStartRawY));
        const spacerHeight = Math.max(8, bodyHeightPx - usedOnPage + breakGapPx);
        pageIdx += 1;
        specs.push({
          pos: offset + topNode.nodeSize,
          heightPx: spacerHeight,
          kind: "block",
          nextPageNumber: pageIdx + 1,
        });
        pageStartRawY = bottomRaw;
        prevBottomRaw = bottomRaw;
        prevMarginBottom = 0;
        return;
      }

      const rect = domNode.getBoundingClientRect();
      const computed = window.getComputedStyle(domNode);
      const marginTop = (parseFloat(computed.marginTop) || 0);
      const marginBottom = (parseFloat(computed.marginBottom) || 0);
      const topRaw = (rect.top - contentOriginTopScreen) / safeZoom;
      const bottomRaw = (rect.bottom - contentOriginTopScreen) / safeZoom;
      const heightPx = Math.max(0, bottomRaw - topRaw);

      // Fits cleanly on current page
      if (bottomRaw - pageStartRawY <= bodyHeightPx + 0.5) {
        topBlockStartPage[blockIndex] = pageIdx;
        prevBottomRaw = bottomRaw;
        prevMarginBottom = marginBottom;
        return;
      }

      // Lists: break cleanly between list items when list spans across a page boundary
      if (topNode.type.name === "bulletList" || topNode.type.name === "orderedList") {
        let liPos = offset + 1;
        let recordedStart = false;
        topNode.forEach((liNode, _liOff, liIdx) => {
          const liDom = view.nodeDOM(liPos) as HTMLElement | null;
          if (liDom && typeof liDom.getBoundingClientRect === "function") {
            const liRect = liDom.getBoundingClientRect();
            const liTopRaw = (liRect.top - contentOriginTopScreen) / safeZoom;
            const liBottomRaw = (liRect.bottom - contentOriginTopScreen) / safeZoom;
            if (liBottomRaw - pageStartRawY > bodyHeightPx + 0.5 && prevBottomRaw > pageStartRawY + 1) {
              const targetBreakPos = liIdx === 0 ? offset : liPos;
              const used = Math.max(0, Math.min(bodyHeightPx, prevBottomRaw - pageStartRawY));
              const rawTargetDist = bodyHeightPx - used + breakGapPx;
              const spacerH =
                liIdx === 0
                  ? Math.max(4, rawTargetDist - prevMarginBottom - marginTop)
                  : Math.max(4, rawTargetDist);
              pageIdx += 1;
              specs.push({
                pos: targetBreakPos,
                heightPx: spacerH,
                kind: "block",
                nextPageNumber: pageIdx + 1,
              });
              pageStartRawY = liTopRaw;
            }
            if (!recordedStart) {
              topBlockStartPage[blockIndex] = pageIdx;
              recordedStart = true;
            }
            prevBottomRaw = liBottomRaw;
            prevMarginBottom = 4;
          }
          liPos += liNode.nodeSize;
        });
        if (!recordedStart) topBlockStartPage[blockIndex] = pageIdx;
        prevBottomRaw = bottomRaw;
        prevMarginBottom = marginBottom;
        return;
      }

      // Tables: if whole table fits on next page, move table cleanly; if taller than 1 page, split between rows
      if (topNode.type.name === "table") {
        if (heightPx <= bodyHeightPx && prevBottomRaw > pageStartRawY + 2) {
          const used = Math.max(0, Math.min(bodyHeightPx, prevBottomRaw - pageStartRawY));
          const spacerH = Math.max(
            4,
            bodyHeightPx - used + breakGapPx - prevMarginBottom - marginTop,
          );
          pageIdx += 1;
          specs.push({
            pos: offset,
            heightPx: spacerH,
            kind: "block",
            nextPageNumber: pageIdx + 1,
          });
          pageStartRawY = topRaw;
          topBlockStartPage[blockIndex] = pageIdx;
          prevBottomRaw = bottomRaw;
          prevMarginBottom = marginBottom;
          return;
        }

        topBlockStartPage[blockIndex] = pageIdx;
        let rowPos = offset + 1;
        topNode.forEach((rowNode, _rOff, rIdx) => {
          const rDom = view.nodeDOM(rowPos) as HTMLElement | null;
          if (rDom && typeof rDom.getBoundingClientRect === "function") {
            const rRect = rDom.getBoundingClientRect();
            const rTopRaw = (rRect.top - contentOriginTopScreen) / safeZoom;
            const rBottomRaw = (rRect.bottom - contentOriginTopScreen) / safeZoom;
            if (rIdx > 0 && rBottomRaw - pageStartRawY > bodyHeightPx + 0.5) {
              const used = Math.max(0, Math.min(bodyHeightPx, prevBottomRaw - pageStartRawY));
              const spacerH = Math.max(4, bodyHeightPx - used + breakGapPx);
              pageIdx += 1;
              specs.push({
                pos: rowPos,
                heightPx: spacerH,
                kind: "table-row",
                nextPageNumber: pageIdx + 1,
              });
              pageStartRawY = rTopRaw;
            }
            prevBottomRaw = rBottomRaw;
          }
          rowPos += rowNode.nodeSize;
        });
        prevBottomRaw = bottomRaw;
        prevMarginBottom = marginBottom;
        return;
      }

      // Headings, images, horizontal rules, or blocks starting near bottom of page (< 40px left):
      // push whole block cleanly to top of next page
      const remainingBeforeBlock = bodyHeightPx - (topRaw - pageStartRawY);
      const isAtomicOrHeading =
        topNode.type.name === "heading" ||
        topNode.type.name === "docImage" ||
        topNode.type.name === "horizontalRule" ||
        !topNode.isTextblock ||
        remainingBeforeBlock < 38;

      if (isAtomicOrHeading && prevBottomRaw > pageStartRawY + 1) {
        const used = Math.max(0, Math.min(bodyHeightPx, prevBottomRaw - pageStartRawY));
        const spacerH = Math.max(
          4,
          bodyHeightPx - used + breakGapPx - prevMarginBottom - marginTop,
        );
        pageIdx += 1;
        specs.push({
          pos: offset,
          heightPx: spacerH,
          kind: "block",
          nextPageNumber: pageIdx + 1,
        });
        pageStartRawY = topRaw;
        topBlockStartPage[blockIndex] = pageIdx;

        // If this textblock is STILL taller than a full page, fall through to inline line-splitting below
        if (!topNode.isTextblock || bottomRaw - pageStartRawY <= bodyHeightPx + 0.5) {
          prevBottomRaw = bottomRaw;
          prevMarginBottom = marginBottom;
          return;
        }
      }

      // Multi-line paragraph splitting across 1 or more page boundaries
      if (topNode.isTextblock && topNode.content.size > 1) {
        let searchStart = offset + 1;
        const textEnd = offset + topNode.nodeSize - 1;
        let recorded = topBlockStartPage[blockIndex] !== undefined;
        let safety = 0;

        while (bottomRaw - pageStartRawY > bodyHeightPx + 0.5 && safety < 40) {
          safety += 1;
          const limitRawY = pageStartRawY + bodyHeightPx;
          const hit = findInlineLineOverflowPos(
            view,
            searchStart,
            textEnd,
            contentOriginTopScreen,
            safeZoom,
            limitRawY,
          );
          if (!hit) break;

          if (hit.pos <= offset + 1 && prevBottomRaw > pageStartRawY + 1) {
            // Even the first line didn't fit on the current page -> break before paragraph
            const used = Math.max(0, Math.min(bodyHeightPx, prevBottomRaw - pageStartRawY));
            const spacerH = Math.max(
              4,
              bodyHeightPx - used + breakGapPx - prevMarginBottom - marginTop,
            );
            pageIdx += 1;
            specs.push({
              pos: offset,
              heightPx: spacerH,
              kind: "block",
              nextPageNumber: pageIdx + 1,
            });
            pageStartRawY = topRaw;
            topBlockStartPage[blockIndex] = pageIdx;
            recorded = true;
            searchStart = offset + 2;
            continue;
          }

          if (!recorded) {
            topBlockStartPage[blockIndex] = pageIdx;
            recorded = true;
          }

          if (hit.pos <= searchStart) {
            searchStart = Math.min(textEnd, hit.pos + 1);
            if (searchStart >= textEnd) break;
          }

          const used = Math.max(0, Math.min(bodyHeightPx, hit.prevLineBottomRaw - pageStartRawY));
          const inlineSpacerH = Math.max(8, bodyHeightPx - used + breakGapPx);
          pageIdx += 1;
          specs.push({
            pos: hit.pos,
            heightPx: inlineSpacerH,
            kind: "inline",
            nextPageNumber: pageIdx + 1,
          });
          pageStartRawY = hit.nextLineTopRaw;
          searchStart = Math.min(textEnd, hit.pos + 1);
          if (searchStart >= textEnd) break;
        }

        if (!recorded) topBlockStartPage[blockIndex] = pageIdx;
        prevBottomRaw = bottomRaw;
        prevMarginBottom = marginBottom;
        return;
      }

      topBlockStartPage[blockIndex] = pageIdx;
      prevBottomRaw = bottomRaw;
      prevMarginBottom = marginBottom;
    });
  } finally {
    pmEl.classList.remove("pd-measuring");
  }

  const pageCount = Math.max(1, ( specs.length > 0 ? specs[specs.length - 1].nextPageNumber : 1 ));
  const signature = specs
    .map((s) => `${s.pos}:${Math.round(s.heightPx)}:${s.kind}`)
    .join("|");
  const prevState = paginationPluginKey.getState(state);
  if (!prevState || prevState.signature !== signature) {
    const tr = state.tr
      .setMeta(paginationPluginKey, { specs, signature })
      .setMeta("addToHistory", false);
    view.dispatch(tr);
  }

  // Compute active page index from current cursor screen coordinates (with spacers applied)
  let activePageIndex = 0;
  try {
    const pmRectAfter = pmEl.getBoundingClientRect();
    const caret = view.coordsAtPos(state.selection.from);
    const yRelStage = (caret.top - pmRectAfter.top) / safeZoom;
    activePageIndex = Math.max(
      0,
      Math.min(pageCount - 1, Math.floor(Math.max(0, yRelStage) / pageStridePx)),
    );
  } catch {
    activePageIndex = 0;
  }

  // Group sanitized blocks by their starting page for Print Preview accuracy
  const pageBlocks: DocBlockNode[][] = Array.from({ length: pageCount }, () => []);
  if (sanitizedBlocks) {
    sanitizedBlocks.forEach((b, idx) => {
      if (b.type === "pageBreak") return;
      const targetP = Math.max(0, Math.min(pageCount - 1, topBlockStartPage[idx] ?? 0));
      pageBlocks[targetP].push(b);
    });
  }

  return {
    pageCount,
    activePageIndex,
    pageBlocks,
  };
}

export function createPersoraDocExtensions() {
  return [
    StarterKit.configure({
      paragraph: false,
      heading: {
        levels: [1, 2, 3],
      },
      codeBlock: false,
      code: false,
    }),
    DocParagraph,
    HeadingLineHeightExtension,
    Underline,
    TextStyle,
    FontSizeExtension,
    Color,
    Highlight.configure({
      multicolor: true,
    }),
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      validate: (href) => Boolean(sanitizeDocHref(href)),
      HTMLAttributes: {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
    CommentMark,
    PageBreakNode,
    DocImageNode,
    DocTable,
    DocTableRow,
    DocTableHeader,
    DocTableCell,
    PaginationExtension,
  ];
}
