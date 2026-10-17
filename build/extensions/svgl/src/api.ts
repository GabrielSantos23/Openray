// svgl.app API access: the library list, categories, individual SVG documents (id-prefixed like
// the svgl extension does) and the svgr React-component endpoint. Everything goes through the
// extension's cached HTTP capability; cache TTLs mirror the reference (5 min library, 1 week SVGs).

import type { FlowKeyCapabilities } from "@flowkey-mini/native-sdk";

export interface SvglRoute {
  dark?: string;
  light?: string;
}

export interface Svgl {
  id: number;
  title: string;
  category: string | string[];
  route: string | SvglRoute;
  wordmark?: string | SvglRoute;
  brandUrl?: string;
  url: string;
}

export interface SvglCategory {
  category: string;
  total: number;
}

export const APP_URL = "https://svgl.app";
export const API_URL = "https://api.svgl.app";
// svgr (React component generation) still lives on the old app API path.
export const OLD_API_URL = `${APP_URL}/api`;

const FIVE_MINUTES_SECONDS = 5 * 60;
const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60;

async function cached<T>(capabilities: FlowKeyCapabilities, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await capabilities.cache.get(key).catch(() => null);
  if (hit != null) return hit as T;
  const value = await load();
  await capabilities.cache.set(key, value, { ttlSeconds }).catch(() => undefined);
  return value;
}

async function fetchJson<T>(capabilities: FlowKeyCapabilities, url: string): Promise<T> {
  const response = await capabilities.http.fetch(url);
  if (response.status >= 400) {
    throw new Error(`Error ${response.status}, please try again later.`);
  }
  return JSON.parse(response.body) as T;
}

export function fetchSvgs(capabilities: FlowKeyCapabilities): Promise<Svgl[]> {
  return cached(capabilities, "svgl_svgs", FIVE_MINUTES_SECONDS, () =>
    fetchJson<Svgl[]>(capabilities, API_URL),
  );
}

export function fetchCategories(capabilities: FlowKeyCapabilities): Promise<SvglCategory[]> {
  return cached(capabilities, "svgl_categories", FIVE_MINUTES_SECONDS, () =>
    fetchJson<SvglCategory[]>(capabilities, `${API_URL}/categories`),
  );
}

// The filename minus extension becomes the id prefix so gradients/filters can't collide when a
// document mixes two logos (`duotone-x.svg` -> `id="duotone-x-gradient"`).
export function getPrefixFromSvgUrl(svgUrl: string): string {
  const file = svgUrl.split("/").pop() ?? "svg";
  return file.replace(/\.svg.*$/i, "").split("-").join("_");
}

export function prefixSvgIds(content: string, prefix: string): string {
  return content
    .replace(/id="([^"]+)"/g, `id="${prefix}-$1"`)
    .replace(/url\(#([^"]+)\)/g, `url(#${prefix}-$1)`);
}

export async function fetchSvg(capabilities: FlowKeyCapabilities, url: string): Promise<string> {
  return cached(capabilities, `svgl_svg_${url}`, ONE_WEEK_SECONDS, async () => {
    const response = await capabilities.http.fetch(url);
    if (response.status >= 400) {
      throw new Error(`Error ${response.status}, please try again later.`);
    }
    return prefixSvgIds(response.body, getPrefixFromSvgUrl(url));
  });
}

async function fetchReactComponent(capabilities: FlowKeyCapabilities, url: string, name: string, tsx: boolean): Promise<string> {
  const svg = await fetchSvg(capabilities, url);
  return cached(capabilities, `svgl_svgr_${url}_${tsx ? "tsx" : "jsx"}`, ONE_WEEK_SECONDS, async () => {
    const response = await capabilities.http.fetch(`${OLD_API_URL}/svgs/svgr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: svg, name, typescript: tsx }),
    });
    if (response.status >= 400) {
      throw new Error(`Error ${response.status}, please try again later.`);
    }
    const payload = JSON.parse(response.body) as { data?: string };
    if (typeof payload.data !== "string") throw new Error("svgr returned no component");
    return payload.data;
  });
}

// --- shared side effects ----------------------------------------------------------------------

export async function copyText(capabilities: FlowKeyCapabilities, text: string): Promise<void> {
  await capabilities.clipboard.write(text);
}

/** Puts a fetched SVG on the clipboard as a real file (file drop list), like Clipboard.copy({file}). */
export async function copySvgFile(
  capabilities: FlowKeyCapabilities,
  native: { call<T>(method: string, params?: Record<string, unknown>): Promise<T> },
  svg: string,
  fileName: string,
): Promise<void> {
  const safe = fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const result = await native.call<{ path: string }>("files.writeTemp", {
    name: `${safe}.svg`,
    content: svg,
  });
  await capabilities.clipboard.writeContent({ paths: [result.path] });
}

export function fetchAndCopyReactComponent(
  capabilities: FlowKeyCapabilities,
  url: string,
  name: string,
  tsx: boolean,
): Promise<string> {
  return fetchReactComponent(capabilities, url, name, tsx);
}
