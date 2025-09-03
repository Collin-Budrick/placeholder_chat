import { component$, $, useSignal, useOnDocument, useOnWindow, useTask$ } from '@builder.io/qwik';
import { useLocation, Link, useNavigate } from '@builder.io/qwik-city';
import { useSession } from '~/routes/plugin@auth';
 // ThemeToggle import temporarily disabled for SSG symbol debug
import ThemeToggle from '~/components/ThemeToggle';
import { LanguageToggle } from '~/components/LanguageToggle';
import { LuHome, LuInfo, LuMail, LuUser } from '@qwikest/icons/lucide';

export default component$(() => {
  const loc = useLocation();
  const nav = useNavigate();
  const session = useSession();

  const isActive = (path: string | ((p: string) => boolean)) => {
    const p = typeof path === 'string' ? path : undefined;
    const fn = typeof path === 'function' ? path : undefined;
    return fn ? fn(loc.url.pathname) : loc.url.pathname === p || loc.url.pathname.startsWith(p + '/');
  };

  // Signals for the sliding selector
  const selectorRef = useSignal<HTMLElement | null>(null);
  const ulRef = useSignal<HTMLElement | null>(null);
  const prevIndex = useSignal<number>(-1);

  // Pointer-down handler: animate selector immediately on user tap/click
  const onPointerDown = $((index: number) => {
    const ul = ulRef.value;
    const sel = selectorRef.value;
    if (!ul || !sel) {
      prevIndex.value = index;
      return;
    }

    const items = Array.from(ul.querySelectorAll<HTMLElement>('.nav-item'));
    if (index < 0 || index >= items.length) {
      prevIndex.value = index;
      return;
    }

    const ulRect = ul.getBoundingClientRect();
    const actRect = items[index].getBoundingClientRect();
    const left = Math.round(actRect.left - ulRect.left);
    const width = Math.round(actRect.width);

    // Do not touch global VT flags; NavViewTransitions controls direction

    // Apply width immediately and position the selector with a small lead (directional bias)
    sel.style.width = `${width}px`;
    const lead = 6; // pixels to lead the animation visually
    // compute previous left; fallback to target left if not available
    const selRect = sel.getBoundingClientRect();
    const prevLeft = selRect.left ? Math.round(selRect.left - ulRect.left) : left;
    const startLeft = prevLeft === undefined || prevLeft === null || prevIndex.value === -1
      ? left
      : (index > prevIndex.value ? prevLeft + lead : prevLeft - lead);

    // set starting transform, make visible, then animate to target
    sel.style.transform = `translateX(${startLeft}px) translateY(-50%)`;
    sel.style.opacity = '1';

    requestAnimationFrame(() => {
      sel.style.transform = `translateX(${left}px) translateY(-50%)`;
    });

    // update prevIndex so subsequent clicks compute direction
    prevIndex.value = index;

    // Also compute nav direction and set flags for VT CSS (Qwik auto-VT will use them)
    try {
      const anchors = Array.from(ul.querySelectorAll<HTMLAnchorElement>('a.nav-link[href^="/"]'));
      const normalize = (p: string) => (p.endsWith('/') && p !== '/' ? p.slice(0, -1) : p);
      const curPath = normalize(loc.url.pathname || '/');
      let curIdx = -1; let bestLen = -1;
      anchors.forEach((a, i) => {
        let base = '/';
        try { base = normalize(new URL(a.href, loc.url.href).pathname || '/'); } catch { base = a.getAttribute('href') || '/'; }
        if (base === '/') {
          if (curPath === '/' && bestLen < 1) { curIdx = i; bestLen = 1; }
        } else if (curPath === base || curPath.startsWith(base + '/')) {
          if (base.length > bestLen) { bestLen = base.length; curIdx = i; }
        }
      });
      if (curIdx >= 0 && index !== curIdx) {
        const dir = index > curIdx ? 'right' as const : 'left' as const;
        const root = document.documentElement;
        root.setAttribute('data-vt-nav', '1');
        root.setAttribute('data-vt-dir', dir);
      }
    } catch { /* ignore */ }
  });

  // No manual VT on click: rely on Qwik auto-VT
  const onAccountClick = $(async () => {
    try {
      const res = await fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } as any });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j && j.user) { await nav('/profile'); return; }
      }
      await nav('/login');
    } catch {
      await nav('/login');
    }
  });

  // Position the selector under the active nav item and animate on route/resize
  const update = $(() => {
    const ul = ulRef.value;
    const sel = selectorRef.value;
    if (!ul || !sel) return;

    // Consider only real page anchors (href starting with '/') as nav items
    const anchors = Array.from(ul.querySelectorAll<HTMLAnchorElement>('a.nav-link[href^="/"]'));
    if (anchors.length === 0) {
      sel.style.opacity = '0'; sel.style.width = '0'; return;
    }

    // Choose the anchor with the best path match (longest matching base or alias)
    const pathname = loc.url.pathname || '/';
    let bestIdx = -1;
    let bestScore = -1;
    const normalize = (p: string) => (p.endsWith('/') && p !== '/' ? p.slice(0, -1) : p);
    const cur = normalize(pathname);

    anchors.forEach((a, i) => {
      const href = a.getAttribute('href') || '/';
      let base = '/';
      try { base = normalize(new URL(href, loc.url.href).pathname || '/'); } catch { base = href; }
      const aliasAttr = a.getAttribute('data-alias') || '';
      const aliases = aliasAttr.split(',').map(s => normalize(s.trim())).filter(Boolean);

      const candidates = [base, ...aliases];
      for (const cand of candidates) {
        if (cand === '/') {
          if (cur === '/') { if (bestScore < 1) { bestScore = 1; bestIdx = i; } }
        } else if (cur === cand || cur.startsWith(cand + '/')) {
          const score = cand.length; // prefer longest/specific match
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
      }
    });

    if (bestIdx === -1) {
      sel.style.opacity = '0'; sel.style.width = '0'; return;
    }

    const activeAnchor = anchors[bestIdx];
    const active = activeAnchor.closest<HTMLElement>('.nav-item') || activeAnchor as unknown as HTMLElement;
    const ulRect = ul.getBoundingClientRect();
    const actRect = active.getBoundingClientRect();
    const left = actRect.left - ulRect.left;
    const width = actRect.width;

    // Apply width immediately (no width transition) then animate transform for smooth movement.
    sel.style.width = `${Math.round(width)}px`;

    // Use requestAnimationFrame to ensure transform transition picks up the change cleanly.
    const raf: any = (typeof window !== 'undefined' && (window as any).requestAnimationFrame)
      ? (window as any).requestAnimationFrame.bind(window)
      : ((fn: any) => setTimeout(fn, 0));
    raf(() => {
      sel.style.transform = `translateX(${Math.round(left)}px) translateY(-50%)`;
      sel.style.opacity = '1';
    });

    // external blur overlay removed per request
  });

  // Initial placement: schedule update now and also when the document becomes ready.
  // Always register the document listener (must be called unconditionally).
  useOnDocument('DOMContentLoaded', $(() => {
    const raf: any = (typeof window !== 'undefined' && (window as any).requestAnimationFrame)
      ? (window as any).requestAnimationFrame.bind(window)
      : ((fn: any) => setTimeout(fn, 0));
    raf(() => update());
  }));

  // React to route/path changes to keep selector accurate
  useTask$(({ track }) => {
    track(() => loc.url.pathname);
    if (typeof window === 'undefined') return;
    const raf: any = (window as any).requestAnimationFrame ?? ((fn: any) => setTimeout(fn, 0));
    raf(() => update());
  });

  // Update on window resize
  useOnWindow('resize', $(() => {
    const raf: any = (typeof window !== 'undefined' && (window as any).requestAnimationFrame)
      ? (window as any).requestAnimationFrame.bind(window)
      : ((fn: any) => setTimeout(fn, 0));
    raf(() => update());
  }));

  // Remove pre-hydration VT pointerdown flags — no longer needed

  // Remove previous document-level click fallback

    const hideAuth = loc.url.pathname.startsWith('/login') || loc.url.pathname.startsWith('/signup');
    return (
    <>
    <nav class={`bottom-nav ${hideAuth ? 'is-hidden' : ''}`}>
      <div class="w-full flex justify-center pb-safe">
        <div class="mx-2 my-2 rounded-box backdrop-blur shadow-lg bottom-nav-surface">
          <ul ref={el => ulRef.value = el} class="px-2 items-center gap-1 w-full flex justify-center">
            {/* sliding selector element as list item for a11y correctness */}
            <li role="presentation" aria-hidden="true" class="pointer-events-none">
              <div ref={el => selectorRef.value = el} class="bottom-nav-selector" />
            </li>
            <li>
              <Link href="/" prefetch aria-current={isActive('/') ? 'page' : undefined}
                  aria-disabled={isActive('/') ? 'true' : undefined}
                  tabIndex={isActive('/') ? -1 : undefined}
                  class={`nav-item nav-link ${isActive('/') ? 'is-active' : ''}`}
                  onPointerDown$={() => onPointerDown(0)}
                  aria-label="Home">
                <LuHome class="w-7 h-7" />
              </Link>
            </li>
            <li>
              <Link href="/about" prefetch aria-current={isActive('/about') ? 'page' : undefined}
                  aria-disabled={isActive('/about') ? 'true' : undefined}
                  tabIndex={isActive('/about') ? -1 : undefined}
                  class={`nav-item nav-link ${isActive('/about') ? 'is-active' : ''}`}
                  onPointerDown$={() => onPointerDown(1)}
                  aria-label="About">
                <LuInfo class="w-7 h-7" />
              </Link>
            </li>
            <li>
              <Link href="/contact" prefetch aria-current={isActive('/contact') ? 'page' : undefined}
                  aria-disabled={isActive('/contact') ? 'true' : undefined}
                  tabIndex={isActive('/contact') ? -1 : undefined}
                  class={`nav-item nav-link ${isActive('/contact') ? 'is-active' : ''}`}
                  onPointerDown$={() => onPointerDown(2)}
                  aria-label="Contact">
                <LuMail class="w-7 h-7" />
              </Link>
            </li>
            <li>
              <Link href={session.value ? '/profile' : '/login'} prefetch preventdefault:click aria-current={isActive((p)=>p.startsWith('/profile')||p.startsWith('/signup')||p.startsWith('/login')) ? 'page' : undefined}
                 aria-disabled={isActive((p)=>p.startsWith('/profile')||p.startsWith('/signup')||p.startsWith('/login')) ? 'true' : undefined}
                 tabIndex={isActive((p)=>p.startsWith('/profile')||p.startsWith('/signup')||p.startsWith('/login')) ? -1 : undefined}
                 class={`nav-item nav-link ${isActive((p)=>p.startsWith('/profile')||p.startsWith('/signup')||p.startsWith('/login')) ? 'is-active' : ''}`}
                 data-alias="/login,/signup"
                 onPointerDown$={() => onPointerDown(3)}
                 onClick$={onAccountClick}
                 aria-label="Account">
                <LuUser class="w-7 h-7" />
              </Link>
            </li>
            <li class="nav-sep" role="separator" aria-hidden="true" />
            <li>
              <LanguageToggle class="nav-item nav-link grid place-items-center" iconClass="w-7 h-7" />
            </li>
            <li>
              <ThemeToggle class="nav-item nav-link grid place-items-center theme-toggle" iconClass="w-7 h-7" />
            </li>
          </ul>
        </div>
      </div>
    </nav>
    </>
  );
});
