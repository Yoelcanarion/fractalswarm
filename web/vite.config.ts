import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The build goes straight into the Python package, which serves it (spec §16).
// `npm run dev` proxies the API to a running `fractalswarm serve`.
//
// `vite build --mode static` is the showcase for GitHub Pages (scripts/build_static_site.py runs it): the same app with a
// shim that answers the `api/...` calls from files (web/src/static/). Its default folder is under dist/, which git
// ignores, so that building it can never overwrite the build the Python package serves; the script passes --outDir.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
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
