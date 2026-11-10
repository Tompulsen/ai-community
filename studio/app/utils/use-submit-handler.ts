import { useRef, type KeyboardEvent } from "react";
import { SubmitKey, useAppConfig } from "../store/config";
import { createImeGuard } from "./ime-input";

export function useSubmitHandler() {
  const submitKey = useAppConfig((state) => state.submitKey);
  const ime = useRef(createImeGuard());
  const isImeKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!ime.current.blocks(event.nativeEvent)) return false;
    // Preserve candidate selection; suppress only the trailing commit Enter.
    if (event.key === "Enter" && !ime.current.isComposing(event.nativeEvent))
      event.preventDefault();
    return true;
  };
  const shouldSubmit = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return false;
    return (
      (submitKey === SubmitKey.AltEnter && event.altKey) ||
      (submitKey === SubmitKey.CtrlEnter && event.ctrlKey) ||
      (submitKey === SubmitKey.ShiftEnter && event.shiftKey) ||
      (submitKey === SubmitKey.MetaEnter && event.metaKey) ||
      (submitKey === SubmitKey.Enter &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.metaKey)
    );
  };
  return {
    submitKey,
    shouldSubmit,
    isImeKey,
    onCompositionStart: () => ime.current.start(),
    onCompositionEnd: () => ime.current.end(),
    onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) =>
      ime.current.release(event.nativeEvent),
  };
}
