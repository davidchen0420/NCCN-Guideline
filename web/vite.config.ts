import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file: the Python bundler injects the guideline data into the
// `/*BUNDLE*/null` placeholder in index.html, so the result works offline from file://.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { target: "es2022", assetsInlineLimit: 100_000_000, cssCodeSplit: false },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
