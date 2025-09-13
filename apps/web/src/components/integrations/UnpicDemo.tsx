import { component$ } from "@builder.io/qwik";
import { Image } from "@unpic/qwik";

export default component$(() => {
	return (
		<div class="space-y-2">
			<h2 class="text-xl font-semibold">Unpic Image</h2>
			<div class="border-base-content/10 bg-base-100/5 rounded-lg border p-3">
				{import.meta.env.DEV ? (
					// In dev, prefer a plain <img> to avoid __image_info fetches over self-signed HTTPS
					<img
						src="/favicon.svg"
						width={128}
						height={128}
						alt="App favicon"
						decoding="async"
						loading="eager"
						fetchPriority="high"
						class="mx-auto block"
					/>
				) : (
					<Image
						src="/favicon.svg"
						width={128}
						height={128}
						alt="App favicon"
						decoding="async"
						loading="eager"
						fetchPriority="high"
						sizes="(min-width: 768px) 128px, 25vw"
						class="mx-auto block"
					/>
				)}
			</div>
			<p class="text-xs text-zinc-400">
				Responsive <code>&lt;img&gt;</code> with srcset/sizes and zero client
				JS.
			</p>
		</div>
	);
});
