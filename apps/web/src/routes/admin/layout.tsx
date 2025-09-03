import { component$, Slot } from '@builder.io/qwik';
import type { RequestHandler } from '@builder.io/qwik-city';

/**
 * Admin layout guard - runs server-side for every /admin/* route.
 * Redirects to /login if no session or if role !== 'admin'.
 */
export const onRequest: RequestHandler = (ev) => {
  const session = ev.sharedMap.get('session');
  const role = session?.user?.role ?? session?.role;
  if (!session || new Date(session.expires) < new Date() || role !== 'admin') {
    throw ev.redirect(302, `/login?callbackUrl=${encodeURIComponent(ev.url.pathname + ev.url.search)}`);
  }
};

export default component$(() => {
  // Render child routes inside the admin layout.
  return <Slot />;
});
