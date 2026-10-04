import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/.kilo/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
