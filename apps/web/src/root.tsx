import { component$, isDev } from "@builder.io/qwik";
import { QwikCityProvider, RouterOutlet } from "@builder.io/qwik-city";
import { RouterHead } from "./components/router-head/router-head";
import "./global.css";

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
        <RouterHead />
        {/* Set theme + language early to avoid FOUC (external to satisfy CSP) */}
        <script src={`${import.meta.env.BASE_URL}theme-init.js`} />
      </head>
      <body lang="en" class="min-h-screen flex flex-col bg-base-100 text-base-content">
        {/* RouterOutlet renders routes that include their own #content container.
            Avoid wrapping in another #content to keep View Transitions working. */}
        <RouterOutlet />
      </body>
    </QwikCityProvider>
  );
});
