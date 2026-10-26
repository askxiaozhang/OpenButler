import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 这些是纯函数测试，不需要 DOM
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});