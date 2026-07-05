import type { BubbleData } from "./types";

// Named colors → container header/body classes and a picker swatch.
export const COLOR_NAMES = [
  "sky",
  "violet",
  "emerald",
  "amber",
  "rose",
  "teal",
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

// Containers are two-tone: a saturated header strip and a soft translucent
// body, so nested containers read as tinted panels rather than lit spheres.
// Hover/press feedback (brightness + scale) is applied generically by the
// container component, not per color.
const HEADER_CLASSES: Record<ColorName, string> = {
  sky: "bg-sky-200/90 text-sky-950 dark:bg-sky-900/80 dark:text-sky-100",
  violet:
    "bg-violet-200/90 text-violet-950 dark:bg-violet-900/80 dark:text-violet-100",
  emerald:
    "bg-emerald-200/90 text-emerald-950 dark:bg-emerald-900/80 dark:text-emerald-100",
  amber:
    "bg-amber-200/90 text-amber-950 dark:bg-amber-900/80 dark:text-amber-100",
  rose: "bg-rose-200/90 text-rose-950 dark:bg-rose-900/80 dark:text-rose-100",
  teal: "bg-teal-200/90 text-teal-950 dark:bg-teal-900/80 dark:text-teal-100",
};

const BODY_CLASSES: Record<ColorName, string> = {
  sky: "bg-sky-50/85 border-sky-200/80 dark:bg-sky-950/50 dark:border-sky-800/70",
  violet:
    "bg-violet-50/85 border-violet-200/80 dark:bg-violet-950/50 dark:border-violet-800/70",
  emerald:
    "bg-emerald-50/85 border-emerald-200/80 dark:bg-emerald-950/50 dark:border-emerald-800/70",
  amber:
    "bg-amber-50/85 border-amber-200/80 dark:bg-amber-950/50 dark:border-amber-800/70",
  rose: "bg-rose-50/85 border-rose-200/80 dark:bg-rose-950/50 dark:border-rose-800/70",
  teal: "bg-teal-50/85 border-teal-200/80 dark:bg-teal-950/50 dark:border-teal-800/70",
};

export const SWATCH: Record<ColorName, string> = {
  sky: "bg-sky-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
  teal: "bg-teal-400",
};

function colorNameFor(bubble: BubbleData, index: number): ColorName {
  const name =
    (bubble.color as ColorName) ?? COLOR_NAMES[index % COLOR_NAMES.length];
  return name in HEADER_CLASSES ? name : "sky";
}

export function headerClassFor(bubble: BubbleData, index: number): string {
  return HEADER_CLASSES[colorNameFor(bubble, index)];
}

export function bodyClassFor(bubble: BubbleData, index: number): string {
  return BODY_CLASSES[colorNameFor(bubble, index)];
}
