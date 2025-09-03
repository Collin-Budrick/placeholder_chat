import { component$ } from '@builder.io/qwik';
import { routeLoader$ } from '@builder.io/qwik-city';
import type { DocumentHead } from '@builder.io/qwik-city';
import { renderIslandSSR } from '~/solid/ssr';
export const prerender = false;

export const useSolidHtml = routeLoader$<string>(async () => {
  const html = await renderIslandSSR();
  return html;
});

export default component$(() => {
  const html = useSolidHtml();
  return (
    <div class="prose p-4">
      <h1 class="text-2xl font-semibold">Solid SSR Island</h1>
<div dangerouslySetInnerHTML={html.value as any} />
    </div>
  );
});

export const head: DocumentHead = {
  title: 'Solid SSR Island | Stack',
  meta: [
    { name: 'description', content: 'A demo page rendering a Solid.js island with server-side rendering inside the Stack app.' },
  ],
};
