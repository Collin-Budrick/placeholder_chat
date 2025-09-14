/**
 * WHAT IS THIS FILE?
 *
 * SSR entry point, in all cases the application is rendered outside the browser, this
 * entry point will be the common one.
 *
 * - Server (express, cloudflare...)
 * - npm run start
 * - npm run preview
 * - npm run build
 *
 */
import {
    type RenderToStreamOptions,
    renderToStream,
} from "@builder.io/qwik/server";
import Root from "./root";

/* Server shims removed — components have been refactored to be server-safe.
   If a remaining component accesses window/document unguarded the build
   will show the failing file so it can be fixed with proper guards or
   moved into a client task. */

// Dev-only: optional warn tracing to locate source of JSX warnings.
// Disabled by default; enable by setting VITE_DEBUG_QWIK_WARN=1.
try {
    const dev = import.meta.env.DEV;
    const env = (import.meta as unknown as { env?: Record<string, string> })
        ?.env as Record<string, string> | undefined;
    // Suppress the noisy dev-only skip-render warnings by default in dev.
    const suppressSkip = dev && (env?.VITE_SUPPRESS_QWIK_SKIP_WARN ?? "1") !== "0";
    if (suppressSkip) {
        const origWarn = console.warn.bind(console);
        console.warn = (...args: unknown[]) => {
            try {
                const msg = String(args?.[0] ?? "");
                if (/unsupported value was passed to the JSX/i.test(msg) && /Symbol\(skip render\)/i.test(msg)) {
                    return; // drop
                }
            } catch {}
            return origWarn(...args);
        };
    }
    const enabled = dev && env?.VITE_DEBUG_QWIK_WARN === "1";
    if (enabled) {
        const origWarn = console.warn.bind(console);
        let inWarn = false;
        console.warn = (...args: unknown[]) => {
            try {
                if (inWarn) return origWarn(...args);
                inWarn = true;
                const msg = String(args?.[0] ?? "");
                const isSkip = /\bSymbol\(skip render\)/i.test(msg);
                const isUnsupported = /unsupported value was passed to the JSX/i.test(msg);
                if (isSkip || isUnsupported) {
                    const err = new Error("QWIK JSX skip render trace");
                    origWarn("[trace]", err.stack?.split("\n").slice(0, 8).join("\n"));
                    // Suppress the noisy dev-only warning
                    return;
                }
            } catch {}
            finally {
                inWarn = false;
            }
            return origWarn(...args);
        };
    }
} catch {}

export default function (opts: RenderToStreamOptions) {
    // Server shims removed - rely on component-level guards (typeof window / useTask$)

    return renderToStream(<Root />, {
		...opts,
		// Keep preload pressure conservative; be stricter in production to curb unused JS
		preloader: (() => {
			const base = {
				ssrPreloads: 3,
				ssrPreloadProbability: 0.8,
				maxIdlePreloads: 12,
				preloadProbability: 0.4,
				debug: false,
			};
			if (import.meta.env?.DEV) return base;
			return {
				...base,
				ssrPreloads: 2,
				ssrPreloadProbability: 0.6,
				maxIdlePreloads: 6,
				preloadProbability: 0.25,
			};
		})(),
		// Use default streaming, but leave room for early flushes on first chunk
		streaming: {
			inOrder: { strategy: "auto" },
		},
		// Use container attributes to set attributes on the html tag.
		containerAttributes: {
			lang: "en-us",
			...opts.containerAttributes,
		},
		serverData: {
			...opts.serverData,
		},
	});
}
