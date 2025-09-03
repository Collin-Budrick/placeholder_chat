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

// Global security headers and best-practice cache hints
export const onRequest: RequestHandler = (ev) => {
  let isHttps = ev.request.url.startsWith('https://');
  if (!isHttps) {
    try {
      const h = ev.request.headers;
      const xfProto = h.get('x-forwarded-proto') || h.get('x-forwarded-protocol');
      const forwarded = h.get('forwarded');
      const xfSsl = h.get('x-forwarded-ssl');
      if ((xfProto && /https/i.test(xfProto)) || (forwarded && /proto=https/i.test(forwarded)) || (xfSsl && /on/i.test(xfSsl))) {
        isHttps = true;
      }
    } catch { /* ignore */ }
  }
  // Content Security Policy (baseline, avoids inline scripts)
  // Allow self scripts/styles; styles allow 'unsafe-inline' for Qwik style islands.
  // Adjust connect-src in dev/prod via env if needed.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' https: data:",
    "connect-src 'self' http: https:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  ev.headers.set('Content-Security-Policy', csp);

  // Clickjacking mitigation
  ev.headers.set('X-Frame-Options', 'DENY');
  // MIME sniffing protection
  ev.headers.set('X-Content-Type-Options', 'nosniff');
  // Reasonable referrer policy
  ev.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Minimal permissions policy
  ev.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // COOP: origin isolation (without COEP to avoid breaking third-party embeds)
  ev.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // HSTS (only over HTTPS)
  if (isHttps) {
    ev.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
};
