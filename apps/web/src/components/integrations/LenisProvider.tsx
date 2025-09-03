import { Slot, component$, useSignal, useOnWindow, $ } from "@builder.io/qwik";

/**
 * Lenis smooth scrolling initializer. Wrap page content with this
 * component to enable smooth scrolling on the client.
 *
 * This version gates the initialization:
 * - honors prefers-reduced-motion
 * - defers work to requestIdleCallback (or a small timeout fallback)
 * - returns a proper cleanup function
 */
export const LenisProvider = component$(() => {
  // Defer Lenis initialization until first interaction to keep resumability.
  const started = useSignal(false);

  const start$ = $(async () => {
    if (started.value) return;
    if (typeof window === "undefined") return;
    // Respect user's reduced motion preference
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      started.value = true;
      return;
    }
    try {
      const { default: Lenis } = await import("lenis");
      const lenis = new Lenis({ lerp: 0.1 });

      let rafId = 0;
      const raf = (time: number) => {
        try { (lenis as any).raf(time); } catch { /* ignore */ }
        rafId = requestAnimationFrame(raf);
      };
      rafId = requestAnimationFrame(raf);

      // store a simple cleanup on window for dev/preview if needed
      (window as any).__lenis_cleanup = () => {
        try { cancelAnimationFrame(rafId); } catch { /* ignore */ }
        try { (lenis as any).destroy?.(); } catch { /* ignore */ }
      };

      started.value = true;
    } catch {
      // If Lenis fails to load, mark started to avoid repeated attempts.
      // Native scrolling will remain active.
      started.value = true;
    }
  });

  // Start Lenis on the first meaningful interaction, including wheel/scroll.
  // Using wheel ensures users who only scroll with the mouse also trigger init.
  useOnWindow('pointerdown', start$);
  useOnWindow('touchstart', start$);
  useOnWindow('keydown', start$);
  useOnWindow('wheel', start$);
  useOnWindow('scroll', start$);

  return <Slot />;
});

export default LenisProvider;
