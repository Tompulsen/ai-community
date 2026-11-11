/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Pass the user's lucky-canvas checkout; the source stays untouched.
const upstream = resolve(process.argv[2]);
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/frontend/vendor/lucky-canvas');
const core = resolve(upstream, 'packages/core');
if (JSON.parse(readFileSync(resolve(core, 'package.json'), 'utf8')).version !== '1.7.26') throw new Error('Expected lucky-canvas 1.7.26');
mkdirSync(output, { recursive: true });
await build({
	entryPoints: [resolve(core, 'src/lib/wheel.ts')], outfile: resolve(output, 'wheel.js'),
	bundle: true, format: 'esm', target: 'es2022', minify: true,
	banner: { js: '/*! lucky-canvas 1.7.26, Copyright ldq / buuing and contributors. Apache-2.0; see LICENSE.\n * Modified for community: CSS sizing, cancellable animation, dispose and deterministic settle.\n * Regenerate with scripts/build-lottery-wheel-vendor.mjs. */' },
	plugins: [{ name: 'community-lifecycle', setup(b) {
		b.onLoad({ filter: /[/\\]lib[/\\](lucky|wheel)\.ts$/ }, args => {
			let source = readFileSync(args.path, 'utf8');
			if (args.path.endsWith('lucky.ts')) {
				source = source.replace(/import\s+'\.\.\/utils\/polyfill'\s*/, '');
				source = source.replace('  static version:', `  protected disposed = false
  protected frameId = 0
  private clickHandler = (e: MouseEvent) => this.handleClick(e)
  protected cancelAnimation () { window.cancelAnimationFrame(this.frameId) }
  public destroy () {
    this.disposed = true
    this.cancelAnimation()
    this.config.canvasElement?.removeEventListener('click', this.clickHandler)
    this.config.canvasElement?.remove()
  }
  static version:`);
				source = source.replace("addEventListener('click', e => this.handleClick(e))", "addEventListener('click', this.clickHandler)");
				source = source.replace("console.error('无法获取到 CanvasContext2D')", "throw new Error('Canvas 2D is unavailable')");
				const start = source.indexOf('    // 监听 window');
				const end = source.indexOf('\n  /**', start);
				if (start < 0 || end < 0) throw new Error('Upstream lifecycle changed');
				source = source.slice(0, start) + '    // The Vue owner sizes the fixed-resolution canvas with CSS.\n  }\n' + source.slice(end);
				source = source.replace(/this\.rAF = window\.requestAnimationFrame[\s\S]*?(?=      config\.setTimeout)/, `this.rAF = (callback: () => void) => {
        this.frameId = window.requestAnimationFrame(() => { if (!this.disposed) callback() })
      }
`);
			} else {
				source = source.replace('  public play (): void {', `  public settle (index: number): void {
    if (this.disposed || !Number.isInteger(index) || index < 0 || index >= this.prizes.length) return
    this.cancelAnimation()
    this.step = 0
    this.prizeFlag = index
    this.rotateDeg = -index * this.prizeDeg - this._defaultConfig.offsetDegree - this.prizeDeg / 2
    this.draw()
  }
  public destroy (): void {
    this.step = 0
    this.endCallback = undefined
    super.destroy()
  }
  public play (): void {
    if (this.disposed) return`);
				source = source.replace('  private draw (): void {', '  private draw (): void {\n    if (this.disposed) return');
			}
			return { contents: source, loader: 'ts' };
		});
	} }],
});
copyFileSync(resolve(core, 'LICENSE'), resolve(output, 'LICENSE'));
