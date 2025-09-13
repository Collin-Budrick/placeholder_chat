import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";

export const prerender = true;

export default component$(() => (
  <main class="min-h-screen p-6">
    <h1 class="text-2xl font-semibold">About</h1>
  </main>
));

export const head: DocumentHead = {
  title: "About | Stack",
  meta: [
    {
      name: "description",
      content: "Learn more about Stack — our mission, features, and the team behind the product.",
    },
  ],
};
