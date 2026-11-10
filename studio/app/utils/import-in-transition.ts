import { startTransition } from "react";

export function importInTransition<T>(load: () => Promise<T>): Promise<T> {
  // Leave render, then start CSS loaders synchronously in a fresh transition.
  return Promise.resolve().then(() => {
    let result!: Promise<T>;
    startTransition(() => {
      result = new Promise<T>((resolve) => resolve(load()));
    });
    return result;
  });
}
