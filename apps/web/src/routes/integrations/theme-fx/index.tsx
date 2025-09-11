import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
// ThemeFxDemo temporarily disabled for SSG QRL debug

export default component$(() => {
	return (
		<div class="max-w-4xl mx-auto p-6">
			{/* ThemeFxDemo removed for SSG debug */}
		</div>
	);
});

export const prerender = true;

export const head: DocumentHead = {
	title: "Theme FX Demo | Stack",
	meta: [
		{
			name: "description",
			content:
				"Demonstration page for theme effects within the Stack integrations.",
		},
	],
};
