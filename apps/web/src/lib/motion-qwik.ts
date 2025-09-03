/**
 * Lazy Motion One helpers (plain async functions — NOT QRLs)
 *
 * These are regular async functions that dynamically import Motion One on first use.
 * They intentionally avoid Qwik's `$` wrapper so they don't become QRLs that capture
 * local component state during the build phase.
 *
 * Usage (inside a client-only/task/event handler):
 *   import { animateMotion, timelineMotion } from '~/lib/motion-qwik';
 *   const player = await animateMotion(el, keyframes, opts);
 *   const tl = await timelineMotion(items, opts);
 */
export async function isReducedMotion(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return true;
  }
}

/**
 * animateMotion
 * - Plain async function that lazy-loads Motion One and calls animate.
 * - Named without a trailing dollar to avoid Qwik's QRL analyzer treating it as a QRL.
 */
export async function animateMotion(el: Element | Element[] | NodeList | any, keyframes: any, opts?: any) {
  try {
    const mod = await import('motion');
    if (!mod || typeof mod.animate !== 'function') return undefined as any;
    // motion.animate returns an Animation-like player
    return mod.animate(el, keyframes, opts);
  } catch (err) {
    // Silent fallback - consumer may apply CSS fallback if undefined returned
    // eslint-disable-next-line no-console
    console.warn('[motion-qwik] failed to load motion.animate', err);
    return undefined as any;
  }
}

/**
 * timelineMotion
 * - Small timeline helper that lazy-loads motion.timeline and sequences items.
 * - Items support `at` which may be:
 *   - number (seconds)
 *   - string negative overlap like "-0.25" (starts 0.25s before the previous)
 *
 * For reduced-motion, we apply final styles synchronously and return a stub controller.
 */
export type TLItem = {
  el: Element | Element[] | NodeList | any;
  keyframes: any;
  options?: any;
  at?: number | string;
};

function applyFinalStyles(el: any, keyframes: any) {
  try {
    if (!el) return;
    // If keyframes is array of objects, pick last object and apply properties
    const last = Array.isArray(keyframes) ? keyframes[keyframes.length - 1] : (typeof keyframes === 'object' ? keyframes : null);
    if (last && typeof last === 'object') {
      const elements = (el instanceof NodeList || Array.isArray(el)) ? Array.from(el as any) : [el];
      for (const node of elements) {
        for (const [k, v] of Object.entries(last)) {
          try {
            // Map transform components to style.transform if present
            if (k === 'transform' || k === 'translate' || k === 'translateY' || k === 'x' || k === 'y') {
              // best-effort: if v is a string, set transform; otherwise skip complex mapping
              if (typeof v === 'string') node.style.transform = v;
            } else {
              // set as style property if possible
              const prop = k.replace(/([A-Z])/g, '-$1').toLowerCase();
              node.style.setProperty(prop, String(v));
            }
          } catch { /* ignore individual property failures */ }
        }
      }
    }
  } catch { /* ignore */ }
}

export async function timelineMotion(items: TLItem[], opts?: any) {
  // Reduced motion: apply finals and return a stub controller
  if (await isReducedMotion()) {
    for (const it of items) {
      applyFinalStyles(it.el, it.keyframes);
    }
    return {
      play() {},
      pause() {},
      cancel() {},
      finished: Promise.resolve(),
    } as any;
  }

  try {
    const mod = await import('motion');
    const timelineFn = (mod as any).timeline ?? (mod as any).default?.timeline ?? (mod as any).timeline;
    if (!timelineFn) {
      // Fallback: sequentially call animateMotion for each item
      const players: any[] = [];
      for (const it of items) {
        const p = await animateMotion(it.el, it.keyframes, it.options);
        if (p) players.push(p);
        try { if (p && p.finished) await p.finished; } catch { /* ignore */ }
      }
      return {
        play() {},
        pause() {},
        cancel() { players.forEach(p => p?.cancel?.()); },
        finished: Promise.resolve(),
      } as any;
    }

    // Build definitions compatible with Motion One timeline API:
    // [target, keyframes, options, at]
    const defs = items.map((it) => {
      let at = it.at;
      if (typeof at === 'string' && at.startsWith('-')) {
        // negative overlap -> "<{abs}" syntax (Motion One accepts '<0.25' to start before previous)
        const num = Math.abs(parseFloat(at));
        at = `<${num}`;
      }
      return [it.el, it.keyframes, it.options || {}, at] as const;
    });

    const tl = timelineFn(defs, opts);
    return tl;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[motion-qwik] timelineMotion failed', err);
    // best-effort fallback: apply finals
    for (const it of items) applyFinalStyles(it.el, it.keyframes);
    return {
      play() {},
      pause() {},
      cancel() {},
      finished: Promise.resolve(),
    } as any;
  }
}
