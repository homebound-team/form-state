import { type StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  // addon-essentials moved into Storybook core; docs is the one piece that stayed a separate addon
  addons: ["@storybook/addon-links", "@storybook/addon-docs"],
  typescript: { check: false },
  framework: "@storybook/react-vite",
};

export default config;
