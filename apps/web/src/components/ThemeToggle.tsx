import { $, component$, useSignal, useTask$ } from "@builder.io/qwik";
import { cn } from "~/lib/cn";
// Switch to Iconify (lucide) for consistency and tree-shaken SVGs
import LuMoon from "~icons/lucide/moon";
import LuSun from "~icons/lucide/sun";

const THEME_KEY = "theme";
const LIGHT = "light"; // daisyUI default light theme
const DARK = "dark"; // daisyUI default dark theme

const ThemeToggle = component$<{ class?: string; iconClass?: string }>(
	(props) => {
		const theme = useSignal<string>(DARK);
		const btnRef = useSignal<HTMLButtonElement>();
		const animating = useSignal<boolean>(false);

		// No prefetch needed; animations removed

		// Initialize from storage (client only) without blocking paint
		useTask$(() => {
			if (typeof window === "undefined") return;
			try {
				const stored = localStorage.getItem(THEME_KEY) as string | null;
				// Backward compatibility: map legacy names
				const legacyMap: Record<string, string> = { oled: DARK, white: LIGHT };
				const initial = stored ? legacyMap[stored] || stored : DARK; // default to dark
				theme.value = initial;
				const root = document.documentElement;
				root.setAttribute("data-theme", initial);
				root.style.colorScheme = initial === DARK ? "dark" : "light";
			} catch {
				void 0;
			}
		});

		const toggle = $(async () => {
			// Immediate theme switch without animations or view transitions
			if (animating.value) return;
			animating.value = true;
			const next = theme.value === DARK ? LIGHT : DARK;
			theme.value = next;
			try {
				localStorage.setItem(THEME_KEY, next);
			} catch {
				/* ignore */
			}
			const root = document.documentElement;
			root.setAttribute("data-theme", next);
			root.style.colorScheme = next === DARK ? "dark" : "light";
			animating.value = false;
		});

		const btnClass = cn("btn btn-ghost btn-sm", props.class);
		const iconClass = cn("w-5 h-5 [stroke-width:2.25]", props.iconClass);

		return (
			<button
				ref={(el) => {
					btnRef.value = el;
				}}
				class={btnClass}
				onPointerDown$={$((e: Event) => {
					try {
						e.stopPropagation();
					} catch {
						/* ignore */
					}
					void toggle();
				})}
				aria-label="Toggle theme"
				title="Toggle theme"
				type="button"
				disabled={animating.value}
			>
				{/* Render both icons; CSS hides the inactive one based on [data-theme] to avoid flicker */}
				<LuMoon class={`theme-icon-moon ${iconClass}`} />
				<LuSun class={`theme-icon-sun ${iconClass}`} />
			</button>
		);
	},
);

export default ThemeToggle;
