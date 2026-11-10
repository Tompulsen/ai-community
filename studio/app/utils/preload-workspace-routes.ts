import type { ComponentType } from "react";
import { Path } from "../constant";
import { importInTransition } from "./import-in-transition";
import { scheduleIdleTask } from "./schedule-idle-task";

const loaders: Partial<Record<Path, () => Promise<ComponentType>>> = {
  [Path.Settings]: async () =>
    (await import("../components/settings")).Settings,
  [Path.Account]: async () =>
    (await import("../components/account")).AccountPage,
  [Path.Gallery]: async () =>
    (await import("../components/gallery/gallery")).GalleryPage,
};
const pending = new Map<Path, Promise<void>>();
const preloaded = new Map<Path, ComponentType>();

export function getPreloadedWorkspaceRoute(path: Path) {
  return preloaded.get(path);
}

function canPreloadSpeculatively(reason: "idle" | "intent") {
  if (typeof navigator === "undefined") return false;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return (
    navigator.onLine !== false &&
    !connection?.saveData &&
    !["slow-2g", "2g"].includes(connection?.effectiveType ?? "") &&
    (reason !== "idle" || connection?.effectiveType !== "3g")
  );
}

export function preloadWorkspaceRoute(
  path: Path,
  reason: "idle" | "intent" | "activation" = "intent",
): Promise<void> {
  const load = loaders[path];
  if (!load || (reason !== "activation" && !canPreloadSpeculatively(reason))) {
    return Promise.resolve();
  }
  let loading = pending.get(path);
  if (!loading) {
    loading = importInTransition(load)
      .then((Page) => {
        preloaded.set(path, Page);
      })
      .catch(() => {
        pending.delete(path);
      });
    pending.set(path, loading);
  }
  return loading;
}

export function workspaceRoutePreloadHandlers(path: Path) {
  return {
    onPointerEnter: () => {
      void preloadWorkspaceRoute(path);
    },
    onFocus: () => {
      void preloadWorkspaceRoute(path);
    },
    onPointerDown: () => {
      void preloadWorkspaceRoute(path, "activation");
    },
  };
}

export function preloadCommonWorkspaceRoutes(): () => void {
  const priorities = [Path.Settings, Path.Account];
  let next = 0;
  let active = true;
  let cancel: (() => void) | undefined;
  const scheduleNext = () => {
    if (
      !active ||
      next === priorities.length ||
      !canPreloadSpeculatively("idle")
    ) {
      return;
    }
    cancel = scheduleIdleTask(() => {
      cancel = undefined;
      if (!active) return;
      void preloadWorkspaceRoute(priorities[next++], "idle").then(scheduleNext);
    });
  };
  scheduleNext();
  return () => {
    active = false;
    cancel?.();
  };
}
