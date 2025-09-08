import { component$, Slot } from '@builder.io/qwik';
import type { RequestHandler } from '@builder.io/qwik-city';
import ScrollProgress from '~/components/ScrollProgress';
import ScrollReveals from '~/components/ScrollReveals';
import BottomNav from '~/components/BottomNav';
import VTGlobal from '~/components/VTGlobal';
import LenisProvider from '~/components/integrations/LenisProvider';

/**
 * Layout component: renders the site navigation and a <Slot /> for route content.
 * Uses Auth.js session via the plugin to avoid manual cookie/header juggling.
 */
export default component$(() => {

  // Lenis initialization moved into a leaf provider component (LenisProvider)






  // View transition pre-hydration script removed.
  return (
    <>
      <ScrollProgress />
      <VTGlobal />
      <LenisProvider>
      <main id="content" class="edge-fades flex-1 grid place-items-center pb-24">
        <Slot />
        <ScrollReveals />
      </main>
      </LenisProvider>
      {/* Overlay-based scroll fades (top/bottom) */}
      <div class="viewport-fade top" aria-hidden="true" />
      <div class="viewport-fade bottom" aria-hidden="true" />
      <BottomNav />
    </>
  );
});

// Enable static prerendering for all pages under this layout by default.
// Individual routes can still opt-out if needed.
export const prerender = true;

// Restrict which routes are statically generated during the SSG build.
// Avoid pages that require live backend/auth (e.g., /profile, /admin).

// Global security headers and best-practice cache hints
export const onRequest: RequestHandler = (ev) => {
  // Keep onRequest minimal during static generation to avoid interfering with prerender.
  try {
    const url = new URL(ev.request.url);
    const p = url.pathname || '/';
    // Cache headers: long cache for assets, modest for HTML and data
    if (/\.(?:js|mjs|css|woff2?|ttf|eot|png|jpe?g|gif|svg|webp|avif|ico|map)$/i.test(p)) {
      ev.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (p.endsWith('/q-data.json')) {
      ev.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    } else {
      ev.headers.set('Cache-Control', 'public, max-age=600, stale-while-revalidate=86400');
    }
    // Basic hardening headers (safe during prerender)
    ev.headers.set('X-Content-Type-Options', 'nosniff');
    ev.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    ev.headers.set('X-Frame-Options', 'DENY');
  } catch {
    // ignore
  }
};

// Explicit list of static routes to prerender at build time
// (handy for environments without a crawler during build).
export const onStaticGenerate = () => ({
  routes: [
    '/',
    '/about',
    '/contact',
    '/login',
    '/signup',
    //'/profile',
    // Exclude dynamic/SSR or auth-protected pages from prerender.
  ],
});
