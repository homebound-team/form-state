import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the `src/...` imports that tsconfig's `paths` allows
  resolve: { alias: { src: fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/setupTests.ts"],
  },
});
