import { component$, useVisibleTask$ } from '@builder.io/qwik';

export default component$(() => {
  useVisibleTask$(() => {
    // Dynamically import to avoid SSR issues
    (async () => {
      // Only register if PWA is enabled at build time
      if (import.meta.env.VITE_ENABLE_PWA !== '1') return;

      try {
        // Use Vite PWA helper when plugin is present (resolved at build time)
        const moduleId = 'virtual:pwa-register';
        const { registerSW } = (await import(/* @vite-ignore */ moduleId)) as typeof import('virtual:pwa-register');
        const updateSW = registerSW({
          immediate: true,
          onNeedRefresh() {
            try { updateSW(true); } catch {}
          },
        });
      } catch {
        // Fallback: plain SW registration (public/sw.js)
        try {
          if ('serviceWorker' in navigator) {
            await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          }
        } catch {}
      }
    })();
  });
  return null;
});
