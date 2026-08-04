import { defineConfig } from "vitest/config";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // plugin-react and vitest may resolve separate Vite peer copies in a pnpm
  // workspace; the plugin contract is identical at runtime.
  plugins: [react() as unknown as PluginOption],
  build: {
    // Tauri's custom protocol can miss standalone image requests in a transparent
    // WebView. Keep the reference background inside the compiled stylesheet.
    assetsInlineLimit: 1_500_000,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/testSetup.ts",
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**"],
  },
  server: {
    port: 4173,
  },
});
