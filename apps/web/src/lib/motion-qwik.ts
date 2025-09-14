/**
 * Lazy Motion One helpers (plain async functions — NOT QRLs)
 *
 * These are regular async functions that dynamically import Motion One on first use.
 * They intentionally avoid Qwik's `$` wrapper so they don't become QRLs that capture
 * local component state during the build phase.
 *
 * Usage (inside a client-only/task/event handler):
 *   import { animateMotion, timelineMotion } from '~/lib/motion-qwik';
 *   const player = await animateMotion(el, keyframes, opts);
 *   const tl = await timelineMotion(items, opts);
 */
async function isReducedMotion(): Promise<boolean> {
	try {
		if (typeof window === "undefined") return true;
		return (
			window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
		);
	} catch {
		return true;
	}
}

/**
 * animateMotion
 * - Plain async function that lazy-loads Motion One and calls animate.
 * - Named without a trailing dollar to avoid Qwik's QRL analyzer treating it as a QRL.
 */
function isValidTarget(el: unknown): el is Element | NodeList | Element[] {
	try {
		if (!el) return false;
		// Single element
		if (typeof Element !== "undefined" && el instanceof Element) return true;
		// NodeList or array-like collection
		if (el instanceof NodeList)
			return (
				el.length > 0 &&
				Array.from(el).every((n) => {
					try {
						return typeof Node !== "undefined"
							? n instanceof Node
							: Boolean((n as { nodeType?: number })?.nodeType);
					} catch {
						return false;
					}
				})
			);
		if (Array.isArray(el))
			return (
				el.length > 0 &&
				el.every((n) => {
					try {
						return typeof Node !== "undefined"
							? (n as unknown) instanceof Node
							: Boolean((n as { nodeType?: number })?.nodeType);
					} catch {
						return false;
					}
				})
			);
	} catch {}
	return false;
}

import type { AnimationOptions as MotionAnimationOptions, DOMKeyframesDefinition } from "motion";

export async function animateMotion(
	el: Element | Element[] | NodeList,
	keyframes:
		| Keyframe[]
		| PropertyIndexedKeyframes
		| Keyframe
		| DOMKeyframesDefinition,
	opts?: number | KeyframeAnimationOptions | MotionAnimationOptions,
): Promise<Animation | undefined> {
	if (!isValidTarget(el)) return undefined;
	try {
		const mod = await import("motion");
		if (!mod || typeof (mod as { animate?: unknown }).animate !== "function")
			return undefined;
		// motion.animate returns an Animation-like player
		type AnimateFn = (
			el: Element | Element[] | NodeList,
			keyframes:
				| Keyframe[]
				| PropertyIndexedKeyframes
				| Keyframe
				| DOMKeyframesDefinition,
			opts?: number | KeyframeAnimationOptions | MotionAnimationOptions,
		) => Animation;
		// Normalize NodeList -> Element[] to avoid odd proxies on CSSStyleDeclaration
		const target =
			(el instanceof NodeList ? Array.from(el) : el) as Element | Element[] | NodeList;
		return (mod as unknown as { animate: AnimateFn }).animate(
			target,
			keyframes as unknown as
				| Keyframe[]
				| PropertyIndexedKeyframes
				| Keyframe
				| DOMKeyframesDefinition,
			opts as unknown as number | KeyframeAnimationOptions | MotionAnimationOptions,
		);
	} catch (err) {
		// Silent fallback - consumer may apply CSS fallback if undefined returned
		// eslint-disable-next-line no-console
		console.warn("[motion-qwik] failed to load motion.animate", err);
		return undefined;
	}
}

/**
 * timelineMotion
 * - Small timeline helper that lazy-loads motion.timeline and sequences items.
 * - Items support `at` which may be:
 *   - number (seconds)
 *   - string negative overlap like "-0.25" (starts 0.25s before the previous)
 *
 * For reduced-motion, we apply final styles synchronously and return a stub controller.
 */
type TLItem = {
	el: Element | Element[] | NodeList;
	keyframes:
		| Keyframe[]
		| PropertyIndexedKeyframes
		| Keyframe
		| DOMKeyframesDefinition;
	options?: number | KeyframeAnimationOptions | MotionAnimationOptions;
	at?: number | string;
};

function applyFinalStyles(
	el: Element | Element[] | NodeList,
	keyframes: unknown,
) {
	try {
		if (!el) return;
		// If keyframes is array of objects, pick last object and apply properties
		const last = Array.isArray(keyframes)
			? keyframes[keyframes.length - 1]
			: typeof keyframes === "object"
				? keyframes
				: null;
		if (last && typeof last === "object") {
			const elements =
				el instanceof NodeList || Array.isArray(el)
					? Array.from(el as unknown as Element[])
					: [el as Element];
			for (const node of elements) {
				for (const [k, v] of Object.entries(last)) {
					try {
						// Map transform components to style.transform if present
						if (
							k === "transform" ||
							k === "translate" ||
							k === "translateY" ||
							k === "x" ||
							k === "y"
						) {
							// best-effort: if v is a string, set transform; otherwise skip complex mapping
							if (typeof v === "string")
								(node as HTMLElement).style.transform = v;
						} else {
							// set as style property if possible
							const prop = k.replace(/([A-Z])/g, "-$1").toLowerCase();
							(node as HTMLElement).style.setProperty(prop, String(v));
						}
					} catch {
						/* ignore individual property failures */
					}
				}
			}
		}
	} catch {
		/* ignore */
	}
}

type TimelineController = {
	play: () => void;
	pause: () => void;
	cancel: () => void;
	finished?: Promise<unknown>;
};

export async function timelineMotion(
	items: TLItem[],
	opts?: unknown,
): Promise<TimelineController | undefined> {
	// Filter out invalid elements early to avoid runtime errors inside the lib
	const validItems = (Array.isArray(items) ? items : []).filter((it) =>
		isValidTarget(it?.el),
	);
	if (validItems.length === 0) {
		return {
			play() {},
			pause() {},
			cancel() {},
			finished: Promise.resolve(),
		};
	}
	// Reduced motion: apply finals and return a stub controller
	if (await isReducedMotion()) {
		for (const it of validItems) {
			applyFinalStyles(it.el, it.keyframes);
		}
		return {
			play() {},
			pause() {},
			cancel() {},
			finished: Promise.resolve(),
		};
	}

	try {
		const mod = await import("motion");
		const timelineFn:
			| undefined
			| ((defs: unknown, options?: unknown) => TimelineController) =
			(mod as { timeline?: (d: unknown, o?: unknown) => TimelineController })
				.timeline ??
			(
				mod as {
					default?: {
						timeline?: (d: unknown, o?: unknown) => TimelineController;
					};
				}
			).default?.timeline;
		if (!timelineFn) {
			// Fallback: sequentially call animateMotion for each item
			const players: Array<
				{ cancel?: () => void; finished?: Promise<unknown> } | undefined
			> = [];
			for (const it of validItems) {
				const p = await animateMotion(it.el, it.keyframes, it.options);
				if (p) players.push(p);
				try {
					if (p?.finished) await p.finished;
				} catch {
					/* ignore */
				}
			}
			return {
				play() {},
				pause() {},
				cancel() {
					players.forEach((p) => {
						p?.cancel?.();
					});
				},
				finished: Promise.resolve(),
			};
		}

		// Build definitions compatible with Motion One timeline API:
		// [target, keyframes, options, at]
		const defs = validItems.map((it) => {
			let at = it.at;
			if (typeof at === "string" && at.startsWith("-")) {
				// negative overlap -> "<{abs}" syntax (Motion One accepts '<0.25' to start before previous)
				const num = Math.abs(parseFloat(at));
				at = `<${num}`;
			}
			return [it.el, it.keyframes, it.options || {}, at] as const;
		});

		const tl = timelineFn(defs, opts);
		return tl;
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn("[motion-qwik] timelineMotion failed", err);
		// best-effort fallback: apply finals
		for (const it of validItems) applyFinalStyles(it.el, it.keyframes);
		return {
			play() {},
			pause() {},
			cancel() {},
			finished: Promise.resolve(),
		};
	}
}
