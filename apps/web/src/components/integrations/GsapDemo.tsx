import { component$, useSignal, useTask$, useOn, $, noSerialize, type NoSerialize } from "@builder.io/qwik";

/**
 * GSAP demo (client-only):
 * - Defers gsap import to the client to keep SSR light
 * - Honors prefers-reduced-motion
 * - Cleans up animations on dispose
 */
const GsapDemo = component$(() => {
  const boxRef = useSignal<HTMLDivElement>();
  const cleanupRef = useSignal<NoSerialize<() => void> | null>(null);
  const started = useSignal(false);

  const start$ = $(async () => {
    if (started.value) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = boxRef.value as HTMLDivElement | null;
    if (!el) return;
    started.value = true;

    try {
      const mod: any = await import('gsap');
      const gsap: any = mod?.default ?? mod;

      // Gentle float animation
      const tween = gsap.to(el, {
        y: -6,
        duration: 1.2,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });

      const onEnter = () => {
        try { gsap.to(el, { scale: 1.04, duration: 0.12, ease: 'power2.out', yoyo: true }).then(() => gsap.to(el, { scale: 1, duration: 0.18, ease: 'power2.out' })); } catch { /* ignore */ }
      };
      const onClick = () => {
        try {
          gsap.to(el, { rotation: '+=360', duration: 0.7, ease: 'power2.inOut' });
          gsap.to(el, { filter: 'hue-rotate(180deg)', duration: 0.35, yoyo: true, repeat: 1, ease: 'power1.inOut' });
        } catch { /* ignore */ }
      };
      el.addEventListener('pointerenter', onEnter);
      el.addEventListener('click', onClick);

      cleanupRef.value = noSerialize(() => {
        try { tween?.kill?.(); } catch { /* ignore */ }
        try { el.removeEventListener('pointerenter', onEnter); } catch { /* ignore */ }
        try { el.removeEventListener('click', onClick); } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  });

  // Start when visible, or on first interaction
  useOn('qvisible', $(() => { try { requestAnimationFrame(() => void start$()); } catch { setTimeout(() => void start$(), 0); } }));
  useOn('pointerenter', $(() => { void start$(); }));
  useOn('click', $(() => { void start$(); }));

  useTask$(({ cleanup }) => {
    cleanup(() => { try { cleanupRef.value?.(); } catch { /* ignore */ } cleanupRef.value = null; });
  });

  return (
    <div class="space-y-2">
      <h2 class="text-xl font-semibold">GSAP</h2>
      <div class="flex items-center gap-4">
        <div class="relative inline-block">
          <div
            ref={boxRef}
            class="size-14 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg"
            style={{ willChange: 'transform' }}
            role="button"
            aria-label="GSAP animated demo box"
            title="Click to spin"
            tabIndex={0}
            onKeyDown$={$((e: KeyboardEvent) => {
              const k = e.key || (e as any).code;
              if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); try { (e.currentTarget as HTMLElement)?.click?.(); } catch {} }
            })}
          />
        </div>
        <p class="text-sm text-zinc-400">Subtle float; click spins. Powered by <code>gsap</code>.</p>
      </div>
    </div>
  );
});

export default GsapDemo;

