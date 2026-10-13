import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    // Raycast ships `main-window.html` + hashed chunks from `frontend/`. Same shape here: a single
    // HTML entry per window plus hashed ES module chunks.
    rollupOptions: {
      input: {
        "main-window": "main-window.html",
        settings: "settings.html",
        hud: "hud.html",
        notes: "notes.html",
      },
    },
  },
  server: {
    port: 5173,
  },
});
