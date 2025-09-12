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
				{!isDev && (
					<link
						rel="manifest"
						href={`${import.meta.env.BASE_URL}manifest.json`}
					/>
				)}
        {/* Connection hints removed (no external Lottie assets in use) */}
				<RouterHead />
				{/* Analytics via Partytown removed; add your own script loader if needed */}
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
				{/* Initialize Velvette page transitions (client-only) */}
				<VelvetteInit client:load />
				{/* RouterOutlet renders routes that include their own #content container.
            Avoid wrapping in another #content to keep View Transitions working. */}
				<RouterOutlet />
			</body>
		</QwikCityProvider>
	);
});
