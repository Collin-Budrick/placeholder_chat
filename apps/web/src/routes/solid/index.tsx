import { component$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';
export const prerender = true;

// This page used to render a static Solid SSR island.
// Since there is no interactivity here, render as a pure Qwik component to reduce
// SSR work and avoid loading the Solid plugin when not needed.
export default component$(() => {
  return (
    <div class="prose p-4">
      <h1 class="text-2xl font-semibold">Static Island (Qwik)</h1>
      <div class="p-4 bg-base-300 rounded shadow">
        <h3 class="text-lg font-semibold">Server-rendered Content</h3>
        <p>This was a Solid SSR demo; it is now a Qwik-only static widget.</p>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: 'Static Island | Stack',
  meta: [
    { name: 'description', content: 'A static, server-rendered widget implemented directly in Qwik for minimal client JS.' },
  ],
};
