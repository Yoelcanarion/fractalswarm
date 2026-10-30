import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

// What the static showcase's page says until its app starts, and for good where its script cannot run: a module script
// does not load from a file, so index.html opened from disk would be a blank page. The app replaces it when it mounts.
const ROOT = '<div id="root"></div>';
const staticPlaceholder: Plugin = {
  name: "static-placeholder",
  transformIndexHtml(html) {
    if (!html.includes(ROOT)) throw new Error(`index.html has no ${ROOT} for the static showcase's placeholder`);
    const say =
      "Loading the static showcase. If this stays empty, the page cannot run from a file: serve this folder (python -m http.server) and open http://localhost:8000/.";
    return html.replace(ROOT, `<div id="root"><p style="margin:0;padding:24px">${say}</p></div>`);
  },
};

// The build goes straight into the Python package, which serves it (spec §16).
// `npm run dev` proxies the API to a running `fractalswarm serve`.
//
// `vite build --mode static` is the showcase for GitHub Pages (scripts/build_static_site.py runs it): the same app with a
// shim that answers the `api/...` calls from files (web/src/static/). Its default folder is under dist/, which git
// ignores, so that building it can never overwrite the build the Python package serves; the script passes --outDir.
export default defineConfig(({ mode }) => ({
  plugins: mode === "static" ? [react(), staticPlaceholder] : [react()],
  base: "./",
  build: {
    outDir: mode === "static" ? "dist/static-site" : "../src/fractalswarm/api/static",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8765", ws: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
