// Persora Docs — TipTap / ProseMirror schema extensions.
// Minimal, focused set: StarterKit (history, bold, italic, strike, headings 1–3,
// bullet/ordered lists, blockquote, horizontal rule, hard break) + Paragraph
// Title/Subtitle variants + FontSize on TextStyle + Color + Highlight + Underline
// + TextAlign + safe Link.
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import {
  normalizeFontSize,
  sanitizeDocHref,
  type DocParagraphVariant,
} from "../../../cloudflare/docs-rules.js";

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

const FontSizeExtension = Extension.create({
  name: "persoraFontSize",

  addOptions() {
    return {
      types: ["textStyle"],
    };
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
        },
      },
    ];
  },
});

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
  ];
}
