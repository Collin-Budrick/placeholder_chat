import type { QRL } from "@builder.io/qwik";
import {
	$,
	component$,
	isServer,
	useOn,
	useSignal,
	useTask$,
} from "@builder.io/qwik";
import { cn } from "~/lib/cn";

type Props = {
	text: string;
	class?: string;
	speedMs?: number;
	idleMs?: number; // optional, not used here but allowed for API clarity
	startDelayMs?: number; // delay typing start to avoid overlapping with UI animations
	suppressTyping?: boolean; // when true, render full text without typing animation
	showCaret?: boolean;
	// When this value changes (and the element is visible), we trigger typing.
	// Useful for forcing a fresh type-on-arrival after client-side navigation.
	startKey?: string | number;
	// When this value changes, the component will erase the current text
	// before invoking the callback. Use to coordinate route toggles.
	eraseKey?: string | number | null;
	onErased$?: QRL<() => void>;
	// Caching controls
	// cache: false disables caching; 'route' keys by pathname+text (default); 'global' keys by text only
	cache?: false | "route" | "global";
	// cacheStorage: 'local' (default) persists across tabs; 'session' only current tab
	cacheStorage?: "local" | "session";
	// cacheKey: explicit cache key override (bypasses cache/cacheStorage/keying)
	cacheKey?: string;
	// When true, clears the cache on hard reload so typing runs again
	resetOnReload?: boolean;
};

const TypeTitle = component$((props: Props) => {
	const shown = useSignal("");
	const startedFor = useSignal<string | null>(null);
	const elRef = useSignal<HTMLElement>();
	const lastEraseKey = useSignal<string | number | null>(null);
	const phase = useSignal<"idle" | "typing" | "erasing">("idle");
	const typingTimer = useSignal<number | null>(null);
	const delayTimer = useSignal<number | null>(null);
	const lastStartKey = useSignal<string | number | null>(null);

	// Helper to check if element is in viewport (QRL for serialization)
	const isVisible = $((): boolean => {
		const el = elRef.value;
		if (!el) return false;
		const rect = el.getBoundingClientRect();
		const vh = globalThis.innerHeight || document.documentElement.clientHeight;
		return rect.top < vh && rect.bottom > 0;
	});

	// Start typing effect (idempotent via startedFor/typed dataset + cache) — QRL for serialization
	const startTyping = $((): void => {
		if (isServer) return;
		const txt = props.text;
		const speed = props.speedMs ?? 45;
		const startDelay = Math.max(0, props.startDelayMs ?? 0);
		const suppress = props.suppressTyping ?? false;
		const storageKind = props.cacheStorage ?? "local";
		const storage: Storage | null = (() => {
			try {
				return storageKind === "session"
					? globalThis.sessionStorage
					: globalThis.localStorage;
			} catch {
				return null;
			}
		})();
		const cacheKey = (() => {
			const mode = props.cache ?? "route";
			if (mode === false) return null;
			if (props.cacheKey) return props.cacheKey;
			try {
				const path = globalThis.location?.pathname || "";
				const base = mode === "global" ? `${txt}` : `${path}|${txt}`;
				return `typetitle:${base}`;
			} catch {
				return `typetitle:${txt}`;
			}
		})();

		// Optional: clear cache when this navigation is a hard reload
		if (props.resetOnReload && storage && cacheKey) {
			try {
				let isReload = false;
				const perf = (globalThis as { performance?: Performance }).performance;
				if (perf?.getEntriesByType) {
					const nav = perf.getEntriesByType("navigation")?.[0] as
						| PerformanceNavigationTiming
						| undefined;
					// Some TS libdom versions do not include activationStart; guard access.
					const actStart =
						(nav as unknown as { activationStart?: number })?.activationStart ??
						0;
					isReload =
						!!nav &&
						(nav.type === "reload" ||
							(nav.type === "navigate" &&
								nav.transferSize === 0 &&
								actStart > 0));
				} else if (perf?.navigation) {
					// legacy API: 1 === TYPE_RELOAD
					isReload = perf.navigation.type === 1;
				}
				if (isReload) storage.removeItem(cacheKey);
			} catch {
				/* ignore */
			}
		}

		// If suppressed or cached as already typed, show instantly
		let cachedDone = false;
		try {
			cachedDone = !!(storage && cacheKey && storage.getItem(cacheKey) === "1");
		} catch {
			/* ignore */
		}
		if (suppress || cachedDone) {
			if (typingTimer.value) globalThis.clearTimeout(typingTimer.value);
			if (delayTimer.value) globalThis.clearTimeout(delayTimer.value);
			typingTimer.value = null;
			delayTimer.value = null;
			shown.value = txt;
			phase.value = "idle";
			try {
				if (storage && cacheKey) storage.setItem(cacheKey, "1");
			} catch {
				/* ignore */
			}
			return;
		}

		if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			shown.value = txt;
			phase.value = "idle";
			return;
		}

		const el = elRef.value;
		const isSameText = startedFor.value === txt;
		if (
			isSameText &&
			el &&
			el.hasAttribute("data-typed") &&
			el.getAttribute("data-typed") === "1"
		) {
			shown.value = txt;
			phase.value = "idle";
			return;
		}

		startedFor.value = txt;
		if (el) {
			try {
				el.setAttribute("data-typed", "0");
			} catch {
				/* ignore */
			}
		}

		let i = 0;
		shown.value = "";
		phase.value = "typing";

		const tick = () => {
			shown.value = txt.slice(0, i);
			i++;
			if (i <= txt.length) {
				const t = globalThis.setTimeout(tick, speed) as unknown as number;
				typingTimer.value = t;
			} else {
				phase.value = "idle";
				try {
					if (storage && cacheKey) storage.setItem(cacheKey, "1");
				} catch {
					/* ignore */
				}
			}
		};

		const runStart = () => {
			const t = globalThis.setTimeout(tick, speed) as unknown as number;
			typingTimer.value = t;
		};

		if (startDelay > 0) {
			const d = globalThis.setTimeout(
				runStart,
				startDelay,
			) as unknown as number;
			delayTimer.value = d;
		} else {
			runStart();
		}
	});

	// Trigger typing when component becomes visible using qvisible event
	useOn(
		"qvisible",
		$(() => {
			if (isServer) return;
			startTyping();
		}),
	);

	// Eagerly show text when suppressed or cached to avoid blank caret on first paint
	useTask$(({ track }) => {
		if (isServer) return;
		const sup = track(() => props.suppressTyping ?? false);
		const txt = track(() => props.text);
		// Re-evaluate when cache-related props change
		track(() => props.cache);
		track(() => props.cacheKey);
		track(() => props.cacheStorage);
		if (sup) {
			// If typing is suppressed, ensure text is shown immediately
			shown.value = txt || "";
			phase.value = "idle";
			if (typingTimer.value) globalThis.clearTimeout(typingTimer.value);
			if (delayTimer.value) globalThis.clearTimeout(delayTimer.value);
			typingTimer.value = null;
			delayTimer.value = null;
			// Mark as completed in cache to avoid immediate re-typing
			try {
				const storageKind = props.cacheStorage ?? "local";
				const storage: Storage | null =
					storageKind === "session"
						? globalThis.sessionStorage
						: globalThis.localStorage;
				const mode = props.cache ?? "route";
				if (mode !== false) {
					const key =
						props.cacheKey ??
						(() => {
							try {
								const path = globalThis.location?.pathname || "";
								const base = mode === "global" ? `${txt}` : `${path}|${txt}`;
								return `typetitle:${base}`;
							} catch {
								return `typetitle:${txt}`;
							}
						})();
					if (storage && key) storage.setItem(key, "1");
				}
			} catch {
				/* ignore */
			}
			return;
		}
		// If cached as already typed, show immediately as well
		try {
			const storageKind = props.cacheStorage ?? "local";
			const storage: Storage | null =
				storageKind === "session"
					? globalThis.sessionStorage
					: globalThis.localStorage;
			const mode = props.cache ?? "route";
			if (mode !== false) {
				const key =
					props.cacheKey ??
					(() => {
						try {
							const path = globalThis.location?.pathname || "";
							const base = mode === "global" ? `${txt}` : `${path}|${txt}`;
							return `typetitle:${base}`;
						} catch {
							return `typetitle:${txt}`;
						}
					})();
				const done = !!(storage && key && storage.getItem(key) === "1");
				if (done) {
					shown.value = txt || "";
					phase.value = "idle";
					if (typingTimer.value) globalThis.clearTimeout(typingTimer.value);
					if (delayTimer.value) globalThis.clearTimeout(delayTimer.value);
					typingTimer.value = null;
					delayTimer.value = null;
				}
			}
		} catch {
			/* ignore */
		}
	});

	// Also react to text changes if already visible
	useTask$(async ({ track }) => {
		if (isServer) return;
		track(() => props.text);
		// Kick typing when startKey changes
		track(() => props.startKey);
		const sup = track(() => props.suppressTyping ?? false);
		track(() => props.startDelayMs);
		if (sup) return; // suppression handled in dedicated task below
		const visible = await isVisible();
		if (visible) {
			await startTyping();
		}
	});

	// Force typing when startKey changes (ignores visibility gating to handle SPA returns)
	useTask$(async ({ track }) => {
		if (isServer) return;
		const key = track(() => props.startKey);
		if (key == null || key === lastStartKey.value) return;
		lastStartKey.value = key;
		try {
			const el = elRef.value;
			if (el) {
				el.setAttribute("data-typed", "0");
			}
		} catch {
			/* ignore */
		}
		// Defer a tick to allow layout after navigation
		await new Promise((r) => setTimeout(r, 0));
		await startTyping();
	});

	// Ensure timers are cleared on destroy
	useTask$(({ cleanup }) => {
		if (isServer) return;
		cleanup(() => {
			if (delayTimer.value) globalThis.clearTimeout(delayTimer.value);
			if (typingTimer.value) globalThis.clearTimeout(typingTimer.value);
			delayTimer.value = null;
			typingTimer.value = null;
			if (elRef.value) {
				try {
					elRef.value.setAttribute("data-typed", "1");
				} catch {
					/* ignore */
				}
			}
		});
	});

	// If suppression toggles on while typing, immediately stop and show full text
	useTask$(({ track }) => {
		if (isServer) return;
		const sup = track(() => props.suppressTyping ?? false);
		if (sup) {
			if (typingTimer.value) globalThis.clearTimeout(typingTimer.value);
			if (delayTimer.value) globalThis.clearTimeout(delayTimer.value);
			typingTimer.value = null;
			delayTimer.value = null;
			shown.value = props.text;
			phase.value = "idle";
		}
	});

	// Handle external erase request (backspace effect) — also guarded with reduced-motion
	useTask$(({ track }) => {
		if (isServer) return;
		const key = track(() => props.eraseKey);
		if (
			key == null ||
			key === lastEraseKey.value ||
			(typeof key === "number" && key <= 0)
		)
			return;
		lastEraseKey.value = key;
		const txt = shown.value || props.text || "";
		if (!txt) {
			phase.value = "idle";
			props.onErased$?.();
			return;
		}
		const speed = Math.max(20, (props.speedMs ?? 45) - 15);
		if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
			shown.value = "";
			phase.value = "idle";
			// Clear cache so next visit can retype
			try {
				const storageKind = props.cacheStorage ?? "local";
				const storage: Storage | null =
					storageKind === "session"
						? globalThis.sessionStorage
						: globalThis.localStorage;
				const mode = props.cache ?? "route";
				const path = globalThis.location?.pathname || "";
				const base =
					mode === "global"
						? `${props.text || ""}`
						: `${path}|${props.text || ""}`;
				const ckey = `typetitle:${base}`;
				storage?.removeItem(ckey);
			} catch {
				/* ignore */
			}
			props.onErased$?.();
			return;
		}
		let i = txt.length;
		phase.value = "erasing";
		const tick = () => {
			i -= 1;
			shown.value = txt.slice(0, Math.max(0, i));
			if (i > 0) {
				globalThis.setTimeout(tick, speed);
			} else {
				phase.value = "idle";
				// Clear cache so next visit can retype
				try {
					const storageKind = props.cacheStorage ?? "local";
					const storage: Storage | null =
						storageKind === "session"
							? globalThis.sessionStorage
							: globalThis.localStorage;
					const mode = props.cache ?? "route";
					const path = globalThis.location?.pathname || "";
					const base =
						mode === "global"
							? `${props.text || ""}`
							: `${path}|${props.text || ""}`;
					const ckey = `typetitle:${base}`;
					storage?.removeItem(ckey);
				} catch {
					/* ignore */
				}
				props.onErased$?.();
			}
		};
		globalThis.setTimeout(tick, speed);
	});

	return (
		<h1 class={cn(props.class)} aria-label={props.text} ref={elRef}>
			{shown.value}
			{props.showCaret !== false && (
				<span
					class={`type-caret ${phase.value === "idle" ? "blink" : ""}`}
					style={{
						animation:
							phase.value === "idle"
								? "caret-blink 0.8s steps(1,end) infinite"
								: "none",
						willChange: "opacity",
					}}
					aria-hidden="true"
				/>
			)}
		</h1>
	);
});

export default TypeTitle;
