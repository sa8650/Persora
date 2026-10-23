// Browser engine for PDF Security: qpdf 12 compiled to WebAssembly
// (@mssio/qpdf-wasm, Apache-2.0), running in a module Web Worker. The ~2.2 MB
// wasm and the worker are only downloaded the first time someone locks or
// unlocks a PDF; Vite emits both as hashed assets under /assets/.

import type { QpdfEngine } from "./pdf-security";

let pending: Promise<QpdfEngine> | null = null;

/** Starts (once) and returns the qpdf worker. A failed start is retried on the next call. */
export function loadQpdfEngine(): Promise<QpdfEngine> {
  pending ||= import("@mssio/qpdf-wasm")
    .then(({ createQpdf }) => createQpdf())
    .then((qpdf): QpdfEngine => ({ run: (args, options) => qpdf.run(args, options) }))
    .catch((error: unknown) => {
      pending = null;
      throw error instanceof Error ? error : new Error(String(error));
    });
  return pending;
}
