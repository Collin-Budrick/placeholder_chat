import { component$ } from "@builder.io/qwik";

// Panda CSS demo using tokens from styled-system/styles.css (no build step needed)
// Uses Tailwind utilities for layout/shape and Panda design tokens for colors.
export default component$(() => {
  const primaryStyle: Record<string, string> = {
    background: 'var(--colors-amber-300)',
    color: 'var(--colors-neutral-900)',
    borderColor: 'var(--colors-amber-400)',
  };
  const outlineStyle: Record<string, string> = {
    background: 'transparent',
    color: 'var(--colors-amber-300)',
    borderColor: 'var(--colors-amber-300)',
  };

  return (
    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Panda CSS</h2>
      <div class="flex items-center gap-3">
        <button
          class="inline-flex items-center justify-center h-10 px-4 rounded-full font-semibold shadow-sm border transition-colors"
          style={primaryStyle}
        >
          Primary
        </button>
        <button
          class="inline-flex items-center justify-center h-10 px-4 rounded-full font-semibold border transition-colors"
          style={outlineStyle}
        >
          Outline
        </button>
      </div>
      <p class="text-xs text-zinc-400">
        Powered by Panda tokens (amber/neutral) from <code>styled-system/styles.css</code>.
      </p>
    </section>
  );
});
