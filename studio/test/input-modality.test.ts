import { fireEvent } from "@testing-library/react";
import { trackInputModality } from "../app/utils/input-modality";

afterEach(() => {
  document.documentElement.removeAttribute("data-input-modality");
});

test("keyboard navigation reveals focus feedback and pointer input clears it", () => {
  const stop = trackInputModality(document);
  const root = document.documentElement;
  expect(root).toHaveAttribute("data-input-modality", "pointer");
  fireEvent.keyDown(document.body, { key: "Tab" });
  expect(root).toHaveAttribute("data-input-modality", "keyboard");
  for (const pointerType of ["mouse", "touch", "pen"]) {
    fireEvent.pointerDown(document.body, { pointerType });
    expect(root).toHaveAttribute("data-input-modality", "pointer");
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(root).toHaveAttribute("data-input-modality", "keyboard");
  }
  stop();
});

test.each(["ctrlKey", "altKey", "metaKey", "isComposing"])(
  "%s key events do not reveal a false keyboard focus indicator",
  (modifier) => {
    const stop = trackInputModality(document);
    fireEvent.keyDown(document.body, { key: "a", [modifier]: true });
    expect(document.documentElement).toHaveAttribute(
      "data-input-modality",
      "pointer",
    );
    stop();
  },
);

test("cleanup restores the previous state and removes both listeners", () => {
  const root = document.documentElement;
  root.setAttribute("data-input-modality", "keyboard");
  const stop = trackInputModality(document);
  stop();
  expect(root).toHaveAttribute("data-input-modality", "keyboard");
  fireEvent.pointerDown(document.body);
  expect(root).toHaveAttribute("data-input-modality", "keyboard");
  root.setAttribute("data-input-modality", "pointer");
  fireEvent.keyDown(document.body, { key: "Tab" });
  expect(root).toHaveAttribute("data-input-modality", "pointer");
});

test("cleanup removes a state that did not exist before mounting", () => {
  const stop = trackInputModality(document);
  stop();
  expect(document.documentElement).not.toHaveAttribute("data-input-modality");
});
