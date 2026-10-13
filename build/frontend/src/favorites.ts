// Favorites — Raycast pins favorite applications and commands at the top of Root Search and
// renders them in their own section, ahead of Applications and Extensions.
//
// Raycast stores the pinned set in its settings store; this clone keeps it in localStorage under
// `raycast-mini:favorites` so it survives window reloads and restarts. Both applications and
// extension commands can be pinned, each with its own key prefix so the two namespaces never
// collide.

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "raycast-mini:favorites";

/** `app:<application id>` / `command:<extension uuid>/<command name>`. */
export type FavoriteKey = string;

export function applicationFavoriteKey(applicationId: string): FavoriteKey {
  return `app:${applicationId}`;
}

export function commandFavoriteKey(extensionUuid: string, commandName: string): FavoriteKey {
  return `command:${extensionUuid}/${commandName}`;
}

/** `internal:<area>/<command>` — internal commands pin with their own prefix so the key can never
 * collide with an extension command's `command:<uuid>/<name>` key. */
export function internalFavoriteKey(commandId: string): FavoriteKey {
  return `internal:${commandId}`;
}

function loadFavorites(): FavoriteKey[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((entry) => typeof entry === "string") as FavoriteKey[]) : [];
  } catch {
    return [];
  }
}

function persistFavorites(keys: FavoriteKey[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* private mode / quota — favorites simply do not persist */
  }
}

export interface FavoritesStore {
  /** Ordered, exactly as Raycast renders them (pin order). */
  favorites: FavoriteKey[];
  isFavorite: (key: FavoriteKey) => boolean;
  toggleFavorite: (key: FavoriteKey) => boolean;
}

export function useFavorites(): FavoritesStore {
  const [favorites, setFavorites] = useState<FavoriteKey[]>(() => loadFavorites());

  useEffect(() => {
    persistFavorites(favorites);
  }, [favorites]);

  const set = useMemo(() => new Set(favorites), [favorites]);

  const toggleFavorite = useCallback(
    (key: FavoriteKey) => {
      const added = !favorites.includes(key);
      setFavorites((current) =>
        current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
      );
      return added;
    },
    [favorites],
  );
  return { favorites, isFavorite: (key) => set.has(key), toggleFavorite };
}
