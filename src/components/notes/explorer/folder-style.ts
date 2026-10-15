import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BookOpen,
  Briefcase,
  Camera,
  Code,
  Compass,
  Dumbbell,
  Flag,
  Folder,
  GraduationCap,
  Heart,
  House,
  Library,
  Lightbulb,
  Music,
  Plane,
  Rocket,
  Star,
  Users,
  Wallet,
} from "lucide-react";

/**
 * Folder color + icon (Notes Sidebars design §3a). Any folder can carry both;
 * root folders render them on their uppercase section label. Nothing is
 * defaulted by name — an unstyled folder is gray with the plain folder glyph.
 *
 * Colors are stored as named tokens in `bubbles.color` (shared with the bubble
 * canvas). The area palette is the design's; the canvas's older token names
 * map onto it so a folder colored on the canvas keeps a sensible tint here.
 */

export const AREA_COLORS = [
  "amber",
  "blue",
  "violet",
  "coral",
  "green",
  "gray",
] as const;
export type AreaColor = (typeof AREA_COLORS)[number];

const LEGACY: Record<string, AreaColor> = {
  sky: "blue",
  teal: "green",
  emerald: "green",
  rose: "coral",
  violet: "violet",
  amber: "amber",
};

export function areaColor(color: string | null | undefined): AreaColor | null {
  if (!color) return null;
  if ((AREA_COLORS as readonly string[]).includes(color))
    return color as AreaColor;
  return LEGACY[color] ?? null;
}

/** CSS color for a stored token (null = the default ink). */
export function areaCss(color: string | null | undefined): string | null {
  const c = areaColor(color);
  return c ? `var(--area-${c})` : null;
}

export const AREA_LABELS: Record<AreaColor, string> = {
  amber: "Amber",
  blue: "Blue",
  violet: "Violet",
  coral: "Coral",
  green: "Green",
  gray: "Gray",
};

export const FOLDER_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  rocket: Rocket,
  library: Library,
  compass: Compass,
  archive: Archive,
  book: BookOpen,
  briefcase: Briefcase,
  heart: Heart,
  music: Music,
  home: House,
  star: Star,
  flag: Flag,
  lightbulb: Lightbulb,
  graduation: GraduationCap,
  code: Code,
  camera: Camera,
  plane: Plane,
  dumbbell: Dumbbell,
  wallet: Wallet,
  people: Users,
};

export const FOLDER_ICON_NAMES = Object.keys(FOLDER_ICONS);

export function folderIcon(name: string | null | undefined): LucideIcon | null {
  return name ? (FOLDER_ICONS[name] ?? null) : null;
}

export function isFolderIconName(v: unknown): v is string {
  return typeof v === "string" && v in FOLDER_ICONS;
}
