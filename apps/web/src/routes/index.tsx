import { component$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import Hero from "~/components/Hero";

export default component$(() => {
  return (
    <div class="w-full">
      <Hero />
      <section class="max-w-5xl mx-auto px-6 py-16 grid gap-8 cv-auto">
        <div data-reveal class="p-6 rounded-xl bg-base-200/40 border border-base-content/10 reveal">
          <h2 class="text-xl font-semibold text-base-content">Delightful motion</h2>
          <p class="text-base-content/70 mt-2">Subtle, tasteful animations that respect reduced motion.</p>
        </div>
        <div data-reveal class="p-6 rounded-xl bg-base-200/40 border border-base-content/10 reveal">
          <h2 class="text-xl font-semibold text-base-content">OLED-first design</h2>
          <p class="text-base-content/70 mt-2">Pure black backgrounds, high contrast text, soft accents.</p>
        </div>
        <div data-reveal class="p-6 rounded-xl bg-base-200/40 border border-base-content/10 reveal">
          <h2 class="text-xl font-semibold text-base-content">Performance by default</h2>
          <p class="text-base-content/70 mt-2">Qwik islands, lazy imports, and worker offloading.</p>
        </div>
      </section>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Welcome to Qwik",
  meta: [
    {
      name: "description",
      content: "Qwik site description",
    },
  ],
};

export const prerender = true;
