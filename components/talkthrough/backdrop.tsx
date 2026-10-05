/**
 * The page's atmosphere: two out-of-focus blooms — petals of cobalt,
 * periwinkle, lavender and powder blue dissolved into haze — over near-black,
 * finished with film grain and a soft vignette. Purely decorative.
 */

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

type Petal = { angle: number; length: number; width: number; fill: string };

function Bloom({ id, petals, heart, className }: { id: string; petals: Petal[]; heart: string; className: string }) {
  const tints = ["cobalt", "periwinkle", "lavender", "powder"] as const;
  return (
    <svg viewBox="-220 -220 440 440" className={className} aria-hidden>
      <defs>
        {tints.map((t) => (
          <radialGradient key={t} id={`${id}-${t}`} cx="50%" cy="78%" r="75%">
            <stop offset="0%" stopColor={`var(--${t})`} stopOpacity="0.95" />
            <stop offset="55%" stopColor={`var(--${t})`} stopOpacity="0.45" />
            <stop offset="100%" stopColor={`var(--${t})`} stopOpacity="0" />
          </radialGradient>
        ))}
        <radialGradient id={`${id}-heart`}>
          <stop offset="0%" stopColor={heart} stopOpacity="0.9" />
          <stop offset="100%" stopColor={heart} stopOpacity="0" />
        </radialGradient>
      </defs>
      {petals.map((p, i) => (
        <ellipse
          key={i}
          cx="0"
          cy={-p.length / 2 - 12}
          rx={p.width}
          ry={p.length / 2}
          transform={`rotate(${p.angle})`}
          fill={`url(#${id}-${p.fill})`}
        />
      ))}
      <circle r="46" fill={`url(#${id}-heart)`} />
    </svg>
  );
}

const MAIN_PETALS: Petal[] = [
  { angle: 0, length: 210, width: 62, fill: "periwinkle" },
  { angle: 47, length: 190, width: 58, fill: "cobalt" },
  { angle: 98, length: 220, width: 66, fill: "lavender" },
  { angle: 151, length: 180, width: 54, fill: "cobalt" },
  { angle: 203, length: 205, width: 60, fill: "powder" },
  { angle: 255, length: 185, width: 56, fill: "periwinkle" },
  { angle: 308, length: 200, width: 62, fill: "cobalt" },
];

const SMALL_PETALS: Petal[] = [
  { angle: 12, length: 170, width: 50, fill: "lavender" },
  { angle: 84, length: 150, width: 46, fill: "powder" },
  { angle: 156, length: 175, width: 52, fill: "periwinkle" },
  { angle: 228, length: 150, width: 46, fill: "lavender" },
  { angle: 300, length: 165, width: 50, fill: "cobalt" },
];

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      {/* Deep washes so the blooms sit in coloured air, not on flat black. */}
      <div className="absolute inset-0 bg-[radial-gradient(110%_75%_at_78%_-8%,rgb(24_38_120/0.55)_0%,transparent_58%),radial-gradient(80%_60%_at_-5%_105%,rgb(46_30_102/0.45)_0%,transparent_62%)]" />

      <div className="absolute -top-[22vmax] -right-[26vmax] size-[92vmax] opacity-[0.5] blur-[56px] will-change-transform motion-safe:animate-drift sm:-right-[18vmax] sm:opacity-[0.55]">
        <Bloom id="bloom-a" petals={MAIN_PETALS} heart="var(--powder)" className="size-full" />
      </div>
      <div className="absolute -bottom-[26vmax] -left-[24vmax] size-[70vmax] opacity-[0.32] blur-[64px] will-change-transform motion-safe:animate-drift-slow">
        <Bloom id="bloom-b" petals={SMALL_PETALS} heart="var(--lavender)" className="size-full" />
      </div>
      {/* A faint warm pollen glow — the only gold in the atmosphere. */}
      <div className="absolute top-[14vmax] right-[16vmax] size-[16vmax] rounded-full bg-[radial-gradient(circle,rgb(231_200_127/0.10)_0%,transparent_70%)] blur-2xl" />

      <div className="absolute inset-0 opacity-[0.11] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div className="absolute inset-0 bg-[radial-gradient(125%_95%_at_50%_35%,transparent_45%,rgb(3_4_8/0.78)_100%)]" />
    </div>
  );
}
