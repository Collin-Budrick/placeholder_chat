import { component$, isDev, Slot } from "@builder.io/qwik";
import type { RequestHandler } from "@builder.io/qwik-city";
import { useLocation } from "@builder.io/qwik-city";
import AuthWarmup from "~/components/AuthWarmup";
import GlassNavBar from "~/components/GlassNavBar";
import SmoothScrollProvider from "~/components/integrations/SmoothScrollProvider";
import ScrollProgress from "~/components/ScrollProgress";
import ScrollReveals from "~/components/ScrollReveals";

/**
 * Layout component: renders the site navigation and a <Slot /> for route content.
 * Uses Auth.js session via the plugin to avoid manual cookie/header juggling.
 */
export default component$(() => {
	// Lenis initialization moved into a leaf provider component (LenisProvider)

	// View transition pre-hydration script removed.
	const env =
		(import.meta as unknown as { env?: Record<string, string> }).env || {};
	const enableSmooth = env.VITE_SMOOTH_SCROLL === "1";
	const enableProgress = env.VITE_SCROLL_PROGRESS === "1";
    // Enable scroll-reveals by default in dev (SSR/HMR), unless explicitly disabled.
    // In prod, require opt-in via VITE_REVEALS=1.
    const enableReveals = env.VITE_REVEALS === "1" || (isDev && env.VITE_REVEALS !== "0");
	const loc = useLocation();
	const path = loc.url.pathname || "/";
	const hideNav =
		path === "/login" ||
		path === "/login/" ||
		path === "/signup" ||
		path === "/signup/" ||
		path === "/integrations" ||
		path === "/integrations/";

	return (
		<>
			{enableProgress && <ScrollProgress client:visible />}
			{enableSmooth ? (
				<SmoothScrollProvider client:idle>
					<main id="content" class="edge-fades flex-1 overflow-auto">
						<div
							id="scroll-inner"
							class="grid min-h-full place-items-center pb-24"
						>
							<Slot />
							{enableReveals && (isDev ? (
								// In dev, hydrate immediately so reveals work reliably with HMR
								// @ts-expect-error Qwik client directive
								<ScrollReveals client:load />
							) : (
								// In prod, hydrate when visible to keep JS minimal
								// @ts-expect-error Qwik client directive
								<ScrollReveals client:visible />
							))}
						</div>
					</main>
				</SmoothScrollProvider>
			) : (
				<main id="content" class="edge-fades flex-1 overflow-auto">
					<div
						id="scroll-inner"
						class="grid min-h-full place-items-center pb-24"
					>
						<Slot />
						{enableReveals && (isDev ? (
							// @ts-expect-error Qwik client directive
							<ScrollReveals client:load />
						) : (
							// @ts-expect-error Qwik client directive
							<ScrollReveals client:visible />
						))}
					</div>
				</main>
			)}
			{/* Overlay-based scroll fades (top/bottom) */}
			<div class="viewport-fade top" aria-hidden="true" />
			<div class="viewport-fade bottom" aria-hidden="true" />
			{/* In production, idle warmup reduces first paint JS; keep eager in dev */}
			{isDev ? (
				// @ts-expect-error Qwik client directive
				<AuthWarmup client:load />
			) : (
				// @ts-expect-error Qwik client directive
				<AuthWarmup client:idle />
			)}
			{
				// New glass top navigation; hydrate on idle to keep auth pages light.
			}
			{/* Render nav in SSR to avoid CLS from late mount; its inner ThemeToggle still hydrates on idle */}
			{!hideNav && <GlassNavBar />}
		</>
	);
});

// Enable static prerendering for all pages under this layout by default.
// Individual routes can still opt-out if needed.
export const prerender = true;

// Restrict which routes are statically generated during the SSG build.
// Avoid pages that require live backend/auth (e.g., /profile, /admin).

// Global security headers and best-practice cache hints
export const onRequest: RequestHandler = (ev) => {
	// Keep onRequest minimal during static generation to avoid interfering with prerender.
	try {
		const url = new URL(ev.request.url);
		const p = url.pathname || "/";
		// Quiet dev/preview SSG pings to avoid SSR logs
		if (p === "/__ssg-ping") {
			try {
				ev.headers.set("Cache-Control", "no-store");
			} catch {}
			try {
				// In Qwik handlers, response helpers return an AbortMessage to be thrown
				// so the handler type remains void.
				// eslint-disable-next-line @typescript-eslint/no-throw-literal
				throw ev.text(204, "");
			} catch {
				return;
			}
		}
		// Cache headers: strong for assets, and warmer for auth pages to improve perceived speed
		// Explicitly set a very long TTL for the favicon to satisfy audits
		if (p === "/favicon.svg") {
			try {
				ev.headers.set("Cache-Control", "public, max-age=31536000, immutable");
			} catch {}
		}
		const isAsset =
			/\.(?:js|mjs|css|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|avif|ico|map)$/i.test(
				p,
			);
		const isQData = p.endsWith("/q-data.json");
		const isAuthPage =
			p === "/login" || p === "/login/" || p === "/signup" || p === "/signup/";
		const isAuthQData =
			p === "/login/q-data.json" || p === "/signup/q-data.json";
		if (isAsset) {
			ev.headers.set("Cache-Control", "public, max-age=31536000, immutable");
		} else if (isAuthQData) {
			// Warm auth data a bit longer so clicking Account feels instant
			ev.headers.set(
				"Cache-Control",
				"public, max-age=600, stale-while-revalidate=604800",
			);
		} else if (isQData) {
			ev.headers.set(
				"Cache-Control",
				"public, max-age=60, stale-while-revalidate=600",
			);
		} else if (isAuthPage) {
			// Cache the HTML for login/signup a bit to avoid refetch hitches between public pages
			ev.headers.set(
				"Cache-Control",
				"public, max-age=600, stale-while-revalidate=604800",
			);
		} else {
			ev.headers.set(
				"Cache-Control",
				"public, max-age=600, stale-while-revalidate=86400",
			);
		}
		// Basic hardening headers (safe during prerender)
		ev.headers.set("X-Content-Type-Options", "nosniff");
		ev.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
		ev.headers.set("X-Frame-Options", "DENY");
		// Security: COOP/COEP for origin isolation (safe for our current asset usage)
		ev.headers.set("Cross-Origin-Opener-Policy", "same-origin");
		ev.headers.set("Cross-Origin-Resource-Policy", "same-origin");
		ev.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
		// CSP: permissive for dev (support Vite HMR inline/eval + WS), stricter for prod/SSG.
		const isDev =
			(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ===
				true || process.env.NODE_ENV !== "production";
		// Build CSP with small deviations for dev and the /integrations route
		const isIntegrations = p === "/integrations" || p === "/integrations/";
		const csp = (
			isDev
				? [
						"default-src 'self'",
						"base-uri 'self'",
						"object-src 'none'",
						"frame-ancestors 'none'",
						// Allow external images in dev for integration demos (e.g., Unsplash)
						"img-src 'self' data: blob: https:",
						"font-src 'self' data:",
						"style-src 'self' 'unsafe-inline'",
						"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
						// Allow data: and blob: for dev integrations that fetch shaders or inline assets
						"connect-src 'self' data: blob: ws: wss: http: https:",
					]
				: [
						"default-src 'self'",
						"base-uri 'self'",
						"object-src 'none'",
						"frame-ancestors 'none'",
						// Allow https images so integrations can load external sources in prod preview too
						"img-src 'self' data: blob: https:",
						"font-src 'self' data:",
						"style-src 'self' 'unsafe-inline'",
						"script-src 'self'",
						// Narrow exception: Permit data/blob connects on the integrations page only
						isIntegrations
							? "connect-src 'self' data: blob:"
							: "connect-src 'self'",
					]
		).join("; ");
		ev.headers.set("Content-Security-Policy", csp);
		// CDN cache hint for edge caches (no impact if no CDN in front)
		if (isAsset) {
			ev.headers.set("Surrogate-Control", "max-age=31536000, immutable");
		} else if (isAuthQData) {
			ev.headers.set("Surrogate-Control", "max-age=1200");
		} else if (isQData) {
			ev.headers.set("Surrogate-Control", "max-age=120");
		} else if (isAuthPage) {
			ev.headers.set("Surrogate-Control", "max-age=1200");
		} else {
			ev.headers.set("Surrogate-Control", "max-age=600");
		}
	} catch {
		// ignore
	}
};

// Explicit list of static routes to prerender at build time
// (handy for environments without a crawler during build).
export const onStaticGenerate = async () => {
	const base = [
		"/",
		"/about",
		"/contact",
		"/integrations",
		"/login",
		"/signup",
	];
	try {
		// Highest priority: explicit routes file (written by watcher)
		const file = process?.env?.SSG_ROUTES_FILE as string | undefined;
		if (file) {
			try {
				const { resolve } = await import("node:path");
				const { readFileSync } = await import("node:fs");
				const p = resolve(file);
				const raw = readFileSync(p, "utf8");
				const arr = JSON.parse(raw);
				if (Array.isArray(arr) && arr.length > 0) {
					return {
						routes: Array.from(
							new Set(
								arr.map((s: string) => (s && s[0] !== "/" ? `/${s}` : s)),
							),
						),
					};
				}
			} catch {}
		}
		// Allow partial SSG runs by providing a CSV of routes via env.
		// Examples: SSG_ONLY_ROUTES="/contact" or SSG_ONLY_ROUTES="/about,/contact"
		const onlyRaw = process?.env?.SSG_ONLY_ROUTES || "";
		if (onlyRaw && typeof onlyRaw === "string") {
			const norm = (s: string) => {
				let v = s.trim();
				if (!v) return "";
				if (!v.startsWith("/")) v = `/${v}`;
				// drop trailing slash except for root
				if (v.length > 1 && v.endsWith("/")) v = v.slice(0, -1);
				return v;
			};
			const only = Array.from(
				new Set(
					onlyRaw
						.split(/[\s,]+/)
						.map(norm)
						.filter(Boolean),
				),
			);
			if (only.length > 0) return { routes: only };
		}
	} catch {
		/* ignore */
	}
	return { routes: base };
};
