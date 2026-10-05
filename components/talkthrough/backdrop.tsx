/**
 * The page's atmosphere, built like a macro photograph with a very shallow
 * depth of field: a far bloom dissolved into haze, nearer petals that are
 * soft but still read as petals, a few points of bokeh, then film grain and
 * a vignette. Everything stays faint so the content keeps the stage.
 * Purely decorative and hidden from assistive tech.
 */

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

type Tint = "cobalt" | "periwinkle" | "lavender" | "powder" | "soft-white";
type Petal = { angle: number; length: number; width: number; tint: Tint; lift?: number };

const TINTS: Tint[] = ["cobalt", "periwinkle", "lavender", "powder", "soft-white"];

function Bloom({ id, petals, heart, className }: { id: string; petals: Petal[]; heart: Tint; className?: string }) {
  return (
    <svg viewBox="-240 -240 480 480" className={className} aria-hidden>
      <defs>
        {TINTS.map((t) => (
          // Light pools toward each petal's tip, like backlit macro shots.
          <radialGradient key={t} id={`${id}-${t}`} cx="50%" cy="22%" r="80%">
            <stop offset="0%" stopColor={`var(--${t})`} stopOpacity="0.95" />
            <stop offset="45%" stopColor={`var(--${t})`} stopOpacity="0.55" />
            <stop offset="100%" stopColor={`var(--${t})`} stopOpacity="0" />
          </radialGradient>
        ))}
        <radialGradient id={`${id}-heart`}>
          <stop offset="0%" stopColor={`var(--${heart})`} stopOpacity="0.85" />
          <stop offset="100%" stopColor={`var(--${heart})`} stopOpacity="0" />
        </radialGradient>
      </defs>
      {petals.map((p, i) => (
        <ellipse
          key={i}
          cx="0"
          cy={-(p.lift ?? 14) - p.length / 2}
          rx={p.width}
          ry={p.length / 2}
          transform={`rotate(${p.angle})`}
          fill={`url(#${id}-${p.tint})`}
        />
      ))}
      <circle r="38" fill={`url(#${id}-heart)`} />
    </svg>
  );
}

// A loose, slightly irregular corolla — real flowers aren't symmetrical.
const FAR: Petal[] = [
  { angle: -8, length: 230, width: 70, tint: "periwinkle" },
  { angle: 44, length: 205, width: 64, tint: "cobalt" },
  { angle: 97, length: 240, width: 72, tint: "lavender" },
  { angle: 152, length: 195, width: 60, tint: "cobalt" },
  { angle: 206, length: 225, width: 66, tint: "powder" },
  { angle: 258, length: 200, width: 62, tint: "periwinkle" },
  { angle: 309, length: 215, width: 66, tint: "cobalt" },
];

const NEAR: Petal[] = [
  { angle: 18, length: 190, width: 46, tint: "lavender", lift: 20 },
  { angle: 78, length: 170, width: 40, tint: "powder", lift: 24 },
  { angle: 141, length: 200, width: 48, tint: "periwinkle", lift: 18 },
  { angle: 214, length: 165, width: 40, tint: "lavender", lift: 26 },
  { angle: 283, length: 185, width: 44, tint: "soft-white", lift: 22 },
];

const LOW: Petal[] = [
  { angle: 30, length: 180, width: 56, tint: "lavender" },
  { angle: 110, length: 160, width: 50, tint: "cobalt" },
  { angle: 190, length: 185, width: 56, tint: "periwinkle" },
  { angle: 270, length: 160, width: 48, tint: "lavender" },
];

/** Out-of-focus points of light, positioned in viewport-relative units. */
const BOKEH = [
  { top: "9%", right: "31%", size: "2.4vmax", tint: "powder", opacity: 0.14 },
  { top: "24%", right: "8%", size: "1.4vmax", tint: "soft-white", opacity: 0.12 },
  { top: "5%", right: "7%", size: "4vmax", tint: "periwinkle", opacity: 0.09 },
];

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      {/* Coloured air, so the blooms don't sit on flat black. */}
      <div className="absolute inset-0 bg-[radial-gradient(95%_70%_at_82%_-6%,rgb(22_34_110/0.5)_0%,transparent_60%),radial-gradient(70%_55%_at_-8%_108%,rgb(42_28_96/0.38)_0%,transparent_64%)]" />

      {/* Far bloom: dissolved almost completely. */}
      <div className="absolute -top-[24vmax] -right-[30vmax] size-[96vmax] opacity-[0.34] blur-[72px] sm:-right-[22vmax]">
        <Bloom id="far" petals={FAR} heart="powder" className="size-full" />
      </div>

      {/* Nearer petals: soft, but their shapes still read. */}
      <div className="absolute -top-[12vmax] -right-[20vmax] size-[62vmax] rotate-[24deg] opacity-[0.26] blur-[16px] sm:-right-[10vmax]">
        <Bloom id="near" petals={NEAR} heart="lavender" className="size-full" />
      </div>

      {/* A second flower low on the left, deep in the haze. */}
      <div className="absolute -bottom-[30vmax] -left-[26vmax] size-[72vmax] opacity-[0.2] blur-[64px]">
        <Bloom id="low" petals={LOW} heart="lavender" className="size-full" />
      </div>

      {BOKEH.map((b, i) => (
        <span
          key={i}
          className="absolute rounded-full blur-[6px]"
          style={{
            top: b.top,
            right: b.right,
            width: b.size,
            height: b.size,
            opacity: b.opacity,
            // Real bokeh has a slightly brighter rim than its centre.
            background: `radial-gradient(circle, color-mix(in oklab, var(--${b.tint}) 70%, transparent) 0%, var(--${b.tint}) 52%, transparent 68%)`,
          }}
        />
      ))}

      {/* The only warmth in the atmosphere: a faint pollen glow at the heart. */}
      <div className="absolute top-[12vmax] right-[14vmax] size-[14vmax] rounded-full bg-[radial-gradient(circle,rgb(231_200_127/0.09)_0%,transparent_70%)] blur-2xl" />

      {/* Soft light lifts the noise in the shadows, where overlay would multiply it away. */}
      <div className="absolute inset-0 opacity-50 mix-blend-soft-light" style={{ backgroundImage: GRAIN }} />
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_60%_30%,transparent_40%,rgb(3_4_8/0.82)_100%)]" />
    </div>
  );
}
