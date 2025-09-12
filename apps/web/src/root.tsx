import { component$, isDev } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import VelvetteInit from "~/components/integrations/VelvetteInit";
import { RouterHead } from "./components/router-head/router-head";
import "./global.css";
// Ensure DaisyUI component styles are present even if Tailwind plugin processing
// is skipped in certain preview/proxy setups.
// Avoid importing the full DaisyUI CSS at runtime to keep CSS lean; Tailwind plugin handles components.

export default component$(() => {
	return (
		<QwikCityProvider>
			<head>
				<meta charset="utf-8" />
				<meta name="color-scheme" content="dark light" />
				{/* Dev CSP meta: ensure blob: workers allowed even if reverse proxy strips headers */}
				{isDev && (
					<meta
						http-equiv="Content-Security-Policy"
						content={[
							"default-src 'self'",
							"base-uri 'self'",
							"object-src 'none'",
							"img-src 'self' data: blob: https:",
							"font-src 'self' data:",
							"style-src 'self' 'unsafe-inline'",
							"script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
							"connect-src 'self' ws: wss: http: https:",
							"worker-src 'self' blob:",
							"child-src 'self' blob:",
						].join("; ")}
					/>
				)}
				{!isDev &&
					(import.meta as unknown as { env?: Record<string, string> })?.env
						?.VITE_ENABLE_PWA === "1" && (
						<link
							rel="manifest"
							href={`${import.meta.env.BASE_URL}manifest.json`}
						/>
					)}
				{/* Connection hints removed (no external Lottie assets in use) */}
				<RouterHead />
				{/* Dev-only: enhance Qwik WARN logs with stack traces to locate source */}
				{isDev && (
					<script src={`${import.meta.env.BASE_URL}debug-warn.js`} defer />
				)}
				<link
					rel="preconnect"
					href="https://images.unsplash.com"
					crossOrigin="anonymous"
				/>
				{/* Analytics via Partytown removed; add your own script loader if needed */}
				{/* Optional prefetch for auth route data; opt-in via VITE_PREFETCH_AUTH=1 */}
				{(import.meta as unknown as { env?: Record<string, string> })?.env
					?.VITE_PREFETCH_AUTH === "1" && (
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
				)}
				{/* Heading defaults moved to global.css to avoid inline <style> and JSX escape warnings. */}
				{/* Load small theme/lang initializer as an external file so a strict CSP can be enforced without inline allowances. */}
				<script src={`${import.meta.env.BASE_URL}theme-init.js`} defer />
			</head>
			<body
				lang="en"
				class="min-h-screen flex flex-col bg-base-100 text-base-content"
			>
				{/* Initialize Velvette page transitions (client-only) */}
				<VelvetteInit client:idle />
				{/* RouterOutlet renders routes that include their own #content container.
            Avoid wrapping in another #content to keep View Transitions working. */}
				<RouterOutlet />
			</body>
		</QwikCityProvider>
	);
});
