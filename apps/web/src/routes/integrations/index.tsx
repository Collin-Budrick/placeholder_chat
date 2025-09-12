import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import DaisyButtonsDemo from "../../components/integrations/DaisyButtonsDemo";
import FakerDemo from "../../components/integrations/FakerDemo";
import IconsDemo from "../../components/integrations/IconsDemo";
import MotionOneDemo from "../../components/integrations/MotionOneDemo";
import UnpicDemo from "../../components/integrations/UnpicDemo";
import { PreactCounterIsland } from "../../components/PreactCounterIsland";

export default component$(() => {
	return (
		<section class="container mx-auto max-w-3xl p-6 space-y-8">
			<h1 class="text-2xl font-bold">Integrations</h1>
			<p class="text-zinc-400">
				Quick demos wired up for Panda, Faker, Motion One, and DaisyUI.
			</p>
			<div class="grid gap-8 md:grid-cols-2">
				<FakerDemo />
				<MotionOneDemo />
				<DaisyButtonsDemo />
				<IconsDemo />
				<UnpicDemo />
				<div class="space-y-2">
					<h2 class="text-xl font-semibold">Preact Island</h2>
					<PreactCounterIsland />
				</div>
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
};

export const prerender = false;
