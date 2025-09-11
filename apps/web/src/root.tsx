import { component$, isDev } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
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
				{!isDev && (
					<link
						rel="manifest"
						href={`${import.meta.env.BASE_URL}manifest.json`}
					/>
				)}
				{/* Connection hints for CDN assets used by integrations (e.g., Lottie demos) */}
				<link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
				<RouterHead />
				{/* Optional: route third‑party analytics via Partytown to isolate from main thread.
            Enable by setting ENABLE_ANALYTICS=1 and provide ANALYTICS_GTAG_ID. */}
				{/* Dev-only analytics via Partytown to avoid any prod perf impact */}
				{isDev && import.meta.env.ENABLE_ANALYTICS === "1" && (
					<>
						<script
							type="text/partytown"
							src={`https://www.googletagmanager.com/gtag/js?id=${import.meta.env.ANALYTICS_GTAG_ID || "G-XXXX"}`}
						/>
						<script type="text/partytown">
							{`window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', '${String(import.meta.env.ANALYTICS_GTAG_ID || "G-XXXX")}', { anonymize_ip: true, transport_type: 'beacon' });`}
						</script>
					</>
				)}
				{/* Prefetch auth route data so login/signup feel instant */}
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
				{/* Heading defaults moved to global.css to avoid inline <style> and JSX escape warnings. */}
				{/* Load small theme/lang initializer as an external file so a strict CSP can be enforced without inline allowances. */}
				<script src={`${import.meta.env.BASE_URL}theme-init.js`} defer />
			</head>
			<body
				lang="en"
				class="min-h-screen flex flex-col bg-base-100 text-base-content"
			>
				{/* RouterOutlet renders routes that include their own #content container.
            Avoid wrapping in another #content to keep View Transitions working. */}
				<RouterOutlet />
			</body>
		</QwikCityProvider>
	);
});
