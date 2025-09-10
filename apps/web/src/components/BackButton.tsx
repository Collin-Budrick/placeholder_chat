import { component$, useSignal, $, useOnWindow } from '@builder.io/qwik';
import { useLocation, useNavigate } from '@builder.io/qwik-city';

// Keep ORDER/canon at module scope so Qwik can serialize QRLs that reference them
const ORDER = ['/', '/about', '/contact', '/login', '/signup', '/profile'] as const;
const canon = (p: string): typeof ORDER[number] => {
  if (!p) return '/';
  let path = p;
  try { path = String(p); } catch { /* ignore */ }
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path.startsWith('/login')) return '/login';
  if (path.startsWith('/signup')) return '/signup';
  if (path.startsWith('/profile')) return '/profile';
  if (path.startsWith('/about')) return '/about';
  if (path.startsWith('/contact')) return '/contact';
  return '/';
};

type BackButtonProps = {
  class?: string;
  ariaLabel?: string;
  fallbackHref?: string; // used when no history to go back
  hoverDistance?: number; // px distance from center to reveal flashlight
  sizeClass?: string; // e.g., 'size-9'
};

// Stable module-scope QRL for back navigation to avoid HMR QRL churn
export const backNav = $((ev: Event, elParam?: Element) => {
  try {
    const el = (elParam as Element | undefined)
      || ((ev && (ev as any).currentTarget) as Element | null)
      || ((ev && (ev as any).target && typeof (ev as any).target.closest === 'function') ? (ev as any).target.closest('button') : null);
    const getAttr = (name: string) => {
      try { return (el && (el as any).getAttribute) ? (el as any).getAttribute(name) : null; } catch { return null; }
    };
    const fallback = (getAttr('data-fallback') || '/') as string;
    const target = (getAttr('data-target') || '') as string;
    const force = (getAttr('data-force') || '') === '1';
    const root = document.documentElement;
    // Default back gesture: slide left (previous)
    root.setAttribute('data-vt-nav', '1');
    root.setAttribute('data-vt-dir', 'left');
    try {
      const vtTarget = (getAttr('data-vt-target') || 'back') as string;
      if (vtTarget) root.setAttribute('data-vt-target', vtTarget);
    } catch { /* ignore */ }
    // Respect reduced motion: no VT, just navigate
    try {
      if (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (globalThis.history && globalThis.history.length > 1) {
          globalThis.history.back();
        } else {
          globalThis.location.assign(fallback || '/');
        }
        return;
      }
    } catch { /* ignore */ }
    const go = () => {
      try {
        if (force && target) {
          globalThis.location.assign(target);
          return;
        }
        if (globalThis.history && globalThis.history.length > 1) {
          // Use history when available; otherwise fall back
          globalThis.history.back();
        } else {
          globalThis.location.assign(fallback || '/');
        }
      } catch {
        try { globalThis.location.assign(fallback || '/'); } catch { /* ignore */ }
      }
    };
    const startVT: any = (document as any).startViewTransition;
    if (typeof startVT === 'function') {
      const tx = startVT(go);
      Promise.resolve(tx?.finished).finally(() => {
        try {
          root.removeAttribute('data-vt-nav');
          root.removeAttribute('data-vt-dir');
          root.removeAttribute('data-vt-effect');
          root.removeAttribute('data-vt-target');
        } catch { /* ignore */ }
      });
    } else {
      go();
    }
  } catch { /* ignore */ }
});

export const BackButton = component$((props: BackButtonProps) => {
  const loc = useLocation();
  const nav = useNavigate();
  const backBtn = useSignal<HTMLButtonElement>();
  const backOverlay = useSignal<HTMLElement>();
  const backPressed = useSignal(false);
  const rafId = useSignal<number | null>(null);
  const animating = useSignal(false);
  const targetX = useSignal(0);
  const targetY = useSignal(0);
  const targetO = useSignal(0); // opacity target 0..1
  const curX = useSignal(0);
  const curY = useSignal(0);
  const curO = useSignal(0);

  const hoverDistance = props.hoverDistance ?? 284;
  const sizeCls = props.sizeClass ?? 'size-9';
  const aria = props.ariaLabel ?? 'Go back';

  // Single press handler to reduce number of QRL chunks
  // Single QRL for all pointer/keyboard press events; infer kind from event.type
  const onPress = $((ev: any) => {
    try {
      const t = String((ev && ev.type) || '').toLowerCase();
      if (t === 'pointerdown') backPressed.value = true;
      else if (t === 'pointerup' || t === 'pointerleave' || t === 'blur' || t === 'keyup') backPressed.value = false;
      else if (t === 'keydown') {
        const e = ev as KeyboardEvent;
        if (e.key === 'Enter' || e.key === ' ') backPressed.value = true;
      }
    } catch { /* ignore */ }
  });

  // Proximity reveal for the back button: show circle only when cursor is very close
  useOnWindow('pointermove', $((ev: Event) => {
    try {
      const e = ev as PointerEvent;
      const btn = backBtn.value; if (!btn) return;
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(cx - e.clientX, cy - e.clientY);
      const near = d < hoverDistance;
      // Clamp target position to button bounds
      targetX.value = Math.max(0, Math.min(r.width, e.clientX - r.left));
      targetY.value = Math.max(0, Math.min(r.height, e.clientY - r.top));
      const t = Math.max(0, Math.min(1, (hoverDistance - d) / hoverDistance));
      targetO.value = near ? t : 0;
      if (!animating.value) {
        animating.value = true;
        const step = () => {
          const overlay = backOverlay.value;
          if (!overlay) {
            animating.value = false;
            if (rafId.value) { cancelAnimationFrame(rafId.value); }
            rafId.value = null;
            return;
          }
          // Lerp towards target for smoother motion
          const s = 0.22; // smoothing factor (0..1)
          curX.value += (targetX.value - curX.value) * s;
          curY.value += (targetY.value - curY.value) * s;
          curO.value += (targetO.value - curO.value) * s;
          overlay.style.setProperty('--mx', `${curX.value.toFixed(2)}px`);
          overlay.style.setProperty('--my', `${curY.value.toFixed(2)}px`);
          overlay.style.opacity = `${Math.max(0, Math.min(1, curO.value)).toFixed(2)}`;
          // Continue animating while we're still moving/fading significantly
          const still = Math.abs(targetX.value - curX.value) < 0.5 && Math.abs(targetY.value - curY.value) < 0.5 && Math.abs(targetO.value - curO.value) < 0.01;
          if (still) {
            // Snap to final to avoid lingering decimals and stop
            overlay.style.setProperty('--mx', `${targetX.value.toFixed(2)}px`);
            overlay.style.setProperty('--my', `${targetY.value.toFixed(2)}px`);
            overlay.style.opacity = `${Math.max(0, Math.min(1, targetO.value)).toFixed(2)}`;
            animating.value = false;
            if (rafId.value) { cancelAnimationFrame(rafId.value); }
            rafId.value = null;
          } else {
            rafId.value = requestAnimationFrame(step);
          }
        };
        rafId.value = requestAnimationFrame(step);
      }
    } catch { /* ignore */ }
  }));

  // Ensure flashlight hides when cursor leaves the window
  useOnWindow('mouseleave', $(() => {
    try {
      targetO.value = 0;
      if (!animating.value) {
        animating.value = true;
        const step = () => {
          const overlay = backOverlay.value;
          if (!overlay) {
            animating.value = false;
            if (rafId.value) { cancelAnimationFrame(rafId.value); }
            rafId.value = null;
            return;
          }
          const s = 0.22;
          curX.value += (targetX.value - curX.value) * s;
          curY.value += (targetY.value - curY.value) * s;
          curO.value += (targetO.value - curO.value) * s;
          overlay.style.setProperty('--mx', `${curX.value.toFixed(2)}px`);
          overlay.style.setProperty('--my', `${curY.value.toFixed(2)}px`);
          overlay.style.opacity = `${Math.max(0, Math.min(1, curO.value)).toFixed(2)}`;
          const still = Math.abs(targetX.value - curX.value) < 0.5 && Math.abs(targetY.value - curY.value) < 0.5 && Math.abs(targetO.value - curO.value) < 0.01;
          if (still) {
            overlay.style.setProperty('--mx', `${targetX.value.toFixed(2)}px`);
            overlay.style.setProperty('--my', `${targetY.value.toFixed(2)}px`);
            overlay.style.opacity = `${Math.max(0, Math.min(1, targetO.value)).toFixed(2)}`;
            animating.value = false;
            if (rafId.value) { cancelAnimationFrame(rafId.value); }
            rafId.value = null;
          } else {
            rafId.value = requestAnimationFrame(step);
          }
        };
        rafId.value = requestAnimationFrame(step);
      }
    } catch { /* ignore */ }
  }));

  // Removed complex onClick logic in favor of stable module-scope backNav

  // Compute explicit target for auth pages:
  // - On /signup -> always go to /login with a left slide
  // - On /login  -> always go to /
  // - Else: fall back to history, with provided fallbackHref or '/'
  const path = (loc.url.pathname || '').toLowerCase();
  const isSignup = path === '/signup' || path === '/signup/';
  const isLogin = path === '/login' || path === '/login/';
  const explicitTarget = isSignup ? '/login' : (isLogin ? '/' : null);

  // Component-scoped explicit nav for SPA + VT when target is known
  const goExplicit = $(async (ev: Event, elParam?: Element) => {
    try {
      const el = (elParam as Element | undefined)
        || ((ev && (ev as any).currentTarget) as Element | null)
        || ((ev && (ev as any).target && typeof (ev as any).target.closest === 'function') ? (ev as any).target.closest('button') : null);
      const dsTarget = String((() => { try { return (el && (el as any).getAttribute) ? (el as any).getAttribute('data-target') : ''; } catch { return ''; } })() || '').trim();
      const to = dsTarget || explicitTarget || props.fallbackHref || '/';
      const root = document.documentElement;
      const before = (globalThis?.location?.pathname || '') as string;
      let forced = false;
      const forceIfNoChange = () => {
        if (forced) return;
        try {
          const now = (globalThis?.location?.pathname || '') as string;
          if (now === before) {
            forced = true;
            globalThis.location.assign(to);
          }
        } catch { /* ignore */ }
      };
      try {
        // Determine slide direction based on ORDER like the nav does
        const current = canon(loc.url.pathname || '/');
        const targetCanon = canon(to);
        const fromIdx = ORDER.indexOf(current as any);
        const toIdx = ORDER.indexOf(targetCanon as any);
        const dir = (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx)
          ? (toIdx > fromIdx ? 'right' : 'left')
          : 'left'; // default left
        root.setAttribute('data-vt-nav', '1');
        root.setAttribute('data-vt-dir', dir);
        // Name target for CSS hints (e.g., login hiding)
        const name = targetCanon === '/' ? 'home' : targetCanon.replace(/^\//, '');
        root.setAttribute('data-vt-target', name);
        // Match VTGlobal special fade for profile transitions
        if (current === '/profile' || targetCanon === '/profile') {
          root.setAttribute('data-vt-effect', 'fade');
        }
      } catch { /* ignore */ }
      const startVT: any = (document as any).startViewTransition;
      if (typeof startVT === 'function') {
        const tx = startVT(async () => {
          try {
            await nav(to);
          } catch (e) {
            try { globalThis.location.assign(to); } catch { /* ignore */ }
          }
        });
        await Promise.resolve(tx?.finished).catch(() => {});
        // Safety: if SPA nav didn't change path, force hard nav
        setTimeout(forceIfNoChange, 120);
        try {
          root.removeAttribute('data-vt-nav');
          root.removeAttribute('data-vt-dir');
          root.removeAttribute('data-vt-effect');
          root.removeAttribute('data-vt-target');
        } catch { /* ignore */ }
      } else {
        try { await nav(to); } catch { try { globalThis.location.assign(to); } catch { /* ignore */ } }
        // Safety: if SPA nav didn't change path, force hard nav
        setTimeout(forceIfNoChange, 80);
      }
    } catch (e) {
      try {
        const to = explicitTarget || props.fallbackHref || '/';
        globalThis.location.assign(to);
      } catch { /* ignore */ }
    }
  });

  // Pre-arm direction on pointerdown to mirror nav behavior (VTGlobal does this for anchors)
  const onPreArm = $((ev: Event) => {
    try {
      const el = (ev?.currentTarget as Element | null) || (ev?.target as Element | null);
      const dsTarget = el && (el as any).getAttribute ? String((el as any).getAttribute('data-target') || '') : '';
      const to = dsTarget || explicitTarget || '';
      const root = document.documentElement;
      if (!to) {
        // No explicit target (history back): default to left slide
        root.setAttribute('data-vt-nav', '1');
        root.setAttribute('data-vt-dir', 'left');
        return;
      }
      const current = canon(loc.url.pathname || '/');
      const targetCanon = canon(to);
      const fromIdx = ORDER.indexOf(current as any);
      const toIdx = ORDER.indexOf(targetCanon as any);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const dir = toIdx > fromIdx ? 'right' : 'left';
      root.setAttribute('data-vt-nav', '1');
      root.setAttribute('data-vt-dir', dir);
      const name = targetCanon === '/' ? 'home' : targetCanon.replace(/^\//, '');
      root.setAttribute('data-vt-target', name);
      if (current === '/profile' || targetCanon === '/profile') {
        root.setAttribute('data-vt-effect', 'fade');
      }
    } catch { /* ignore */ }
  });

  return (
    <button
      type="button"
      aria-label={aria}
      class={`group relative inline-flex ${sizeCls} items-center justify-center rounded-full text-base-content/70 hover:text-base-content/90 transition-all focus:outline-none ${props.class || ''}`}
      ref={(el) => (backBtn.value = el as HTMLButtonElement)}
      onPointerDown$={$((ev)=>{ onPress(ev as any); onPreArm(ev as any); })}
      onPointerUp$={onPress}
      onPointerLeave$={onPress}
      onBlur$={onPress}
      onKeyDown$={$((ev)=>{ onPress(ev as any); const e = ev as KeyboardEvent; if (e.key === 'Enter' || e.key === ' ') onPreArm(ev as any); })}
      onKeyUp$={onPress}
      data-fallback={props.fallbackHref ?? (isSignup ? '/login' : (isLogin ? '/' : '/'))}
      data-target={explicitTarget ?? ''}
      data-force={explicitTarget ? '1' : ''}
      data-vt-target={isSignup ? 'login' : ''}
      onClick$={explicitTarget ? goExplicit : backNav}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        class="relative z-10 transition-transform"
        style={{ transform: backPressed.value ? 'scale(0.9)' : 'scale(1)', willChange: 'transform' } as any}
      >
        <path d="M15.5 4.5L8.5 12l7 7.5" stroke="currentColor" stroke-width="3.75" stroke-linecap="round" stroke-linejoin="round" />
      </svg>

      {/* Gradient focus ring overlay (larger + gradient) */}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute -inset-2 rounded-full opacity-0 group-focus-visible:opacity-100 transition-opacity z-0"
        style={{
          background: 'conic-gradient(from 220deg at 50% 50%, rgba(203,213,225,0.95), rgba(148,163,184,0.95), rgba(203,213,225,0.95))',
          WebkitMaskImage: 'radial-gradient(farthest-side, transparent calc(100% - 6px), black calc(100% - 6px))',
          maskImage: 'radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))',
        } as any}
      />

      {/* Pressed/recessed overlay to mimic pill inputs */}
      <span
        aria-hidden="true"
        class={`pointer-events-none absolute inset-0 rounded-full transition-opacity z-0 ${backPressed.value ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: '#E9D5FF',
          border: '1px solid #D6BCFA',
          boxShadow: 'inset 0 3px 14px rgba(0,0,0,.20), inset 0 -3px 8px rgba(0,0,0,.14)',
        } as any}
      />

      {/* Flashlight reveal overlay (light purple) */}
      <span
        aria-hidden="true"
        ref={(el) => (backOverlay.value = el as any)}
        class="pointer-events-none absolute inset-0 rounded-full shadow-sm opacity-0 transition-opacity z-0"
        style={{
          background: 'rgba(233,213,255,0.45)',
          border: '1px solid #D6BCFA',
          WebkitMaskImage: 'radial-gradient(48px 48px at var(--mx) var(--my), rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 52%, rgba(0,0,0,0.18) 82%, transparent 100%)',
          maskImage: 'radial-gradient(48px 48px at var(--mx) var(--my), rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 52%, rgba(0,0,0,0.18) 82%, transparent 100%)',
          willChange: 'opacity',
        } as any}
      />
    </button>
  );
});

export default BackButton;
