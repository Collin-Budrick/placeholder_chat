import { Slot, component$, useVisibleTask$, useSignal } from "@builder.io/qwik";

// GSAP-based smooth scrolling controller.
// - Uses container mode on #content (scroll wrapper) to animate scrollTop via ScrollToPlugin
// - Honors prefers-reduced-motion and falls back to native behavior
// - Smooths wheel, key, and same-path hash anchor jumps
export default component$(() => {
  const started = useSignal(false);

  useVisibleTask$(() => {
    if (started.value) return;
    if (typeof window === 'undefined') return;
    const prefers = (() => {
      try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
    })();
    if (prefers) return;

    const tick = async () => {
      if (started.value) return;
      const wrapper = document.getElementById('content') as HTMLElement | null;
      if (!wrapper) { requestAnimationFrame(() => { void tick(); }); return; }

      try {
        const m1: any = await import('gsap');
        const m2: any = await import('gsap/ScrollToPlugin');
        const gsap: any = m1?.default ?? m1;
        const ScrollTo: any = m2?.default ?? m2;
        try { gsap.registerPlugin?.(ScrollTo); } catch {}

        const maxScroll = () => Math.max(0, wrapper.scrollHeight - wrapper.clientHeight);
        const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
        // Slightly faster profile
        const baseDuration = 0.42;
        const maxExtra = 0.7;
        const ease = 'power3.out';
        const wheelMultiplier = 1.7;
        const flingFactor = 8;
        let targetY = wrapper.scrollTop;
        let lastTime = performance.now();
        let releaseTimer: number | null = null;
        const velSamples: Array<{ dy: number; dt: number }> = [];
        const pushSample = (dy: number, dt: number) => { velSamples.push({ dy, dt }); if (velSamples.length > 8) velSamples.shift(); };
        const avgVelocity = () => { const sumDt = velSamples.reduce((a, s) => a + s.dt, 0); if (!sumDt) return 0; const sumDy = velSamples.reduce((a, s) => a + s.dy, 0); return sumDy / sumDt; };
        const scrollTo = (y: number) => {
          const current = wrapper.scrollTop;
          const dist = Math.abs(y - current);
          const dur = baseDuration + Math.min(maxExtra, dist / (wrapper.clientHeight * 1.25));
          gsap.to(wrapper, { duration: dur, ease, scrollTo: { y, autoKill: true }, overwrite: 'auto' });
        };
        const onWheel = (ev: WheelEvent) => {
          try {
            ev.preventDefault();
            const now = performance.now();
            const dt = Math.max(1, now - lastTime); lastTime = now;
            const cur = wrapper.scrollTop;
            const dy = ev.deltaY * wheelMultiplier;
            targetY = clamp((Number.isFinite(targetY) ? targetY : cur) + dy, 0, maxScroll());
            pushSample(dy, dt);
            scrollTo(targetY);
            if (releaseTimer != null) window.clearTimeout(releaseTimer);
            releaseTimer = window.setTimeout(() => {
              try {
                const v = avgVelocity();
                if (Math.abs(v) > 0.02) {
                  const extra = v * flingFactor * 16;
                  const flingTarget = clamp(targetY + extra, 0, maxScroll());
                  const dist = Math.abs(flingTarget - wrapper.scrollTop);
                  const dur = baseDuration + Math.min(maxExtra, dist / (wrapper.clientHeight * 1.25));
                  gsap.to(wrapper, { duration: dur, ease, scrollTo: { y: flingTarget, autoKill: true }, overwrite: 'auto' });
                  targetY = flingTarget;
                }
              } catch {}
              velSamples.length = 0;
              releaseTimer = null;
            }, 120);
          } catch {}
        };
        const onKey = (ev: KeyboardEvent) => {
          const key = ev.key; const h = wrapper.clientHeight; const cur = wrapper.scrollTop;
          let t: number | null = null;
          if (key === 'PageDown') t = cur + h * 0.9; else if (key === 'PageUp') t = cur - h * 0.9; else if (key === ' ') t = cur + h * (ev.shiftKey ? -0.9 : 0.9); else if (key === 'Home') t = 0; else if (key === 'End') t = maxScroll();
          if (t !== null) { ev.preventDefault(); targetY = clamp(t, 0, maxScroll()); scrollTo(targetY); }
        };
        const onDocClick = (ev: Event) => {
          const t = ev.target as Element | null; const a = t?.closest?.('a[href]') as HTMLAnchorElement | null; if (!a) return;
          const me = ev as MouseEvent; if ((me as any).button !== 0 || me.metaKey || (me as any).ctrlKey || (me as any).shiftKey || (me as any).altKey) return;
          const href = a.getAttribute('href') || ''; if (!href || !href.includes('#')) return;
          const url = new URL(a.href, location.href); if (url.origin !== location.origin || url.pathname !== location.pathname) return;
          const id = (url.hash || '').replace(/^#/, ''); if (!id) return;
          const el = document.getElementById(id) || document.querySelector(`[name="${id}"]`) as HTMLElement | null; if (!el) return;
          ev.preventDefault();
          try { const top = el.getBoundingClientRect().top + wrapper.scrollTop; targetY = clamp(top, 0, maxScroll()); const dist = Math.abs(targetY - wrapper.scrollTop); const dur = baseDuration + Math.min(maxExtra, dist / (wrapper.clientHeight * 1.25)); gsap.to(wrapper, { duration: dur, ease, scrollTo: { y: targetY, autoKill: true } }); } catch {}
          try { history.pushState({}, '', `#${id}`); } catch {}
        };
        try { wrapper.setAttribute('data-gsap-smooth', 'active'); } catch {}
        wrapper.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('keydown', onKey, { passive: false });
        document.addEventListener('click', onDocClick);
        (window as any).__smooth_active = true; started.value = true;
        (window as any).__smooth_cleanup = () => {
          try { wrapper.removeEventListener('wheel', onWheel as any); } catch {}
          try { window.removeEventListener('keydown', onKey as any); } catch {}
          try { document.removeEventListener('click', onDocClick as any); } catch {}
          try { wrapper.removeAttribute('data-gsap-smooth'); } catch {}
        };
      } catch {}
    };

    void tick();
  });

  return <Slot />;
});
