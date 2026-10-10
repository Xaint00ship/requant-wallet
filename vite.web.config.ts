import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
    },
    fs: { allow: [".."] },
  },
  build: { outDir: "../dist-web", emptyOutDir: true, target: "esnext" },
});
