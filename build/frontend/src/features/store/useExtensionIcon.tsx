// Extension icon hook: resolves an installed extension's manifest icon (via `store.getIcon`,
// served from the install tree on disk) and caches it per uuid for the session so root search,
// settings and the Store view share one fetch per extension.

import { useEffect, useState } from "react";
import { RaycastIcon } from "../../icons";
import { storeGetIcon } from "./storeApi";

const cache = new Map<string, string>();

export function useExtensionIcon(uuid: string | null | undefined): string | null {
  const [icon, setIcon] = useState<string | null>(() => (uuid ? cache.get(uuid) ?? null : null));

  useEffect(() => {
    if (!uuid) {
      setIcon(null);
      return;
    }
    const cached = cache.get(uuid);
    if (cached) {
      setIcon(cached);
      return;
    }
    let alive = true;
    storeGetIcon(uuid)
      .then((result) => {
        if (!alive) return;
        if (result.icon) cache.set(uuid, result.icon);
        setIcon(result.icon);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [uuid]);

  return icon;
}

/** Root-search tile for an installed extension: its real icon when resolvable, Blocks otherwise. */
export function ExtensionIcon({ uuid, size = 16 }: { uuid: string; size?: number }) {
  const icon = useExtensionIcon(uuid);
  if (icon) {
    return <img src={icon} width={size} height={size} alt="" style={{ borderRadius: 3, objectFit: "contain" }} />;
  }
  return <RaycastIcon name="Blocks" size={size} />;
}
