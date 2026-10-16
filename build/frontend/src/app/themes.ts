// Raycast's bundled themes, verbatim from the shipped frontend (`themes-BIClSzcF.js`). The
// launcher's token ramps in base.css are Raycast's own relative-color math over `--bg`/`--fg`,
// so applying a theme is overriding that handful of root variables.

export interface ThemeDefinition {
  id: string;
  name: string;
  appearance: "dark" | "light";
  background: string;
  backgroundSecondary: string;
  foreground: string;
  accent: string;
  selection: string;
  loader: string;
  red: string;
  orange: string;
  yellow: string;
  green: string;
  blue: string;
  purple: string;
  magenta: string;
}

export const BUNDLED_THEMES: ThemeDefinition[] = [
  {
    id: "bundled-raycast-dark", name: "Raycast Dark", appearance: "dark",
    background: "#000000", backgroundSecondary: "#000000", foreground: "#FFFFFF", accent: "#4FA3F8",
    selection: "#FFFFFF", loader: "#FFFFFF", red: "#FF6363", orange: "#FF9217", yellow: "#FFC531",
    green: "#59D499", blue: "#56C2FF", purple: "#A485FF", magenta: "#CF2F98",
  },
  {
    id: "bundled-raycast-light", name: "Raycast Light", appearance: "light",
    background: "#FFFFFF", backgroundSecondary: "#FFFFFF", foreground: "#000000", accent: "#138AF2",
    selection: "#000000", loader: "#000000", red: "#B12424", orange: "#C75D07", yellow: "#F8A300",
    green: "#006B4F", blue: "#138AF2", purple: "#6A3DEC", magenta: "#9A1B6E",
  },
  {
    id: "bundled-sky", name: "Sky", appearance: "dark",
    background: "#0E1C3F", backgroundSecondary: "#173036", foreground: "#D7F0F4", accent: "#4FA3F8",
    selection: "#6688FF", loader: "#47FFFF", red: "#ED5959", orange: "#ED8659", yellow: "#EDD559",
    green: "#47FF91", blue: "#1A9FFF", purple: "#7759ED", magenta: "#ED59B2",
  },
  {
    id: "bundled-sunset", name: "Sunset", appearance: "dark",
    background: "#451A08", backgroundSecondary: "#0A3943", foreground: "#FADDD1", accent: "#4FA3F8",
    selection: "#7698EF", loader: "#47E0FF", red: "#ED5959", orange: "#ED8659", yellow: "#EDD559",
    green: "#59ED7A", blue: "#30BBE8", purple: "#7759ED", magenta: "#ED59B2",
  },
  {
    id: "bundled-midnight", name: "Midnight", appearance: "dark",
    background: "#070034", backgroundSecondary: "#11005B", foreground: "#FAF0FF", accent: "#4FA3F8",
    selection: "#B1A7FF", loader: "#F4C4FF", red: "#F84141", orange: "#FFC100", yellow: "#FEFF7F",
    green: "#63BA89", blue: "#6AB7FB", purple: "#C58AFA", magenta: "#FF5DB3",
  },
  {
    id: "bundled-dawn", name: "Dawn", appearance: "light",
    background: "#FFF1F7", backgroundSecondary: "#D0C1FF", foreground: "#120032", accent: "#4FA3F8",
    selection: "#602AFF", loader: "#5A00FF", red: "#E14848", orange: "#E5753C", yellow: "#B7B400",
    green: "#00AC5D", blue: "#4F80FF", purple: "#9454FF", magenta: "#D756BF",
  },
  {
    id: "bundled-overcast", name: "Overcast", appearance: "light",
    background: "#D9F9FF", backgroundSecondary: "#C7E0FC", foreground: "#002369", accent: "#4FA3F8",
    selection: "#0075FF", loader: "#0019FF", red: "#EE5050", orange: "#FA8542", yellow: "#EBA200",
    green: "#30B475", blue: "#5271D8", purple: "#B35AEB", magenta: "#DD43A7",
  },
  {
    id: "bundled-noon", name: "Noon", appearance: "light",
    background: "#FFE7C6", backgroundSecondary: "#FCBFA5", foreground: "#1E003C", accent: "#4FA3F8",
    selection: "#7B46FF", loader: "#6100FF", red: "#DA4C4C", orange: "#D76F33", yellow: "#D49200",
    green: "#09B664", blue: "#5876D8", purple: "#A543E3", magenta: "#C4228B",
  },
];

const THEME_VARIABLES: Array<[string, keyof ThemeDefinition]> = [
  ["--bg", "background"],
  ["--bg-secondary", "backgroundSecondary"],
  ["--fg", "foreground"],
  ["--accent", "accent"],
  ["--selection", "selection"],
  ["--loader", "loader"],
  ["--red", "red"],
  ["--orange", "orange"],
  ["--yellow", "yellow"],
  ["--green", "green"],
];

/** Raycast Dark is base.css's compiled-in default; clearing restores it exactly. */
export function applyTheme(theme: ThemeDefinition | null): void {
  const style = document.documentElement.style;
  if (!theme || theme.id === "bundled-raycast-dark") {
    for (const [variable] of THEME_VARIABLES) style.removeProperty(variable);
    style.setProperty("--theme-backdrop-base", "#333333");
    document.documentElement.removeAttribute("data-theme-appearance");
    return;
  }
  for (const [variable, key] of THEME_VARIABLES) style.setProperty(variable, theme[key] as string);
  style.setProperty("--theme-backdrop-base", theme.appearance === "light" ? "#ffffff" : "#333333");
  document.documentElement.setAttribute("data-theme-appearance", theme.appearance);
}

export function themeByName(name: string): ThemeDefinition | null {
  return BUNDLED_THEMES.find((candidate) => candidate.name === name) ?? null;
}
