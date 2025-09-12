import { staticAdapter } from "@builder.io/qwik-city/adapters/static/vite";
import { extendConfig } from "@builder.io/qwik-city/vite";
import baseConfig from "../../vite.config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";

export default extendConfig(baseConfig as any, () => {
	const here = fileURLToPath(import.meta.url);
	const root = path.resolve(path.dirname(here), "../../");
	const shimServer = path.resolve(root, "src/shims/preact.server.shim.mjs");
	const shimRts = path.resolve(root, "src/shims/preact.rts.shim.mjs");
  return {
		resolve: {
			// Use array form to guarantee alias order (specific before generic)
			alias: [
				// Order matters: most specific first
				{ find: "preact-render-to-string/stream-node", replacement: shimRts },
				{ find: "preact-render-to-string/stream", replacement: shimRts },
				{ find: "preact-render-to-string", replacement: shimRts },
				{ find: "preact/compat/server.mjs", replacement: shimServer },
				{ find: "preact/compat/server", replacement: shimServer },
			],
		},
		// Ensure SSR module resolution also honors our shims (with ordering)
		ssr: {
			resolve: {
				alias: [
					// Order matters: most specific first
					{ find: "preact-render-to-string/stream-node", replacement: shimRts },
					{ find: "preact-render-to-string/stream", replacement: shimRts },
					{ find: "preact-render-to-string", replacement: shimRts },
					{ find: "preact/compat/server.mjs", replacement: shimServer },
					{ find: "preact/compat/server", replacement: shimServer },
				],
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
			// Rollup visualizer for SSG/SSR bundle
			visualizer({
				filename: "server/stats-ssg.html",
				template: "treemap",
				gzipSize: true,
				brotliSize: true,
				open: false,
			}),
		],
	};
});
