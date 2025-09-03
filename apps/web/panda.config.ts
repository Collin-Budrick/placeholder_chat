import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  // Avoid double-reset with Tailwind/Uno
  preflight: false,

  presets: [
    "@pandacss/preset-panda",
  ],

  // Files to scan for style usage
  include: [
    "./src/**/*.{ts,tsx}",
  ],

  // Where to emit css and types
  outdir: "./styled-system",
});

