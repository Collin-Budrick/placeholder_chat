import { component$ } from "@builder.io/qwik";
import { Image } from "@unpic/qwik";

export default component$(() => {
	return (
		<div class="space-y-2">
			<h2 class="text-xl font-semibold">Unpic Image</h2>
			<div class="rounded-lg border border-base-content/10 p-3 bg-base-100/5">
				<Image
					src="/favicon.svg"
					width={128}
					height={128}
					alt="App favicon"
					decoding="async"
					loading="eager"
					fetchpriority="high"
					sizes="(min-width: 768px) 128px, 25vw"
					class="block mx-auto"
				/>
			</div>
			<p class="text-xs text-zinc-400">
				Responsive <code>&lt;img&gt;</code> with srcset/sizes and zero client
				JS.
			</p>
		</div>
	);
});
