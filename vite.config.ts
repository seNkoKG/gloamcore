import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/poe-api": {
        target: "https://poe.ninja",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/poe-api/, ""),
        headers: {
          "User-Agent": "Ninja-Lens (personal economy widget)",
        },
      },
      "/wiki-api": {
        target: "https://www.poewiki.net",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/wiki-api/, ""),
        headers: {
          "User-Agent": "Ninja-Lens (personal economy widget)",
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
