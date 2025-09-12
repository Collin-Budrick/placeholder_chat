import { $, component$, isServer, useTask$ } from "@builder.io/qwik";
import { animateMotion } from "~/lib/motion-qwik";

/**
 * Module-level starter that initializes IntersectionObserver reveals.
 * Kept at module scope so QRLs inside components do not capture local identifiers.
 *
 * Returns a cleanup function that disconnects observers and cancels players.
 */
const startScrollReveals = $(async (): Promise<() => void> => {
	if (typeof document === "undefined") return () => {};
	// Respect reduced motion preference
	try {
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			return () => {};
		}
	} catch {
		return () => {};
	}

	try {
		const items = Array.from(
			document.querySelectorAll<HTMLElement>("[data-reveal]"),
		);
		if (!items.length) return () => {};

		const observers: IntersectionObserver[] = [];
		const players: Animation[] = [];
		const revealed = new WeakSet<Element>();

		const io = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						const el = entry.target as HTMLElement;
						// Avoid replaying the same reveal
						if (!revealed.has(el)) {
							revealed.add(el);

							// Ensure initial state (in case it wasn't set yet)
							try {
								el.style.opacity = el.style.opacity || "0";
								el.style.transform = el.style.transform || "translateY(16px)";
							} catch {
								/* ignore */
							}

							// Animate with Motion One (lazy-loaded via animate$). Fire-and-forget but keep player for cleanup.
							(async () => {
								try {
									const opts: { duration: number; easing: string } = {
										duration: 0.5,
										easing: "cubic-bezier(.22,.9,.37,1)",
									};
									const player = (await animateMotion(
										el,
										{ y: [16, 0], opacity: [0, 1] },
										opts,
									)) as Animation | undefined;

									if (player) players.push(player);
									try {
										if (player?.finished) await player.finished;
									} catch {
										/* ignore */
									}
								} catch {
									/* ignore */
								}
							})();

							// Stop observing this element
							try {
								io.unobserve(el);
							} catch {
								/* ignore */
							}
						}
					}
				});
			},
			{ root: null, rootMargin: "0px 0px -15% 0px", threshold: 0.01 },
		);

		// Initialize items and observe
		items.forEach((item) => {
			try {
				item.style.opacity = item.style.opacity || "0";
				item.style.transform = item.style.transform || "translateY(16px)";
			} catch {
				/* ignore */
			}
			io.observe(item);
		});

		observers.push(io);

		return () => {
			try {
				observers.forEach((o) => {
					o.disconnect();
				});
			} catch {
				/* ignore */
			}
			try {
				players.forEach((p) => {
					p?.cancel?.();
				});
			} catch {
				/* ignore */
			}
		};
	} catch {
		return () => {};
	}
});

const ScrollReveals = component$(() => {
	useTask$(() => {
		if (isServer) return;
		let idleId: number | undefined;
		let timeoutId: number | undefined;
		let cleanupFn: (() => void) | undefined;

		const start = async () => {
			try {
				cleanupFn = await startScrollReveals();
			} catch {
				/* ignore */
			}
		};

		type W = typeof window & {
			requestIdleCallback?: (cb: IdleRequestCallback) => number;
			cancelIdleCallback?: (id: number) => void;
		};
		const w = window as W;
		const idleCb = w.requestIdleCallback;
		if (typeof idleCb === "function") {
			idleId = idleCb(() => {
				void start();
			});
		} else {
			timeoutId = window.setTimeout(() => {
				void start();
			}, 200);
		}

		return () => {
			try {
				if (
					idleId !== undefined &&
					typeof w.cancelIdleCallback === "function"
				) {
					w.cancelIdleCallback(idleId);
				}
			} catch {
				/* ignore */
			}
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			try {
				cleanupFn?.();
			} catch {
				/* ignore */
			}
		};
	});
	return null;
});

export default ScrollReveals;
