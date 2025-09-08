import { staticAdapter } from "@builder.io/qwik-city/adapters/static/vite";
import { extendConfig } from "@builder.io/qwik-city/vite";
import baseConfig from "../../vite.config";

export default extendConfig(baseConfig as any, () => {
  return {
    build: {
      ssr: true,
      // Enable sourcemaps for SSR/static build to aid debugging and diagnostics
      sourcemap: true,
      rollupOptions: {
        input: ["@qwik-city-plan"],
      },
    },
    plugins: [
      staticAdapter({
        origin: process.env.SITE_ORIGIN || process.env.BASE_URL || 'https://example.com',
      }),
    ],
  };
});
