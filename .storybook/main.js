module.exports = {
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-links", "@storybook/addon-essentials"],
  typescript: { check: false },

  webpackFinal: async (config) => {
    // Make our `src/...` imports work
    config.resolve.modules.push(__dirname, "./");
    return config;
  },

  framework: {
    name: "@storybook/react-webpack5",
    options: {}
  },

  docs: {
    autodocs: false
  }
};
