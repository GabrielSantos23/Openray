// GitHub source for the extension store catalog: the `raycast/extensions` repo.
//
// Two authenticated-tier API calls power a full sync (the recursive tree of `main` is TRUNCATED by
// GitHub above ~70k entries, so the catalog walks the `extensions` subtree by SHA instead —
// complete and authoritative), then every extension's `package.json` comes from
// raw.githubusercontent.com, which is a CDN and not subject to the API rate limit.
// Detail views add two lazy, cached calls per extension: the extension's file list (screenshots)
// and its last commit date.
"use strict";

const REPO = "raycast/extensions";
const BRANCH = "main";
const API_BASE = `https://api.github.com/repos/${REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

function githubFetch(path, { fetchImpl, raw = false } = {}) {
  const doFetch = fetchImpl ?? fetch;
  const url = raw ? `${RAW_BASE}/${path}` : `${API_BASE}${path}`;
  return doFetch(url, {
    headers: raw ? { "User-Agent": "RaycastMini" } : { Accept: "application/vnd.github+json", "User-Agent": "RaycastMini" },
    signal: AbortSignal.timeout(60_000),
  });
}

async function fetchJson(path, fetchImpl) {
  const response = await githubFetch(path, { fetchImpl });
  if (!response.ok) throw new Error(`github api ${path}: HTTP ${response.status}`);
  return response.json();
}

async function fetchRawText(path, fetchImpl) {
  const response = await githubFetch(path, { fetchImpl, raw: true });
  if (!response.ok) throw new Error(`github raw ${path}: HTTP ${response.status}`);
  return response.text();
}

async function fetchRawBuffer(path, fetchImpl) {
  const response = await githubFetch(path, { fetchImpl, raw: true });
  if (!response.ok) throw new Error(`github raw ${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** `[{"name", "sha"}]` for every directory under `extensions/` — two API calls, complete. */
async function fetchExtensionDirs(fetchImpl) {
  const root = await fetchJson(`/git/trees/${BRANCH}`, fetchImpl);
  const extensionsNode = (root.tree ?? []).find((entry) => entry.path === "extensions" && entry.type === "tree");
  if (!extensionsNode?.sha) throw new Error("github tree: no extensions directory");
  const subtree = await fetchJson(`/git/trees/${extensionsNode.sha}`, fetchImpl);
  return (subtree.tree ?? [])
    .filter((entry) => entry.type === "tree")
    .map((entry) => ({ name: entry.path, sha: entry.sha }));
}

/** The date of the latest commit touching `path` (one API call — used per detail view, cached). */
async function fetchLastCommitDate(repoPath, fetchImpl) {
  const commits = await fetchJson(`/commits?path=${encodeURIComponent(repoPath)}&per_page=1`, fetchImpl);
  const date = commits?.[0]?.commit?.committer?.date ?? commits?.[0]?.commit?.author?.date ?? null;
  return date;
}

/** `[{"path", "sha", "size"}]` for one extension directory, recursive (dirs stay small). */
async function fetchDirListing(sha, fetchImpl) {
  const tree = await fetchJson(`/git/trees/${sha}?recursive=1`, fetchImpl);
  if (tree.truncated) throw new Error("github tree: directory listing truncated");
  return (tree.tree ?? []).filter((entry) => entry.type === "blob");
}

/** Bounded-concurrency map over `items`; never rejects — per-item errors go to `onError`. */
async function pool(items, concurrency, worker, onError) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        await worker(item);
      } catch (error) {
        onError?.(item, error);
      }
    }
  });
  await Promise.all(runners);
}

module.exports = {
  REPO,
  BRANCH,
  fetchExtensionDirs,
  fetchLastCommitDate,
  fetchDirListing,
  fetchRawText,
  fetchRawBuffer,
  rawUrl: (path) => `${RAW_BASE}/${path}`,
  blobUrl: (path) => `https://github.com/${REPO}/blob/${BRANCH}/${path}`,
  pool,
};
