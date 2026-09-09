import base from "@homebound/eslint-config";
import react from "@homebound/eslint-config/react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [base, react],
  ignorePatterns: [".yarn/**/*", "dist/**/*", "storybook-static/**/*"],
  overrides: [
    // The vitest config imports `vitest/config`, which is not test code leaking into app code
    { files: ["vitest.config.mts"], rules: { "@homebound/prevent-test-file-imports-in-app-code": "off" } },
  ],
});
