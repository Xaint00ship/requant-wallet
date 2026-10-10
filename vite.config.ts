import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    {
      name: "native-core-worker",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/web/src/service.ts"))
          return code.replace(
            'new URL("./core.worker.ts", import.meta.url)',
            'new URL("../../src/native-core.worker.ts", import.meta.url)',
          );
      },
    },
    react(),
  ],
  clearScreen: false,
  server: {
    port: 3320,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/.build-tools/**", "**/.wallet-test/**", "**/target/**"],
    },
  },
  build: { target: "esnext" },
});
