import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The build goes straight into the Python package, which serves it (spec §16).
// `npm run dev` proxies the API to a running `fractalswarm serve`.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../src/fractalswarm/api/static",
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
});
