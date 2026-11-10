import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type RefObject,
} from "react";

function composerButton(container: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element) || !container.contains(target)) return null;
  const button = target.closest<HTMLButtonElement>("button");
  if (
    !button ||
    button.disabled ||
    button.getAttribute("aria-disabled") === "true" ||
    button.matches(
      '[data-select-trigger], [role="combobox"], [role="slider"]',
    ) ||
    button.closest(
      'dialog, [role="dialog"], [role="listbox"], [role="menu"]',
    ) ||
    target.closest("input, textarea, select, [contenteditable='true']")
  )
    return null;
  return button;
}

export function useComposerFocus(
  inputRef: RefObject<HTMLTextAreaElement>,
  fileInputRef: RefObject<HTMLInputElement>,
  mobile: boolean,
  historyRef?: RefObject<HTMLElement>,
) {
  const composerRef = useRef<HTMLDivElement>(null);
  const mouseEntry = useRef(false);
  const restoreFrame = useRef<number>();
  const restore = useCallback(() => {
    const input = inputRef.current;
    const composer = composerRef.current;
    const active = document.activeElement;
    if (
      mobile ||
      !mouseEntry.current ||
      !input?.isConnected ||
      input.disabled ||
      !composer ||
      document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
    )
      return false;
    if (active === input) return true;
    if (
      !active ||
      active === document.body ||
      active === historyRef?.current ||
      composerButton(composer, active)
    )
      input.focus({ preventScroll: true });
    return document.activeElement === input;
  }, [inputRef, historyRef, mobile]);

  const restoreAfterAction = useCallback(() => {
    restore();
    if (restoreFrame.current !== undefined)
      cancelAnimationFrame(restoreFrame.current);
    // Let the closing control unmount and the outside click finish first.
    restoreFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = undefined;
      restore();
    });
  }, [restore]);

  useEffect(() => {
    const fileInput = fileInputRef.current;
    const onTab = (event: KeyboardEvent) => {
      if (event.key === "Tab") mouseEntry.current = false;
    };
    const finishClick = () => {
      const frame = restoreFrame.current;
      if (frame === undefined) return;
      const finish = () => {
        if (restoreFrame.current !== frame || !restore()) return false;
        cancelAnimationFrame(frame);
        restoreFrame.current = undefined;
        return true;
      };
      // React may commit a portaled control's removal after this native click.
      if (!finish()) queueMicrotask(finish);
    };
    // A Tab that enters the composer can originate anywhere on the page.
    document.addEventListener("keydown", onTab, true);
    document.addEventListener("click", finishClick);
    // Restore on selection/cancel, before asynchronous material preparation.
    fileInput?.addEventListener("change", restore);
    fileInput?.addEventListener("cancel", restore);
    return () => {
      document.removeEventListener("keydown", onTab, true);
      document.removeEventListener("click", finishClick);
      fileInput?.removeEventListener("change", restore);
      fileInput?.removeEventListener("cancel", restore);
      if (restoreFrame.current !== undefined) {
        cancelAnimationFrame(restoreFrame.current);
        restoreFrame.current = undefined;
      }
    };
  }, [fileInputRef, restore]);

  const handlers: HTMLAttributes<HTMLDivElement> = {
    onClick(event) {
      const target = event.target;
      const input = inputRef.current;
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(target instanceof Element) ||
        !event.currentTarget.contains(target) ||
        !target.closest("[data-composer-focus-area]") ||
        target.closest(
          "button, a, input, textarea, select, label, summary, img, audio, video, [contenteditable]:not([contenteditable='false']), [tabindex], [data-select-trigger], [role='button'], [role='checkbox'], [role='switch'], [role='slider'], [role='combobox'], [role='dialog'], [role='listbox'], [role='menu']",
        ) ||
        !input?.isConnected ||
        input.disabled ||
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        )
      )
        return;
      input.focus({ preventScroll: true });
    },
    onPointerDownCapture(event) {
      // Portaled menus keep their own focus scope despite React event bubbling.
      if (!event.currentTarget.contains(event.target as Node)) return;
      mouseEntry.current =
        !mobile &&
        event.pointerType === "mouse" &&
        event.button === 0 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        Boolean(composerButton(event.currentTarget, event.target));
    },
    onMouseDownCapture(event) {
      if (
        !mouseEntry.current ||
        event.button !== 0 ||
        !composerButton(event.currentTarget, event.target) ||
        !inputRef.current?.isConnected ||
        inputRef.current.disabled
      )
        return;
      event.preventDefault();
      inputRef.current.focus({ preventScroll: true });
    },
    onKeyDownCapture(event) {
      if (
        (event.key === "Enter" || event.key === " ") &&
        composerButton(event.currentTarget, event.target)
      )
        mouseEntry.current = false;
    },
    onFocusCapture(event) {
      if (
        mouseEntry.current &&
        !mobile &&
        composerButton(event.currentTarget, event.target) &&
        inputRef.current?.isConnected &&
        !inputRef.current.disabled &&
        !document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        )
      )
        inputRef.current.focus({ preventScroll: true });
    },
  };

  return { ref: composerRef, ...handlers, restoreAfterAction };
}
