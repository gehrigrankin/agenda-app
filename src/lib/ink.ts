/**
 * Ink blocks (Notes Sidebars design §4a): handwriting and sketches stored in
 * the note's Lexical JSON as an `ink` node. Pure helpers — geometry, path
 * building and defensive parsing — shared by the node and its tests.
 *
 * Coordinates live in a fixed virtual space INK_WIDTH units wide (the block
 * renders with `viewBox="0 0 INK_WIDTH height"`), so a drawing keeps its shape
 * when the editor column changes width.
 */

export const INK_WIDTH = 1000;
export const INK_DEFAULT_HEIGHT = 320;
export const INK_MIN_HEIGHT = 160;
export const INK_MAX_HEIGHT = 2400;

export type InkTool = "pen" | "highlighter" | "eraser" | "lasso";
export type InkColor = "ink" | "green" | "amber" | "coral";
export const INK_COLORS: readonly InkColor[] = [
  "ink",
  "green",
  "amber",
  "coral",
];

/** CSS color for an ink color name (the palette follows the theme). */
export function inkCss(color: InkColor): string {
  return color === "ink" ? "var(--ink-100)" : `var(--area-${color})`;
}

export interface InkStroke {
  tool: "pen" | "highlighter";
  color: InkColor;
  /** Base width in virtual units. */
  width: number;
  /** [x, y, pressure 0–1]. */
  points: [number, number, number][];
}

const MAX_STROKES = 3000;
const MAX_POINTS = 4000;

const round = (n: number) => Math.round(n * 10) / 10;

/** Validate untrusted (persisted) stroke data; anything malformed is dropped. */
export function parseStrokes(raw: unknown): InkStroke[] {
  if (!Array.isArray(raw)) return [];
  const out: InkStroke[] = [];
  for (const s of raw.slice(0, MAX_STROKES)) {
    if (typeof s !== "object" || s === null) continue;
    const o = s as Record<string, unknown>;
    const tool = o.tool === "highlighter" ? "highlighter" : "pen";
    const color = (INK_COLORS as readonly string[]).includes(o.color as string)
      ? (o.color as InkColor)
      : "ink";
    const width =
      typeof o.width === "number" && Number.isFinite(o.width)
        ? Math.min(60, Math.max(0.5, o.width))
        : 3;
    const points: [number, number, number][] = [];
    if (Array.isArray(o.points)) {
      for (const p of o.points.slice(0, MAX_POINTS)) {
        if (!Array.isArray(p)) continue;
        const [x, y, pr] = p;
        if (typeof x !== "number" || typeof y !== "number") continue;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const pressure =
          typeof pr === "number" && Number.isFinite(pr)
            ? Math.min(1, Math.max(0, pr))
            : 0.5;
        points.push([round(x), round(y), round(pressure)]);
      }
    }
    if (points.length > 0) out.push({ tool, color, width, points });
  }
  return out;
}

/**
 * A smoothed SVG path through the points (midpoint quadratic curves). A
 * single point becomes a tiny segment so a dot still renders with round caps.
 */
export function strokePath(points: [number, number, number][]): string {
  if (points.length === 0) return "";
  const [x0, y0] = points[0];
  if (points.length === 1) return `M${x0} ${y0}L${x0 + 0.1} ${y0}`;
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${x} ${y} ${round((x + nx) / 2)} ${round((y + ny) / 2)}`;
  }
  const [lx, ly] = points[points.length - 1];
  return d + `L${lx} ${ly}`;
}

/** Rendered stroke width: pens follow pressure, highlighters are broad. */
export function strokeWidth(s: InkStroke): number {
  if (s.tool === "highlighter") return s.width * 4;
  const avg =
    s.points.reduce((sum, p) => sum + p[2], 0) / Math.max(1, s.points.length);
  return s.width * (0.6 + avg * 0.9);
}

function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t =
    len === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does the eraser at (x, y) with `radius` touch this stroke? */
export function strokeHit(
  s: InkStroke,
  x: number,
  y: number,
  radius: number,
): boolean {
  const pts = s.points;
  const r = radius + strokeWidth(s) / 2;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= r;
  for (let i = 1; i < pts.length; i++) {
    if (
      distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <=
      r
    )
      return true;
  }
  return false;
}

/** Ray-casting point-in-polygon. */
export function pointInPolygon(
  x: number,
  y: number,
  poly: [number, number][],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Indexes of strokes mostly (≥60% of points) inside the lasso. */
export function lassoSelect(
  strokes: InkStroke[],
  poly: [number, number][],
): number[] {
  if (poly.length < 3) return [];
  const out: number[] = [];
  strokes.forEach((s, i) => {
    const inside = s.points.filter((p) =>
      pointInPolygon(p[0], p[1], poly),
    ).length;
    if (inside / s.points.length >= 0.6) out.push(i);
  });
  return out;
}

export function translateStrokes(
  strokes: InkStroke[],
  indexes: ReadonlySet<number>,
  dx: number,
  dy: number,
): InkStroke[] {
  return strokes.map((s, i) =>
    indexes.has(i)
      ? {
          ...s,
          points: s.points.map(([x, y, p]) => [
            round(x + dx),
            round(y + dy),
            p,
          ]),
        }
      : s,
  );
}

/** The lowest y any stroke reaches (to grow a block as you write near its foot). */
export function inkBottom(strokes: InkStroke[]): number {
  let max = 0;
  for (const s of strokes) for (const p of s.points) if (p[1] > max) max = p[1];
  return max;
}
