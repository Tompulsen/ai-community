import { useRef, useCallback, useEffect } from "react";

export function isMessageInteractiveTarget(target: EventTarget | null) {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
      ? target.parentElement
      : null;
  return !!element?.closest(
    'input, textarea, select, button, a[href], summary, [role="button"], [contenteditable]:not([contenteditable="false"])',
  );
}

export function useLongPress(
  onLongPress: (e: React.MouseEvent | React.TouchEvent, message: any) => void,
  delay: number = 500,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const start = useCallback(
    (e: React.MouseEvent | React.TouchEvent, message: any) => {
      longPressTriggered.current = false;
      if (isMessageInteractiveTarget(e.target)) return;
      timerRef.current = setTimeout(() => {
        longPressTriggered.current = true;
        onLongPress(e, message);
      }, delay);
    },
    [onLongPress, delay],
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clear();
  }, [clear]);

  return {
    onMouseDown: (e: React.MouseEvent, message: any) => start(e, message),
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: (e: React.TouchEvent, message: any) => start(e, message),
    onTouchEnd: clear,
    onTouchMove: clear,
    longPressTriggered,
  };
}
