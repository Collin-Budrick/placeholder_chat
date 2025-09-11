import {
	$,
	component$,
	isServer,
	useOn,
	useSignal,
	useTask$,
} from "@builder.io/qwik";

export const LottieDemo = component$(() => {
	const host = useSignal<HTMLDivElement>();
	const start$ = $(async () => {
		if (isServer) return;
		if (typeof window === "undefined") return;
		const el = host.value;
		if (!el) return;
		try {
			const mod = await import("lottie-web/build/player/lottie_light");
			const src = `${import.meta.env.BASE_URL}lottie/demo.json`;
			let animationData: unknown | undefined;
			try {
				const r = await fetch(src, { headers: { accept: "application/json" } });
				if (r.ok && /json/i.test(r.headers.get("content-type") || "")) {
					animationData = await r.json();
				}
			} catch {
				/* ignore fetch errors; fallback to path */
			}
			type LottieNamespace = { loadAnimation?: (params: unknown) => unknown };
			let loadAnimation: ((params: unknown) => unknown) | undefined;
			const maybeNs: unknown = (mod as { default?: unknown }).default ?? mod;
			if (typeof (maybeNs as LottieNamespace)?.loadAnimation === "function") {
				loadAnimation = (maybeNs as LottieNamespace).loadAnimation;
			} else if (typeof maybeNs === "function") {
				loadAnimation = maybeNs as unknown as (params: unknown) => unknown;
			}
			if (typeof loadAnimation !== "function") return;
			const anim = loadAnimation({
				container: el,
				// Canvas renderer avoids some SVG sizing/transform quirks in nested layouts
				renderer: "canvas",
				loop: true,
				autoplay: true,
				// Prefer inline data to avoid extra fetch; fallback to path
				animationData,
				path: animationData ? undefined : src,
				rendererSettings: {
					preserveAspectRatio: "xMidYMid meet",
					progressiveLoad: true,
					clearCanvas: true,
					// Keep pixel ratio modest for small demo to reduce GPU blit cost
					dpr: Math.min(window.devicePixelRatio || 1, 2),
				},
			});
			// Cleanup on unmount
			return () => {
				try {
					const player = anim as { destroy?: () => void } | undefined;
					player?.destroy?.();
				} catch {
					/* noop */
				}
			};
		} catch {
			/* noop */
		}
	});

	// Also start on visibility or interaction
	useOn(
		"qvisible",
		$(() => {
			void start$();
		}),
	);
	useOn(
		"pointerenter",
		$(() => {
			void start$();
		}),
	);

	// Render Lottie on client after mount (idle-loaded) with a rAF nudge
	useTask$(({ cleanup }) => {
		if (isServer) return;
		if (typeof window === "undefined") return;
		let cancelled = false;
		let timeoutId: number | undefined;
		let started = false;
		let disposer: (() => void) | undefined;

		const start = async () => {
			if (cancelled || started) return;
			started = true;
			try {
				disposer = await start$();
			} catch {
				/* ignore */
			}
		};

		type W = typeof window & {
			requestIdleCallback?: (cb: IdleRequestCallback) => number;
		};
		const idleCb = (window as W).requestIdleCallback;
		const kick = () => {
			if (!started) {
				started = true;
				void start();
			}
		};
		if (idleCb) {
			idleCb(() => kick());
		}
		// Also start next frame for reliability
		try {
			requestAnimationFrame(() => kick());
		} catch {
			timeoutId = window.setTimeout(kick, 0) as unknown as number;
		}

		cleanup(() => {
			cancelled = true;
			if (timeoutId !== undefined) clearTimeout(timeoutId as number);
			try {
				if (typeof disposer === "function") disposer();
			} catch {
				/* ignore */
			}
		});
	});

	return (
		<div class="space-y-2">
			<h2 class="text-xl font-semibold">Lottie</h2>
			<div
				ref={host}
				class="rounded-xl overflow-hidden"
				style={{
					width: "160px",
					height: "160px",
					display: "block",
					contain: "content",
					background: "transparent",
					isolation: "isolate",
				}}
				aria-hidden="true"
			/>
		</div>
	);
});

export default LottieDemo;
