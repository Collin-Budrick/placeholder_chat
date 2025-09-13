/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */

const config = {
  plugins: ["prettier-plugin-tailwindcss"],
  // Align with Biome formatter for consistent diffs
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
};

export default config;
