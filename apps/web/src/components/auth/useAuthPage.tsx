import type { QRL } from "@builder.io/qwik";
import { $, useOn, useSignal, useTask$ } from "@builder.io/qwik";
import { animateMotion } from "~/lib/motion-qwik";

export type UseAuthPageOptions = {
	/** Initial text for the auth page title */
	title: string;
	/** Optional list of localStorage keys to clear when the auth page becomes visible */
	typingCacheKeys?: string[];
};

export type UseAuthPageReturn = {
	titleText: ReturnType<typeof useSignal<string>>;
	eraseKey: ReturnType<typeof useSignal<number | null>>;
	titleStartKey: ReturnType<typeof useSignal<number>>;
	authContainer: ReturnType<typeof useSignal<HTMLElement | undefined>>;
	formWrap: ReturnType<typeof useSignal<HTMLElement | undefined>>;
	description: ReturnType<typeof useSignal<HTMLElement | undefined>>;
	setAuthContainer: QRL<(el: HTMLElement | undefined) => void>;
	setFormWrap: QRL<(el: HTMLElement | undefined) => void>;
	setDescription: QRL<(el: HTMLElement | undefined) => void>;
	fadeOut: QRL<() => void>;
	fadeIn: QRL<() => void>;
};

const DEFAULT_CACHE_KEYS = [
	"typetitle:/login|Log in",
	"typetitle:/signup|Sign Up",
];

export function useAuthPage({
	title,
	typingCacheKeys = DEFAULT_CACHE_KEYS,
}: UseAuthPageOptions): UseAuthPageReturn {
	const titleText = useSignal(title);
	const eraseKey = useSignal<number | null>(null);
	const titleStartKey = useSignal(0);
	const authContainer = useSignal<HTMLElement>();
	const formWrap = useSignal<HTMLElement>();
	const description = useSignal<HTMLElement>();

	useTask$(() => {
		try {
			titleStartKey.value = Date.now();
		} catch {
			/* ignore */
		}
	});

	useOn(
		"qvisible",
		$(() => {
			if (typeof window === "undefined") return;
			if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
				return;
			const root = authContainer.value;
			if (!root) return;
			type W = typeof window & {
				requestIdleCallback?: (
					cb: IdleRequestCallback,
					opts?: { timeout?: number },
				) => number;
			};
			type IdleShim = (cb: () => void) => number;
			const idle: IdleShim = (window as W).requestIdleCallback
				? (cb) => (window as W).requestIdleCallback?.(cb as IdleRequestCallback)
				: (cb) => window.setTimeout(cb, 250);
			idle(() => {
				try {
					void animateMotion(
						root,
						{ opacity: [0, 1], y: [24, 0] },
						{
							duration: 0.45,
							easing: "cubic-bezier(.22,.9,.37,1)",
						},
					);
				} catch {
					/* ignore */
				}
			});
			try {
				titleStartKey.value = Date.now();
			} catch {
				/* ignore */
			}
			try {
				const ls = globalThis.localStorage;
				typingCacheKeys.forEach((key) => {
				ls?.removeItem(key);
			});
			} catch {
				/* ignore */
			}
		}),
	);

	const setAuthContainer = $((el: HTMLElement | undefined) => {
		authContainer.value = el;
	});

	const setFormWrap = $((el: HTMLElement | undefined) => {
		formWrap.value = el;
	});

	const setDescription = $((el: HTMLElement | undefined) => {
		description.value = el;
	});

	const fadeOut = $(() => {
		const el = authContainer.value;
		if (el) el.classList.add("auth-fade-out");
	});

	const fadeIn = $(() => {
		const el = authContainer.value;
		if (el) el.classList.remove("auth-fade-out");
	});

	return {
		titleText,
		eraseKey,
		titleStartKey,
		authContainer,
		formWrap,
		description,
		setAuthContainer,
		setFormWrap,
		setDescription,
		fadeOut,
		fadeIn,
	};
}





