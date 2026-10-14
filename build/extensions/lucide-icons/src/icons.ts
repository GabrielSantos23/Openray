import metadataJson from './generated/lucide-metadata.json';

export interface LucideIconMeta {
  /** Kebab-case lucide icon name, e.g. `a-arrow-down`. */
  name: string;
  /** PascalCase name, e.g. `AArrowDown` (matches the lucide-react export). */
  pascalName: string;
  keywords: string[];
  /** Canonical lucide SVG markup (24×24, stroke-based). */
  svg: string;
}

export const allIcons = metadataJson as LucideIconMeta[];

export function filterIcons(query: string): LucideIconMeta[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return allIcons;
  }
  // Multi-word queries match when every token appears somewhere in the name
  // or keywords — without an AI fallback, local recall has to handle the
  // "arrow down" → a-arrow-down case the original delegated to the model.
  const tokens = q.split(/\s+/);
  return allIcons.filter((icon) => {
    const haystack = [icon.name, ...icon.keywords.map((k) => k.toLowerCase())];
    return tokens.every((token) => haystack.some((h) => h.includes(token)));
  });
}

export function displayName(icon: LucideIconMeta, pascalCase: boolean): string {
  return pascalCase ? icon.pascalName : icon.name;
}

export function componentName(icon: LucideIconMeta): string {
  return `<${icon.pascalName} />`;
}

export function iconPageUrl(icon: LucideIconMeta): string {
  return `https://lucide.dev/icons/${icon.name}`;
}
