import { useLayoutEffect, useRef, type RefObject } from "react";
import type { ConversationSearchMatch } from "../utils/conversation-search";
import "./conversation-search-highlight.scss";

type SearchHighlight = Set<Range>;
type SearchHighlightApi = {
  registry: Map<string, SearchHighlight>;
  Highlight: new (...ranges: Range[]) => SearchHighlight;
};

export const SEARCH_HIGHLIGHT = "octopus-conversation-search";
export const CURRENT_SEARCH_HIGHLIGHT = "octopus-conversation-search-current";

function highlightApi(): SearchHighlightApi | null {
  const registry = (
    window.CSS as unknown as { highlights?: SearchHighlightApi["registry"] }
  )?.highlights;
  const Highlight = (
    window as unknown as { Highlight?: SearchHighlightApi["Highlight"] }
  ).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

export function renderedSearchRanges(root: Element, query: string): Range[] {
  if (!query.trim()) return [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.parentElement?.closest(
          "script, style, button, [aria-hidden='true'], [hidden]",
        )
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  const nodes: { node: Text; offset: number }[] = [];
  let text = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push({ node: node as Text, offset: text.length });
    text += node.textContent;
  }
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const ranges: Range[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    const first = nodes.find(
      (part) => start >= part.offset && start < part.offset + part.node.length,
    );
    const last = nodes.find(
      (part) => end > part.offset && end <= part.offset + part.node.length,
    );
    if (!first || !last) continue;
    const range = root.ownerDocument.createRange();
    range.setStart(first.node, start - first.offset);
    range.setEnd(last.node, end - last.offset);
    ranges.push(range);
  }
  return ranges;
}

/** Highlight text without replacing Markdown nodes or changing native selection. */
export function useConversationSearchHighlight({
  containerRef,
  query,
  current,
  occurrence,
  navigation,
  page,
  enabled,
}: {
  containerRef: RefObject<HTMLDivElement>;
  query: string;
  current?: ConversationSearchMatch;
  occurrence: number;
  navigation: number;
  page: number;
  enabled: boolean;
}) {
  const lastScroll = useRef("");
  const messageId = current?.messageId;
  const matchStart = current?.start;
  useLayoutEffect(() => {
    const container = containerRef.current;
    const api = highlightApi();
    let activeMessage: HTMLElement | undefined;
    let frame: number | undefined;
    let settleFrame: number | undefined;
    const clear = () => {
      api?.registry.delete(SEARCH_HIGHLIGHT);
      api?.registry.delete(CURRENT_SEARCH_HIGHLIGHT);
      activeMessage?.removeAttribute("data-chat-search-current");
      activeMessage?.removeAttribute("data-chat-search-fallback");
    };
    if (!enabled || !messageId || !container || !query.trim()) {
      lastScroll.current = "";
      clear();
      return;
    }
    const key = JSON.stringify([query, messageId, matchStart, navigation]);
    let settled = false;
    let userInterrupted = false;
    const resizeObserver = new ResizeObserver(() => schedule());
    const update = () => {
      frame = undefined;
      const ranges: Range[] = [];
      let currentRanges: Range[] = [];
      for (const message of Array.from(
        container.querySelectorAll<HTMLElement>("[data-quotable-message]"),
      )) {
        resizeObserver.observe(message);
        const content = message.querySelector(
          '[data-chat-search-content="true"]',
        );
        if (!content) continue;
        const found = renderedSearchRanges(content, query);
        ranges.push(...found);
        if (message.dataset.messageId === messageId) {
          activeMessage = message;
          currentRanges = found;
        }
      }
      const selected = currentRanges[occurrence];
      if (api) {
        api.registry.set(SEARCH_HIGHLIGHT, new api.Highlight(...ranges));
        api.registry.set(
          CURRENT_SEARCH_HIGHLIGHT,
          new api.Highlight(...(selected ? [selected] : [])),
        );
      }
      if (!activeMessage) return;
      activeMessage.setAttribute("data-chat-search-current", "true");
      if (!api || !selected)
        activeMessage.setAttribute("data-chat-search-fallback", "true");
      else activeMessage.removeAttribute("data-chat-search-fallback");
      if (!settled || userInterrupted) return;
      const rect =
        selected?.getBoundingClientRect() ??
        activeMessage.getBoundingClientRect();
      const body = container.getBoundingClientRect();
      const bottom = Math.min(
        rect.bottom,
        rect.top + container.clientHeight - 24,
      );
      if (
        lastScroll.current === key &&
        rect.top >= body.top + 8 &&
        bottom <= body.bottom - 8
      )
        return;
      container.scrollTop +=
        rect.top - body.top - Math.min(96, container.clientHeight / 4);
      lastScroll.current = key;
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(container, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const interrupt = () => {
      userInterrupted = true;
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest("input, textarea, select, [contenteditable]") &&
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        interrupt();
    };
    container.addEventListener("wheel", interrupt, { passive: true });
    container.addEventListener("touchstart", interrupt, { passive: true });
    container.addEventListener("pointerdown", interrupt, { passive: true });
    container.addEventListener("keydown", keydown);
    resizeObserver.observe(container);
    update();
    // Let pagination and the session's initial positioning finish before jumping.
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        settled = true;
        update();
      });
    });
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      container.removeEventListener("wheel", interrupt);
      container.removeEventListener("touchstart", interrupt);
      container.removeEventListener("pointerdown", interrupt);
      container.removeEventListener("keydown", keydown);
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (settleFrame !== undefined) cancelAnimationFrame(settleFrame);
      clear();
    };
  }, [
    containerRef,
    enabled,
    query,
    messageId,
    matchStart,
    occurrence,
    navigation,
    page,
  ]);
}
