/**
 * Floorplan furniture icon set — vector port of design/REAIGEN_FLOORPLAN_ICONS
 * (PNG pack, 2026-07-02), one uniform stroke across every symbol.
 *
 * Shapes are authored in metres in each icon's local frame: origin at the
 * footprint centre, +y toward the front (y = -d/2 is the back/head edge —
 * headboard, backrest, tank, faucet). The renderer fits an icon to the
 * detected object box and keeps strokes at fixed screen width, so the whole
 * set keeps the same line at any scale or rotation; the SVG file exporter
 * (scripts/generate-floorplan-icons.mjs) bakes the same shapes with a stroke
 * width proportional to physical size instead.
 *
 * `fill: "white"` marks occluding surfaces (pillows over the frame, chairs
 * tucked under the table) — everything else is open line work.
 */

export type IconShape =
  | { t: "rect"; x: number; y: number; w: number; h: number; rx?: number; fill?: "white" }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: "white" }
  | { t: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill?: "white" }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "path"; d: string; fill?: "white" };

export interface FurnitureIcon {
  /** Natural footprint, metres (width across, depth front-to-back). */
  w: number;
  d: number;
  shapes: IconShape[];
}

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  rx?: number,
  fill?: "white"
): IconShape => ({ t: "rect", x, y, w, h, ...(rx ? { rx } : {}), ...(fill ? { fill } : {}) });
const circle = (cx: number, cy: number, r: number): IconShape => ({ t: "circle", cx, cy, r });
const line = (x1: number, y1: number, x2: number, y2: number): IconShape => ({ t: "line", x1, y1, x2, y2 });
const path = (d: string, fill?: "white"): IconShape => ({ t: "path", d, ...(fill ? { fill } : {}) });

/** Two-hump duvet squiggle centred at (x, y). */
const squiggle = (x: number, y: number, s = 0.16): IconShape =>
  path(`M ${x - s} ${y} q ${s / 2} ${-s / 3} ${s} 0 q ${s / 2} ${s / 3} ${s} 0`);

/** Dining chair: D-shaped horseshoe (double back line + shoulder ticks),
 * flat side toward the table. `cx` is the flat edge x, `sign` −1 when the
 * back bulges left (chair left of the table), +1 when it bulges right. */
const dChair = (cx: number, cy: number, sign: number): IconShape[] => {
  const h = 0.26; // half height
  const dp = 0.36 * sign; // back depth, signed away from the table
  const band = 0.065; // gap between outer and inner back line
  const sweep = sign > 0 ? 0 : 1;
  const ih = h - band;
  const idp = dp - band * sign;
  // Ellipse points: φ = 0 at the top corner, π/2 at the far back, π bottom.
  const outer = (phi: number): [number, number] =>
    [cx + dp * Math.sin(phi), cy - h * Math.cos(phi)];
  const inner = (phi: number): [number, number] =>
    [cx + idp * Math.sin(phi), cy - ih * Math.cos(phi)];
  const [ax, ay] = inner((160 * Math.PI) / 180);
  const [bx, by] = inner((20 * Math.PI) / 180);
  const tick = (phi: number): IconShape => {
    const [ox, oy] = outer(phi);
    const [ix, iy] = inner(phi);
    return line(ox, oy, ix, iy);
  };
  return [
    path(
      `M ${cx} ${cy - h} L ${cx} ${cy + h} A ${Math.abs(dp)} ${h} 0 0 ${sweep} ${cx} ${cy - h} Z`,
      "white"
    ),
    // Inner back line hugs the back only, ending short of the flat edge.
    path(`M ${ax} ${ay} A ${Math.abs(idp)} ${ih} 0 0 ${sweep} ${bx} ${by}`),
    tick((45 * Math.PI) / 180),
    tick((135 * Math.PI) / 180),
  ];
};

export const FURNITURE_ICONS: Record<string, FurnitureIcon> = {
  // ── from the PNG pack ──────────────────────────────────────────────────────
  bed_var_01: {
    w: 1.6,
    d: 2.0,
    shapes: [
      rect(-0.8, -1.0, 1.6, 2.0, 0.05),
      rect(-0.72, -0.92, 0.68, 0.42, 0.07, "white"),
      rect(0.04, -0.92, 0.68, 0.42, 0.07, "white"),
      path(
        "M -0.83 -0.38 C -0.6 -0.45 -0.25 -0.41 0.02 -0.44 C 0.32 -0.46 0.62 -0.41 0.83 -0.39 " +
          "C 0.85 -0.2 0.84 -0.02 0.82 0.12 C 0.5 0.18 0.12 0.13 -0.18 0.16 C -0.5 0.19 -0.72 0.15 -0.83 0.11 Z",
        "white"
      ),
      squiggle(-0.4, -0.12),
      squiggle(0.32, -0.06),
      squiggle(-0.1, 0.02),
    ],
  },
  bed_var_02: {
    w: 0.85,
    d: 2.0,
    shapes: [
      rect(-0.425, -1.0, 0.85, 2.0, 0.05),
      rect(-0.36, -0.92, 0.72, 0.42, 0.07, "white"),
      path(
        "M -0.46 -0.38 C -0.3 -0.45 -0.1 -0.41 0.05 -0.44 C 0.2 -0.46 0.35 -0.41 0.46 -0.39 " +
          "C 0.48 -0.2 0.47 -0.02 0.45 0.12 C 0.25 0.18 0.05 0.13 -0.12 0.16 C -0.3 0.19 -0.4 0.15 -0.46 0.11 Z",
        "white"
      ),
      squiggle(-0.13, -0.14, 0.13),
      squiggle(0.08, 0.0, 0.13),
    ],
  },
  sofa_var_01: {
    // Two-seater: full-width back rail, armrest rails at both ends,
    // two cushions running flush to the front edge.
    w: 1.7,
    d: 0.9,
    shapes: [
      rect(-0.85, -0.45, 1.7, 0.13, 0.045),
      rect(-0.85, -0.33, 0.13, 0.78, 0.045),
      rect(0.72, -0.33, 0.13, 0.78, 0.045),
      rect(-0.7, -0.31, 0.69, 0.76, 0.06, "white"),
      rect(0.01, -0.31, 0.69, 0.76, 0.06, "white"),
    ],
  },
  sofa_var_02: {
    // L-sectional: chaise column top-left, seats along the bottom; rails on
    // the back (left half), left edge, full front edge, and a short right arm.
    w: 2.6,
    d: 2.45,
    shapes: [
      rect(-1.3, -1.225, 1.3, 0.13, 0.05),
      rect(-1.3, -1.225, 0.13, 2.45, 0.05),
      rect(-1.3, 1.095, 2.6, 0.13, 0.05),
      rect(1.17, -0.02, 0.13, 1.12, 0.05),
      rect(-1.15, -1.07, 1.13, 1.13, 0.07, "white"),
      rect(-1.15, 0.08, 1.13, 1.0, 0.07, "white"),
      rect(0.0, 0.08, 1.15, 1.0, 0.07, "white"),
    ],
  },
  chair_var_01: {
    // Armchair: wrap-around arch (double line) with shoulder segment ticks,
    // seat protruding below the arm fronts.
    w: 0.75,
    d: 0.7,
    shapes: [
      path(
        "M -0.26 0.35 L -0.26 -0.02 Q -0.26 -0.24 0 -0.24 Q 0.26 -0.24 0.26 -0.02 L 0.26 0.35 " +
          "Q 0.26 0.35 0 0.35 Q -0.26 0.35 -0.26 0.35 Z",
        "white"
      ),
      path(
        "M -0.375 0.28 L -0.375 -0.04 Q -0.375 -0.35 0 -0.35 Q 0.375 -0.35 0.375 -0.04 L 0.375 0.28 " +
          "Q 0.375 0.31 0.345 0.31 L -0.345 0.31 Q -0.375 0.31 -0.375 0.28 Z" +
          "M -0.285 0.31 L -0.285 -0.02 Q -0.285 -0.26 0 -0.26 Q 0.285 -0.26 0.285 -0.02 L 0.285 0.31",
        "white"
      ),
      line(-0.34, -0.2, -0.26, -0.13),
      line(0.34, -0.2, 0.26, -0.13),
    ],
  },
  table_var_01: {
    // Dining set: table with two D-chairs fully visible on each long side.
    w: 2.0,
    d: 1.35,
    shapes: [
      ...dChair(-0.51, -0.35, -1),
      ...dChair(-0.51, 0.35, -1),
      ...dChair(0.51, -0.35, 1),
      ...dChair(0.51, 0.35, 1),
      rect(-0.49, -0.65, 0.98, 1.3, 0.02, "white"),
    ],
  },
  table_var_02: {
    // Plain table for small/coffee tables where a dining set would mislead.
    w: 1.2,
    d: 0.7,
    shapes: [rect(-0.6, -0.35, 1.2, 0.7, 0.03)],
  },
  toilet_var_01: {
    w: 0.42,
    d: 0.6,
    shapes: [
      path(
        "M -0.21 -0.28 L 0.21 -0.28 L 0.21 -0.02 Q 0.21 0.3 0 0.3 Q -0.21 0.3 -0.21 -0.02 Z"
      ),
      path(
        "M -0.15 -0.2 L 0.15 -0.2 L 0.15 -0.02 Q 0.15 0.22 0 0.22 Q -0.15 0.22 -0.15 -0.02 Z"
      ),
      rect(-0.045, -0.25, 0.09, 0.05, 0.02),
    ],
  },
  sink_var_01: {
    // Kitchen sink: rim, basin, faucet crossing the back rim.
    w: 0.6,
    d: 0.6,
    shapes: [
      rect(-0.3, -0.3, 0.6, 0.6, 0.025, "white"),
      rect(-0.24, -0.2, 0.48, 0.44, 0.04),
      rect(-0.03, -0.31, 0.06, 0.13, 0.01, "white"),
    ],
  },
  bathtub_var_01: {
    w: 0.8,
    d: 2.0,
    shapes: [
      rect(-0.4, -1.0, 0.8, 2.0, 0.1),
      path(
        "M -0.33 -0.79 Q -0.33 -0.93 -0.19 -0.93 L 0.19 -0.93 Q 0.33 -0.93 0.33 -0.79 " +
          "L 0.33 0.53 Q 0.33 0.93 0 0.93 Q -0.33 0.93 -0.33 0.53 Z"
      ),
      circle(0, -0.72, 0.035),
    ],
  },
  stove_var_01: {
    w: 0.6,
    d: 0.6,
    shapes: [
      rect(-0.3, -0.3, 0.6, 0.6, 0.025, "white"),
      circle(-0.14, -0.14, 0.105),
      circle(0.14, -0.14, 0.105),
      circle(-0.14, 0.14, 0.105),
      circle(0.14, 0.14, 0.105),
    ],
  },
  refrigerator_var_01: {
    // Snowflake mark — six-ray star.
    w: 0.6,
    d: 0.6,
    shapes: [
      rect(-0.3, -0.3, 0.6, 0.6),
      line(-0.12, 0, 0.12, 0),
      line(-0.06, -0.104, 0.06, 0.104),
      line(-0.06, 0.104, 0.06, -0.104),
    ],
  },

  // ── categories beyond the pack, same line language ─────────────────────────
  storage_var_01: {
    w: 1.2,
    d: 0.6,
    // Cabinet/wardrobe plan symbol: restrained casework lines rather than an
    // X-mark, which reads as a missing-image placeholder in architectural plans.
    shapes: [rect(-0.6, -0.3, 1.2, 0.6), line(-0.6, 0.18, 0.6, 0.18), line(0, -0.3, 0, 0.18)],
  },
  washer_dryer_var_01: {
    w: 0.6,
    d: 0.65,
    shapes: [rect(-0.3, -0.325, 0.6, 0.65), circle(0, 0.02, 0.2), circle(0, 0.02, 0.07)],
  },
  dishwasher_var_01: {
    w: 0.6,
    d: 0.6,
    shapes: [rect(-0.3, -0.3, 0.6, 0.6, 0.025, "white"), line(-0.3, -0.2, 0.3, -0.2), circle(0, 0.06, 0.16)],
  },
  oven_var_01: {
    w: 0.6,
    d: 0.6,
    shapes: [
      rect(-0.3, -0.3, 0.6, 0.6, 0.025, "white"),
      line(-0.3, -0.2, 0.3, -0.2),
      circle(-0.08, -0.25, 0.02),
      circle(0.08, -0.25, 0.02),
      rect(-0.22, -0.12, 0.44, 0.34, 0.02),
    ],
  },
  television_var_01: {
    w: 1.3,
    d: 0.15,
    shapes: [rect(-0.65, -0.075, 1.3, 0.15), line(-0.65, 0, 0.65, 0)],
  },
  stairs_var_01: {
    w: 1.0,
    d: 2.6,
    shapes: [
      rect(-0.5, -1.3, 1.0, 2.6),
      ...Array.from({ length: 8 }, (_, i) => line(-0.5, -1.3 + ((i + 1) * 2.6) / 9, 0.5, -1.3 + ((i + 1) * 2.6) / 9)),
      line(0, -1.2, 0, 1.2),
      path("M -0.08 1.05 L 0 1.2 L 0.08 1.05"),
    ],
  },
  fireplace_var_01: {
    w: 1.1,
    d: 0.5,
    shapes: [
      rect(-0.55, -0.25, 1.1, 0.5),
      line(-0.33, -0.25, -0.06, 0.25),
      line(0.06, -0.25, 0.33, 0.25),
    ],
  },
  generic_var_01: {
    w: 1.0,
    d: 1.0,
    shapes: [rect(-0.5, -0.5, 1.0, 1.0)],
  },

  // ── door leaf (panel + quarter swing), hinge at local (-w/2, front) ────────
  door_var_01: {
    w: 0.9,
    d: 0.95,
    shapes: [
      line(-0.45, 0.475, -0.45, -0.425),
      path("M 0.45 0.475 A 0.9 0.9 0 0 0 -0.45 -0.425"),
    ],
  },
};

/** Icon choice per symbol kind; variants pick by fitted box shape. */
export function iconForKind(
  kind: string,
  halfW: number,
  halfD: number,
  presentationVariant?: string,
  counterSeams: readonly number[] = []
): FurnitureIcon {
  const long = Math.max(halfW, halfD);
  const short = Math.min(halfW, halfD);
  switch (kind) {
    case "bed":
      return long > 0 && 2 * short >= 1.15 ? FURNITURE_ICONS.bed_var_01 : FURNITURE_ICONS.bed_var_02;
    case "sofa": {
      const w = Math.max(2 * halfW, 0.01);
      const d = Math.max(2 * halfD, 0.01);
      const rail = Math.min(0.2, Math.max(0.11, d * 0.145));
      const gap = Math.min(0.025, Math.max(0.012, w * 0.008));
      const innerLeft = -w / 2 + rail + gap;
      const innerWidth = Math.max(0.02, w - 2 * (rail + gap));
      const cushionWidth = Math.max(0.01, (innerWidth - gap) / 2);
      const cushionY = -d / 2 + rail + gap;
      const cushionDepth = Math.max(0.01, d - rail - gap);
      const radius = Math.min(0.08, Math.max(0.035, Math.min(w, d) * 0.055));
      return {
        w,
        d,
        shapes: [
          rect(-w / 2, -d / 2, w, rail, radius, "white"),
          rect(-w / 2, -d / 2 + rail - gap, rail, d - rail + gap, radius, "white"),
          rect(w / 2 - rail, -d / 2 + rail - gap, rail, d - rail + gap, radius, "white"),
          rect(innerLeft, cushionY, cushionWidth, cushionDepth, radius, "white"),
          rect(innerLeft + cushionWidth + gap, cushionY, cushionWidth, cushionDepth, radius, "white"),
        ],
      };
    }
    case "chair":
      return FURNITURE_ICONS.chair_var_01;
    case "table":
      // Always the plain top: RoomPlan detects chairs as separate objects, so
      // an icon with built-in chairs would collide with the real ones.
      // (table_var_01, the full dining set, stays exported for manual use.)
      return {
        w: Math.max(2 * halfW, 0.01),
        d: Math.max(2 * halfD, 0.01),
        shapes: [
          rect(
            -halfW,
            -halfD,
            Math.max(2 * halfW, 0.01),
            Math.max(2 * halfD, 0.01),
            Math.min(halfW, halfD) * 0.06,
            "white"
          ),
        ],
      };
    case "toilet":
      return FURNITURE_ICONS.toilet_var_01;
    case "sink":
      return FURNITURE_ICONS.sink_var_01;
    case "bathtub":
      return FURNITURE_ICONS.bathtub_var_01;
    case "stove": {
      // Author the cooktop directly in its solved footprint. Non-uniformly
      // fitting the square library icon into shallow casework would squash
      // its burner circles into ellipses.
      const w = Math.max(2 * halfW, 0.01);
      const d = Math.max(2 * halfD, 0.01);
      const r = Math.min(w, d) * 0.14;
      const px = Math.min(w * 0.24, Math.max(0, w / 2 - r * 1.35));
      const py = Math.min(d * 0.24, Math.max(0, d / 2 - r * 1.35));
      return {
        w,
        d,
        shapes: [
          ...(presentationVariant === "counter-fixture"
            ? []
            : [rect(-w / 2, -d / 2, w, d, Math.min(w, d) * 0.04, "white")]),
          circle(-px, -py, r),
          circle(px, -py, r),
          circle(-px, py, r),
          circle(px, py, r),
        ],
      };
    }
    case "refrigerator": {
      const w = Math.max(2 * halfW, 0.01);
      const d = Math.max(2 * halfD, 0.01);
      const inset = Math.min(w, d) * 0.1;
      return {
        w,
        d,
        shapes: [
          rect(-w / 2, -d / 2, w, d, Math.min(w, d) * 0.025, "white"),
          line(-w / 2 + inset, d / 2 - inset, w / 2 - inset, d / 2 - inset),
          line(0, d / 2 - inset, 0, d / 2),
        ],
      };
    }
    case "storage": {
      if (presentationVariant === "kitchen-counter") {
        const w = Math.max(2 * halfW, 0.01);
        const d = Math.max(2 * halfD, 0.01);
        return {
          w,
          d,
          shapes: [
            rect(-w / 2, -d / 2, w, d),
            ...counterSeams.map((x) => line(x, -d / 2, x, d / 2)),
          ],
        };
      }
      const w = Math.max(2 * halfW, 0.01);
      const d = Math.max(2 * halfD, 0.01);
      const frontBand = Math.min(0.11, Math.max(0.045, d * 0.18));
      const frontLine = d / 2 - frontBand;
      const moduleCount = Math.max(1, Math.round(w / 0.65));
      return {
        w,
        d,
        shapes: [
          rect(-w / 2, -d / 2, w, d, Math.min(w, d) * 0.025, "white"),
          line(-w / 2, frontLine, w / 2, frontLine),
          ...Array.from({ length: moduleCount - 1 }, (_, index) => {
            const x = -w / 2 + (w * (index + 1)) / moduleCount;
            return line(x, -d / 2, x, frontLine);
          }),
        ],
      };
    }
    case "washerDryer":
      return FURNITURE_ICONS.washer_dryer_var_01;
    case "dishwasher":
      return FURNITURE_ICONS.dishwasher_var_01;
    case "oven": {
      // An oven integrated below a worktop is not viewed from the front in a
      // top-down floorplan. RoomPlan frequently reports the combined hob/oven
      // as `oven`, so use the same planar burner language as a cooktop when it
      // is attached to counter casework. Standalone ovens keep their own glyph.
      if (presentationVariant !== "counter-fixture") {
        return FURNITURE_ICONS.oven_var_01;
      }
      const w = Math.max(2 * halfW, 0.01);
      const d = Math.max(2 * halfD, 0.01);
      const r = Math.min(w, d) * 0.14;
      const px = Math.min(w * 0.24, Math.max(0, w / 2 - r * 1.35));
      const py = Math.min(d * 0.24, Math.max(0, d / 2 - r * 1.35));
      return {
        w,
        d,
        shapes: [
          circle(-px, -py, r),
          circle(px, -py, r),
          circle(-px, py, r),
          circle(px, py, r),
        ],
      };
    }
    case "television":
      return FURNITURE_ICONS.television_var_01;
    case "stairs":
      return FURNITURE_ICONS.stairs_var_01;
    case "fireplace":
      return FURNITURE_ICONS.fireplace_var_01;
    default:
      return FURNITURE_ICONS.generic_var_01;
  }
}
