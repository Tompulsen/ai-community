import { useState, type ComponentType } from "react";
import { Path } from "../constant";
import { getPreloadedWorkspaceRoute } from "../utils/preload-workspace-routes";

export function PreloadedWorkspaceRoute({
  path,
  fallback,
}: {
  path: Path;
  fallback: ComponentType;
}) {
  // Keep the selected component for this visit so late prewarming cannot remount it.
  const [Page] = useState<ComponentType>(
    () => getPreloadedWorkspaceRoute(path) ?? fallback,
  );
  return <Page />;
}
