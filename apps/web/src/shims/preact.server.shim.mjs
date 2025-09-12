// Minimal shim for preact/compat/server to avoid pulling preact-render-to-string
// during SSG builds where we don't SSR any Preact islands.
export function renderToString() {
  return "";
}

export async function renderToReadableStream() {
  try {
    // Provide an empty, closed stream when available
    // eslint-disable-next-line no-undef
    return new ReadableStream({ start(controller) { controller.close?.(); } });
  } catch {
    // Fallback: return a dummy object
    return {};
  }
}

