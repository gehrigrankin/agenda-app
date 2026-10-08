/**
 * Subjects are tags (the school-agenda word for them on the Today page): the
 * colored labels shared by tasks and events. A tag created from the Today
 * item panel ("+ New subject") gets the next color in this rotation; tags
 * made elsewhere (#hashtags, Settings) may have no color and fall back to
 * SUBJECT_FALLBACK.
 *
 * The values are the dark-theme hexes from the agenda design; they stay
 * legible on the light theme's paper too, so they are not themed per mode.
 */
export const SUBJECT_COLORS = [
  "#9CC5AC",
  "#9BB8CE",
  "#CDB78A",
  "#B6A8CF",
  "#D8A9A0",
  "#C7A6B8",
  "#A9C49A",
  "#D4AE8C",
  "#8FC1C0",
  "#B0B7D9",
] as const;

/** Dot/label color for a subject with no color of its own. */
export const SUBJECT_FALLBACK = "#8A9390";

export function isSubjectColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (SUBJECT_COLORS as readonly string[]).includes(value)
  );
}

/**
 * The color a new subject gets: the first palette color no existing subject
 * uses yet, else the rotation continues from the count — so the first few
 * subjects never share a color, and a big list still cycles evenly.
 */
export function nextSubjectColor(existing: (string | null)[]): string {
  const used = new Set(existing.map((c) => c?.toUpperCase()));
  const free = SUBJECT_COLORS.find((c) => !used.has(c));
  return free ?? SUBJECT_COLORS[existing.length % SUBJECT_COLORS.length];
}

export function subjectColor(color: string | null | undefined): string {
  return color || SUBJECT_FALLBACK;
}
