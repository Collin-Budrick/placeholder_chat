import { component$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';

export const prerender = true;

export default component$(() => (
  <main class="min-h-screen p-6">
    <h1 class="text-2xl font-semibold">Contact</h1>
  </main>
));

export const head: DocumentHead = {
  title: 'Contact | Stack',
  meta: [
    { name: 'description', content: 'Get in touch with the Stack team for support, feedback, or inquiries.' },
  ],
};
