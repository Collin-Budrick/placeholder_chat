import { component$, useSignal, useTask$, isServer, $, useOnDocument } from "@builder.io/qwik";
import TypeTitle from "~/components/TypeTitle";
import rawMessages from "../content/hero-messages.txt?raw";
import { timelineMotion } from '~/lib/motion-qwik';

const HERO_LINES = (rawMessages || '')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_LINE = '사랑해요 미나.';

export const Hero = component$(() => {
  const rootRef = useSignal<HTMLElement>();
  const h1Ref = useSignal<HTMLElement>();
  const pRef = useSignal<HTMLElement>();
  const ctaRef = useSignal<HTMLElement>();
  const typedOnce = useSignal<boolean>(false);
  const titleText = useSignal<string>(HERO_LINES[0] ?? DEFAULT_LINE);
  const eraseKey = useSignal<number | null>(null);
  const idx = useSignal<number>(0);
  const typingSpeed = 45; // ms per character (match TypeTitle default)
  const cycleIdleMs = 1400; // customizable idle time between messages (ms)
  const eraseTimerId = useSignal<number | null>(null);
  const suppressTyping = useSignal<boolean>(false);
  const restored = useSignal<boolean>(false);

  // Restore last shown hero message when returning to the page
  useTask$(() => {
    if (isServer) return;
    try {
      const savedMsg = globalThis.sessionStorage?.getItem('heroMessage');
      const savedIdxStr = globalThis.sessionStorage?.getItem('heroIndex');
      const savedIdx = savedIdxStr != null ? Number(savedIdxStr) : NaN;
      if ((savedMsg && typeof savedMsg === 'string') || Number.isFinite(savedIdx)) {
        // Prefer exact index if valid; else derive from message
        if (Number.isFinite(savedIdx) && savedIdx >= 0 && savedIdx < HERO_LINES.length) {
          idx.value = savedIdx as number;
          titleText.value = HERO_LINES[idx.value] ?? savedMsg ?? titleText.value;
        } else if (savedMsg) {
          titleText.value = savedMsg;
          const i = HERO_LINES.indexOf(savedMsg);
          if (i >= 0) idx.value = i;
        }
        // Show immediately once to create the illusion of resuming,
        // then re-enable typing for subsequent cycles after a couple of frames.
        suppressTyping.value = true;
        try {
          setTimeout(() => setTimeout(() => { suppressTyping.value = false; }, 0), 0);
        } catch { /* ignore */ }
      }
      restored.value = true;
    } catch (_e) { void _e; }
  });

  // Persist current hero message and index whenever they change
  useTask$(({ track }) => {
    if (isServer) return;
    if (!track(() => restored.value)) return;
    track(() => titleText.value);
    track(() => idx.value);
    try {
      globalThis.sessionStorage?.setItem('heroMessage', titleText.value || '');
      globalThis.sessionStorage?.setItem('heroIndex', String(idx.value));
    } catch (_e) { void _e; }
  });

  // Also persist on component unmount (route change)
  useTask$(({ cleanup }) => {
    if (isServer) return;
    cleanup(() => {
      try {
        globalThis.sessionStorage?.setItem('heroMessage', titleText.value || '');
        globalThis.sessionStorage?.setItem('heroIndex', String(idx.value));
      } catch (_e) { void _e; }
    });
  });

  useTask$(() => {
    if (isServer) return;
    // Read first-visit typing flag after mount (SSR-safe)
    try { typedOnce.value = !!globalThis.sessionStorage?.getItem('typedOnce'); } catch (_e) { void _e; }
    // Honor reduced-motion first
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let cancelled = false;
    let clearId: number | undefined;
    let idleCbId: number | undefined;

    const start = async () => {
      if (cancelled) return;
      try {
        if (h1Ref.value && pRef.value && ctaRef.value) {
          try {
            const items = [
              { el: h1Ref.value, keyframes: { y: [24, 0], opacity: [0, 1] }, options: { duration: 0.6, easing: 'cubic-bezier(.22,.9,.37,1)' }, at: 0 },
              { el: pRef.value,  keyframes: { y: [16, 0], opacity: [0, 1] }, options: { duration: 0.5, easing: 'cubic-bezier(.22,.9,.37,1)' }, at: 0.35 },
              { el: ctaRef.value, keyframes: { y: [10, 0], opacity: [0, 1] }, options: { duration: 0.45, easing: 'cubic-bezier(.22,.9,.37,1)' }, at: 0.45 },
            ];
            const tl = await timelineMotion(items);
            try { if (tl && (tl as any).finished) await (tl as any).finished; } catch { /* ignore */ }
          } catch { /* ignore timeline failures */ }
        }
      } catch (_e) {
        // ignore failures to load animation lib
        void _e;
      }
    };

    const idleCb = (window as any).requestIdleCallback;
    if (idleCb) {
      idleCbId = idleCb(() => {
        void start();
      });
    } else {
      clearId = window.setTimeout(() => {
        void start();
      }, 200);
    }

    return () => {
      cancelled = true;
      try {
        if (idleCbId !== undefined && (window as any).cancelIdleCallback) {
          (window as any).cancelIdleCallback(idleCbId);
        }
      } catch (_e) { void _e; }
      if (clearId !== undefined) clearTimeout(clearId);
    };
  });

  // Helper to schedule erase; pauses when tab is hidden and reschedules when visible
  const scheduleErase$ = $(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Clear any existing timer
    if (eraseTimerId.value) {
      try { globalThis.clearTimeout(eraseTimerId.value); } catch { /* ignore */ }
      eraseTimerId.value = null;
    }
    // Do not schedule while tab is hidden
    if (document.hidden) return;
    const dwell = 4000; // ms to hold after typing completes
    const ms = Math.max(600, (titleText.value?.length || 0) * typingSpeed + dwell);
    const id = globalThis.setTimeout(() => { eraseKey.value = Date.now(); }, ms) as unknown as number;
    eraseTimerId.value = id;
  });

  // Recompute erase schedule when text changes
  useTask$(({ track, cleanup }) => {
    if (isServer) return;
    track(() => titleText.value);
    void scheduleErase$();
    cleanup(() => {
      if (eraseTimerId.value) {
        try { globalThis.clearTimeout(eraseTimerId.value); } catch { /* ignore */ }
        eraseTimerId.value = null;
      }
    });
  });

  // Pause/resume erase timer on tab visibility changes
  useOnDocument('visibilitychange', $(() => {
    if (document.hidden) {
      if (eraseTimerId.value) {
        try { globalThis.clearTimeout(eraseTimerId.value); } catch { /* ignore */ }
        eraseTimerId.value = null;
      }
    } else {
      // Ensure current line is fully visible on return (avoid blank caret)
      suppressTyping.value = true;
      void scheduleErase$();
      try {
        setTimeout(() => setTimeout(() => { suppressTyping.value = false; }, 0), 0);
      } catch { /* ignore */ }
    }
  }));

  return (
    <section ref={rootRef} class="relative w-full overflow-hidden">
      {/* radial accent glow background */}
      <div aria-hidden class="pointer-events-none absolute -inset-40">
        <div class="absolute -top-40 left-1/2 -translate-x-1/2 size-[1200px] rounded-full"
             style={{
               background: 'radial-gradient(closest-side, rgba(199,183,255,0.12), rgba(199,183,255,0.05), transparent)'
             }} />
      </div>
      <div class="relative mx-auto max-w-6xl px-6 py-24 text-center">
        <div ref={h1Ref}>
          <TypeTitle
            text={titleText.value}
            class="text-5xl md:text-7xl lg:text-9xl leading-tight font-extrabold tracking-tight text-balance"
            speedMs={typingSpeed}
            idleMs={cycleIdleMs}
            startDelayMs={200}
            eraseKey={eraseKey.value}
            /* Always type on first load; TypeTitle respects reduced-motion automatically */
            suppressTyping={suppressTyping.value}
            cache="global"
            cacheStorage="session"
            resetOnReload={true}
            onErased$={$(() => {
              try {
                globalThis.sessionStorage?.setItem('typedOnce','1');
                typedOnce.value = true;
              } catch (_e) { void _e; }
              const lines = HERO_LINES.length > 0 ? HERO_LINES : [DEFAULT_LINE, 'I love you, Mina.'];
              idx.value = (idx.value + 1) % lines.length;
              titleText.value = lines[idx.value];
            })}
          />
        </div>
        <p ref={pRef} class="mt-4 text-base-content/70 max-w-2xl mx-auto">
          OLED‑first design, buttery smooth scroll, and tasteful motion.
        </p>
        <div class="mt-8 flex items-center justify-center gap-4">
          <a
            ref={ctaRef}
            href="#get-started"
            class="btn btn-primary"
          >
            Get Started
          </a>
          <a href="#learn-more" class="btn btn-ghost">
            Learn more
          </a>
        </div>
      </div>
    </section>
  );
});

export default Hero;
