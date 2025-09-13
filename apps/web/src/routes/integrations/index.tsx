import { component$, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import DaisyButtonsDemo from "../../components/integrations/DaisyButtonsDemo";
import FakerDemo from "../../components/integrations/FakerDemo";
import IconsDemo from "../../components/integrations/IconsDemo";
import MotionOneDemo from "../../components/integrations/MotionOneDemo";
import PictureDemo from "../../components/integrations/PictureDemo";
import UnpicDemo from "../../components/integrations/UnpicDemo";
import { PreactCounterIsland } from "../../components/PreactCounterIsland";

export default component$(() => {
	// Prewarm faker chunk in the background to reduce first-interaction latency
	useVisibleTask$(() => {
		(async () => {
			try {
				await import("@faker-js/faker/locale/en");
			} catch {}
		})();
	});
	return (
		<section class="container mx-auto max-w-3xl space-y-8 p-6">
			<h1
				class="text-2xl font-bold"
				style={{ fontSize: "1.5rem", lineHeight: "1.25" }}
			>
				Integrations
			</h1>
			<p class="text-zinc-400">
				Quick demos wired up for Panda, Faker, Motion One, and DaisyUI.
			</p>
			<div class="grid gap-8 md:grid-cols-2">
				{/* Gate non-critical demos behind client:visible to trim initial JS */}
				<FakerDemo client:visible />
				<MotionOneDemo client:visible />
				<DaisyButtonsDemo client:visible />
				<IconsDemo client:visible />
				{/* Move the Preact island higher so it isn't far down */}
				<div class="space-y-2">
					<h2 class="text-xl font-semibold">Preact Island</h2>
					{/* Extra guard to avoid early hydration in dev */}
					<PreactCounterIsland client:visible />
				</div>
				{/* Keep the Unpic image eager for LCP */}
				<UnpicDemo />
				{/* Responsive <picture> demo (runtime source). Swap to imagetools local imports when ready. */}
				<PictureDemo />
			</div>
		</section>
	);
});

export const head: DocumentHead = {
	title: "Integrations | Stack",
	meta: [
		{
			name: "description",
			content:
				"Quick demos wired up for Lenis, Lottie, Panda, Faker, Motion One, and DaisyUI within the Stack app.",
		},
	],
	links: [
		{
			rel: "preload",
			href: "/favicon.svg",
			as: "image",
			// Boost priority for the above‑the‑fold image
			fetchpriority: "high" as any,
		},
	],
};

export const prerender = false;
