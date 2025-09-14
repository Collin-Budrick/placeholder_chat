import { $, component$, isServer, useTask$ } from "@builder.io/qwik";
import { animateMotion } from "~/lib/motion-qwik";
import type { AnimationOptions as MotionAnimationOptions, DOMKeyframesDefinition } from "motion";

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
                        const dir = (el as HTMLElement)?.dataset?.revealFrom || "bottom";
                        const translate =
                            dir === "right"
                                ? "translateX(16px)"
                                : dir === "left"
                                  ? "translateX(-16px)"
                                  : dir === "top"
                                    ? "translateY(-16px)"
                                    : "translateY(16px)"; // bottom
                        el.style.opacity = el.style.opacity || "0";
                        el.style.transform = el.style.transform || translate;
                    } catch {
                        /* ignore */
                    }

                    // Animate with Motion One (lazy-loaded via animate$). Fire-and-forget but keep player for cleanup.
                    (async () => {
                        try {
                            // Optional stagger via data-reveal-order (1-based). If present, delay each by 120ms.
                            let order = 0;
                            try {
                                const raw = (el as HTMLElement)?.dataset?.revealOrder;
                                order = Math.max(0, Math.min(20, Number(raw || 0)));
                            } catch {}
                            const opts: MotionAnimationOptions & { duration?: number } = {
                                duration: 0.5,
                                ease: [0.22, 0.9, 0.37, 1],
                                delay: order > 0 ? order * 120 : 0,
                            };
                            const dir = (el as HTMLElement)?.dataset?.revealFrom || "bottom";
                            const keyframes: DOMKeyframesDefinition =
                                dir === "right"
                                    ? { x: [16, 0], opacity: [0, 1] }
                                    : dir === "left"
                                      ? { x: [-16, 0], opacity: [0, 1] }
                                      : dir === "top"
                                        ? { y: [-16, 0], opacity: [0, 1] }
                                        : { y: [16, 0], opacity: [0, 1] };
                            const player = (await animateMotion(
                                el,
                                keyframes,
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

		// Initialize items and observe. Do not shift elements already in view on first paint (avoid CLS).
        const vh = window.innerHeight || 0;
        let heroDone = false;
        try {
            heroDone = sessionStorage.getItem("hero_anim_done") === "1";
        } catch {}
        items.forEach((item) => {
            try {
                const rect = item.getBoundingClientRect?.();
                const initiallyInView = !!rect && rect.top < vh && rect.bottom > 0;
                const dir = (item as HTMLElement)?.dataset?.revealFrom || "bottom";
                const translate =
                    dir === "right"
                        ? "translateX(16px)"
                        : dir === "left"
                          ? "translateX(-16px)"
                          : dir === "top"
                            ? "translateY(-16px)"
                            : "translateY(16px)"; // bottom
                const force = (item as HTMLElement)?.dataset?.revealForce === "1";
                if (initiallyInView && !force) {
                    // Keep visible and do not animate this element if it's already in view
                    item.style.opacity = item.style.opacity || "1";
                    item.style.transform = item.style.transform || "none";
                    // Skip observing on subsequent navigations too (no re-animate in view)
                    if (!heroDone) io.observe(item);
                } else {
                    // Offscreen initially or forced: set starting state and observe for reveal
                    item.style.opacity = item.style.opacity || "0";
                    item.style.transform = item.style.transform || translate;
                    io.observe(item);
                }
            } catch {
                /* ignore */
            }
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
