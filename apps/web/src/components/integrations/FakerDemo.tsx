import { component$, useStore, useTask$, isServer, useOn, $ } from "@builder.io/qwik";

type User = { id: string; name: string; email: string };

export const FakerDemo = component$(() => {
  const state = useStore<{ users: User[] }>({ users: [] });
  const started = (globalThis as any).__faker_started ||= { v: false } as { v: boolean };

  const start$ = $(async () => {
    if (isServer) return;
    if (typeof window === 'undefined') return;
    if (started.v) return;
    started.v = true;
    try {
      const { faker } = await import("@faker-js/faker");
      (state as any).users = Array.from({ length: 5 }).map(() => ({
        id: (faker as any).string.uuid(),
        name: (faker as any).person.fullName(),
        email: (faker as any).internet.email(),
      }));
    } catch { /* ignore */ }
  });
  // Client-only starter with idle+rAF scheduling
  useTask$(({ cleanup }) => {
    if (isServer) return;
    if (typeof window === 'undefined') return;

    let idleId: number | undefined;
    let timeoutId: number | undefined;
    let cancelled = false;

    const kick = () => { if (!started.v && !cancelled) void start$(); };
    const idleCb = (window as any).requestIdleCallback;
    if (idleCb) idleId = idleCb(kick);
    try { requestAnimationFrame(kick); } catch { timeoutId = window.setTimeout(kick, 0) as unknown as number; }

    cleanup(() => {
      cancelled = true;
      try { if (idleId !== undefined && (window as any).cancelIdleCallback) (window as any).cancelIdleCallback(idleId); } catch { /* ignore */ }
      if (timeoutId !== undefined) clearTimeout(timeoutId as any);
    });
  });

  // Also start when visible or interacted
  useOn('qvisible', $(() => { void start$(); }));
  useOn('pointerenter', $(() => { void start$(); }));

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
