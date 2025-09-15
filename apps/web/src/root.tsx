import { component$, isDev } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import VelvetteInit from "~/components/integrations/VelvetteInit";
import PWARegister from "~/components/pwa/PWARegister";
import { RouterHead } from "./components/router-head/router-head";
import "./global.css";
// Ensure DaisyUI component styles are present even if Tailwind plugin processing
// is skipped in certain preview/proxy setups.
// Avoid importing the full DaisyUI CSS at runtime to keep CSS lean; Tailwind plugin handles components.

export default component$(() => {
	return (
		<QwikCityProvider>
			<head>
				<meta charSet="utf-8" />
				<meta name="color-scheme" content="dark light" />
				{/* Dev fallback meta description to satisfy audits when route head isn't yet applied */}
				{isDev ? (
					<meta
						name="description"
						content="Fast, modern chat app with Qwik SSR and a Rust gateway."
					/>
				) : null}
				{/* Dev CSP meta: ensure blob: workers allowed even if reverse proxy strips headers */}
				{isDev ? (
					<meta
						httpEquiv="Content-Security-Policy"
						content={[
							"default-src 'self'",
							"base-uri 'self'",
							"object-src 'none'",
							"img-src 'self' data: blob: https:",
							"font-src 'self' data:",
							"style-src 'self' 'unsafe-inline'",
							"script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
							// Allow data: and blob: connects for integrations that fetch inline shaders/text in dev
							"connect-src 'self' data: blob: ws: wss: http: https:",
							"worker-src 'self' blob:",
							"child-src 'self' blob:",
						].join("; ")}
					/>
				) : null}
				{(() => {
					const env = (
						import.meta as unknown as { env?: Record<string, string> }
					)?.env as Record<string, string> | undefined;
					return !isDev && env?.VITE_ENABLE_PWA === "1" ? (
						<link
							rel="manifest"
							href={`${import.meta.env.BASE_URL}manifest.json`}
						/>
					) : null;
				})()}
				{/* Connection hints removed (no external Lottie assets in use) */}
				<RouterHead />
				{/* Dev-only: enhance Qwik WARN logs with stack traces when explicitly enabled */}
				{(() => {
					const env = (
						import.meta as unknown as { env?: Record<string, string> }
					)?.env as Record<string, string> | undefined;
					return isDev && env?.VITE_DEBUG_QWIK_WARN === "1" ? (
						<script src={`${import.meta.env.BASE_URL}debug-warn.js`} defer />
					) : null;
				})()}
				{/* Remove unused third-party preconnects to avoid competing with critical resources */}
				{/* Analytics via Partytown removed; add your own script loader if needed */}
				{/* Optional prefetch for auth route data; opt-in via VITE_PREFETCH_AUTH=1 */}
				{(() => {
					const env = (
						import.meta as unknown as { env?: Record<string, string> }
					)?.env as Record<string, string> | undefined;
					return env?.VITE_PREFETCH_AUTH === "1" ? (
						<>
							<link
								rel="prefetch"
								href="/login/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
							<link
								rel="prefetch"
								href="/signup/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
						</>
					) : null;
				})()}

				{/* Aggressive idle prefetch of common SSG routes; opt-in via VITE_PREFETCH_ALL=1 */}
				{(() => {
					const env = (
						import.meta as unknown as { env?: Record<string, string> }
					)?.env as Record<string, string> | undefined;
					const enabledFlag = env?.VITE_PREFETCH_ALL;
					const isDev = Boolean(env?.DEV ?? true);
					// In dev (including docker:dev), enable aggressive prefetch by default
					// unless VITE_PREFETCH_ALL is explicitly set to "0". In prod, require "1".
					const shouldPrefetch =
						enabledFlag === "1" || (isDev && enabledFlag !== "0");
					return shouldPrefetch ? (
						<>
							<link
								rel="prefetch"
								href="/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
							<link
								rel="prefetch"
								href="/about/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
							<link
								rel="prefetch"
								href="/contact/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
							<link
								rel="prefetch"
								href="/integrations/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
							<link
								rel="prefetch"
								href="/login/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
							<link
								rel="prefetch"
								href="/signup/q-data.json"
								as="fetch"
								crossOrigin="anonymous"
							/>
						</>
					) : null;
				})()}
				{/* Heading defaults moved to global.css to avoid inline <style> and JSX escape warnings. */}
				{/* Load small theme/lang initializer as an external file so a strict CSP can be enforced without inline allowances. */}
				<script src={`${import.meta.env.BASE_URL}theme-init.js`} defer />
			</head>
			<body
				lang="en"
				class="bg-base-100 text-base-content flex min-h-screen flex-col"
			>
				{/* Initialize Velvette page transitions (client-only)
				 * Default: enabled in dev, disabled in prod unless VITE_VELVETTE=1.
				 * This avoids pulling ~200KB Velvette core on first paint in prod.
				 */}
				{(() => {
					const env = (
						import.meta as unknown as { env?: Record<string, string> }
					)?.env as Record<string, string> | undefined;
					const wantProd = env?.VITE_VELVETTE === "1";
					const enable = isDev ? env?.VITE_VELVETTE !== "0" : wantProd;
					return enable ? (
						// @ts-expect-error Qwik client directive
						<VelvetteInit client:idle />
					) : null;
				})()}
        {/* Register the PWA service worker when enabled via env */}
        {(() => {
          const env = (
            import.meta as unknown as { env?: Record<string, string> }
          )?.env as Record<string, string> | undefined;
          return env?.VITE_ENABLE_PWA === "1" ? (
            // @ts-expect-error Qwik client directive
            <PWARegister client:visible />
          ) : null;
        })()}
				{/* RouterOutlet renders routes that include their own #content container.
            Avoid wrapping in another #content to keep View Transitions working. */}
				<RouterOutlet />
			</body>
		</QwikCityProvider>
	);
});
