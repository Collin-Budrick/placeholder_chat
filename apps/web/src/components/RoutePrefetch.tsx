import { component$, isServer, useTask$ } from "@builder.io/qwik";

/**
 * RoutePrefetch — idle prefetch of likely next routes' q-data.json.
 *
 * - Guarded by `VITE_PREFETCH_ALL=1` to avoid unintentional bandwidth usage.
 * - Respects Data Saver and low-end connections.
 * - Prefetches only a safe allowlist of public routes and links marked `data-prefetch`.
 * - Skips auth/protected areas (/admin, /profile) to avoid session churn.
 */
export default component$(() => {
  useTask$(() => {
    if (isServer) return;

    // Env toggle (SSR-injected into client bundle by Vite)
    const env = (import.meta as unknown as { env?: Record<string, string> }).env || {};
    const enabled = env.VITE_PREFETCH_ALL === "1";
    if (!enabled) return;

    // Respect user/device constraints
    try {
      // Prefer the standard Network Information API when available
      const conn = (navigator as unknown as { connection?: any })?.connection;
      const saveData = !!conn?.saveData;
      const slow = typeof conn?.effectiveType === "string" && /(^|-)2g$/.test(conn.effectiveType);
      if (saveData || slow) return;
    } catch {}

    // Utility to schedule work when idle
    type W = typeof window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as W;
    let idleId: number | undefined;
    let timeoutId: number | undefined;

    const run = async () => {
      try {
        const cur = location.pathname || "/";

        // Collect candidate hrefs from nav and any elements explicitly marked data-prefetch
        const hrefs = new Set<string>();
        try {
          const anchors = Array.from(
            document.querySelectorAll<HTMLAnchorElement>("a[data-prefetch][href^='/' ]")
          );
          anchors.forEach((a) => {
            try {
              const href = new URL(a.href, location.origin).pathname;
              if (href) hrefs.add(href);
            } catch {}
          });
        } catch {}

        // Include a small allowlist of public routes that are commonly next steps
        ["/", "/about", "/contact", "/login", "/signup"].forEach((p) => hrefs.add(p));

        // Normalize and filter candidates
        const candidates = Array.from(hrefs)
          .map((p) => {
            let v = p.trim();
            if (!v) return "";
            // Drop trailing slash except for root
            if (v.length > 1 && v.endsWith("/")) v = v.slice(0, -1);
            return v;
          })
          .filter(Boolean)
          .filter((p) => p !== cur)
          // Skip likely protected areas to avoid auth-bound fetches
          .filter((p) => !p.startsWith("/admin") && p !== "/profile");

        // Deduplicate and prefetch the q-data for each candidate when idle
        const controller = new AbortController();

        const prefetchOne = async (path: string) => {
          // Build q-data URL
          const url = `${path}/q-data.json`;
          try {
            const res = await fetch(url, {
              // Same-origin credentials are fine for public q-data; cookies sent if present
              credentials: "same-origin",
              cache: "force-cache",
              mode: "same-origin",
              signal: controller.signal,
            });
            const ct = res.headers.get("content-type") || "";
            if (!res.ok || !/json/i.test(ct)) return;
            // Touch the body minimally so it enters HTTP cache; ignore contents
            // Avoid double reading elsewhere per AGENTS.md guidance
            await res.text().catch(() => {});
          } catch {
            // Ignore network errors silently; this is a best-effort hint
          }
        };

        // Soft limit: prefetch up to 5 routes to avoid over-fetching
        const list = candidates.slice(0, 5);
        await Promise.all(list.map(prefetchOne));

        // Cleanup hook to abort if the component unmounts mid-prefetch
        return () => controller.abort();
      } catch {
        /* ignore */
      }
    };

    const idleCb = w.requestIdleCallback;
    if (typeof idleCb === "function") {
      idleId = idleCb(() => {
        void run();
      }, { timeout: 2000 });
    } else {
      // Fallback after a tiny delay
      timeoutId = window.setTimeout(() => {
        void run();
      }, 300);
    }

    return () => {
      try {
        if (idleId !== undefined && typeof w.cancelIdleCallback === "function") {
          w.cancelIdleCallback(idleId);
        }
      } catch {}
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  });

  return null;
});

