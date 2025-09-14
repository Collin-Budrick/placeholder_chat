/** @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";
import { animate } from "motion";
import type { DOMKeyframesDefinition } from "motion";

type Stat = {
  label: string;
  target: number;
  format: (v: number) => string;
  subtext?: string;
};

const formatK = (v: number) => `${v.toFixed(1)}k`;
const formatM = (v: number) => `${v.toFixed(1)}M`;
const formatPct = (v: number) => `${v.toFixed(2)}%`;

const STATS: Stat[] = [
  { label: "Active users", target: 12.3, format: formatK, subtext: "+324 today" },
  { label: "Messages sent", target: 98.4, format: formatM, subtext: "+1.2M this week" },
  { label: "Uptime", target: 99.99, format: formatPct, subtext: "Last 30 days" },
];

export default function StatsCard() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<string[]>(["0", "0", "0%"]);
  const started = useRef(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (started.current) return;
    // Prepare hidden state for entrance animation
    try {
      el.style.opacity = "0";
      el.style.transform = "translateY(16px)";
      el.style.willChange = "transform, opacity";
    } catch {}

    const start = () => {
      if (started.current) return;
      started.current = true;
      // Fade/slide the card in from the bottom
      try {
        const kf: DOMKeyframesDefinition = { y: [16, 0], opacity: [0, 1] };
        animate(el as Element, kf, {
          duration: 0.5,
          ease: [0.22, 0.9, 0.37, 1],
        })?.finished.finally(() => {
          try { (el as HTMLElement).style.willChange = ""; } catch {}
        });
      } catch {}
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setValues(STATS.map((s) => s.format(s.target)));
        return;
      }
      STATS.forEach((s, i) => {
        try {
          const holder = { v: 0 };
          animate(holder, { v: s.target }, {
            duration: 1.2,
            ease: [0.22, 0.9, 0.37, 1],
            onUpdate: () => {
              const v = holder.v;
              setValues((prev) => {
                const next = prev.slice();
                next[i] = s.format(v);
                return next;
              });
            },
          });
        } catch {
          setValues((prev) => {
            const next = prev.slice();
            next[i] = s.format(s.target);
            return next;
          });
        }
      });
    };

    // Only start when the entire card is in the viewport
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    const fullyInView = rect.top >= 0 && rect.bottom <= vh;
    if (fullyInView) start();
    const io = new IntersectionObserver((entries) => {
      const hit = entries.some((e) => e.intersectionRatio >= 0.99);
      if (hit) {
        start();
        try { io.disconnect(); } catch {}
      }
    }, { root: null, threshold: [0.99] });
    try { io.observe(el); } catch {}
    return () => { try { io.disconnect(); } catch {} };
  }, []);

  return (
    <div ref={rootRef}
      class="stats stats-vertical lg:stats-horizontal glass-surface border-soft with-grain bg-base-100/5 w-full border shadow"
    >
      {/* Active users */}
      <div class="stat">
        <div class="stat-title">Active users</div>
        <div class="stat-value">{values[0]}</div>
        <div class="stat-desc">+324 today</div>
      </div>
      {/* Messages sent */}
      <div class="stat">
        <div class="stat-title">Messages sent</div>
        <div class="stat-value">{values[1]}</div>
        <div class="stat-desc">+1.2M this week</div>
      </div>
      {/* Uptime */}
      <div class="stat">
        <div class="stat-title">Uptime</div>
        <div class="stat-value">{values[2]}</div>
        <div class="stat-desc">Last 30 days</div>
      </div>
    </div>
  );
}
