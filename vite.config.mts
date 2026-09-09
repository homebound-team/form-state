import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // Resolve the `src/...` imports that tsconfig's `paths` allows
  resolve: { alias: { src: fileURLToPath(new URL("./src", import.meta.url)) } },
});
