import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 期望固定端口 + 严格端口（避免 dev 时端口漂移导致 Rust 端连不上）
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
});
