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

const MAX_USERS = 3;
const SKELETON_SHAPES: Array<{ name: string; email: string }> = [
	{ name: "w-24", email: "w-40" },
	{ name: "w-20", email: "w-36" },
	{ name: "w-28", email: "w-44" },
];

const FakerDemo = component$(() => {
	const state = useStore<{ users: User[] }>({ users: [] });
	const started = __getFakerStarted();

	const start$ = $(async () => {
		if (isServer) return;
		if (typeof window === "undefined") return;
		if (started.v) return;
		started.v = true;
		try {
			const { faker } = await import("@faker-js/faker/locale/en");
			const gen = (): User => ({
				id: faker.string.uuid(),
				name: faker.person.fullName(),
				email: faker.internet.email(),
			});
			state.users = [gen()];
			const rest = Math.max(0, MAX_USERS - 1);
			let remaining = rest;
			const enqueueNext = () => {
				if (remaining <= 0) return;
				remaining -= 1;
				state.users = [...state.users, gen()].slice(0, MAX_USERS);
				if (remaining > 0) schedule();
			};
			const schedule = () => {
				type W = typeof window & {
					requestIdleCallback?: (
						cb: IdleRequestCallback,
						opts?: { timeout?: number },
					) => number;
				};
				const ric = (window as W).requestIdleCallback;
				if (typeof ric === "function") {
					ric(() => enqueueNext(), { timeout: 120 });
				} else {
					setTimeout(enqueueNext, 40);
				}
			};
			schedule();
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
			<ul class="space-y-1.5">
				{Array.from({ length: MAX_USERS }).map((_, index) => {
					const user = state.users[index];
					if (!user) {
						const shape =
							SKELETON_SHAPES[index] ??
							SKELETON_SHAPES[SKELETON_SHAPES.length - 1];
						return (
							<li
								key={`placeholder-${index}`}
								class="min-h-[1.75rem]"
							>
								<div class="grid min-h-[1.75rem] grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] items-center gap-x-3">
									<div class={`skeleton h-3 ${shape.name} rounded`}></div>
									<div class="skeleton h-3 w-4 rounded"></div>
									<div class={`skeleton h-3 ${shape.email} rounded`}></div>
								</div>
							</li>
						);
					}
					return (
						<li key={user.id} class="min-h-[1.75rem]">
							<div class="grid min-h-[1.75rem] grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] items-center gap-x-2 text-sm text-zinc-300">
								<span class="min-w-0 truncate font-medium">{user.name}</span>
								<span class="text-zinc-500">—</span>
								<span class="min-w-0 truncate text-xs text-zinc-400">
									{user.email}
								</span>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
});

export default FakerDemo;
