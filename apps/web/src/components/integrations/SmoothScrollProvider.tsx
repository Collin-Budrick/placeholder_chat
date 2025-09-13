import { component$, Slot, useSignal, useVisibleTask$ } from "@builder.io/qwik";

// Smooth scrolling controller without GSAP.
// - Animates #content.scrollTop using requestAnimationFrame with easing and inertia
// - Honors prefers-reduced-motion and falls back to native behavior
// - Smooths wheel, key, and same-path hash anchor jumps
export default component$(() => {
  const started = useSignal(false);

  useVisibleTask$(() => {
    if (started.value) return;
    if (typeof window === "undefined") return;
    const prefers = (() => {
      try {
        return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      } catch {
        return false;
      }
    })();
    if (prefers) return;

    const init = () => {
      if (started.value) return;
      const wrapper = document.getElementById("content") as HTMLElement | null;
      if (!wrapper) {
        requestAnimationFrame(() => {
          init();
        });
        return;
      }

      const maxScroll = () => Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
      const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
      const wheelMultiplier = 1.25;
      let animId: number | null = null;
      let startTime = 0;
      let startY = wrapper.scrollTop;
      let endY = startY;
      let durationMs = 0;

      const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
      const computeDuration = (distance: number) => {
        const h = wrapper.clientHeight || 1;
        const base = 220; // ms
        const maxExtra = 420; // ms
        const extra = Math.min(maxExtra, (Math.abs(distance) / (h * 1.2)) * 420);
        return base + extra;
      };
      const cancelAnim = () => {
        if (animId != null) cancelAnimationFrame(animId);
        animId = null;
      };
      const tick = (now: number) => {
        if (startTime === 0) startTime = now;
        const t = Math.min(1, (now - startTime) / durationMs);
        const v = startY + (endY - startY) * easeOutCubic(t);
        wrapper.scrollTop = v;
        if (t < 1) {
          animId = requestAnimationFrame(tick);
        } else {
          animId = null;
          startY = endY = wrapper.scrollTop;
        }
      };
      const animateTo = (y: number) => {
        const target = clamp(y, 0, maxScroll());
        const current = wrapper.scrollTop;
        // Retarget mid-flight: start from current visual position
        startY = current;
        endY = target;
        durationMs = computeDuration(endY - startY);
        startTime = 0;
        cancelAnim();
        animId = requestAnimationFrame(tick);
      };

      const onWheel = (ev: WheelEvent) => {
        try {
          ev.preventDefault();
          const cur = wrapper.scrollTop;
          const dy = ev.deltaY * wheelMultiplier;
          const next = (animId != null ? endY : cur) + dy;
          animateTo(next);
        } catch {}
      };

      const onKey = (ev: KeyboardEvent) => {
        const key = ev.key;
        const h = wrapper.clientHeight;
        const cur = wrapper.scrollTop;
        let t: number | null = null;
        if (key === "PageDown") t = cur + h * 0.9;
        else if (key === "PageUp") t = cur - h * 0.9;
        else if (key === " ") t = cur + h * (ev.shiftKey ? -0.9 : 0.9);
        else if (key === "Home") t = 0;
        else if (key === "End") t = maxScroll();
        if (t !== null) {
          ev.preventDefault();
          animateTo(t);
        }
      };

      const onDocClick = (ev: Event) => {
        const t = ev.target as Element | null;
        const a = t?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        const me = ev as MouseEvent;
        if (me.button !== 0 || me.metaKey || me.ctrlKey || me.shiftKey || me.altKey) return;
        const href = a.getAttribute("href") || "";
        if (!href || !href.includes("#")) return;
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin || url.pathname !== location.pathname) return;
        const id = (url.hash || "").replace(/^#/, "");
        if (!id) return;
        const el =
          document.getElementById(id) ||
          (document.querySelector(`[name="${id}"]`) as HTMLElement | null);
        if (!el) return;
        ev.preventDefault();
        try {
          const top = el.getBoundingClientRect().top + wrapper.scrollTop;
          animateTo(top);
        } catch {}
        try {
          history.pushState({}, "", `#${id}`);
        } catch {}
      };

      try {
        wrapper.setAttribute("data-smooth", "active");
      } catch {}
      wrapper.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("keydown", onKey, { passive: false });
      document.addEventListener("click", onDocClick);
      type W = typeof window & {
        __smooth_active?: boolean;
        __smooth_cleanup?: () => void;
      };
      (window as W).__smooth_active = true;
      started.value = true;
      (window as W).__smooth_cleanup = () => {
        try {
          cancelAnim();
        } catch {}
        try {
          wrapper.removeEventListener("wheel", onWheel);
        } catch {}
        try {
          window.removeEventListener("keydown", onKey);
        } catch {}
        try {
          document.removeEventListener("click", onDocClick);
        } catch {}
        try {
          wrapper.removeAttribute("data-smooth");
        } catch {}
      };
    };

    init();
  });

  return <Slot />;
});
