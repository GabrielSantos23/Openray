// Extension icon hook (re-homed from the Store's useExtensionIcon in M2): resolves an installed
// extension's manifest icon (via `backend.getExtensionIcon`, read from the install tree on disk)
// and caches it per uuid for the session so root search and settings share one fetch. Manifest
// icons may be files (data URL), lucide names (`iconName`), or emoji (`emoji`).

import { useEffect, useState } from "react";
import { RaycastIcon } from "../../icons";
import { ipc } from "../../ipc";

export interface ExtensionIconMeta {
  icon: string | null;
  emoji: string | null;
}

const cache = new Map<string, ExtensionIconMeta>();

export function useExtensionIconMeta(uuid: string | null | undefined): ExtensionIconMeta | null {
  const [meta, setMeta] = useState<ExtensionIconMeta | null>(() => (uuid ? cache.get(uuid) ?? null : null));

  useEffect(() => {
    if (!uuid) {
      setMeta(null);
      return;
    }
    const cached = cache.get(uuid);
    if (cached) {
      setMeta(cached);
      return;
    }
    let alive = true;
    ipc.backend("getExtensionIcon", { uuid }, { module: "backend" })
      .then((result) => {
        const next: ExtensionIconMeta = {
          icon: (result as { icon?: string | null }).icon ?? null,
          emoji: (result as { emoji?: string | null }).emoji ?? null,
        };
        if (!alive) return;
        if (next.icon || next.emoji) cache.set(uuid, next);
        setMeta(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [uuid]);

  return meta;
}

/** Root-search tile for an installed extension: its real icon when resolvable, Blocks otherwise. */
export function ExtensionIcon({ uuid, size = 16 }: { uuid: string; size?: number }) {
  const meta = useExtensionIconMeta(uuid);
  if (meta?.icon) {
    return <img src={meta.icon} width={size} height={size} alt="" style={{ borderRadius: 3, objectFit: "contain" }} />;
  }
  if (meta?.emoji) {
    return (
      <span
        aria-hidden
        style={{ display: "inline-grid", placeItems: "center", width: size, height: size, fontSize: Math.round(size * 0.72), lineHeight: 1 }}
      >
        {meta.emoji}
      </span>
    );
  }
  return <RaycastIcon name="Blocks" size={size} />;
}
