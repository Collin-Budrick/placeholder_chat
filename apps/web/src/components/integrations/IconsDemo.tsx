import { component$ } from "@builder.io/qwik";
// Iconify via unplugin-icons (tree-shaken SVGs, no runtime)
import LuHome from "~icons/lucide/home";
import LuInfo from "~icons/lucide/info";
import LuMail from "~icons/lucide/mail";
import LuStar from "~icons/lucide/star";
import LuUser from "~icons/lucide/user";

export default component$(() => {
  const base = "size-6";
  return (
    <div class="space-y-2">
      <h2 class="text-xl font-semibold">Iconify (unplugin-icons)</h2>
      <div class="text-primary flex items-center gap-4">
        <LuHome class={base} aria-label="Home icon" />
        <LuInfo class={base} aria-label="Info icon" />
        <LuMail class={base} aria-label="Mail icon" />
        <LuUser class={base} aria-label="User icon" />
        <LuStar class={base} aria-label="Star icon" />
      </div>
      <p class="text-xs text-zinc-400">Icons are compiled to inline SVG, tree‑shaken per usage.</p>
    </div>
  );
});
