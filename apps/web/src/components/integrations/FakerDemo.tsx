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
            const { faker } = await import("@faker-js/faker/locale/en");
            const gen = (): User => ({
                id: faker.string.uuid(),
                name: faker.person.fullName(),
                email: faker.internet.email(),
            });
            // Emit one immediately for fast feedback
            state.users = [gen()];
            // Stream the rest in small idle/time-sliced chunks
            const rest = 2; // total 3 users (1 now + 2 later)
            let remaining = rest;
            const enqueueNext = () => {
                if (remaining <= 0) return;
                remaining -= 1;
                state.users = [...state.users, gen()];
                if (remaining > 0) schedule();
            };
            const schedule = () => {
                type W = typeof window & {
                    requestIdleCallback?: (cb: IdleRequestCallback, opts?: { timeout?: number }) => number;
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
			<ul class="space-y-1">
				{state.users.length === 0 ? (
					<>
						<li class="flex items-center gap-3">
							<div class="skeleton h-3 w-24 rounded"></div>
							<div class="skeleton h-3 w-40 rounded"></div>
						</li>
						<li class="flex items-center gap-3">
							<div class="skeleton h-3 w-20 rounded"></div>
							<div class="skeleton h-3 w-36 rounded"></div>
						</li>
						<li class="flex items-center gap-3">
							<div class="skeleton h-3 w-28 rounded"></div>
							<div class="skeleton h-3 w-44 rounded"></div>
						</li>
					</>
				) : (
					state.users.map((u) => (
						<li key={u.id} class="text-sm text-zinc-300">
							{u.name} — <span class="text-zinc-400">{u.email}</span>
						</li>
					))
				)}
			</ul>
		</div>
	);
});

export default FakerDemo;
