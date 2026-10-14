/** Tint palette for the search-bar color dropdown (Raycast-compatible keys). */
export const COLORS = {
  PrimaryText: '#D4D4D8',
  Red: '#EF4444',
  Orange: '#F97316',
  Yellow: '#EAB308',
  Green: '#22C55E',
  Blue: '#3B82F6',
  Purple: '#A855F7',
  Pink: '#EC4899',
  Brown: '#A16207',
} as const;

export type ColorName = keyof typeof COLORS;

export const DEFAULT_COLOR: ColorName = 'PrimaryText';

export const COLOR_OPTIONS = (Object.keys(COLORS) as ColorName[]).map((name) => ({
  label: name,
  value: name,
}));

export function resolveColor(value: string | undefined): string {
  if (value !== undefined && value in COLORS) {
    return COLORS[value as ColorName];
  }
  return COLORS[DEFAULT_COLOR];
}
