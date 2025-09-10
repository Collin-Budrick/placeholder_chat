import { component$, $, useOnDocument } from '@builder.io/qwik';

// Global VT helpers: cleans flags after Qwik's auto view transition finishes
export default component$(() => {
  // Pre-arm direction on pointerdown for any internal link (not just bottom nav)
  useOnDocument('pointerdown', $((ev: Event) => {
    try {
      const target = ev.target as Element | null;
      const a = target?.closest?.('a[href^="/"]') as HTMLAnchorElement | null;
      if (!a) return;
      // ignore modified clicks/new tab/download
      const me = ev as PointerEvent;
      if ((me as any).button !== 0 || me.metaKey || (me as any).ctrlKey || (me as any).shiftKey || (me as any).altKey) return;

      // Define the logical order of sections used to infer slide direction.
      // Place '/login' before '/profile' so navigating to login slides as "earlier" than profile.
      const ORDER = ['/', '/about', '/contact', '/login', '/signup', '/profile'];
      const canon = (p: string) => {
        if (!p) return '/';
        if (p.startsWith('/login')) return '/login';
        if (p.startsWith('/signup')) return '/signup';
        if (p.startsWith('/profile')) return '/profile';
        if (p.startsWith('/about')) return '/about';
        if (p.startsWith('/contact')) return '/contact';
        return '/';
      };
      const current = canon(location.pathname || '/');
      let toPath = '/';
      try { toPath = new URL(a.href, location.href).pathname; } catch { toPath = a.getAttribute('href') || '/'; }
      const targetCanon = canon(toPath);
      const fromIdx = ORDER.indexOf(current);
      const toIdx = ORDER.indexOf(targetCanon);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const dir = toIdx > fromIdx ? 'right' : 'left';
      const root = document.documentElement;
      root.setAttribute('data-vt-nav', '1');
      root.setAttribute('data-vt-dir', dir);
      // Special-case: fade effect when navigating to/from profile
      if (current === '/profile' || targetCanon === '/profile') {
        root.setAttribute('data-vt-effect', 'fade');
      }
    } catch { /* ignore */ }
  }));

  // Clean up flags once Qwik's view transition finishes.
  // Qwik dispatches a custom event named 'qview-transition'.
  useOnDocument('qview-transition', $((event: any) => {
    try {
      const tx = (event as CustomEvent<any>).detail;
      Promise.resolve(tx?.finished).finally(() => {
        try {
          const root = document.documentElement;
          root.removeAttribute('data-vt-nav');
          root.removeAttribute('data-vt-dir');
          root.removeAttribute('data-vt-effect');
          root.removeAttribute('data-vt-target');
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  }));

  // Safety: if for some reason pointerdown didn't run (e.g., keyboard activation),
  // infer and set direction on click just before navigation.
  useOnDocument('click', $((ev: Event) => {
    try {
      const root = document.documentElement;
      if (root.getAttribute('data-vt-nav') === '1') return; // already set via pointerdown
      const target = ev.target as Element | null;
      const a = target?.closest?.('a[href^="/"]') as HTMLAnchorElement | null;
      if (!a) return;
      // ignore modified clicks/new tab/download
      const me = ev as MouseEvent;
      if ((me as any).button !== 0 || me.metaKey || (me as any).ctrlKey || (me as any).shiftKey || (me as any).altKey) return;

      const ORDER = ['/', '/about', '/contact', '/login', '/signup', '/profile'];
      const canon = (p: string) => {
        if (!p) return '/';
        if (p.startsWith('/login')) return '/login';
        if (p.startsWith('/signup')) return '/signup';
        if (p.startsWith('/profile')) return '/profile';
        if (p.startsWith('/about')) return '/about';
        if (p.startsWith('/contact')) return '/contact';
        return '/';
      };
      const current = canon(location.pathname || '/');
      let toPath = '/';
      try { toPath = new URL(a.href, location.href).pathname; } catch { toPath = a.getAttribute('href') || '/'; }
      const targetCanon = canon(toPath);
      const fromIdx = ORDER.indexOf(current);
      const toIdx = ORDER.indexOf(targetCanon);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const dir = toIdx > fromIdx ? 'right' : 'left';
      root.setAttribute('data-vt-nav', '1');
      root.setAttribute('data-vt-dir', dir);
    } catch { /* ignore */ }
  }));

  // Note: Do not intercept anchor clicks here; let Qwik handle SPA navigation.
  return null;
});
