import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: "web",
  base: "/wallet/",
  plugins: [react()],
  publicDir: "../public",
  server: {
    host: "127.0.0.1",
    port: 3324,
    strictPort: true,
    proxy: {
      "/wallet-api": { target: "https://requant.network", changeOrigin: true },
      "/telegram-wallet-api": {
        target: "http://127.0.0.1:3313",
        changeOrigin: true,
      },
    },
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        wallet: resolve("web/index.html"),
        telegram: resolve("web/telegram.html"),
        export: resolve("web/export.html"),
      },
    },
  },
});
