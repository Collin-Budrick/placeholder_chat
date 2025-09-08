import { component$, isDev } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import { RouterHead } from "./components/router-head/router-head";
import "./global.css";
// Ensure DaisyUI component styles are present even if Tailwind plugin processing
// is skipped in certain preview/proxy setups.
// Avoid importing the full DaisyUI CSS at runtime to keep CSS lean; Tailwind plugin handles components.

export default component$(() => {
  return (
    <QwikCityProvider>
      <head>
        <meta charset="utf-8" />
        <meta name="color-scheme" content="dark light" />
        {!isDev && (
          <link
            rel="manifest"
            href={`${import.meta.env.BASE_URL}manifest.json`}
          />
        )}
        {/* Connection hints for CDN assets used by integrations (e.g., Lottie demos) */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <RouterHead />
        {/* Small inline CSS to satisfy upcoming UA change: ensure section-contained h1 has explicit size.
            Utility classes still override. This avoids Lighthouse deprecation warnings. */}
        <style>{`h1{font-size:2em;line-height:1.2}article h1,aside h1,nav h1,section h1,main h1{font-size:1.5rem;line-height:1.25}`}</style>
        {/* Load small theme/lang initializer as an external file so a strict CSP can be enforced without inline allowances. */}
        <script src={`${import.meta.env.BASE_URL}theme-init.js`} defer />
      </head>
      <body lang="en" class="min-h-screen flex flex-col bg-base-100 text-base-content">
        {/* RouterOutlet renders routes that include their own #content container.
            Avoid wrapping in another #content to keep View Transitions working. */}
        <RouterOutlet />
      </body>
    </QwikCityProvider>
  );
});
