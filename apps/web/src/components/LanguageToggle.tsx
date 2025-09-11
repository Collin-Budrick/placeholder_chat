import { $, component$, useSignal, useTask$ } from "@builder.io/qwik";
import { LuGlobe } from "@qwikest/icons/lucide";

type Props = { class?: string; iconClass?: string };

const LANG_KEY = "lang";
const FALLBACK = "en";
const SUPPORTED = ["en", "es"] as const;
type Lang = (typeof SUPPORTED)[number];

export const LanguageToggle = component$((props: Props) => {
	const lang = useSignal<Lang>(FALLBACK);

	// Initialize from storage on client
	useTask$(() => {
		try {
			const stored = (localStorage.getItem(LANG_KEY) || FALLBACK) as Lang;
			const next = (SUPPORTED as readonly string[]).includes(stored)
				? (stored as Lang)
				: FALLBACK;
			lang.value = next;
			document.documentElement.setAttribute("lang", next);
			document.documentElement.setAttribute("data-lang", next);
		} catch {
			void 0;
		}
	});

	const cycle = $(() => {
		const idx = SUPPORTED.indexOf(lang.value);
		const next = SUPPORTED[(idx + 1) % SUPPORTED.length];
		lang.value = next;
		try {
			localStorage.setItem(LANG_KEY, next);
		} catch {
			void 0;
		}
		document.documentElement.setAttribute("lang", next);
		document.documentElement.setAttribute("data-lang", next);
	});

	const btnClass = props.class ?? "btn btn-ghost btn-sm";
	const iconClass = props.iconClass ?? "w-5 h-5";

	return (
		<button
			type="button"
			class={btnClass}
			onClick$={cycle}
			aria-label={`Language: ${lang.value}`}
			title={`Language: ${lang.value.toUpperCase()}`}
		>
			<LuGlobe class={iconClass} />
		</button>
	);
});

export default LanguageToggle;
