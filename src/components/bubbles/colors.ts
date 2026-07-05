import type { BubbleData } from "./types";

// Named colors → circle classes (bg/border/text/hover) and a picker swatch.
export const COLOR_NAMES = [
  "sky",
  "violet",
  "emerald",
  "amber",
  "rose",
  "teal",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

// Fills are soft radial gradients defined in globals.css (`.bubble-grad-*`)
// so each palette color reads as a lit sphere rather than a flat disc.
// Hover/press feedback (brightness + scale) is applied generically by the
// bubble component, not per color.
export const COLOR_CLASSES: Record<ColorName, string> = {
  sky: "bubble-grad-sky border-sky-300/90 text-sky-900 dark:border-sky-800/90 dark:text-sky-100",
  violet:
    "bubble-grad-violet border-violet-300/90 text-violet-900 dark:border-violet-800/90 dark:text-violet-100",
  emerald:
    "bubble-grad-emerald border-emerald-300/90 text-emerald-900 dark:border-emerald-800/90 dark:text-emerald-100",
  amber:
    "bubble-grad-amber border-amber-300/90 text-amber-900 dark:border-amber-800/90 dark:text-amber-100",
  rose: "bubble-grad-rose border-rose-300/90 text-rose-900 dark:border-rose-800/90 dark:text-rose-100",
  teal: "bubble-grad-teal border-teal-300/90 text-teal-900 dark:border-teal-800/90 dark:text-teal-100",
};

export const SWATCH: Record<ColorName, string> = {
  sky: "bg-sky-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  teal: "bg-teal-400",
};

export function colorClassFor(bubble: BubbleData, index: number): string {
  const name =
    (bubble.color as ColorName) ?? COLOR_NAMES[index % COLOR_NAMES.length];
  return COLOR_CLASSES[name] ?? COLOR_CLASSES.sky;
}
