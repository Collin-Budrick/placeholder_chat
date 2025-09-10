import { component$, useTask$, isServer, useOn, $, useSignal } from "@builder.io/qwik";

export const LottieDemo = component$(() => {
  const host = useSignal<HTMLDivElement>();
  const start$ = $(async () => {
    if (isServer) return;
    if (typeof window === 'undefined') return;
    const el = host.value; if (!el) return;
    try {
      const mod: any = await import('lottie-web/build/player/lottie_light');
      const src = `${import.meta.env.BASE_URL}lottie/demo.json`;
      let animationData: any | undefined = undefined;
      try {
        const r = await fetch(src, { headers: { 'accept': 'application/json' } });
        if (r.ok && /json/i.test(r.headers.get('content-type') || '')) {
          animationData = await r.json();
        }
      } catch { /* ignore fetch errors; fallback to path */ }
      const lottieAny: any = (mod && (mod.default ?? mod)) as any;
      const loadAnimation: any = typeof lottieAny === 'function' ? lottieAny : lottieAny?.loadAnimation;
      if (typeof loadAnimation !== 'function') return;
      const anim = loadAnimation({
        container: el,
        // Canvas renderer avoids some SVG sizing/transform quirks in nested layouts
        renderer: 'canvas',
        loop: true,
        autoplay: true,
        // Prefer inline data to avoid extra fetch; fallback to path
        animationData,
        path: animationData ? undefined : src,
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          progressiveLoad: true,
          clearCanvas: true,
          // Keep pixel ratio modest for small demo to reduce GPU blit cost
          dpr: Math.min(window.devicePixelRatio || 1, 2),
        },
      });
      // Cleanup on unmount
      return () => { try { (anim as any)?.destroy?.(); } catch { /* noop */ } };
    } catch { /* noop */ }
  });

  // Also start on visibility or interaction
  useOn('qvisible', $(() => { void start$(); }));
  useOn('pointerenter', $(() => { void start$(); }));

  // Render Lottie on client after mount (idle-loaded) with a rAF nudge
  useTask$(({ cleanup }) => {
    if (isServer) return;
    if (typeof window === 'undefined') return;
    let cancelled = false;
    let timeoutId: number | undefined;
    let started = false;
    let disposer: (() => void) | void;

    const start = async () => {
      if (cancelled || started) return; started = true;
      try { disposer = await start$(); } catch { /* ignore */ }
    };

    const idleCb = (window as any).requestIdleCallback;
    const kick = () => { if (!started) { started = true; void start(); } };
    if (idleCb) { idleCb(() => kick()); }
    // Also start next frame for reliability
    try { requestAnimationFrame(() => kick()); } catch { timeoutId = window.setTimeout(kick, 0) as unknown as number; }

    cleanup(() => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId as any);
      try { if (typeof disposer === 'function') disposer(); } catch { /* ignore */ }
    });
  });

  return (
    <div class="space-y-2">
      <h2 class="text-xl font-semibold">Lottie</h2>
      <div
        ref={host}
        class="rounded-xl overflow-hidden"
        style={{
          width: '160px',
          height: '160px',
          display: 'block',
          contain: 'content',
          background: 'transparent',
          isolation: 'isolate',
        }}
        aria-label="Lottie animation"
      />
    </div>
  );
});

export default LottieDemo;
