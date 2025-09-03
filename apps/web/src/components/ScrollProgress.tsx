import { component$, useSignal, useOnWindow, useOnDocument, $ } from "@builder.io/qwik";

export const ScrollProgress = component$(() => {
  const progress = useSignal(0);

  // Use declarative window handlers for scroll & resize to avoid an eager visible task.
  const update = $(() => {
    if (typeof document === "undefined") return;
    // Respect reduced motion preference
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progress.value = 0;
      return;
    }
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop;
    const scrollHeight = doc.scrollHeight - doc.clientHeight;
    const p = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    progress.value = Math.max(0, Math.min(100, p));
  });

  // Initial measurement on client (run after DOM is ready)
  useOnDocument('DOMContentLoaded', $(() => {
    requestAnimationFrame(() => update());
  }));

  useOnWindow('scroll', $(() => requestAnimationFrame(() => update())));
  useOnWindow('resize', $(() => requestAnimationFrame(() => update())));

  return (
    <div class="scroll-progress fixed left-0 top-0 h-[2px] z-50 w-full bg-transparent">
      {/* JS fallback bar (hidden when CSS scroll-timeline is supported) */}
      <div
        class="fallback h-full bg-accent transition-[width] duration-75 ease-linear"
        style={{ width: `${progress.value}%` }}
      />
    </div>
  );
});

export default ScrollProgress;
