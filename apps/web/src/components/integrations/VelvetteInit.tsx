import { component$, useVisibleTask$ } from "@builder.io/qwik";
import { initVelvette } from "~/lib/velvette";

// Tiny client-only initializer to enable Velvette page transitions.
export default component$(() => {
  useVisibleTask$(() => {
    void initVelvette();
  });
  return null;
});
