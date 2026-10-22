import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
