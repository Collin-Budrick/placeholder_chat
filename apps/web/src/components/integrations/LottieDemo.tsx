import { component$, useSignal, useTask$, isServer, useOn, $ } from "@builder.io/qwik";

export const LottieDemo = component$(() => {
  const host = useSignal<HTMLDivElement>();
  const started = (globalThis as any).__lottie_started ||= { v: false } as { v: boolean };

  const start$ = $(async () => {
    if (isServer) return;
    if (typeof window === 'undefined') return;
    if (started.v) return;
    const el = host.value; if (!el) return; // triggers will try again
    started.v = true;
    try {
      const lottie = await (async () => {
        const w = window as any;
        if (w.lottie) return w.lottie;
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js';
          s.async = true; s.crossOrigin = 'anonymous';
          s.onload = () => resolve(); s.onerror = () => reject(new Error('lottie load failed'));
          document.head.appendChild(s);
        });
        return (window as any).lottie;
      })();
      (lottie as any).loadAnimation({
        container: el,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: 'https://assets1.lottiefiles.com/packages/lf20_jcikwtux.json',
      });
    } catch { /* noop */ }
  });

  // Also start on visibility or interaction
  useOn('qvisible', $(() => { void start$(); }));
  useOn('pointerenter', $(() => { void start$(); }));

  // Render Lottie on client after mount (idle-loaded) with a rAF nudge
  useTask$(({ cleanup }) => {
    if (isServer) return;
    if (typeof window === 'undefined') return;
    const el = host.value; if (!el) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let started = false;

    const start = async () => {
      if (cancelled) return;
      try {
        const lottie = await (async () => {
          const w = window as any;
          if (w.lottie) return w.lottie;
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js';
            s.async = true; s.crossOrigin = 'anonymous';
            s.onload = () => resolve(); s.onerror = () => reject(new Error('lottie load failed'));
            document.head.appendChild(s);
          });
          return (window as any).lottie;
        })();
        if (cancelled) return;
        const anim = (lottie as any).loadAnimation({
          container: el,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          path: 'https://assets1.lottiefiles.com/packages/lf20_jcikwtux.json',
        });
        cleanup(() => { try { anim.destroy?.(); } catch { /* noop */ } });
      } catch { /* noop */ }
    };

    const idleCb = (window as any).requestIdleCallback;
    const kick = () => { if (!started) { started = true; void start(); } };
    if (idleCb) { idleCb(() => kick()); }
    // Also start next frame for reliability
    try { requestAnimationFrame(() => kick()); } catch { timeoutId = window.setTimeout(kick, 0) as unknown as number; }

    cleanup(() => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId as any);
    });
  });

  return (
    <div class="space-y-2">
      <h2 class="text-xl font-semibold">Lottie</h2>
      <div ref={host} style={{ width: '160px', height: '160px' }} />
    </div>
  );
});

export default LottieDemo;
