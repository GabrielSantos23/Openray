import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Action,
  ActionPanel,
  Form,
  Grid,
  List,
  defineReactExtension,
  type CommandProps,
} from "@flowkey-mini/react-ui";
import type { ExtensionManifest, FlowKeyCapabilities } from "@flowkey-mini/native-sdk";
import manifestJson from "../manifest.json";
import * as api from "./api";
import * as gen from "./components";
import { loadState, saveState, withMoved, withPinned, withRecent, withoutPinned, type SvglState } from "./state";

interface SvglPreferences {
  svgDefaultAction?: string;
  showWordmark?: boolean;
  defaultPackageManager?: string;
}

const routeUrl = (route: api.Svgl["route"], variant: "light" | "dark"): string =>
  typeof route === "string" ? route : (route[variant] ?? route.light ?? route.dark ?? "");

// Action-panel section order and titles, straight from the reference panel
// (svgDefaultAction's section leads, wordmark sections hide behind the preference).
const SECTION_ORDER = [
  "copySvg",
  "copySvgFile",
  "copySvgWordmark",
  "copyShadcnRegistry",
  "copyReactComponent",
  "copyVueComponent",
  "copySvelteComponent",
  "copyAngularComponent",
  "copySvgUrl",
  "copySvgWordmarkUrl",
  "copyAstroComponent",
  "operation",
  "svgInfo",
] as const;

const WORDMARK_KEYS = new Set(["copySvgWordmark", "copySvgWordmarkUrl"]);

const SECTION_TITLES: Record<string, string> = {
  copySvg: "Copy SVG",
  copySvgFile: "Copy SVG File",
  copySvgWordmark: "Copy SVG Wordmark",
  copyShadcnRegistry: "Copy shadcn/ui Registry",
  copyReactComponent: "Copy React Component",
  copyVueComponent: "Copy Vue Component",
  copySvelteComponent: "Copy Svelte Component",
  copyAngularComponent: "Copy Angular Component",
  copySvgUrl: "Copy SVG URL",
  copySvgWordmarkUrl: "Copy SVG Wordmark URL",
  copyAstroComponent: "Copy Astro Component",
  operation: "Operation",
  svgInfo: "SVG Info",
};

function categoriesFrom(svgs: api.Svgl[]): api.SvglCategory[] {
  const counts = new Map<string, number>();
  for (const svg of svgs) {
    const list = Array.isArray(svg.category) ? svg.category : [svg.category];
    for (const category of list) counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, total]) => ({ category, total }));
}

/** Every token must appear in the title (Raycast's grid search filters titles only). */
function matchesQuery(svg: api.Svgl, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const title = svg.title.toLowerCase();
  return tokens.every((token) => title.includes(token));
}

export function SvglGrid(props: CommandProps) {
  const { capabilities, native, window, preferences, query, filterValue } = props;
  const prefs = preferences as SvglPreferences;
  const [svgs, setSvgs] = useState<api.Svgl[] | null>(null);
  const [categories, setCategories] = useState<api.SvglCategory[]>([]);
  const [state, setState] = useState<SvglState>({ pinned: [], recent: [] });
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [persisted, library, categoryList] = await Promise.all([
        loadState(capabilities).catch(() => ({ pinned: [], recent: [] })),
        api.fetchSvgs(capabilities).catch(() => null),
        api.fetchCategories(capabilities).catch(() => []),
      ]);
      if (!alive) return;
      setState(persisted);
      if (library) setSvgs(library);
      setCategories(categoryList.length ? categoryList : categoriesFrom(library ?? []));
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [capabilities]);

  const applyState = (next: SvglState) => {
    stateRef.current = next;
    setState(next);
    void saveState(capabilities, next).catch(() => undefined);
  };

  const addRecent = (id: number) => applyState(withRecent(stateRef.current, id));

  const failToast = (title: string, error: unknown) => {
    void capabilities.toast
      .show({ title, message: error instanceof Error ? error.message : undefined, style: "failure" })
      .catch(() => undefined);
  };

  const category = filterValue ?? "All";
  const isLoading = !loaded || svgs === null;

  const filterOptions = useMemo(() => {
    const options = [
      { label: "All", value: "All" },
      { label: "Pinned", value: "Pinned" },
      { label: "Recently Used", value: "Recently Used" },
    ];
    for (const entry of categories) options.push({ label: entry.category, value: entry.category });
    return options;
  }, [categories]);

  const byId = useMemo(() => new Map((svgs ?? []).map((svg) => [svg.id, svg])), [svgs]);
  const searched = useMemo(
    () => (svgs ?? []).filter((svg) => matchesQuery(svg, query)),
    [svgs, query],
  );

  const actionsFor = (svg: api.Svgl, category: string): ReactNode => {
    const { capabilities: caps, native: n, window: win } = { capabilities, native, window };

    const copySvgText = async (url: string, message: string) => {
      addRecent(svg.id);
      try {
        const text = await api.fetchSvg(caps, url);
        await api.copyText(caps, text);
        await caps.hud.show({ title: message });
        win.closeMainWindow();
      } catch (error) {
        failToast("Failed to fetch svg", error);
      }
    };

    const copySvgFile = async (url: string, message: string, fileName: string) => {
      addRecent(svg.id);
      try {
        const text = await api.fetchSvg(caps, url);
        await api.copySvgFile(caps, n, text, fileName);
        await caps.hud.show({ title: message });
        win.closeMainWindow();
      } catch (error) {
        failToast("Failed to fetch svg", error);
      }
    };

    const copyReactComponent = async (url: string, tsx: boolean) => {
      addRecent(svg.id);
      try {
        const component = await api.fetchAndCopyReactComponent(caps, url, svg.title, tsx);
        await api.copyText(caps, component);
        await caps.hud.show({ title: "Copied React component to clipboard" });
        win.closeMainWindow();
      } catch (error) {
        failToast("Failed to fetch react component", error);
      }
    };

    const copyTemplateComponent = async (
      url: string,
      framework: "Vue" | "Svelte" | "Angular" | "Astro",
      lang?: string,
    ) => {
      addRecent(svg.id);
      try {
        const component =
          framework === "Vue" || framework === "Svelte"
            ? await gen.vueOrSvelteComponent(caps, lang ?? "js", url, framework)
            : framework === "Angular"
              ? await gen.angularComponent(caps, url, svg.title.replace(/ /g, ""))
              : await gen.astroComponent(caps, url);
        await api.copyText(caps, component);
        await caps.hud.show({ title: `Copied ${framework} component to clipboard` });
        win.closeMainWindow();
      } catch (error) {
        failToast(`Failed to fetch ${framework.toLowerCase()} component`, error);
      }
    };

    const copyUrl = async (url: string, message: string) => {
      addRecent(svg.id);
      await api.copyText(caps, url);
      void caps.toast.show({ title: message, style: "success" }).catch(() => undefined);
    };

    const copyShadcnRegistry = async () => {
      addRecent(svg.id);
      const runner = prefs.defaultPackageManager || "pnpm";
      const command = gen.shadcnInstallCommand(svg.title, runner);
      await api.copyText(caps, command);
      void caps.toast
        .show({ title: "Copied shadcn/ui Registry install command to clipboard", style: "success" })
        .catch(() => undefined);
    };

    const pin = async () => {
      applyState(withPinned(stateRef.current, svg.id));
      void caps.toast.show({ title: `Pinned ${svg.title}`, style: "success" }).catch(() => undefined);
    };
    const unpin = async () => {
      applyState(withoutPinned(stateRef.current, svg.id));
      void caps.toast.show({ title: `Unpinned ${svg.title}`, style: "success" }).catch(() => undefined);
    };
    const movePinned = async (delta: -1 | 1) => {
      applyState(withMoved(stateRef.current, svg.id, delta));
      void caps.toast
        .show({ title: `${delta < 0 ? "Moved up" : "Moved down"} ${svg.title}`, style: "success" })
        .catch(() => undefined);
    };

    const isPinned = state.pinned.includes(svg.id);
    const pinnedIndex = state.pinned.indexOf(svg.id);

    const sections: Record<string, ReactNode | null> = {
      copySvg: (
        <ActionPanel.Section title="Copy SVG" key="copySvg">
          {typeof svg.route === "string" ? (
            <Action
              icon={{ lucide: "clipboard" }}
              title="Copy SVG Text"
              onAction={() => copySvgText(svg.route as string, "Copied SVG text to clipboard")}
            />
          ) : (
            <>
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy Light SVG Text"
                shortcut={{ key: "l", modifiers: ["ctrl"] }}
                onAction={() => copySvgText(routeUrl(svg.route, "light"), "Copied Light SVG text to clipboard")}
              />
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy Dark SVG Text"
                shortcut={{ key: "d", modifiers: ["ctrl"] }}
                onAction={() => copySvgText(routeUrl(svg.route, "dark"), "Copied Dark SVG text to clipboard")}
              />
            </>
          )}
        </ActionPanel.Section>
      ),
      copySvgFile: (
        <ActionPanel.Section title="Copy SVG File" key="copySvgFile">
          {typeof svg.route === "string" ? (
            <Action
              icon={{ lucide: "clipboard" }}
              title="Copy SVG File"
              shortcut={{ key: "return", modifiers: ["ctrl"] }}
              onAction={() => copySvgFile(svg.route as string, "Copied SVG file to clipboard", svg.title)}
            />
          ) : (
            <>
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy Light SVG File"
                shortcut={{ key: "return", modifiers: ["ctrl"] }}
                onAction={() =>
                  copySvgFile(routeUrl(svg.route, "light"), "Copied Light SVG file to clipboard", `${svg.title}-light`)
                }
              />
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy Dark SVG File"
                shortcut={{ key: "return", modifiers: ["ctrl"] }}
                onAction={() =>
                  copySvgFile(routeUrl(svg.route, "dark"), "Copied Dark SVG file to clipboard", `${svg.title}-dark`)
                }
              />
            </>
          )}
        </ActionPanel.Section>
      ),
      copySvgWordmark:
        svg.wordmark === undefined ? null : (
          <ActionPanel.Section title="Copy SVG Wordmark" key="copySvgWordmark">
            {typeof svg.wordmark === "string" ? (
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy SVG Wordmark Text"
                onAction={() => copySvgText(svg.wordmark as string, "Copied SVG Wordmark to clipboard")}
              />
            ) : (
              <>
                <Action
                  icon={{ lucide: "clipboard" }}
                  title="Copy Light SVG Wordmark Text"
                  shortcut={{ key: "l", modifiers: ["ctrl", "shift"] }}
                  onAction={() => copySvgText(routeUrl(svg.wordmark!, "light"), "Copied Light SVG Wordmark to clipboard")}
                />
                <Action
                  icon={{ lucide: "clipboard" }}
                  title="Copy Dark SVG Wordmark Text"
                  shortcut={{ key: "d", modifiers: ["ctrl", "shift"] }}
                  onAction={() => copySvgText(routeUrl(svg.wordmark!, "dark"), "Copied Dark SVG Wordmark to clipboard")}
                />
              </>
            )}
          </ActionPanel.Section>
        ),
      copyShadcnRegistry: (
        <ActionPanel.Section title="Copy shadcn/ui Registry" key="copyShadcnRegistry">
          <Action
            icon={{ uri: "https://svgl.app/library/shadcn-ui.svg" }}
            title="Copy Shadcn/ui Registry Install Command"
            onAction={() => copyShadcnRegistry()}
          />
        </ActionPanel.Section>
      ),
      copyReactComponent: (
        <ActionPanel.Section title="Copy React Component" key="copyReactComponent">
          {typeof svg.route === "string" ? (
            <>
              <Action
                icon={{ uri: "https://svgl.app/library/react.svg" }}
                title="Copy TSX Component"
                shortcut={{ key: "t", modifiers: ["ctrl"] }}
                onAction={() => copyReactComponent(svg.route as string, true)}
              />
              <Action
                icon={{ uri: "https://svgl.app/library/react.svg" }}
                title="Copy JSX Component"
                shortcut={{ key: "j", modifiers: ["ctrl"] }}
                onAction={() => copyReactComponent(svg.route as string, false)}
              />
            </>
          ) : (
            <>
              <Action
                icon={{ uri: "https://svgl.app/library/react.svg" }}
                title="Copy Light TSX Component"
                shortcut={{ key: "t", modifiers: ["ctrl"] }}
                onAction={() => copyReactComponent(routeUrl(svg.route, "light"), true)}
              />
              <Action
                icon={{ uri: "https://svgl.app/library/react.svg" }}
                title="Copy Dark TSX Component"
                shortcut={{ key: "t", modifiers: ["ctrl", "shift"] }}
                onAction={() => copyReactComponent(routeUrl(svg.route, "dark"), true)}
              />
              <Action
                icon={{ uri: "https://svgl.app/library/react.svg" }}
                title="Copy Light JSX Component"
                shortcut={{ key: "j", modifiers: ["ctrl"] }}
                onAction={() => copyReactComponent(routeUrl(svg.route, "light"), false)}
              />
              <Action
                icon={{ uri: "https://svgl.app/library/react.svg" }}
                title="Copy Dark JSX Component"
                shortcut={{ key: "j", modifiers: ["ctrl", "shift"] }}
                onAction={() => copyReactComponent(routeUrl(svg.route, "dark"), false)}
              />
            </>
          )}
        </ActionPanel.Section>
      ),
      copyVueComponent: (
        <ActionPanel.Section title="Copy Vue Component" key="copyVueComponent">
          {(typeof svg.route === "string" ? [["Copy TS Component", "light", "ts"], ["Copy JS Component", "light", "js"]] : [
            ["Copy Light TS Component", "light", "ts"],
            ["Copy Dark TS Component", "dark", "ts"],
            ["Copy Light JS Component", "light", "js"],
            ["Copy Dark JS Component", "dark", "js"],
          ]).map(([title, variant, lang]) => (
            <Action
              key={title}
              icon={{ uri: "https://svgl.app/library/vue.svg" }}
              title={title}
              onAction={() => copyTemplateComponent(routeUrl(svg.route, variant as "light" | "dark"), "Vue", lang)}
            />
          ))}
        </ActionPanel.Section>
      ),
      copySvelteComponent: (
        <ActionPanel.Section title="Copy Svelte Component" key="copySvelteComponent">
          {(typeof svg.route === "string" ? [["Copy TS Component", "light", "ts"], ["Copy JS Component", "light", "js"]] : [
            ["Copy Light TS Component", "light", "ts"],
            ["Copy Dark TS Component", "dark", "ts"],
            ["Copy Light JS Component", "light", "js"],
            ["Copy Dark JS Component", "dark", "js"],
          ]).map(([title, variant, lang]) => (
            <Action
              key={title}
              icon={{ uri: "https://svgl.app/library/svelte.svg" }}
              title={title}
              onAction={() => copyTemplateComponent(routeUrl(svg.route, variant as "light" | "dark"), "Svelte", lang)}
            />
          ))}
        </ActionPanel.Section>
      ),
      copyAngularComponent: (
        <ActionPanel.Section title="Copy Angular Component" key="copyAngularComponent">
          {typeof svg.route === "string" ? (
            <Action
              icon={{ uri: "https://svgl.app/library/angular.svg" }}
              title="Copy Component"
              onAction={() => copyTemplateComponent(svg.route as string, "Angular")}
            />
          ) : (
            <>
              <Action
                icon={{ uri: "https://svgl.app/library/angular.svg" }}
                title="Copy Light Component"
                onAction={() => copyTemplateComponent(routeUrl(svg.route, "light"), "Angular")}
              />
              <Action
                icon={{ uri: "https://svgl.app/library/angular.svg" }}
                title="Copy Dark Component"
                onAction={() => copyTemplateComponent(routeUrl(svg.route, "dark"), "Angular")}
              />
            </>
          )}
        </ActionPanel.Section>
      ),
      copySvgUrl: (
        <ActionPanel.Section title="Copy SVG URL" key="copySvgUrl">
          {typeof svg.route === "string" ? (
            <Action
              icon={{ lucide: "clipboard" }}
              title="Copy SVG URL"
              onAction={() => copyUrl(svg.route as string, "Copied SVG URL to clipboard")}
            />
          ) : (
            <>
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy Light SVG URL"
                onAction={() => copyUrl(routeUrl(svg.route, "light"), "Copied Light SVG URL to clipboard")}
              />
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy Dark SVG URL"
                onAction={() => copyUrl(routeUrl(svg.route, "dark"), "Copied Dark SVG URL to clipboard")}
              />
            </>
          )}
        </ActionPanel.Section>
      ),
      copySvgWordmarkUrl:
        svg.wordmark === undefined ? null : (
          <ActionPanel.Section title="Copy SVG Wordmark URL" key="copySvgWordmarkUrl">
            {typeof svg.wordmark === "string" ? (
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy SVG Wordmark URL"
                onAction={() => copyUrl(svg.wordmark as string, "Copied SVG Wordmark URL to clipboard")}
              />
            ) : (
              <>
                <Action
                  icon={{ lucide: "clipboard" }}
                  title="Copy Light SVG Wordmark URL"
                  onAction={() => copyUrl(routeUrl(svg.wordmark!, "light"), "Copied Light SVG Wordmark URL to clipboard")}
                />
                <Action
                  icon={{ lucide: "clipboard" }}
                  title="Copy Dark SVG Wordmark URL"
                  onAction={() => copyUrl(routeUrl(svg.wordmark!, "dark"), "Copied Dark SVG Wordmark URL to clipboard")}
                />
              </>
            )}
          </ActionPanel.Section>
        ),
      copyAstroComponent: (
        <ActionPanel.Section title="Copy Astro Component" key="copyAstroComponent">
          {typeof svg.route === "string" ? (
            <Action
              icon={{ uri: "https://svgl.app/library/astro.svg" }}
              title="Copy Component"
              onAction={() => copyTemplateComponent(svg.route as string, "Astro")}
            />
          ) : (
            <>
              <Action
                icon={{ uri: "https://svgl.app/library/astro.svg" }}
                title="Copy Light Component"
                onAction={() => copyTemplateComponent(routeUrl(svg.route, "light"), "Astro")}
              />
              <Action
                icon={{ uri: "https://svgl.app/library/astro.svg" }}
                title="Copy Dark Component"
                onAction={() => copyTemplateComponent(routeUrl(svg.route, "dark"), "Astro")}
              />
            </>
          )}
        </ActionPanel.Section>
      ),
      operation: (
        <ActionPanel.Section title="Operation" key="operation">
          {isPinned ? (
            <>
              <Action
                icon={{ lucide: "pin" }}
                title="Unpin SVG"
                shortcut={{ key: "p", modifiers: ["ctrl"] }}
                onAction={() => unpin()}
              />
              {pinnedIndex !== 0 && (
                <Action
                  icon={{ lucide: "arrow-up" }}
                  title="Move up in Pinned"
                  shortcut={{ key: "up", modifiers: ["ctrl"] }}
                  onAction={() => movePinned(-1)}
                />
              )}
              {pinnedIndex !== state.pinned.length - 1 && (
                <Action
                  icon={{ lucide: "arrow-down" }}
                  title="Move Down in Pinned"
                  shortcut={{ key: "down", modifiers: ["ctrl"] }}
                  onAction={() => movePinned(1)}
                />
              )}
            </>
          ) : (
            <Action
              icon={{ lucide: "pin" }}
              title="Pin SVG"
              shortcut={{ key: "p", modifiers: ["ctrl"] }}
              onAction={() => pin()}
            />
          )}
        </ActionPanel.Section>
      ),
      svgInfo: (
        <ActionPanel.Section title="SVG Info" key="svgInfo">
          <Action
            icon={{ lucide: "clipboard" }}
            title="Copy SVG Title"
            onAction={async () => {
              await api.copyText(caps, svg.title);
              void caps.toast.show({ title: "Copied SVG title", style: "success" }).catch(() => undefined);
            }}
          />
          <Action
            icon={{ lucide: "globe" }}
            title="Open SVG in Browser"
            shortcut={{ key: "o", modifiers: ["ctrl"] }}
            onAction={() => void caps.shell.openUrl(routeUrl(svg.route, "light"))}
          />
          <Action
            icon={{ lucide: "globe" }}
            title={`Visit ${svg.title} Website`}
            shortcut={{ key: "v", modifiers: ["ctrl"] }}
            onAction={() => void caps.shell.openUrl(svg.url)}
          />
          {svg.brandUrl ? (
            <Action
              icon={{ lucide: "globe" }}
              title={`Visit ${svg.title} Brand Website`}
              shortcut={{ key: "b", modifiers: ["ctrl"] }}
              onAction={() => void caps.shell.openUrl(svg.brandUrl as string)}
            />
          ) : null}
          <Action
            icon={{ lucide: "globe" }}
            title="Visit This Category in Svgl"
            shortcut={{ key: "s", modifiers: ["ctrl"] }}
            onAction={() =>
              void caps.shell.openUrl(`${api.APP_URL}${category !== "All" ? `/directory/${category.toLowerCase()}` : ""}`)
            }
          />
        </ActionPanel.Section>
      ),
    };

    const visibleKeys = (prefs.showWordmark ?? true)
      ? SECTION_ORDER
      : SECTION_ORDER.filter((key) => !WORDMARK_KEYS.has(key));
    const available = visibleKeys.filter((key) => sections[key] !== null);
    const preferred = prefs.svgDefaultAction && available.includes(prefs.svgDefaultAction)
      ? prefs.svgDefaultAction
      : "copySvg";
    const ordered = [preferred, ...available.filter((key) => key !== preferred)];
    return <ActionPanel>{ordered.map((key) => sections[key])}</ActionPanel>;
  };

  const gridItem = (svg: api.Svgl, idPrefix: string, category: string) => (
    <Grid.Item
      key={`${idPrefix}_${svg.id}`}
      id={`${idPrefix}_${svg.id}`}
      title={svg.title}
      icon={{ uri: routeUrl(svg.route, "light"), uriDark: routeUrl(svg.route, "dark") }}
      actions={actionsFor(svg, category)}
    />
  );

  let body: ReactNode;
  if (category === "Pinned") {
    const pinned = state.pinned.map((id) => byId.get(id)).filter((svg): svg is api.Svgl => Boolean(svg));
    body = (
      <Grid.Section title="Pinned" subtitle={String(pinned.length)}>
        {pinned.map((svg) => gridItem(svg, "pinned", firstCategory(svg)))}
      </Grid.Section>
    );
  } else if (category === "Recently Used") {
    const recent = state.recent
      .map((id) => byId.get(id))
      .filter((svg): svg is api.Svgl => Boolean(svg))
      .filter((svg) => !state.pinned.includes(svg.id))
      .filter((svg) => matchesQuery(svg, query))
      .slice(0, 12);
    body = (
      <Grid.Section title="Recently Used" subtitle={String(recent.length)}>
        {recent.map((svg) => gridItem(svg, "recent", firstCategory(svg)))}
      </Grid.Section>
    );
  } else if (category !== "All") {
    const inCategory = searched.filter((svg) => inCategoryOf(svg, category));
    const total = categories.find((entry) => entry.category === category)?.total ?? inCategory.length;
    body = (
      <Grid.Section title={category} subtitle={String(total)}>
        {inCategory.map((svg) => gridItem(svg, category, category))}
      </Grid.Section>
    );
  } else {
    const pinned = state.pinned.map((id) => byId.get(id)).filter((svg): svg is api.Svgl => Boolean(svg));
    const recent = state.recent
      .map((id) => byId.get(id))
      .filter((svg): svg is api.Svgl => Boolean(svg))
      .filter((svg) => !state.pinned.includes(svg.id) && matchesQuery(svg, query))
      .slice(0, 12);
    body = (
      <>
        {pinned.length > 0 && (
          <Grid.Section title="Pinned" subtitle={String(pinned.length)}>
            {pinned.map((svg) => gridItem(svg, "pinned", firstCategory(svg)))}
          </Grid.Section>
        )}
        {recent.length > 0 && (
          <Grid.Section title="Recently Used" subtitle={String(recent.length)}>
            {recent.map((svg) => gridItem(svg, "recent", firstCategory(svg)))}
          </Grid.Section>
        )}
        {categories.map((entry) => {
          const inCategory = searched.filter((svg) => inCategoryOf(svg, entry.category));
          if (query.trim() && inCategory.length === 0) return null;
          return (
            <Grid.Section title={entry.category} subtitle={String(entry.total)} key={entry.category}>
              {inCategory.map((svg) => gridItem(svg, entry.category, entry.category))}
            </Grid.Section>
          );
        })}
      </>
    );
  }

  return (
    <Grid
      columns={6}
      isLoading={isLoading}
      searchBarPlaceholder="Search SVG Logos"
      filter={filterOptions}
    >
      {body}
    </Grid>
  );
}

function firstCategory(svg: api.Svgl): string {
  return Array.isArray(svg.category) ? (svg.category[0] ?? "All") : (svg.category ?? "All");
}

function inCategoryOf(svg: api.Svgl, category: string): boolean {
  return Array.isArray(svg.category) ? svg.category.includes(category) : svg.category === category;
}

// ------------------------------------------------------------------------------------------
// Setup shadcn/ui Registry
// ------------------------------------------------------------------------------------------

const REGISTRY_JSON = `{
  "registries": {
    "@svgl": "https://svgl.app/r/{name}.json"
  }
}`;

export function SetupShadcnRegistry(props: CommandProps) {
  const { capabilities } = props;
  return (
    <List searchBarPlaceholder="Setup shadcn/ui Registry">
      <List.Section>
        <List.Item
          id="copy-registry"
          title="Setup shadcn/ui Registry"
          subtitle="Copy svgl registry JSON into your clipboard."
          icon={{ uri: "https://svgl.app/library/shadcn-ui.svg" }}
          actions={
            <ActionPanel>
              <Action
                icon={{ lucide: "clipboard" }}
                title="Copy Registry JSON"
                onAction={async () => {
                  await capabilities.clipboard.write(REGISTRY_JSON);
                  await capabilities.toast
                    .show({
                      title: "Copied to clipboard",
                      message: "Add the svgl registry to your components.json file",
                      style: "success",
                    })
                    .catch(() => undefined);
                }}
              />
              <Action
                icon={{ lucide: "globe" }}
                title="Open Svgl Shadcn/ui Registry Docs"
                onAction={() => void capabilities.shell.openUrl("https://svgl.app/docs/shadcn-ui")}
              />
              <Action
                icon={{ lucide: "globe" }}
                title="Open Shadcn/ui Registry Docs"
                onAction={() => void capabilities.shell.openUrl("https://ui.shadcn.com/docs/registry")}
              />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

// ------------------------------------------------------------------------------------------
// Request SVG Logo (opens a pre-filled issue on the svgl repository)
// ------------------------------------------------------------------------------------------

export function RequestLogo(props: CommandProps) {
  const issueUrl = (values: Record<string, unknown>) => {
    const iconName = String(values.iconName ?? "");
    const svgUrl = String(values.svgUrl ?? "");
    const svgDarkUrl = String(values.svgDarkUrl ?? "");
    const productUrl = String(values.productUrl ?? "");
    const params = new URLSearchParams();
    params.set("title", `[SVG Request] ${iconName}`);
    const body = [
      "**Icon Name:** " + iconName,
      "**SVG URL:** " + svgUrl,
      svgDarkUrl ? `**SVG Dark Mode URL:** ${svgDarkUrl}` : "",
      "**Product URL:** " + productUrl,
    ]
      .filter(Boolean)
      .join("\n");
    params.set("body", body);
    return `https://github.com/pheralb/svgl/issues/new?${params.toString()}`;
  };

  return (
    <Form
      title="Request SVG Logo"
      onSubmit={(values) => {
        void props.capabilities.shell.openUrl(issueUrl(values));
      }}
      actions={
        <ActionPanel>
          <Action title="Submit Request" onAction={() => undefined} primary />
        </ActionPanel>
      }
    >
      <Form.TextField id="iconName" label="Icon Name" placeholder="Enter icon name" required />
      <Form.TextField id="svgUrl" label="SVG URL" placeholder="Enter icon SVG URL" required />
      <Form.TextField
        id="svgDarkUrl"
        label="SVG Dark Mode URL (optional)"
        placeholder="Enter icon SVG Dark Mode URL"
      />
      <Form.TextField id="productUrl" label="Product URL" placeholder="Enter icon product URL" required />
    </Form>
  );
}

export function SvglCommand(props: CommandProps) {
  switch (props.commandId) {
    case "setup-shadcn-registry":
      return <SetupShadcnRegistry {...props} />;
    case "request":
      return <RequestLogo {...props} />;
    default:
      return <SvglGrid {...props} />;
  }
}

const manifest = manifestJson as unknown as ExtensionManifest;

export default defineReactExtension({
  manifest,
  component: SvglCommand,
});
