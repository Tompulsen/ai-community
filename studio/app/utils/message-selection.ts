export function getMessageSelectionText(container: Element | null) {
  const selection = container?.ownerDocument.getSelection();
  if (
    !container ||
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount
  )
    return undefined;

  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    if (
      !container.contains(range.startContainer) ||
      !container.contains(range.endContainer)
    )
      return undefined;
  }

  const text = selection.toString();
  return text.length ? text : undefined;
}
