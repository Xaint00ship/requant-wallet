import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 3320,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/.build-tools/**", "**/.wallet-test/**", "**/target/**"],
    },
  },
  build: { target: "es2022" },
});
