export function isSelectMenuWithin(
  target: Node,
  container: HTMLElement | null,
): boolean {
  const element = target instanceof Element ? target : target.parentElement;
  const menu = element?.closest<HTMLElement>("[data-select-trigger-id]");
  const triggerId = menu?.dataset.selectTriggerId;
  const trigger = triggerId ? document.getElementById(triggerId) : null;
  return !!trigger && !!container?.contains(trigger);
}
