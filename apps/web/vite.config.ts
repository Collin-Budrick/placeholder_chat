/**
 * This is the base config for vite.
 * When building, the adapter config is used which loads this file and extends it.
 */
import { defineConfig, type UserConfig } from "vite";
import { qwikVite } from "@builder.io/qwik/optimizer";
import { qwikCity } from "@builder.io/qwik-city/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import solid from "vite-plugin-solid";
import pkg from "./package.json";
import tailwindcss from "@tailwindcss/vite";
import { partytownVite } from "@qwik.dev/partytown/utils";
import { join } from "path";
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
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
  const extraPlugins: any[] = [];
  const resolveHttpsOptions = () => {
    // Honor explicit disable first (used by prod preview proxy)
    if (process.env.NO_HTTPS === '1') return false as any;
    // When using mkcert, let the plugin supply the certs
    if (process.env.USE_MKCERT === '1') return true as any;
    const rawKey = process.env.DEV_TLS_KEY_FILE || process.env.TLS_KEY_FILE || process.env.SSL_KEY_FILE;
    const rawCert = process.env.DEV_TLS_CERT_FILE || process.env.TLS_CERT_FILE || process.env.SSL_CERT_FILE;
    const resolvePath = (p?: string) => {
      if (!p) return null;
      const candidates = [
        p,
        path.resolve(process.cwd(), p),
        p.replace(/^apps[\\/]+web[\\/]+/i, ''),
        path.resolve(process.cwd(), p.replace(/^apps[\\/]+web[\\/]+/i, '')),
      ];
      for (const c of candidates) {
        try { if (c && fs.existsSync(c)) return c; } catch {}
      }
      return null;
    };
    let keyFile = resolvePath(rawKey);
    let certFile = resolvePath(rawCert);

    // Convenience fallback: look for certs in ./certs if env vars are not provided
    if (!keyFile || !certFile) {
      const defaultKeyCandidates = [
        'certs/dev.key',
        'certs/localhost-key.pem',
        'certs/key.pem',
      ];
      const defaultCertCandidates = [
        'certs/dev.crt',
        'certs/dev.pem',
        'certs/localhost.crt',
        'certs/localhost.pem',
      ];
      keyFile ||= defaultKeyCandidates.map(resolvePath).find(Boolean) as string | null;
      certFile ||= defaultCertCandidates.map(resolvePath).find(Boolean) as string | null;
    }
    if (keyFile && certFile) {
      try {
        const relKey = path.relative(process.cwd(), keyFile);
        const relCert = path.relative(process.cwd(), certFile);
        console.log(`[https] Using TLS key/cert from ${relKey} / ${relCert}`);
      } catch {}
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'] } as any;
    }
    try {
      // Fallback: generate an in-memory self-signed cert for localhost
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const selfsigned = require('selfsigned');
      const attrs = [{ name: 'commonName', value: 'localhost' }];
      const pems = selfsigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [
          {
            name: 'subjectAltName',
            altNames: [
              { type: 2, value: 'localhost' },
              { type: 7, ip: '127.0.0.1' },
              { type: 7, ip: '::1' },
            ],
          },
        ],
      });
      console.warn('[https] Using in-memory self-signed development certificate (browser will warn).');
      return { key: pems.private, cert: pems.cert, minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'] } as any;
    } catch (_e) {
      // As a last resort, allow Vite/plugin to handle
      return true as any;
    }
  };
  // Optional plugins: load if present
  try {
    // @ts-ignore
    const { VitePWA } = require("@vite-pwa/qwik");
    extraPlugins.push(VitePWA({ registerType: "auto" }));
  } catch (e) {}
  try {
    if (process.env.USE_MKCERT === '1') {
      // Enable trusted HTTPS in dev using mkcert with optional custom hosts
      // https://github.com/liuweiGL/vite-plugin-mkcert
      // @ts-ignore
      const mkcert = require('vite-plugin-mkcert');
      const parseHosts = (s?: string) =>
        (s || '')
          .split(/[\s,]+/)
          .map((x: string) => x.trim())
          .filter(Boolean);
      const urlHosts = [
        process.env.VITE_PUBLIC_HOST,
        process.env.WEB_FORCE_URL,
        process.env.DEV_SERVER_URL,
        process.env.LAN_DEV_URL,
      ]
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .map((u) => {
          try {
            // Allow raw hosts as well as full URLs
            return new URL(u).hostname;
          } catch {
            return String(u).replace(/^https?:\/\//, '').replace(/:\d+.*$/, '');
          }
        })
        .filter(Boolean);
      const baseHosts = ['localhost', '127.0.0.1', '::1'];
      const envHosts = parseHosts(process.env.MKCERT_HOSTS);
      // de-duplicate while keeping order: env > urls > base
      const seen = new Set<string>();
      const hosts = [...envHosts, ...urlHosts, ...baseHosts].filter((h) => {
        const k = h.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const options = { hosts, savePath: 'apps/web/certs' } as any;
      extraPlugins.push(mkcert.default ? mkcert.default(options) : mkcert(options));
    }
  } catch (e) {}
  try {
    // @ts-ignore
    const { visualizer } = require('rollup-plugin-visualizer');
    extraPlugins.push(
      visualizer?.({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        open: false,
      }) ?? undefined,
    );
  } catch (e) {}
  try {
    // @ts-ignore
    const compression = require("vite-plugin-compression2");
    extraPlugins.push(
      compression.default?.({
        algorithm: "gzip",
        ext: ".gz",
        threshold: 10240,
      }) ?? compression({ algorithm: "gzip", ext: ".gz", threshold: 10240 }),
    );
  } catch (e) {}
  try {
    // @ts-ignore
    const inspect = require("vite-plugin-inspect");
    extraPlugins.push(
      inspect && inspect.default ? inspect.default() : inspect(),
    );
  } catch (e) {}
  try {
    // @ts-ignore
    const checker = require("vite-plugin-checker");
    if (command === "serve") {
      extraPlugins.push(
        checker.default?.({ typescript: true, eslint: { files: ["./src"] } }) ??
          checker({ typescript: true, eslint: { files: ["./src"] } }),
      );
    }
  } catch (e) {}
  const cfg: UserConfig = {
    // Suppress Vite's informational "externalized for browser compatibility" logs
    // (These are expected when Node built-ins are referenced from server-only modules.)
    logLevel: 'warn',
    plugins: [
      qwikCity(),
      qwikVite(),
      tsconfigPaths({ root: "." }),
      solid({
        ssr: true,
        include: ["src/solid/**/*.{tsx,jsx}"],
      }),
      ...extraPlugins,
      tailwindcss(),
      partytownVite({ dest: join(__dirname, "dist", "~partytown") }),
    ],
    // This tells Vite which dependencies to pre-build in dev mode.
    optimizeDeps: {
      // Put problematic deps that break bundling here, mostly those with binaries.
      // For example ['better-sqlite3'] if you use that in server functions.
      exclude: [],
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
      https: resolveHttpsOptions(),
      headers: {
        // Don't cache the server response in dev mode
        "Cache-Control": "public, max-age=0",
        // Add HSTS header (browsers ignore it over HTTP, but Lighthouse checks for presence)
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      },
      // Allow HMR over tunnels if provided via env
      // Allow disabling HMR (and its WebSocket) to verify bfcache locally
      // Usage: NO_HMR=1 npm run dev:web
      hmr:
        process.env.NO_HMR === '1'
          ? false
          : process.env.DOCKER_TRAEFIK === '1'
            ? {
                protocol: 'wss',
                // omit host so the client uses window.location.hostname
                clientPort: 5173, // Traefik public port
                port: 5174,       // internal Vite port
              }
            : process.env.VITE_PUBLIC_HOST
              ? {
                  host: process.env.VITE_PUBLIC_HOST.replace(/^https?:\/\//, "").replace(/\/$/, ""),
                  protocol: 'wss',
                  clientPort: 443,
                }
              : undefined,
      // Improve reliability of file watching on Windows/WSL bind mounts
      watch: {
        usePolling: true,
        interval: 100,
      },
      // Dev proxy: forward /api and /ws to the gateway to avoid CORS and to make
      // browser-origin requests reach the backend during development.
      proxy: (() => {
        const inDockerTraefik = process.env.DOCKER_TRAEFIK === '1';
        const httpTarget = inDockerTraefik ? 'http://gateway:7000' : 'http://127.0.0.1:7000';
        const wsTarget = inDockerTraefik ? 'ws://gateway:7000' : 'ws://127.0.0.1:7000';
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
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      },
    },
    build: {
      // Generate source maps for production builds to aid debugging and Lighthouse
      sourcemap: true,
      // Reduce spurious warnings and split big vendor deps
      chunkSizeWarningLimit: 4096,
      rollupOptions: {
        external: (id) => id === '/vendor/lottie-player/lottie-player.esm.js',
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // Avoid chunking core Qwik libs to preserve SSR init order
              if (id.includes('@builder.io/')) return undefined;
              if (id.includes('gsap')) return 'vendor-gsap';
              if (id.includes('@lottiefiles')) return 'vendor-lottie';
              if (id.includes('@modular-forms')) return 'vendor-mod-forms';
              if (id.includes('valibot')) return 'vendor-valibot';
              return 'vendor';
            }
          },
        },
      },
    },
  };

  try {
    const httpsKind = cfg.server?.https
      ? (cfg.server.https === true ? 'mkcert/auto' : (cfg.server.https === false ? 'disabled' : 'file/selfsigned'))
      : 'disabled';
    const hmr = cfg.server?.hmr === false ? 'disabled' : JSON.stringify(cfg.server?.hmr ?? {});
    console.log(`[vite-config] server: port=${cfg.server?.port} https=${httpsKind} hmr=${hmr} docker_traefik=${process.env.DOCKER_TRAEFIK ?? ''}`);
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
