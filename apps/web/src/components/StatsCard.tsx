import {
	component$,
	isServer,
	useSignal,
	useVisibleTask$,
} from "@builder.io/qwik";
import { animateMotion } from "~/lib/motion-qwik";

type Stat = {
	label: string;
	target: number;
	format: (v: number) => string;
	subtext?: string;
	initial: string;
};

const formatK = (v: number) => `${v.toFixed(1)}k`;
const formatM = (v: number) => `${v.toFixed(1)}M`;
const formatPct = (v: number) => `${v.toFixed(2)}%`;

const STATS: Stat[] = [
	{
		label: "Active users",
		target: 12.3,
		format: formatK,
		subtext: "+324 today",
		initial: "0",
	},
	{
		label: "Messages sent",
		target: 98.4,
		format: formatM,
		subtext: "+1.2M this week",
		initial: "0",
	},
	{
		label: "Uptime",
		target: 99.99,
		format: formatPct,
		subtext: "Last 30 days",
		initial: "0%",
	},
];

const COUNTER_DURATION_MS = 1200;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

export const StatsCard = component$(() => {
	const rootRef = useSignal<HTMLElement>();
	const values = useSignal<string[]>(STATS.map((stat) => stat.initial));
	const started = useSignal(false);

	useVisibleTask$(() => {
		if (isServer) return;
		if (typeof window === "undefined") return;

		const el = rootRef.value;
		if (!el || started.value) return;
		started.value = true;

		let cancelled = false;
		let frameId = 0;

		(async () => {
			try {
				el.style.opacity = "0";
				el.style.transform = "translateY(16px)";
				el.style.willChange = "transform, opacity";
			} catch {}

			const reduced =
				window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
			if (reduced) {
				values.value = STATS.map((stat) => stat.format(stat.target));
				try {
					el.style.opacity = "1";
					el.style.transform = "none";
					el.style.willChange = "";
				} catch {}
				return;
			}

			const start = window.performance?.now?.() ?? Date.now();
			const step = (now: number) => {
				if (cancelled) return;
				const progress = easeOutCubic((now - start) / COUNTER_DURATION_MS);
				values.value = STATS.map((stat) => stat.format(stat.target * progress));
				if (progress < 1) {
					frameId = window.requestAnimationFrame(step);
				} else {
					values.value = STATS.map((stat) => stat.format(stat.target));
				}
			};
			frameId = window.requestAnimationFrame(step);

			try {
				const player = await animateMotion(el, { y: [16, 0], opacity: [0, 1] }, {
					duration: 0.5,
					easing: "cubic-bezier(.22,.9,.37,1)",
				});
				await player?.finished;
			} catch {}
			try {
				el.style.willChange = "";
			} catch {}
		})();

		return () => {
			cancelled = true;
			if (frameId) {
				try {
					window.cancelAnimationFrame(frameId);
				} catch {}
			}
		};
	});

	return (
		<div
			ref={rootRef}
			class="stats stats-vertical lg:stats-horizontal glass-surface border-soft with-grain bg-base-100/5 w-full border shadow"
		>
			{STATS.map((stat, index) => (
				<div class="stat" key={stat.label}>
					<div class="stat-title">{stat.label}</div>
					<div class="stat-value">{values.value[index]}</div>
					{stat.subtext ? <div class="stat-desc">{stat.subtext}</div> : null}
				</div>
			))}
		</div>
	);
});

export default StatsCard;
