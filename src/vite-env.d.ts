/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_PAGES_FUNCTIONS?: string;
  /** Set by the persora-pdfjs-assets Vite plugin: same-origin base for PDF.js support files. */
  readonly VITE_PDFJS_ASSET_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
