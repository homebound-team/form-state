import base from "@homebound/eslint-config";
import react from "@homebound/eslint-config/react";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [base, react],
  ignorePatterns: [".yarn/**/*", "dist/**/*"],
});
