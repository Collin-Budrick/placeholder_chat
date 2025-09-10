import { component$, useTask$, useOnDocument, $ } from '@builder.io/qwik';

// Aggressively warm auth routes so /login feels instant on click.
// - Fetches /login and /signup q-data.json on load (with network guards)
// - requestIdleCallback: pre-import route modules to prime chunks
// - Pointerover on links to /login or /signup: immediate prefetch and import
export default component$(() => {
  // On client load: warm auth q-data and (idle) route modules from public pages
  useTask$(() => {
    if (typeof window === 'undefined') return;
    const p = (location.pathname || '/').toLowerCase();
    if (p.startsWith('/login') || p.startsWith('/signup')) return;
    const conn: any = (navigator as any)?.connection || (navigator as any)?.mozConnection || (navigator as any)?.webkitConnection;
    if (conn?.saveData) return; // respect Data Saver
    const slow = typeof conn?.effectiveType === 'string' && /^(slow-2g|2g)$/.test(conn.effectiveType);
    if (slow) return;

    const prefetchQData = (path: string) => {
      try {
        const url = path.endsWith('/') ? path + 'q-data.json' : path + '/q-data.json';
        // fire-and-forget; credentials for same-origin cookies
        fetch(url, { credentials: 'same-origin' } as RequestInit).catch(() => {});
      } catch { /* ignore */ }
    };

    // Warm q-data immediately
    prefetchQData('/login');
    prefetchQData('/signup');

    // Prime route module graph during idle
    const idle = (window as any).requestIdleCallback || ((fn: any) => setTimeout(fn, 300));
    idle(async () => {
      try { await import('~/routes/login/index'); } catch {}
      try { await import('~/routes/signup/index'); } catch {}
    });
  });

  // On hover/focus over links to auth routes, perform immediate warmup
  const onHover = $((ev: Event) => {
    try {
      const target = ev.target as Element | null;
      const a = target?.closest?.('a[href^="/"]') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href) return;
      const path = (() => {
        try { return new URL(href, location.href).pathname; } catch { return href; }
      })().toLowerCase();
      if (!(path.startsWith('/login') || path.startsWith('/signup'))) return;

      // Fetch q-data and import route now to ensure zero-lag on click
      const q = path.endsWith('/') ? path + 'q-data.json' : path + '/q-data.json';
      fetch(q, { credentials: 'same-origin' } as RequestInit).catch(() => {});
      if (path.startsWith('/login')) { import('~/routes/login/index').catch(() => {}); }
      else { import('~/routes/signup/index').catch(() => {}); }
    } catch { /* ignore */ }
  });

  useOnDocument('pointerover', onHover);
  useOnDocument('focusin', onHover);

  return null;
});

