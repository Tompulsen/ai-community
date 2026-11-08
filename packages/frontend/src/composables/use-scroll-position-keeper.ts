/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { throttle } from 'throttle-debounce';
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import type { Ref } from 'vue';

// note render skippingがオンだとズレるため、遷移直前にスクロール範囲に表示されているdata-scroll-anchor要素を特定して、復元時に当該要素までスクロールするようにする

export function useScrollPositionKeeper(scrollContainerRef: Ref<HTMLElement | null | undefined>): void {
	let anchorId: string | null = null;
	// キャプチャ時のアンカー要素上端のコンテナ上端からの距離
	let anchorContainerLocalY = 0;
	let savedScrollTop: number | null = null;
	let ready = true;
	let active = true;
	let restoreTimer: number | undefined;

	watch(scrollContainerRef, (el, _previous, onCleanup) => {
		if (!el) return;

		const captureAnchor = (force = false) => {
			if (!active || !el.isConnected || (!ready && !force)) return;
			savedScrollTop = el.scrollTop;

			if (el.scrollTop < 100) {
				// 上部にいるときはanchorを参照するとズレの原因になるし位置復元するメリットも乏しいため設定しない
				anchorId = null;
				return;
			}

			const scrollContainerRect = el.getBoundingClientRect();
			const viewPosition = scrollContainerRect.top + scrollContainerRect.height / 2;

			anchorId = null;
			const anchorEls = el.querySelectorAll<HTMLElement>('[data-scroll-anchor]');
			for (let i = anchorEls.length - 1; i > -1; i--) { // 下から見た方が速い
				const anchorEl = anchorEls[i];
				const anchorTop = anchorEl.getBoundingClientRect().top;
				// 上端が viewPosition 以下の最初の要素（＝中央を跨ぐか、中央より上にある中で最も近いもの）を選択する
				// 最下部スクロール時に min-height による空白に viewPosition が入った場合も最後のアイテムをキャプチャできる
				if (anchorTop <= viewPosition) {
					anchorId = anchorEl.getAttribute('data-scroll-anchor');
					anchorContainerLocalY = anchorTop - scrollContainerRect.top;
					break;
				}
			}
		};

		// ほんとはscrollイベントじゃなくてonBeforeDeactivatedでやりたい
		// https://github.com/vuejs/vue/issues/9454
		// https://github.com/vuejs/rfcs/pull/284
		const onScroll = throttle(1000, () => captureAnchor());
		el.addEventListener('scroll', onScroll, { passive: true });
		// スクロール後すぐにクリックするとthrottleによりanchorIdが古いまま残るため、
		// pointerdownで遷移直前のアンカーを同期的に取得する
		const onInteraction = () => {
			window.clearTimeout(restoreTimer);
			ready = true;
			captureAnchor(true);
		};
		el.addEventListener('pointerdown', onInteraction, { passive: true });
		el.addEventListener('keydown', onInteraction);
		el.addEventListener('wheel', onInteraction, { passive: true });
		onCleanup(() => {
			onScroll.cancel();
			el.removeEventListener('scroll', onScroll);
			el.removeEventListener('pointerdown', onInteraction);
			el.removeEventListener('keydown', onInteraction);
			el.removeEventListener('wheel', onInteraction);
		});
	}, {
		immediate: true,
	});

	const restore = () => {
		if (savedScrollTop == null) return;
		const scrollContainer = scrollContainerRef.value;
		if (!scrollContainer) return;
		const scrollAnchorEl = anchorId ? scrollContainer.querySelector<HTMLElement>(`[data-scroll-anchor="${CSS.escape(anchorId)}"]`) : null;
		if (!scrollAnchorEl) {
			scrollContainer.scrollTop = savedScrollTop;
			return;
		}
		const anchorRect = scrollAnchorEl.getBoundingClientRect();
		// anchorContentY: コンテンツ先頭からのアンカー要素上端の距離（scrollTopに依存しない）
		const anchorContentY = scrollContainer.scrollTop + anchorRect.top - scrollContainer.getBoundingClientRect().top;
		// キャプチャ時と同じ scrollTop になるよう直接セット（コンテナ高さ変化に依存しない）
		scrollContainer.scrollTop = anchorContentY - anchorContainerLocalY;
	};

	onDeactivated(() => {
		// Capture before KeepAlive detaches the element; its scrollTop is already 0 here.
		active = false;
		ready = false;
		window.clearTimeout(restoreTimer);
	});

	onActivated(() => {
		active = true;
		ready = false;
		restore();
		nextTick(() => {
			if (!active) return;
			restore();
			restoreTimer = window.setTimeout(() => {
				restore();

				ready = true;
			}, 100);
		});
	});
	onBeforeUnmount(() => { active = false; window.clearTimeout(restoreTimer); });
}
