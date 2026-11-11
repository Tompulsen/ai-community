import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "../utils/motion";

const SLOT_COUNT = 8;
const MAX_TAIL_LENGTH = 256;
const MAX_TAIL_NODES = 48;
const EXCLUDED_TAIL =
  "a, pre, code, button, textarea, input, select, table, svg, math, .katex, [data-source-citation]";
const registeredStyles = new WeakSet<object>();
const unsupportedStyles = new WeakSet<object>();

type HighlightRanges = Set<Range>;
type HighlightRegistry = Map<string, HighlightRanges>;
type HighlightApi = {
  highlights: HighlightRegistry;
  registerProperty: (property: {
    name: string;
    syntax: string;
    inherits: boolean;
    initialValue: string;
  }) => void;
};
type HighlightConstructor = new () => HighlightRanges;
type Reveal = {
  animation: Animation;
  range: Range;
  text: Text;
  start: number;
  end: number;
  content: string;
  highlight: HighlightRanges;
  registry: HighlightRegistry;
  name: string;
};
type SelectionPoint = { node: Text; offset: number; prefix: string };
type SelectedText = { anchor: SelectionPoint; focus: SelectionPoint };

function highlightSupport() {
  const css = window.CSS as unknown as Partial<HighlightApi> | undefined;
  const Highlight = (window as unknown as { Highlight?: HighlightConstructor })
    .Highlight;
  if (!css?.highlights || !css.registerProperty || !Highlight) return null;
  if (unsupportedStyles.has(css)) return null;
  if (!registeredStyles.has(css)) {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      try {
        css.registerProperty({
          name: `--octopus-stream-tail-${slot}-opacity`,
          syntax: "<number>",
          inherits: true,
          initialValue: "1",
        });
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          error.name !== "InvalidModificationError"
        ) {
          unsupportedStyles.add(css);
          return null;
        }
      }
    }
    registeredStyles.add(css);
  }
  return { registry: css.highlights, Highlight };
}

function tailText(root: HTMLElement): Text | null {
  let node: Node | null = root.lastChild;
  for (let visited = 0; node && visited < MAX_TAIL_NODES; visited++) {
    if (node instanceof Element && node.matches(EXCLUDED_TAIL)) return null;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return node.parentElement?.closest(EXCLUDED_TAIL) ? null : (node as Text);
    }
    if (node.lastChild) {
      node = node.lastChild;
      continue;
    }
    while (node && node !== root && !node.previousSibling)
      node = node.parentNode;
    node = node && node !== root ? node.previousSibling : null;
  }
  return null;
}

function hasSelection(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection();
  return (
    !!selection &&
    !selection.isCollapsed &&
    (root.contains(selection.anchorNode) ||
      root.contains(selection.focusNode) ||
      (selection.rangeCount > 0 &&
        selection.getRangeAt(0).intersectsNode(root)))
  );
}

function selectedText(root: HTMLElement): SelectedText | null {
  const selection = root.ownerDocument.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    !(selection.anchorNode instanceof Text) ||
    !(selection.focusNode instanceof Text) ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  )
    return null;
  return {
    anchor: {
      node: selection.anchorNode,
      offset: selection.anchorOffset,
      prefix: selection.anchorNode.data.slice(0, selection.anchorOffset),
    },
    focus: {
      node: selection.focusNode,
      offset: selection.focusOffset,
      prefix: selection.focusNode.data.slice(0, selection.focusOffset),
    },
  };
}

function restoreSelectedText(root: HTMLElement, selected: SelectedText) {
  const selection = root.ownerDocument.getSelection();
  const { anchor, focus } = selected;
  if (
    !selection?.rangeCount ||
    typeof selection.setBaseAndExtent !== "function" ||
    selection.anchorNode !== anchor.node ||
    selection.focusNode !== focus.node ||
    !root.contains(anchor.node) ||
    !root.contains(focus.node) ||
    !anchor.node.data.startsWith(anchor.prefix) ||
    !focus.node.data.startsWith(focus.prefix)
  )
    return false;
  selection.setBaseAndExtent(
    anchor.node,
    anchor.offset,
    focus.node,
    focus.offset,
  );
  return true;
}

/** Fade new plain-text tails without inserting nodes into Markdown content. */
export function useStreamTailReveal(
  rootRef: RefObject<HTMLElement>,
  content: string,
  active: boolean,
) {
  const previous = useRef({ content, active });
  const reveals = useRef(new Map<number, Reveal>());
  const selection = useRef<SelectedText | null>(null);
  const nativeMotionAvailable = useRef(true);
  const stopWatching = useRef<(() => void) | undefined>();
  const clear = useCallback(() => {
    for (const reveal of reveals.current.values()) {
      reveal.animation.onfinish = null;
      reveal.animation.cancel();
      reveal.highlight.delete(reveal.range);
      if (
        !reveal.highlight.size &&
        reveal.registry.get(reveal.name) === reveal.highlight
      )
        reveal.registry.delete(reveal.name);
    }
    reveals.current.clear();
    stopWatching.current?.();
    stopWatching.current = undefined;
  }, []);

  useLayoutEffect(() => clear, [clear]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !active) return;
    const captureSelection = () => {
      selection.current = selectedText(root);
    };
    const releaseSelection = () => {
      selection.current = null;
    };
    captureSelection();
    document.addEventListener("selectionchange", captureSelection);
    document.addEventListener("pointerdown", releaseSelection, true);
    return () => {
      document.removeEventListener("selectionchange", captureSelection);
      document.removeEventListener("pointerdown", releaseSelection, true);
    };
  }, [active, rootRef]);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { content, active };
    const root = rootRef.current;
    if (!root || content === before.content) return;
    if ((!active && !before.active) || !content.startsWith(before.content)) {
      selection.current = null;
      clear();
      return;
    }
    if (selection.current && !restoreSelectedText(root, selection.current))
      selection.current = null;
    // React updates nodeValue as a whole; retain only the existing tail ranges.
    for (const reveal of reveals.current.values()) {
      if (
        reveal.text.isConnected &&
        reveal.text.data.slice(reveal.start, reveal.end) === reveal.content
      ) {
        reveal.range.setStart(reveal.text, reveal.start);
        reveal.range.setEnd(reveal.text, reveal.end);
      }
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shouldClear = () =>
      document.hidden || prefersReducedMotion() || hasSelection(root);
    if (shouldClear() || !root.animate || !nativeMotionAvailable.current) {
      clear();
      return;
    }
    const appended = content.slice(before.content.length);
    // Markdown delimiters can reinterpret an earlier node rather than append text.
    if (/[\\`*_~[\]<>$|]/.test(appended)) return;
    const tail = appended.split(/\r?\n/).at(-1)!.slice(-MAX_TAIL_LENGTH);
    if (!tail.trim()) return;
    const text = tailText(root);
    if (!text?.data.endsWith(tail)) return;
    const support = highlightSupport();
    if (!support) return;
    let slot = 0;
    while (slot < SLOT_COUNT && reveals.current.has(slot)) slot++;
    if (slot === SLOT_COUNT) return;

    const name = `octopus-stream-tail-${slot}`;
    const property = `--${name}-opacity`;
    const range = document.createRange();
    range.setStart(text, text.length - tail.length);
    range.setEnd(text, text.length);
    const existingHighlight = support.registry.get(name);
    const highlight = existingHighlight ?? new support.Highlight();
    if (!existingHighlight) support.registry.set(name, highlight);
    highlight.add(range);
    let animation: Animation;
    try {
      animation = root.animate([{ [property]: "0.6" }, { [property]: "1" }], {
        duration: 180,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      });
    } catch {
      nativeMotionAvailable.current = false;
      highlight.delete(range);
      if (!highlight.size && support.registry.get(name) === highlight)
        support.registry.delete(name);
      return;
    }
    const reveal = {
      animation,
      range,
      text,
      start: text.length - tail.length,
      end: text.length,
      content: tail,
      highlight,
      registry: support.registry,
      name,
    };
    reveals.current.set(slot, reveal);
    animation.onfinish = () => {
      if (reveals.current.get(slot) !== reveal) return;
      animation.onfinish = null;
      animation.cancel();
      highlight.delete(range);
      if (!highlight.size && support.registry.get(name) === highlight)
        support.registry.delete(name);
      reveals.current.delete(slot);
      if (!reveals.current.size) {
        stopWatching.current?.();
        stopWatching.current = undefined;
      }
    };
    if (!stopWatching.current) {
      const update = () => {
        if (shouldClear()) clear();
      };
      const observer = new MutationObserver(update);
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "data-motion"],
      });
      media.addEventListener("change", update);
      document.addEventListener("selectionchange", update);
      document.addEventListener("visibilitychange", update);
      stopWatching.current = () => {
        observer.disconnect();
        media.removeEventListener("change", update);
        document.removeEventListener("selectionchange", update);
        document.removeEventListener("visibilitychange", update);
      };
    }
  }, [content, active, rootRef, clear]);
}
