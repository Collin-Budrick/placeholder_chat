import type { Component } from "@builder.io/qwik";
import { $, component$ } from "@builder.io/qwik";
import { cn } from "~/lib/cn";
// Switch to Iconify (lucide) for consistency and tree-shaken SVGs
import LuMoon from "~icons/lucide/moon";
import LuSun from "~icons/lucide/sun";

// Some IDE setups type unplugin-icons default exports as unknown. Cast to Qwik Component.
const MoonIcon = LuMoon as unknown as Component<{ class?: string }>;
const SunIcon = LuSun as unknown as Component<{ class?: string }>;

const THEME_KEY = "theme";
const LIGHT = "light"; // daisyUI default light theme
const DARK = "dark"; // daisyUI default dark theme

const ThemeToggle = component$<{ class?: string; iconClass?: string }>(
	(props) => {
		const btnClass = cn("btn btn-ghost btn-sm", props.class);
    const iconClass = cn("icon-sharp w-5 h-5 [stroke-width:2]", props.iconClass);

		const toggle = $(async () => {
			try {
				const root = document.documentElement;
				const legacyMap: Record<string, string> = { oled: DARK, white: LIGHT };
				const curAttr = root.getAttribute("data-theme") || DARK;
				const curStored =
					(localStorage.getItem(THEME_KEY) as string | null) || curAttr;
				const cur = legacyMap[curStored] || curStored;
				const next = cur === DARK ? LIGHT : DARK;
				root.setAttribute("data-theme", next);
				root.style.colorScheme = next === DARK ? "dark" : "light";
				try {
					localStorage.setItem(THEME_KEY, next);
				} catch {}
			} catch {}
		});

		return (
			<button
				class={btnClass}
				onPointerDown$={$((e: Event) => {
					try {
						e.stopPropagation();
					} catch {}
					void toggle();
				})}
				aria-label="Toggle theme"
				title="Toggle theme"
				type="button"
			>
				{/* Render both icons; CSS hides the inactive one based on [data-theme] to avoid flicker */}
				<MoonIcon class={`theme-icon-moon ${iconClass}`} />
				<SunIcon class={`theme-icon-sun ${iconClass}`} />
			</button>
		);
	},
);

export default ThemeToggle;
