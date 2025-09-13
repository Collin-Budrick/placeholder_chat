/** @jsxImportSource preact */
import { useEffect, useRef, useState } from "preact/hooks";
import { animate } from "motion";

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

    const start = () => {
      if (started.current) return;
      started.current = true;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setValues(STATS.map((s) => s.format(s.target)));
        return;
      }
      STATS.forEach((s, i) => {
        try {
          const holder = { v: 0 };
          animate(holder, { v: s.target }, {
            duration: 1.2,
            easing: "cubic-bezier(.22,.9,.37,1)",
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

    // Start immediately (island hydrates when visible), but keep IO as a safe fallback
    start();
    // Also guard for rare timing where hydration happens just before it scrolls in
    const rect = el.getBoundingClientRect();
    const initiallyInView = rect.top < (window.innerHeight || 0) && rect.bottom > 0;
    if (!initiallyInView) {
      try { setTimeout(() => { if (!started.current) start(); }, 150); } catch {}
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        start();
        try { io.disconnect(); } catch {}
      }
    }, { root: null, threshold: 0.15 });
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
