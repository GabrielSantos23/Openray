// The app update check (`updates.*`, docs/updates.md). The backend compares the running
// version against the latest GitHub Release on a boot + 6h schedule and pushes
// `updates.changed` whenever its state moves; this hook mirrors that state for the
// root-search "New Update Available" card.

import { useEffect, useState } from "react";
import { ipc, onNotification } from "./ipc";

export interface UpdateState {
  available: boolean;
  checking: boolean;
  currentVersion: string;
  latestVersion: string | null;
  /** GitHub release page. */
  url: string | null;
  downloadUrl: string | null;
  assetName: string | null;
  notes: string | null;
  publishedAt: string | null;
  lastCheckedAt: number | null;
  lastError: string | null;
  skippedVersion: string | null;
}

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    let cancelled = false;
    ipc
      .backend("updates.getState", {}, { module: "backend" })
      .then((response) => {
        if (!cancelled) setState((response as UpdateState) ?? null);
      })
      .catch(() => undefined);
    const off = onNotification("updates.changed", (data) => {
      if (!cancelled) setState((data as UpdateState) ?? null);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return state;
}
