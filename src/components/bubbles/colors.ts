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

export const COLOR_CLASSES: Record<ColorName, string> = {
  sky: "bg-sky-100 border-sky-300 text-sky-900 hover:bg-sky-200 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-100 dark:hover:bg-sky-900",
  violet:
    "bg-violet-100 border-violet-300 text-violet-900 hover:bg-violet-200 dark:bg-violet-950 dark:border-violet-800 dark:text-violet-100 dark:hover:bg-violet-900",
  emerald:
    "bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900",
  amber:
    "bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900",
  rose: "bg-rose-100 border-rose-300 text-rose-900 hover:bg-rose-200 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-100 dark:hover:bg-rose-900",
  teal: "bg-teal-100 border-teal-300 text-teal-900 hover:bg-teal-200 dark:bg-teal-950 dark:border-teal-800 dark:text-teal-100 dark:hover:bg-teal-900",
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
