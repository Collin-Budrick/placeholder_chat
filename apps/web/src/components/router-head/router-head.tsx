import { $, component$ } from "@builder.io/qwik";
import { useDocumentHead, useLocation } from "@builder.io/qwik-city";

/**
 * The RouterHead component is placed inside of the document `<head>` element.
 */
export const RouterHead = component$(() => {
  const head = useDocumentHead();
  const loc = useLocation();

  return (
    <>
      {(() => {
        const title = head.title && String(head.title).trim().length > 0 ? head.title : "Stack";
        return <title>{title}</title>;
      })()}

      <link rel="canonical" href={loc.url.href} />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      {/* Theme color for light/dark — helps browser UI (address bar) match theme on first paint */}
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />

      {/* If we detect Google Fonts being loaded via head.links, preconnect to fonts.gstatic for faster font fetch.
          Also preload the Google Fonts stylesheet (Inter 400/700) and load it with the non-blocking onload trick.
          This improves font LCP while keeping a safe fallback. */}
      {(() => {
        const hasGoogleFonts = head.links.some((l) => {
          const href = (l as { href?: string }).href ?? "";
          return href.includes("fonts.googleapis") || href.includes("fonts.gstatic");
        });
        return hasGoogleFonts ? (
          <>
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link
              rel="preload"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
              as="style"
            />
            <link
              rel="stylesheet"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
              media="print"
              onLoad$={$((e: Event) => {
                try {
                  const el = (e?.currentTarget ||
                    (e as unknown as { target?: EventTarget }).target) as HTMLLinkElement | null;
                  if (el) el.media = "all";
                } catch {
                  /* ignore */
                }
              })}
            />
            <noscript>
              <link
                rel="stylesheet"
                href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
              />
            </noscript>
          </>
        ) : null;
      })()}

      {/* styled-system styles are now bundled via global.css import */}

      {/* View transitions CSS removed */}

      {head.meta.map((m) => (
        <meta key={m.key} {...m} />
      ))}
      {(() => {
        const hasDescription = head.meta.some(
          (m) => (m as { name?: string }).name === "description",
        );
        return hasDescription ? null : (
          <meta
            name="description"
            content="Stack — modern web app experience with motion, performance, and delightful design."
          />
        );
      })()}

      {head.links.map((l) => (
        <link key={l.key} {...l} />
      ))}

      {head.styles.map((s) => (
        <style
          key={s.key}
          {...s.props}
          {...(s.props?.dangerouslySetInnerHTML ? {} : { dangerouslySetInnerHTML: s.style })}
        />
      ))}

      {head.scripts.map((s) => (
        <script
          key={s.key}
          {...s.props}
          {...(s.props?.dangerouslySetInnerHTML ? {} : { dangerouslySetInnerHTML: s.script })}
        />
      ))}
    </>
  );
});
