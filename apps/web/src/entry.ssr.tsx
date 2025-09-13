/**
 * WHAT IS THIS FILE?
 *
 * SSR entry point, in all cases the application is rendered outside the browser, this
 * entry point will be the common one.
 *
 * - Server (express, cloudflare...)
 * - npm run start
 * - npm run preview
 * - npm run build
 *
 */
import { type RenderToStreamOptions, renderToStream } from "@builder.io/qwik/server";
import Root from "./root";

/* Server shims removed — components have been refactored to be server-safe.
   If a remaining component accesses window/document unguarded the build
   will show the failing file so it can be fixed with proper guards or
   moved into a client task. */

export default function (opts: RenderToStreamOptions) {
  // Server shims removed - rely on component-level guards (typeof window / useTask$)

  return renderToStream(<Root />, {
    ...opts,
    // Keep preload pressure conservative; be stricter in production to curb unused JS
    preloader: (() => {
      const base = {
        ssrPreloads: 3,
        ssrPreloadProbability: 0.8,
        maxIdlePreloads: 12,
        preloadProbability: 0.4,
        debug: false,
      };
      if (import.meta.env?.DEV) return base;
      return {
        ...base,
        ssrPreloads: 2,
        ssrPreloadProbability: 0.6,
        maxIdlePreloads: 6,
        preloadProbability: 0.25,
      };
    })(),
    // Use default streaming, but leave room for early flushes on first chunk
    streaming: {
      inOrder: { strategy: "auto" },
    },
    // Use container attributes to set attributes on the html tag.
    containerAttributes: {
      lang: "en-us",
      ...opts.containerAttributes,
    },
    serverData: {
      ...opts.serverData,
    },
  });
}
