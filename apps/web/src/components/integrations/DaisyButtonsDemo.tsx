import { component$ } from "@builder.io/qwik";

// Simple DaisyUI buttons demo: Primary and Outline
export default component$(() => {
  return (
    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Buttons</h2>
      <div class="flex items-center gap-3">
        <button class="btn btn-primary">Primary</button>
        <button class="btn btn-outline">Outline</button>
      </div>
    </section>
  );
});

