import { $, component$, useSignal } from "@builder.io/qwik";

// Small responsive <picture> using Unsplash params to demonstrate AVIF/WebP + JPEG fallbacks.
// This is a runtime network demo (similar to UnpicDemo). Once `vite-imagetools` is installed,
// you can switch to local imports like:
//   import srcAvif from '~/assets/sample.jpg?imagetools&format=avif&width=400;800;1200&as=srcset';
//   import srcWebp from '~/assets/sample.jpg?imagetools&format=webp&width=400;800;1200&as=srcset';
//   import srcJpg  from '~/assets/sample.jpg?imagetools&width=400;800;1200&as=srcset';

export default component$(() => {
  const carRef = useSignal<HTMLElement>();
  // Width candidates tuned to our actual card slot. Cap at 480 to avoid oversizing.
  const widths = [240, 320, 360, 420, 480];
  const buildSet = (id: string, fm: "avif" | "webp" | "jpg") => {
    // Per-image tuning: the concert image compresses well at a lower q
    const isConcert = id === "photo-1492684223066-81342ee5ff30";
    const q = fm === "avif"
      ? (isConcert ? 40 : 45)
      : fm === "webp"
        ? (isConcert ? 58 : 60)
        : (isConcert ? 52 : 55);
    return widths
      .map(
        (w) =>
          `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=${q}&fm=${fm} ${w}w`,
      )
      .join(", ");
  };
  // Accurately reflect the card’s column width: container max-w-3xl (64rem) with px-6 (3rem) and gap-8 (2rem), split in 2 cols.
  const sizes = "(min-width: 768px) calc((min(100vw, 64rem) - 3rem - 2rem)/2), 100vw";

  const slides = [
    {
      id: "photo-1503264116251-35a269479413",
      alt: "Sunlit water surface with gentle ripples",
    },
    {
      id: "photo-1500530855697-b586d89ba3ee",
      alt: "Mountain landscape under warm sunset",
    },
    {
      id: "photo-1492684223066-81342ee5ff30",
      alt: "Concert crowd with lights and smoke",
    },
  ];

  const fallback = (id: string, w = 360, q = 55) =>
    `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=${q}&fm=jpg`;

  return (
    <div class="space-y-2">
      <h2 class="text-xl font-semibold">Web Image Carousel</h2>
      <div class="glass-surface border-soft with-grain card bg-base-100/5 border overflow-hidden">
      {/* DaisyUI carousel */}
      <div class="relative">
        <div
          ref={(el) => {
            carRef.value = el as unknown as HTMLElement;
          }}
          class="carousel carousel-center w-full rounded-box"
          aria-roledescription="carousel"
        >
        {slides.map((s, i) => (
          <div id={`pic-slide-${i + 1}`} class="carousel-item w-full" key={s.id}>
            <figure class="aspect-[3/2] w-full">
              <picture>
                <source type="image/avif" srcSet={buildSet(s.id, "avif")} sizes={sizes} />
                <source type="image/webp" srcSet={buildSet(s.id, "webp")} sizes={sizes} />
                {i === 0 ? (
                  <img
                    src={fallback(s.id)}
                    srcSet={buildSet(s.id, "jpg")}
                    sizes={sizes}
                    alt={s.alt}
                    loading="eager"
                    fetchpriority="high"
                    class="h-full w-full object-cover"
                    width={360}
                    height={240}
                  />
                ) : (
                  <img
                    src={fallback(s.id)}
                    srcSet={buildSet(s.id, "jpg")}
                    sizes={sizes}
                    alt={s.alt}
                    loading="lazy"
                    class="h-full w-full object-cover"
                    width={360}
                    height={240}
                  />
                )}
              </picture>
            </figure>
          </div>
        ))}
        </div>
        {/* Stationary overlay controls */}
        <div class="pointer-events-none absolute left-2 right-2 top-1/2 z-10 -translate-y-1/2 transform flex justify-between">
          <button
            type="button"
            class="pointer-events-auto btn btn-circle btn-ghost w-12 h-12"
            aria-label="Previous slide"
            onClick$={$(() => {
              const el = carRef.value as unknown as HTMLElement | null;
              if (!el) return;
              try { el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' as ScrollBehavior }); } catch { el.scrollLeft -= el.clientWidth; }
            })}
          >
            ❮
          </button>
          <button
            type="button"
            class="pointer-events-auto btn btn-circle btn-ghost w-12 h-12"
            aria-label="Next slide"
            onClick$={$(() => {
              const el = carRef.value as unknown as HTMLElement | null;
              if (!el) return;
              try { el.scrollBy({ left: el.clientWidth, behavior: 'smooth' as ScrollBehavior }); } catch { el.scrollLeft += el.clientWidth; }
            })}
          >
            ❯
          </button>
        </div>
      </div>
      <div class="card-body p-4">
        <h3 class="card-title text-base">Responsive picture carousel</h3>
        <p class="text-sm opacity-70">
          AVIF/WebP with JPEG fallback, accurate sizes/srcset, and eager first slide for better LCP. DaisyUI carousel — no extra JS.
        </p>
        <div class="join justify-center">
          {slides.map((_s, i) => (
            <a
              key={i}
              href={`#pic-slide-${i + 1}`}
              class="join-item btn btn-circle w-12 h-12"
              aria-label={`Go to slide ${i + 1}`}
            >
              {i + 1}
            </a>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
});
