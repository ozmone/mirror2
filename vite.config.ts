import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf("node_modules") === -1) return;
          if (id.indexOf("react") !== -1 || id.indexOf("react-dom") !== -1) return "vendor-react";
          if (id.indexOf("dexie") !== -1) return "vendor-storage";
          if (id.indexOf("lucide-react") !== -1) return "vendor-icons";
          return "vendor";
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});
