export function trackInputModality(ownerDocument: Document) {
  const root = ownerDocument.documentElement;
  const attribute = "data-input-modality";
  const previous = root.getAttribute(attribute);
  const setModality = (value: "pointer" | "keyboard") => {
    if (root.getAttribute(attribute) !== value) {
      root.setAttribute(attribute, value);
    }
  };
  const onPointerDown = () => setModality("pointer");
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.isComposing
    ) {
      setModality("keyboard");
    }
  };

  setModality("pointer");
  ownerDocument.addEventListener("pointerdown", onPointerDown, true);
  ownerDocument.addEventListener("keydown", onKeyDown, true);

  return () => {
    ownerDocument.removeEventListener("pointerdown", onPointerDown, true);
    ownerDocument.removeEventListener("keydown", onKeyDown, true);
    if (previous === null) root.removeAttribute(attribute);
    else root.setAttribute(attribute, previous);
  };
}
