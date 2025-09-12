/**
 * This is the base config for vite.
 * When building, the adapter config is used which loads this file and extends it.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { qwikVite } from "@builder.io/qwik/optimizer";
import { qwikCity } from "@builder.io/qwik-city/vite";
import tailwindcss from "@tailwindcss/vite";
import { join } from "path";
import Fonts from "unplugin-fonts/vite";
import Icons from "unplugin-icons/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import pkg from "./package.json";

const require = createRequire(import.meta.url);
type PkgDep = Record<string, string>;
const { dependencies = {}, devDependencies = {} } = pkg as any as {
	dependencies: PkgDep;
	devDependencies: PkgDep;
	[key: string]: unknown;
};
errorOnDuplicatesPkgDeps(devDependencies, dependencies);
/**
 * Note that Vite normally starts from `index.html` but the qwikCity plugin makes start at `src/entry.ssr.tsx` instead.
 */

export default defineConfig(({ command, mode }): UserConfig => {
	const isProdBuild =
		command === "build" &&
		(mode === "production" || process.env.NODE_ENV === "production");
	const isSsgBuild = process.env.BUILD_TARGET === "ssg";
	const extraPlugins: any[] = [];
	// Try to load Preact plugin if present; keep optional to avoid hard failure before deps are installed
	try {
		// @ts-expect-error
		const preact = require("@preact/preset-vite");
		if (preact) extraPlugins.push(preact.default ? preact.default() : preact());
	} catch (e) {
		// Not installed yet; islands using preact/compat will still work after you install deps
	}
	// Enable gzip/deflate in dev to improve Lighthouse in docker:dev and direct 5174 access
	const devCompressPlugin = () => {
		return {
			name: "dev-compression",
			configureServer(server: any) {
				try {
					// eslint-disable-next-line @typescript-eslint/no-var-requires
					const compression = require("compression");
					if (compression) server.middlewares.use(compression());
				} catch {}
			},
		} as any;
	};
	// Add preview-time headers (cache + compression) to improve Lighthouse in preview/proxy setups
	const previewHeadersPlugin = () => {
		return {
			name: "preview-headers",
			// Vite 5/7 preview server hook
			configurePreviewServer(server: any) {
				try {
					// Optional gzip compression for text assets in preview
					// eslint-disable-next-line @typescript-eslint/no-var-requires
					const compression = require("compression");
					if (compression) server.middlewares.use(compression());
				} catch {}
				const assetRe =
					/\.(?:js|mjs|css|json|xml|txt|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|avif|ico|map)$/i;
				server.middlewares.use((req: any, res: any, next: any) => {
					try {
						const url: string = (req.originalUrl || req.url || "/") as string;
						const isAsset =
							assetRe.test(url) ||
							url.startsWith("/assets/") ||
							url.startsWith("/build/");
						if (isAsset) {
							res.setHeader(
								"Cache-Control",
								"public, max-age=31536000, immutable",
							);
						} else {
							res.setHeader(
								"Cache-Control",
								"public, max-age=600, stale-while-revalidate=86400",
							);
						}
						// Helpful defaults
						res.setHeader("Vary", "Accept-Encoding");
						res.setHeader(
							"Strict-Transport-Security",
							"max-age=63072000; includeSubDomains; preload",
						);
						// Security headers for preview (static serving)
						res.setHeader("X-Content-Type-Options", "nosniff");
						res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
						res.setHeader("X-Frame-Options", "DENY");
						res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
						res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
						res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
            const csp = [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline' blob:",
              "connect-src 'self'",
              // Allow Vite/preview to spawn blob: workers (some libs create workers dynamically)
              "worker-src 'self' blob:",
              // Back-compat for old UAs that use child-src for workers
              "child-src 'self' blob:",
            ].join("; ");
						res.setHeader("Content-Security-Policy", csp);
					} catch {}
					next();
				});
			},
		} as any;
	};
	const resolveHttpsOptions = () => {
		// Honor explicit disable first (used by prod preview proxy)
		if (process.env.NO_HTTPS === "1") return false as any;
		// When using mkcert, let the plugin supply the certs
		if (process.env.USE_MKCERT === "1") return true as any;
		const rawKey =
			process.env.DEV_TLS_KEY_FILE ||
			process.env.TLS_KEY_FILE ||
			process.env.SSL_KEY_FILE;
		const rawCert =
			process.env.DEV_TLS_CERT_FILE ||
			process.env.TLS_CERT_FILE ||
			process.env.SSL_CERT_FILE;
		const resolvePath = (p?: string) => {
			if (!p) return null;
			const candidates = [
				p,
				path.resolve(process.cwd(), p),
				p.replace(/^apps[\\/]+web[\\/]+/i, ""),
				path.resolve(process.cwd(), p.replace(/^apps[\\/]+web[\\/]+/i, "")),
			];
			for (const c of candidates) {
				try {
					if (c && fs.existsSync(c)) return c;
				} catch {}
			}
			return null;
		};
		let keyFile = resolvePath(rawKey);
		let certFile = resolvePath(rawCert);

		// Convenience fallback: look for certs in ./certs if env vars are not provided
		if (!keyFile || !certFile) {
			const defaultKeyCandidates = [
				"certs/dev.key",
				"certs/localhost-key.pem",
				"certs/key.pem",
			];
			const defaultCertCandidates = [
				"certs/dev.crt",
				"certs/dev.pem",
				"certs/localhost.crt",
				"certs/localhost.pem",
			];
			keyFile ||= defaultKeyCandidates.map(resolvePath).find(Boolean) as
				| string
				| null;
			certFile ||= defaultCertCandidates.map(resolvePath).find(Boolean) as
				| string
				| null;
		}
    if (keyFile && certFile) {
      try {
        const relKey = path.relative(process.cwd(), keyFile);
        const relCert = path.relative(process.cwd(), certFile);
        // Only announce certs when running the dev server; suppress during vite build/watch and knip runs
        if (command !== "build" && process.env.KNIP !== "1") {
          console.log(`[https] Using TLS key/cert from ${relKey} / ${relCert}`);
        }
      } catch {}
			return {
				key: fs.readFileSync(keyFile),
				cert: fs.readFileSync(certFile),
				minVersion: "TLSv1.2",
				ALPNProtocols: ["http/1.1"],
			} as any;
		}
		try {
			// Fallback: generate an in-memory self-signed cert for localhost
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const selfsigned = require("selfsigned");
			const attrs = [{ name: "commonName", value: "localhost" }];
			const pems = selfsigned.generate(attrs, {
				days: 365,
				keySize: 2048,
				algorithm: "sha256",
				extensions: [
					{
						name: "subjectAltName",
						altNames: [
							{ type: 2, value: "localhost" },
							{ type: 7, ip: "127.0.0.1" },
							{ type: 7, ip: "::1" },
						],
					},
				],
			});
      if (command !== "build" && process.env.KNIP !== "1") {
        console.warn(
          "[https] Using in-memory self-signed development certificate (browser will warn).",
        );
      }
			return {
				key: pems.private,
				cert: pems.cert,
				minVersion: "TLSv1.2",
				ALPNProtocols: ["http/1.1"],
			} as any;
		} catch (_e) {
			// As a last resort, allow Vite/plugin to handle
			return true as any;
		}
	};
	// Optional plugins: load if present
	try {
		// Load PWA only for production client builds (avoid SW caching in dev/SSG)
		if (isProdBuild && !isSsgBuild) {
			// @ts-expect-error
			const { VitePWA } = require("@vite-pwa/qwik");
			extraPlugins.push(VitePWA({ registerType: "auto" }));
		}
	} catch (e) {}
	try {
		if (process.env.USE_MKCERT === "1") {
			// Enable trusted HTTPS in dev using mkcert with optional custom hosts
			// https://github.com/liuweiGL/vite-plugin-mkcert
			// @ts-expect-error
			const mkcert = require("vite-plugin-mkcert");
			const parseHosts = (s?: string) =>
				(s || "")
					.split(/[\s,]+/)
					.map((x: string) => x.trim())
					.filter(Boolean);
			const urlHosts = [
				process.env.VITE_PUBLIC_HOST,
				process.env.WEB_FORCE_URL,
				process.env.DEV_SERVER_URL,
				process.env.LAN_DEV_URL,
			]
				.filter((u): u is string => typeof u === "string" && u.length > 0)
				.map((u) => {
					try {
						// Allow raw hosts as well as full URLs
						return new URL(u).hostname;
					} catch {
						return String(u)
							.replace(/^https?:\/\//, "")
							.replace(/:\d+.*$/, "");
					}
				})
				.filter(Boolean);
			const baseHosts = ["localhost", "127.0.0.1", "::1"];
			const envHosts = parseHosts(process.env.MKCERT_HOSTS);
			// de-duplicate while keeping order: env > urls > base
			const seen = new Set<string>();
			const hosts = [...envHosts, ...urlHosts, ...baseHosts].filter((h) => {
				const k = h.toLowerCase();
				if (seen.has(k)) return false;
				seen.add(k);
				return true;
			});
			const options = { hosts, savePath: "apps/web/certs" } as any;
			extraPlugins.push(
				mkcert.default ? mkcert.default(options) : mkcert(options),
			);
		}
	} catch (e) {}
	try {
		if (command === "build" && process.env.BUILD_TARGET !== "ssg") {
			// @ts-expect-error
			const { visualizer } = require("rollup-plugin-visualizer");
			extraPlugins.push(
				visualizer?.({
					filename: "dist/stats.html",
					template: "treemap",
					gzipSize: true,
					brotliSize: true,
					open: false,
				}) ?? undefined,
			);
		}
	} catch (e) {}
	try {
		// Prefer Traefik for compression in Docker; otherwise, use brotli (optionally gzip) at build time
		if (
			command === "build" &&
			process.env.BUILD_TARGET !== "ssg" &&
			process.env.DOCKER_TRAEFIK !== "1" &&
			process.env.ASSET_COMPRESSION === "1"
		) {
			// @ts-expect-error
			const compression = require("vite-plugin-compression2");
			const wantGzip = process.env.ASSET_GZIP === "1";
			const wantBrotli = process.env.ASSET_BROTLI === "1" || !wantGzip; // default to brotli-only
			if (wantGzip) {
				extraPlugins.push(
					compression.default?.({
						algorithm: "gzip",
						ext: ".gz",
						threshold: 10240,
					}) ??
						compression({ algorithm: "gzip", ext: ".gz", threshold: 10240 }),
				);
			}
			if (wantBrotli) {
				extraPlugins.push(
					compression.default?.({
						algorithm: "brotliCompress",
						ext: ".br",
						threshold: 10240,
					}) ??
						compression({
							algorithm: "brotliCompress",
							ext: ".br",
							threshold: 10240,
						}),
				);
			}
		}
	} catch (e) {}
	try {
		// Opt-in only to avoid extra dev payload unless explicitly enabled
		if (command === "serve" && process.env.VITE_INSPECT === "1") {
			// @ts-expect-error
			const inspect = require("vite-plugin-inspect");
			extraPlugins.push(
				inspect && inspect.default ? inspect.default() : inspect(),
			);
		}
	} catch (e) {}
	try {
		// @ts-expect-error
		const checker = require("vite-plugin-checker");
		if (command === "serve") {
			extraPlugins.push(
				checker.default?.({ typescript: true, eslint: { files: ["./src"] } }) ??
					checker({ typescript: true, eslint: { files: ["./src"] } }),
			);
		}
	} catch (e) {}
  const tailwindPrewarmPlugin = () => {
    return {
      name: "tailwind-prewarm-global-css",
      apply: "serve",
      configureServer(server: any) {
        const warm = async () => {
          try {
            const cssPath = path.posix.join("/src", "global.css");
            // Trigger transform so Tailwind + DaisyUI run before first navigation
            await server.transformRequest(cssPath);
          } catch {}
        };
        try {
          // Run once server is ready; a short delay avoids race with other plugins
          const t = setTimeout(warm, 200);
          server.httpServer?.once("close", () => clearTimeout(t));
        } catch {}
      },
    } as any;
  };

  const cfg: UserConfig = {
		// Use esbuild to drop dev statements in production builds; disable sourcemaps in dev for lighter responses
		esbuild:
			command === "build"
				? { drop: ["console", "debugger"], legalComments: "none" }
				: { sourcemap: false },
		resolve: {
			alias: {
				// Avoid bundling Node's undici into the browser; map to a tiny shim
				undici: join(__dirname, "src", "shims", "undici.browser.mjs"),
				// React compat to Preact for smaller islands
				react: "preact/compat",
				"react-dom": "preact/compat",
				"react/jsx-runtime": "preact/jsx-runtime",
			},
		},
		// Suppress Vite's informational "externalized for browser compatibility" logs
		// (These are expected when Node built-ins are referenced from server-only modules.)
		logLevel: "warn",
      plugins: [
          qwikCity({ trailingSlash: false }),
          qwikVite(),
          tsconfigPaths({ root: "." }),
          // Tree-shaken icon components via Iconify collections (e.g., ~icons/lucide/home)
          Icons({ compiler: "jsx" }),
          // Warm Tailwind+DaisyUI pipeline so first request doesn't trigger cold compile
          tailwindPrewarmPlugin(),
			// Optional: Preload/inject web fonts (enable by setting USE_FONTS=1)
			...(process.env.USE_FONTS === "1"
				? [
						Fonts({
							google: {
								families: [
									{ name: "Inter", styles: "wght@400;500;600;700" },
									{ name: "JetBrains Mono", styles: "wght@400;600" },
								],
								injectTo: "head-prepend",
							},
						}),
					]
				: []),
			// Only enable Solid plugin if the project has any Solid islands
			...(fs.existsSync(join(__dirname, "src", "solid"))
				? [
						solid({
							ssr: true,
							include: ["src/solid/**/*.{tsx,jsx}"],
						}),
					]
				: []),
			// Add dev compression only when not behind Traefik to avoid double compression.
			...(command === "serve" && process.env.DOCKER_TRAEFIK !== "1"
				? [devCompressPlugin()]
				: []),
			...extraPlugins,
			// Improve cache/compression headers when using `vite preview` or Traefik preview proxy
			previewHeadersPlugin(),
			// Run Tailwind only for the client build to avoid duplicate CSS work/logs in SSG pass
            ...(isSsgBuild ? [] : [tailwindcss()]),
		],
		// This tells Vite which dependencies to pre-build in dev mode.
		optimizeDeps: {
			// Put problematic deps that break bundling here, mostly those with binaries.
			// For example ['better-sqlite3'] if you use that in server functions.
			// Also exclude Qwik core/city so the optimizer can transform $(), component$, etc.
			exclude: [
				"undici",
				"@builder.io/qwik",
				"@builder.io/qwik-city",
				"@modular-forms/qwik",
				"@unpic/qwik",
				// Avoid bringing zod into dev optimizer; we don't use it directly
				"zod",
			],
			// Minify prebundled deps in dev to cut payload size
			esbuildOptions: {
				minify: true,
				sourcemap: false,
				target: "es2020",
			},
			// Force prebundle commonly-used heavy deps (but NOT Qwik packages)
			include: [
				"preact",
				"preact/compat",
				"preact/jsx-runtime",
				"motion",
				"@faker-js/faker",
				"valibot",
			],
		},
		/**
		 * This is an advanced setting. It improves the bundling of your server code. To use it, make sure you understand when your consumed packages are dependencies or dev dependencies. (otherwise things will break in production)
		 */
		// ssr:
		//   command === "build" && mode === "production"
		//     ? {
		//         // All dev dependencies should be bundled in the server build
		//         noExternal: Object.keys(devDependencies),
		//         // Anything marked as a dependency will not be bundled
		//         // These should only be production binary deps (including deps of deps), CLI deps, and their module graph
		//         // If a dep-of-dep needs to be external, add it here
		//         // For example, if something uses `bcrypt` but you don't have it as a dep, you can write
		//         // external: [...Object.keys(dependencies), 'bcrypt']
		//         external: Object.keys(dependencies),
		//       }
		//     : undefined,
		server: {
			host: true,
			// Bind Vite inside container on 5174; Traefik listens on 5173
			port: 5174,
			strictPort: true,
			// Ensure absolute URLs (if generated) use the LAN IP when set
			origin: process.env.PUBLIC_ORIGIN || process.env.LAN_DEV_URL || undefined,
			// Allow LAN-friendly DNS aliases and hosts configured via env
			allowedHosts:
				process.env.DOCKER_TRAEFIK === "1"
					? undefined
					: (() => {
							const parseHost = (u?: string) => {
								if (!u) return null;
								try {
									return new URL(u).hostname;
								} catch {
									return u.replace(/^https?:\/\//, "").replace(/:\d+.*$/, "");
								}
							};
							const envHosts = [
								parseHost(process.env.VITE_PUBLIC_HOST),
								parseHost(process.env.WEB_FORCE_URL),
								parseHost(process.env.DEV_SERVER_URL),
								parseHost(process.env.LAN_DEV_URL),
								parseHost(process.env.PUBLIC_ORIGIN),
								parseHost(process.env.PUBLIC_HOST),
								parseHost(process.env.PUBLIC_IP),
							].filter((v): v is string => !!v && v.length > 0);
							const base = [".nip.io", ".sslip.io", "localhost", "127.0.0.1"];
							const set = new Set<string>(base);
							for (const h of envHosts) set.add(h);
							return Array.from(set);
						})(),
			https: resolveHttpsOptions(),
			headers: (() => {
        const csp = [
          "default-src 'self'",
          // Allow inline for dev only (Vite injects inline scripts and some frameworks emit small inlines)
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
          // HMR/websocket + SSR proxy connections
          "connect-src 'self' ws: wss: http: https:",
          // Styles often use inline during dev (Tailwind, Qwik style injections)
          "style-src 'self' 'unsafe-inline'",
          // Safe asset types
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "object-src 'none'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          // Allow dev-time workers created from blob: URLs (e.g., Vite plugins or libs)
          "worker-src 'self' blob:",
          // Back-compat for old UAs that use child-src for workers
          "child-src 'self' blob:",
        ].join("; ");
				return {
					// Don't cache the server response in dev mode
					"Cache-Control": "public, max-age=0",
					// Add HSTS header (browsers ignore it over HTTP, but Lighthouse checks for presence)
					"Strict-Transport-Security":
						"max-age=63072000; includeSubDomains; preload",
					// Attach a permissive dev CSP to avoid inline/script blocks during HMR
					"Content-Security-Policy": csp,
				} as Record<string, string>;
			})(),
			// Allow HMR over tunnels if provided via env
			// Allow disabling HMR (and its WebSocket) to verify bfcache locally
			// Usage: NO_HMR=1 npm run dev:web
			hmr:
				process.env.NO_HMR === "1"
					? false
					: process.env.DOCKER_TRAEFIK === "1"
						? {
								protocol: "wss",
								// omit host so the client uses window.location.hostname
								clientPort: 5173, // Traefik public port
								port: 5174, // internal Vite port
								overlay: false,
							}
						: process.env.VITE_PUBLIC_HOST
							? {
									host: process.env.VITE_PUBLIC_HOST.replace(
										/^https?:\/\//,
										"",
									).replace(/\/$/, ""),
									protocol: "wss",
									clientPort: 443,
									overlay: false,
								}
							: { overlay: false },
			// Improve reliability of file watching on Windows/WSL bind mounts
			watch: {
				// Prefer native FS events; fall back to polling in Docker or when explicitly requested
				usePolling:
					process.env.DOCKER_TRAEFIK === "1" || process.env.USE_POLLING === "1",
				// Relax polling interval to reduce CPU load on Windows/Docker bind mounts
				interval: Number(
					process.env.VITE_WATCH_INTERVAL_MS ||
						process.env.POLL_INTERVAL_MS ||
						"350",
				),
			},
			// Dev proxy: forward /api and /ws to the gateway to avoid CORS and to make
			// browser-origin requests reach the backend during development.
			proxy: (() => {
				const inDockerTraefik = process.env.DOCKER_TRAEFIK === "1";
				const httpTarget = inDockerTraefik
					? "http://gateway:7000"
					: "http://127.0.0.1:7000";
				const wsTarget = inDockerTraefik
					? "ws://gateway:7000"
					: "ws://127.0.0.1:7000";
				return {
					"/api": {
						target: httpTarget,
						changeOrigin: true,
						secure: false,
					},
					"/ws": {
						target: wsTarget,
						changeOrigin: true,
						ws: true,
					},
				} as any;
			})(),
		},
		preview: {
			host: true,
			https: resolveHttpsOptions(),
			headers: {
				// Do cache the server response in preview (non-adapter production build)
				"Cache-Control": "public, max-age=600",
				// Add HSTS header for preview as well
				"Strict-Transport-Security":
					"max-age=63072000; includeSubDomains; preload",
			},
		},
		build: {
			// Emit modern JS for modern browsers
			target: "es2022",
			// Disable sourcemaps in production to cut bundle weight and leak risk.
			// Keep for debug builds only (non-production modes).
			sourcemap:
				command === "build"
					? mode !== "production" && process.env.VITE_SOURCEMAPS !== "0"
					: false,
			// Avoid nuking dist when using parallel --watch processes (client + SSG)
			emptyOutDir: process.env.VITE_WATCH === "1" ? false : true,
			// Reduce spurious warnings and split big vendor deps
			chunkSizeWarningLimit: 4096,
			rollupOptions: {
				// Be a bit more aggressive with treeshaking for internal modules only
				treeshake: { moduleSideEffects: "no-external" },
				external: (id) => id === "/vendor/lottie-player/lottie-player.esm.js",
				output: {
					manualChunks(id) {
						if (id.includes("node_modules")) {
							// Avoid chunking core Qwik libs to preserve SSR init order
							if (id.includes("@builder.io/")) return undefined;
							// Split Preact + Qwik-React bridge into a dedicated chunk, so it's fetched only when a Preact island runs
							if (
								id.includes("preact") ||
								id.includes("@preact") ||
								id.includes("/preact/compat") ||
								id.includes("@builder.io/qwik-react")
							)
								return "vendor-preact";
							// Split icon library to keep core smaller
							// Split icon library chunk when present; handled by unplugin-icons virtual imports
							// Keep any transitive zod usage isolated from core bundles
							if (id.includes("zod")) return "vendor-zod";
							if (id.includes("lottie-web")) return "vendor-lottie";
							if (id.includes("@modular-forms")) return "vendor-mod-forms";
							if (id.includes("valibot")) return "vendor-valibot";
							return "vendor";
						}
					},
				},
			},
		},
		// Disable CSS sourcemaps in dev to reduce served bytes
		css: { devSourcemap: false },
	};

  try {
    // Only log server config in non-build commands; suppress during knip
    if (command !== "build" && process.env.KNIP !== "1") {
      const httpsVal: any = (cfg as any)?.server?.https;
      const httpsKind =
        httpsVal === true
          ? "mkcert/auto"
          : httpsVal === false || typeof httpsVal === "undefined"
            ? "disabled"
            : "file/selfsigned";
      const hmrConf: any = (cfg as any)?.server?.hmr;
      const hmr =
        hmrConf === false ? "disabled" : JSON.stringify(hmrConf ?? {});
      console.log(
        `[vite-config] server: port=${(cfg as any)?.server?.port} https=${httpsKind} hmr=${hmr} docker_traefik=${process.env.DOCKER_TRAEFIK ?? ""}`,
      );
    }
  } catch {}

	return cfg;
});
// *** utils ***
/**
 * Function to identify duplicate dependencies and throw an error
 * @param {Object} devDependencies - List of development dependencies
 * @param {Object} dependencies - List of production dependencies
 */
function errorOnDuplicatesPkgDeps(
	devDependencies: PkgDep,
	dependencies: PkgDep,
) {
	let msg = "";
	// Create an array 'duplicateDeps' by filtering devDependencies.
	// If a dependency also exists in dependencies, it is considered a duplicate.
	const duplicateDeps = Object.keys(devDependencies).filter(
		(dep) => dependencies[dep],
	);
	// include any known qwik packages
	const qwikPkg = Object.keys(dependencies).filter((value) =>
		/qwik/i.test(value),
	);
	// any errors for missing "qwik-city-plan"
	// [PLUGIN_ERROR]: Invalid module "@qwik-city-plan" is not a valid package
	msg = `Move qwik packages ${qwikPkg.join(", ")} to devDependencies`;
	if (qwikPkg.length > 0) {
		throw new Error(msg);
	}
	// Format the error message with the duplicates list.
	// The `join` function is used to represent the elements of the 'duplicateDeps' array as a comma-separated string.
	msg = `
    Warning: The dependency "${duplicateDeps.join(", ")}" is listed in both "devDependencies" and "dependencies".
    Please move the duplicated dependencies to "devDependencies" only and remove it from "dependencies"
  `;
	// Throw an error with the constructed message.
	if (duplicateDeps.length > 0) {
		throw new Error(msg);
	}
}
