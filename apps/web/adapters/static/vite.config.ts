import { staticAdapter } from "@builder.io/qwik-city/adapters/static/vite";
import { extendConfig } from "@builder.io/qwik-city/vite";
import baseConfig from "../../vite.config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default extendConfig(baseConfig as any, () => {
	const here = fileURLToPath(import.meta.url);
	const root = path.resolve(path.dirname(here), "../../");
	const shimServer = path.resolve(root, "src/shims/preact.server.shim.mjs");
	const shimRts = path.resolve(root, "src/shims/preact.rts.shim.mjs");
	return {
		resolve: {
			alias: {
				"preact/compat/server": shimServer,
				"preact/compat/server.mjs": shimServer,
				"preact-render-to-string": shimRts,
				"preact-render-to-string/stream-node": shimRts,
			},
		},
		build: {
			ssr: true,
			// Keep SSR/prerender output separate from client assets
			outDir: "server",
			// Enable sourcemaps for SSR/static build to aid debugging and diagnostics
			sourcemap: true,
			rollupOptions: {
				input: ["@qwik-city-plan"],
			},
		},
		plugins: [
			staticAdapter({
				origin:
					process.env.SITE_ORIGIN ||
					process.env.BASE_URL ||
					"https://example.com",
			}),
		],
	};
});
