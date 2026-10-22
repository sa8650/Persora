import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// PDF Studio: PDF.js loads CMaps (CJK text), standard font data, its JPX/JBIG2
// WebAssembly decoders and ICC profiles on demand. They are served from the
// app's own origin under a versioned path (no CDN, cacheable forever) and are
// only requested when a PDF actually needs them.
const PDFJS_DIR = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
const PDFJS_ASSET_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
const PDFJS_MIME: Record<string, string> = { ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf", ".wasm": "application/wasm", ".icc": "application/vnd.iccprofile", ".js": "text/javascript" };
function pdfjsAssets(): Plugin {
  const version = JSON.parse(readFileSync(path.join(PDFJS_DIR, "package.json"), "utf8")).version as string;
  const base = `/pdfjs/${version}/`;
  return {
    name: "persora-pdfjs-assets",
    config: () => ({ define: { "import.meta.env.VITE_PDFJS_ASSET_BASE": JSON.stringify(base) } }),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url || "").split("?")[0];
        if (!url.startsWith(base)) return next();
        const relative = decodeURIComponent(url.slice(base.length));
        const [dir] = relative.split("/");
        const file = path.join(PDFJS_DIR, relative);
        if (!PDFJS_ASSET_DIRS.includes(dir) || !file.startsWith(PDFJS_DIR) || !existsSync(file) || !statSync(file).isFile()) { response.statusCode = 404; response.end(); return; }
        response.setHeader("Content-Type", PDFJS_MIME[path.extname(file)] || "application/octet-stream");
        createReadStream(file).pipe(response);
      });
    },
    generateBundle() {
      for (const dir of PDFJS_ASSET_DIRS) {
        const root = path.join(PDFJS_DIR, dir);
        if (!existsSync(root)) continue;
        for (const name of readdirSync(root)) {
          if (name.startsWith("LICENSE") || name.startsWith("quickjs")) continue; // scripting is never enabled
          this.emitFile({ type: "asset", fileName: `${base.slice(1)}${dir}/${name}`, source: readFileSync(path.join(root, name)) });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Photo Studio's on-device fallback: use ORT's prebuilt ESM bundle so Vite never copies the
      // ~26 MB WebAssembly binary into dist (Cloudflare Pages caps assets at 25 MiB). The runtime
      // fetches its .wasm from VITE_PHOTO_STUDIO_ORT_WASM_BASE (CDN by default) only when needed.
      "onnxruntime-web/webgpu": fileURLToPath(new URL("./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs", import.meta.url)),
    },
  },
  server: { host: "0.0.0.0", allowedHosts: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@supabase/")) return "supabase";
        },
      },
    },
  },
});
