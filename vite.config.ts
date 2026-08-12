import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/wiki-api": {
        target: "https://www.poewiki.net",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/wiki-api/, ""),
        headers: {
          "User-Agent": "GloamCore (Path of Exile companion)",
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
