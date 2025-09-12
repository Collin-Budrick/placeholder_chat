import {
	$,
	component$,
	isServer,
	useOn,
	useStore,
	useTask$,
} from "@builder.io/qwik";

function __getFakerStarted(): { v: boolean } {
	try {
		const g = globalThis as { __faker_started?: { v: boolean } };
		g.__faker_started = g.__faker_started ?? { v: false };
		return g.__faker_started;
	} catch {
		return { v: false };
	}
}

type User = { id: string; name: string; email: string };

const FakerDemo = component$(() => {
	const state = useStore<{ users: User[] }>({ users: [] });
	const started = __getFakerStarted();

	const start$ = $(async () => {
		if (isServer) return;
		if (typeof window === "undefined") return;
		if (started.v) return;
		started.v = true;
		try {
			const { faker } = await import("@faker-js/faker");
			state.users = Array.from({ length: 5 }).map(() => ({
				id: faker.string.uuid(),
				name: faker.person.fullName(),
				email: faker.internet.email(),
			}));
		} catch {
			/* ignore */
		}
	});
	// Client-only starter with idle+rAF scheduling
	useTask$(({ cleanup }) => {
		if (isServer) return;
		if (typeof window === "undefined") return;

		let idleId: number | undefined;
		let timeoutId: number | undefined;
		let cancelled = false;

		const kick = () => {
			if (!started.v && !cancelled) void start$();
		};
		type W = typeof window & {
			requestIdleCallback?: (cb: IdleRequestCallback) => number;
			cancelIdleCallback?: (id: number) => void;
		};
		const idleCb = (window as W).requestIdleCallback;
		if (idleCb) idleId = idleCb(kick);
		try {
			requestAnimationFrame(kick);
		} catch {
			timeoutId = window.setTimeout(kick, 0) as unknown as number;
		}

		cleanup(() => {
			cancelled = true;
			try {
				if (idleId !== undefined && (window as W).cancelIdleCallback)
					(window as W).cancelIdleCallback?.(idleId);
			} catch {
				/* ignore */
			}
			if (timeoutId !== undefined) clearTimeout(timeoutId as number);
		});
	});

	// Also start when visible or interacted
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

	return (
		<div class="space-y-2">
			<h2 class="text-xl font-semibold">Faker</h2>
			<ul class="space-y-1">
				{state.users.map((u) => (
					<li key={u.id} class="text-sm text-zinc-300">
						{u.name} — <span class="text-zinc-400">{u.email}</span>
					</li>
				))}
			</ul>
		</div>
	);
});

export default FakerDemo;
