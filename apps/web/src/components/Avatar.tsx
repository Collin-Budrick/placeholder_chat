import { component$ } from "@builder.io/qwik";
import { cn } from "~/lib/cn";
import { pastelFor } from "~/lib/avatar-color";

type Props = {
  name: string;
  size?: string; // tailwind size classes like "h-8 w-8"
  class?: string;
  bgHex?: string; // optional explicit background color
};

// Map a string to one of DaisyUI's semantic tokens (p,s,a,i,su,w,er,n)
function tokenKey(key: string) {
  const tokens = ["p", "s", "a", "i", "su", "w", "er", "n"] as const;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const idx = h % tokens.length;
  return tokens[idx];
}

export default component$<Props>(({ name, size = "h-8 w-8", class: className, bgHex }) => {
  const initial = (name?.trim()?.charAt(0) || "?").toUpperCase();
  const tone = tokenKey(name || initial);
  const pastel = bgHex || pastelFor(name || initial);
  return (
    <div class="avatar placeholder">
      <div
        class={cn(
          "rounded-full aspect-square relative overflow-hidden",
          size,
          className,
        )}
        data-tone={tone}
        style={{ backgroundColor: pastel, color: "#111" }}
      >
        <span
          class="leading-none font-semibold select-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          aria-hidden="true"
        >
          {initial}
        </span>
      </div>
    </div>
  );
});
