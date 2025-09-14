import {
	$,
	component$,
	type NoSerialize,
	noSerialize,
	useOn,
	useSignal,
	useTask$,
} from "@builder.io/qwik";
import type { DOMKeyframesDefinition } from "motion";

/**
 * Simple Motion One demo using the `motion` package.
 * - Defers import to the client to keep SSR clean
 * - Honors prefers-reduced-motion
 * - Cleans up animations on dispose
 */
const MotionOneDemo = component$(() => {
	const boxRef = useSignal<HTMLElement>();
	const wrapperRef = useSignal<HTMLDivElement>();

	const started = useSignal(false);
	const cleanupRef = useSignal<NoSerialize<() => void> | null>(null);

	const start$ = $(async () => {
		if (started.value) return;
		if (typeof window === "undefined") return;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

		const el = boxRef.value as HTMLDivElement | null;
		if (!el) return; // will be retried by external triggers

		started.value = true;
		try {
			const { animate } = await import("motion");

			const idle = animate(
				el,
				{
					transform: ["translateY(0px)", "translateY(-6px)", "translateY(0px)"],
				} as DOMKeyframesDefinition,
				{ duration: 2.4, ease: "easeInOut", repeat: Infinity },
			);

			const onEnter = () => {
				try {
					animate([
						[
							el,
							{ transform: "scale(1.04)" } as DOMKeyframesDefinition,
							{ duration: 0.12, ease: "easeOut" },
						],
						[
							el,
							{ transform: "scale(1.0)" } as DOMKeyframesDefinition,
							{ duration: 0.18, ease: "easeOut" },
						],
					]);
				} catch {
					/* ignore */
				}
			};
			el.addEventListener("pointerenter", onEnter);

			const onClick = () => {
				try {
					animate(
						el,
						{
							filter: [
								"hue-rotate(0deg) saturate(1) brightness(1)",
								"hue-rotate(-140deg) saturate(1.2) brightness(1.05)",
								"hue-rotate(0deg) saturate(1) brightness(1)",
							],
						} as DOMKeyframesDefinition,
						{ duration: 0.65, ease: "easeInOut" },
					);

					animate(
						el,
						{
							transform: [
								"translateX(0px) scale(1)",
								"translateX(-4px) scale(1.02)",
								"translateX(4px) scale(1.02)",
								"translateX(-3px) scale(1.01)",
								"translateX(3px) scale(1.01)",
								"translateX(0px) scale(1)",
							],
						} as DOMKeyframesDefinition,
						{ duration: 0.35, ease: "easeInOut" },
					);
					const wrap =
						wrapperRef.value || (el.parentElement as HTMLElement | null);
					if (!wrap) return;
					const count = 16;
					for (let i = 0; i < count; i++) {
						const spark = document.createElement("div");
						spark.setAttribute("aria-hidden", "true");
						spark.className =
							"pointer-events-none absolute rounded-full shadow";
						const hues = [174, 182, 188, 192, 196];
						const h = hues[Math.floor(Math.random() * hues.length)];
						spark.style.background = `oklch(0.77 0.16 ${h})`;
						const size = 4 + Math.random() * 4;
						spark.style.width = `${size}px`;
						spark.style.height = `${size}px`;
						spark.style.left = "50%";
						spark.style.top = "50%";
						spark.style.transform = "translate(-50%, -50%)";
						spark.style.willChange = "transform, opacity, filter";
						spark.style.borderRadius = "9999px";
						if (getComputedStyle(wrap).position === "static")
							wrap.style.position = "relative";
						wrap.appendChild(spark);

						const angle =
							(i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
						const distance = 48 + Math.random() * 64;
						const dx = Math.cos(angle) * distance;
						const dy = Math.sin(angle) * distance;
						const outDur = 0.38 + Math.random() * 0.12;
						const fadeDur = 0.26 + Math.random() * 0.14;
						animate([
							[
								spark,
								{
									transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1)`,
								} as DOMKeyframesDefinition,
								{ duration: outDur, ease: "easeOut" },
							],
							[
								spark,
								{
									transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${1.6 + Math.random() * 0.6})`,
									opacity: 0,
									filter: "blur(2px)",
								} as DOMKeyframesDefinition,
								{ duration: fadeDur, ease: "easeIn" },
							],
						])
							.finished.finally(() => {
								spark.remove();
							})
							.catch(() => spark.remove());
					}
				} catch {
					/* ignore */
				}
			};
			el.addEventListener("click", onClick);

			cleanupRef.value = noSerialize(() => {
				try {
					idle.stop?.();
				} catch {
					/* ignore */
				}
				try {
					el.removeEventListener("pointerenter", onEnter);
				} catch {
					/* ignore */
				}
				try {
					el.removeEventListener("click", onClick);
				} catch {
					/* ignore */
				}
			});
		} catch {
			/* ignore */
		}
	});

	// Start when the demo becomes visible; also start on first hover/click
	useOn(
		"qvisible",
		$(() => {
			try {
				requestAnimationFrame(() => void start$());
			} catch {
				setTimeout(() => void start$(), 0);
			}
		}),
	);
	useOn(
		"pointerenter",
		$(() => {
			void start$();
		}),
	);
	useOn(
		"click",
		$(() => {
			void start$();
		}),
	);

	// Cleanup on unmount
	useTask$(({ cleanup }) => {
		cleanup(() => {
			try {
				cleanupRef.value?.();
			} catch {
				/* ignore */
			}
			cleanupRef.value = null;
		});
	});

	return (
		<div class="space-y-2">
			<h2 class="text-xl font-semibold">Motion One</h2>
			<div class="flex items-center gap-4">
				<div ref={wrapperRef} class="relative inline-block">
					<button
						ref={boxRef}
						class="size-14 rounded-md bg-gradient-to-br from-teal-500 to-cyan-500 shadow-lg"
						style={{ willChange: "transform" }}
						aria-label="Animated demo box"
						type="button"
						onKeyDown$={$((e: KeyboardEvent) => {
							const code = e.key || e.code;
							if (code === "Enter" || code === " " || code === "Spacebar") {
								e.preventDefault();
								try {
									(e.currentTarget as HTMLElement)?.click?.();
								} catch {
									/* ignore */
								}
							}
						})}
						title="Click for fireworks"
					/>
				</div>
				<p class="text-sm text-zinc-400">
					Subtle float; hover to pulse. Powered by <code>motion</code>.
				</p>
			</div>
		</div>
	);
});

export default MotionOneDemo;
