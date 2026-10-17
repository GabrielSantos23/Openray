// Theme commands for the registry: the bundled palettes live in the frontend
// (build/frontend/src/app/themes.ts, sourced from the shipped themes-BIClSzcF.js); this table
// mirrors the id/name/appearance so agents can list and switch themes through MCP. Switching
// routes through the settings store (theme-dark / theme-light keys hold theme names), which is
// exactly what the Settings page writes.

"use strict";

const BUNDLED_THEMES = [
  { id: "bundled-raycast-dark", name: "Raycast Dark", appearance: "dark" },
  { id: "bundled-raycast-light", name: "Raycast Light", appearance: "light" },
  { id: "bundled-sky", name: "Sky", appearance: "dark" },
  { id: "bundled-sunset", name: "Sunset", appearance: "dark" },
  { id: "bundled-midnight", name: "Midnight", appearance: "dark" },
  { id: "bundled-dawn", name: "Dawn", appearance: "light" },
  { id: "bundled-overcast", name: "Overcast", appearance: "light" },
  { id: "bundled-noon", name: "Noon", appearance: "light" },
];

function createThemeCommands({ registry, settingsStore }) {
  function findTheme(name) {
    const needle = String(name ?? "").trim().toLowerCase();
    return BUNDLED_THEMES.find((theme) => theme.name.toLowerCase() === needle || theme.id === needle) ?? null;
  }

  registry.register([
    {
      id: "themes.list",
      title: "themes list",
      description:
        "List the bundled launcher themes (id, name, appearance). Switch one with themes.set.",
      risk: "read",
      domain: "themes",
      params: { type: "object" },
      run: () => ({ themes: BUNDLED_THEMES }),
    },
    {
      id: "themes.get",
      title: "themes get",
      description: "Read which theme applies for dark and light OS appearance.",
      risk: "read",
      domain: "themes",
      params: { type: "object" },
      run: () => {
        const values = settingsStore.getValues();
        return {
          darkTheme: values["theme-dark"] ?? "Raycast Dark",
          lightTheme: values["theme-light"] ?? "Raycast Light",
        };
      },
    },
    {
      id: "themes.set",
      title: "themes set",
      description:
        "Set the launcher theme by name for one OS appearance (dark by default; pass appearance:\"light\" for the light theme). The change applies live.",
      risk: "write",
      domain: "themes",
      params: {
        type: "object",
        properties: {
          name: { type: "string", enum: BUNDLED_THEMES.map((theme) => theme.name) },
          appearance: { type: "string", enum: ["dark", "light"] },
        },
        required: ["name"],
        additionalProperties: false,
      },
      run: (params) => {
        const theme = findTheme(params.name);
        if (!theme) {
          const error = new Error(`unknown theme: ${params.name}`);
          error.code = "invalid_params";
          error.hint = "call themes.list for the available names";
          throw error;
        }
        // The frontend precedence is `active-theme` (the persisted live preview) over the
        // appearance keys, so a switch writes both — the same effect as picking the row on
        // the Settings Themes page.
        const key = params.appearance === "light" ? "theme-light" : "theme-dark";
        const result = settingsStore.handlers.set({
          values: { [key]: theme.name, "active-theme": theme.name },
        });
        return { theme, values: result.values };
      },
    },
  ]);

  return { findTheme };
}

module.exports = { createThemeCommands, BUNDLED_THEMES };
