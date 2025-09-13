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
				Quick demos wired up for Iconify, Web Images/Unpic, Faker, Motion One, Preact Island, and DaisyUI.
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
		// Preload the LCP image candidate used by PictureDemo's first slide.
		// Match the <source type="image/avif"> chain so modern browsers can reuse it.
		(() => {
			const id = "photo-1503264116251-35a269479413"; // first slide ("Sunlit water surface...")
			const widths = [240, 320, 360, 400, 420];
			const q = 38; // matches PictureDemo AVIF quality for non-concert images
			const imagesrcset = widths
				.map(
					(w) =>
						`https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=${q}&fm=avif ${w}w`,
				)
				.join(", ");
			const imagesizes =
				"(min-width: 768px) calc((min(100vw, 48rem) - 3rem - 2rem)/2), 100vw";
			return {
				rel: "preload",
				as: "image",
				type: "image/avif" as any,
				imagesrcset: imagesrcset as any,
				imagesizes: imagesizes as any,
			} as const;
		})(),
	],
};

// Enable SSG for this route so the LCP image and preload hints
// are present in the initial HTML of the static build.
export const prerender = true;
