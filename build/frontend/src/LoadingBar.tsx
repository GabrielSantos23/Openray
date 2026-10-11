// Raycast's navigation-bar loading indicator: shown only after `isLoading` has been true for
// 300ms, then fades in/out, exactly like `NavigationBarUI.Root` in the shipped bundle. Shared by
// the root search header and the Translate view's top bar.

import { useEffect, useState } from "react";

export function LoadingBar({ isLoading }: { isLoading: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setVisible(true), 300);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [isLoading]);
  return <div className="loader-bar" data-state={visible ? "loading" : undefined} />;
}
