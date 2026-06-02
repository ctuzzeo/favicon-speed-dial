import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { settings } from "#stores/useSettings";

/**
 * Renders its children only once settings have loaded from storage. This stops
 * the UI from painting default-derived state (wallpaper, theme, dial layout)
 * on a cold boot before the real values are read — the cause of the brief
 * "first run / updated" flash. index.html paints a neutral background in the
 * meantime, and `settings.initialize()` always flips `isLoaded` (even on
 * error), so this never blocks the page indefinitely.
 */
export const AppReady = observer(function AppReady({
  children,
}: {
  children: ReactNode;
}) {
  if (!settings.isLoaded) return null;
  return <>{children}</>;
});
