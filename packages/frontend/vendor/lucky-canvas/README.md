# lucky-canvas wheel

The wheel is built from the user-supplied `lucky-canvas` 1.7.26 source (`packages/core/src/lib/wheel.ts`), upstream https://github.com/buuing/lucky-canvas. Copyright ldq / buuing and contributors; Apache-2.0 (full license alongside this file).

Regenerate with `node scripts/build-lottery-wheel-vendor.mjs <lucky-canvas-repository>` using the existing esbuild dependency. Only the wheel and its dependencies are bundled; no runtime CDN or additional package is needed.

Modifications: remove legacy prototype polyfills and global resize/font observers (the owner scales a fixed-resolution canvas with CSS); retain/cancel animation frames; dispose canvas listeners; add `settle(index)` for reduced motion and background tabs. The original checkout is never modified. The `.d.ts` describes the integration surface only. Backend receipts always select the winning index; no client lottery is used.
