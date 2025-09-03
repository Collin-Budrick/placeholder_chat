import { component$, useSignal, $, useOnWindow } from '@builder.io/qwik';
import { useNavigate, useLocation } from '@builder.io/qwik-city';

type BackButtonProps = {
  class?: string;
  ariaLabel?: string;
  fallbackHref?: string; // used when no history to go back
  hoverDistance?: number; // px distance from center to reveal flashlight
  sizeClass?: string; // e.g., 'size-9'
};

export const BackButton = component$((props: BackButtonProps) => {
  const nav = useNavigate();
  const loc = useLocation();
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

  const onClick = $(() => {
    const fallback = props.fallbackHref ?? '/';
    try {
      const isProtected = (p: string) => p.startsWith('/profile') || p.startsWith('/admin');
      const startBackNav = async (to: string) => {
        try {
          // Arm View Transitions to slide right->left for back nav
          const root = document.documentElement;
          root.setAttribute('data-vt-nav', '1');
          root.setAttribute('data-vt-dir', 'left');
        } catch { /* ignore */ }
        try { await nav(to); } catch { /* ignore */ }
      };
      // On the login page, prefer a safe fallback to avoid bouncing back to a protected route
      const path = loc?.url?.pathname || '';
      const stored = (() => { try { return sessionStorage.getItem('vt:last') || ''; } catch { return ''; } })();
      const lastPublic = (() => { try { return sessionStorage.getItem('vt:lastPublic') || ''; } catch { return ''; } })();
      const sameOriginRef = (() => { try { const r = document.referrer ? new URL(document.referrer) : null; return r && r.origin === location.origin ? (r.pathname + r.search + r.hash) : ''; } catch { return ''; } })();
      const prev = stored || sameOriginRef;

      const isAuthPage = path.startsWith('/login') || path.startsWith('/signup');
      if (isAuthPage) {
        // On auth pages, never bounce between /login <-> /signup.
        // Prefer a last known public route; fall back to '/'.
        const refIsProtected = isProtected(sameOriginRef);
        const refIsAuth = sameOriginRef.startsWith('/login') || sameOriginRef.startsWith('/signup');
        const safeRef = sameOriginRef && !refIsProtected && !refIsAuth ? sameOriginRef : '';
        const target = (lastPublic && !isProtected(lastPublic)) ? lastPublic : (safeRef || fallback);
        void startBackNav(target);
        return;
      }

      // Non-auth pages: prefer real back when available, but skip protected routes
      const prevIsAuth = prev.startsWith('/login') || prev.startsWith('/signup');
      const prevIsProtected = isProtected(prev);
      if (globalThis.history && globalThis.history.length > 1 && prev && prev !== path && !prevIsAuth && !prevIsProtected) {
        try {
          const root = document.documentElement;
          root.setAttribute('data-vt-nav', '1');
          root.setAttribute('data-vt-dir', 'left');
        } catch { /* ignore */ }
        globalThis.history.back();
        return;
      }
      if (prev && prev !== path && !prevIsAuth && !prevIsProtected) {
        void startBackNav(prev);
      } else if (lastPublic && !isProtected(lastPublic)) {
        void startBackNav(lastPublic);
      } else {
        void startBackNav(fallback);
      }
    } catch { try { void nav(fallback); } catch { /* ignore */ } }
  });

  return (
    <button
      type="button"
      aria-label={aria}
      class={`group relative inline-flex ${sizeCls} items-center justify-center rounded-full text-base-content/70 hover:text-base-content/90 transition-all focus:outline-none ${props.class || ''}`}
      ref={(el) => (backBtn.value = el as HTMLButtonElement)}
      onPointerDown$={$(() => { backPressed.value = true; })}
      onPointerUp$={$(() => { backPressed.value = false; })}
      onPointerLeave$={$(() => { backPressed.value = false; })}
      onBlur$={$(() => { backPressed.value = false; })}
      onKeyDown$={$((e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') backPressed.value = true; })}
      onKeyUp$={$(() => { backPressed.value = false; })}
      onClick$={onClick}
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
