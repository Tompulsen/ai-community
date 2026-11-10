import React, { createRef, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { ChoiceSelect } from "../app/components/choice-select";
import { ComposerParameterPopover } from "../app/components/composer-parameter-popover";

const options = (
  <>
    <option value="">Automatic</option>
    <option value="light">Light</option>
    <option value="dark">Dark</option>
  </>
);

const browserDescriptors = {
  scrollIntoView: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  ),
  hasPointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "hasPointerCapture",
  ),
  releasePointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "releasePointerCapture",
  ),
  ResizeObserver: Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver"),
};

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

afterEach(cleanup);

afterAll(() => {
  for (const key of [
    "scrollIntoView",
    "hasPointerCapture",
    "releasePointerCapture",
  ] as const) {
    const descriptor = browserDescriptors[key];
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  }
  if (browserDescriptors.ResizeObserver) {
    Object.defineProperty(
      globalThis,
      "ResizeObserver",
      browserDescriptors.ResizeObserver,
    );
  } else {
    delete (globalThis as unknown as Record<string, unknown>).ResizeObserver;
  }
});

async function choose(name: string, trigger = screen.getByRole("combobox")) {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name }));
  await waitFor(() =>
    expect(trigger).toHaveAttribute("aria-expanded", "false"),
  );
}

test("the visible trigger keeps the public id and explicit label association", () => {
  render(
    <>
      <label htmlFor="theme">Color mode</label>
      <ChoiceSelect id="theme" defaultValue="light">
        {options}
      </ChoiceSelect>
    </>,
  );
  const trigger = screen.getByRole("combobox", { name: "Color mode" });
  expect(trigger.tagName).toBe("BUTTON");
  expect(screen.getByLabelText("Color mode")).toBe(trigger);
  expect(trigger).toHaveAttribute("id", "theme");
  expect(trigger).toHaveTextContent("Light");
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
});

test("an implicit label activates the visible button before the form bridge", () => {
  const ref = createRef<HTMLSelectElement>();
  const { container } = render(
    <label>
      Color mode
      <ChoiceSelect ref={ref} defaultValue="light">
        {options}
      </ChoiceSelect>
    </label>,
  );
  const trigger = screen.getByRole("combobox", { name: /Color mode/ });
  expect(container.querySelector("label")!.control).toBe(trigger);
  act(() => ref.current?.focus());
  expect(trigger).toHaveFocus();
});

test("selection dispatches a real native change with a correct currentTarget", async () => {
  let selectedElement: HTMLSelectElement | undefined;
  let selectedValue: string | undefined;
  const onChange = jest.fn((event: React.ChangeEvent<HTMLSelectElement>) => {
    selectedElement = event.currentTarget;
    selectedValue = event.currentTarget.value;
  });
  const { container } = render(
    <ChoiceSelect label="Color mode" defaultValue="" onChange={onChange}>
      {options}
    </ChoiceSelect>,
  );
  await choose("Dark");
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(selectedElement).toBe(
    container.querySelector("select[data-select-native]"),
  );
  expect(selectedValue).toBe("dark");
  expect(screen.getByRole("combobox")).toHaveTextContent("Dark");
});

test("a controlled parent can accept changes and update the visible selection", async () => {
  function Harness() {
    const [value, setValue] = useState("light");
    return (
      <ChoiceSelect
        label="Color mode"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      >
        {options}
      </ChoiceSelect>
    );
  }
  render(<Harness />);
  await choose("Dark");
  expect(screen.getByRole("combobox")).toHaveTextContent("Dark");
});

test("a rejected controlled change restores the existing value", async () => {
  const onChange = jest.fn();
  const { container } = render(
    <ChoiceSelect label="Color mode" value="light" onChange={onChange}>
      {options}
    </ChoiceSelect>,
  );
  await choose("Dark");
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("combobox")).toHaveTextContent("Light");
  expect(
    (container.querySelector("select[data-select-native]") as HTMLSelectElement)
      .value,
  ).toBe("light");
});

test("empty options remain selectable and form data contains only the original field", async () => {
  const formChange = jest.fn();
  const { container } = render(
    <form onChange={formChange}>
      <ChoiceSelect label="Color mode" name="theme" defaultValue="dark">
        {options}
      </ChoiceSelect>
    </form>,
  );
  await choose("Automatic");
  expect(screen.getByRole("combobox")).toHaveTextContent("Automatic");
  expect(
    new FormData(container.querySelector("form")!).getAll("theme"),
  ).toEqual([""]);
  expect(formChange).toHaveBeenCalledTimes(1);
});

test("option groups carry disabled state and keep hidden options out of the menu", async () => {
  const onChange = jest.fn();
  render(
    <ChoiceSelect label="Color mode" defaultValue="light" onChange={onChange}>
      <option value="light">Light</option>
      <optgroup label="Unavailable" disabled>
        <option value="dark">Dark</option>
      </optgroup>
      <option value="hidden" hidden>
        Hidden
      </option>
    </ChoiceSelect>,
  );
  fireEvent.click(screen.getByRole("combobox"));
  const dark = await screen.findByRole("option", { name: "Dark" });
  expect(dark).toHaveAttribute("aria-disabled", "true");
  expect(screen.queryByRole("option", { name: "Hidden" })).toBeNull();
  fireEvent.click(dark);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeInTheDocument();
});

test("keyboard navigation skips disabled items, selects, and restores trigger focus", async () => {
  render(
    <ChoiceSelect label="Color mode" defaultValue="light">
      <option value="light">Light</option>
      <option value="unavailable" disabled>
        Unavailable
      </option>
      <option value="dark">Dark</option>
    </ChoiceSelect>,
  );
  const trigger = screen.getByRole("combobox");
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const light = await screen.findByRole("option", { name: "Light" });
  await waitFor(() => expect(light).toHaveFocus());
  fireEvent.keyDown(light, { key: "ArrowDown" });
  const dark = screen.getByRole("option", { name: "Dark" });
  await waitFor(() => expect(dark).toHaveFocus());
  fireEvent.keyDown(dark, { key: "Enter" });
  await waitFor(() => expect(trigger).toHaveTextContent("Dark"));
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("closed trigger typeahead uses the existing option labels", async () => {
  render(
    <ChoiceSelect label="Color mode" defaultValue="light">
      {options}
    </ChoiceSelect>,
  );
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "d" });
  await waitFor(() => expect(trigger).toHaveTextContent("Dark"));
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("Escape closes only the select menu inside a parent dialog", async () => {
  const onOuterEscape = jest.fn();
  render(
    <div
      role="dialog"
      id="parent-dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") onOuterEscape();
      }}
    >
      <ChoiceSelect label="Color mode" defaultValue="light">
        {options}
      </ChoiceSelect>
    </div>,
  );
  const trigger = screen.getByRole("combobox");
  fireEvent.click(trigger);
  const menu = await screen.findByRole("listbox");
  expect(menu).toHaveAttribute("data-select-trigger-id", trigger.id);
  expect(menu).toHaveAttribute("data-select-owner", "parent-dialog");
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(onOuterEscape).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("a native dialog owns its portaled menu", async () => {
  const { container } = render(
    <dialog open id="native-dialog">
      <ChoiceSelect label="Color mode" defaultValue="light">
        {options}
      </ChoiceSelect>
    </dialog>,
  );
  fireEvent.click(screen.getByRole("combobox"));
  const menu = await screen.findByRole("listbox");
  expect(container.querySelector("dialog")!.contains(menu)).toBe(true);
  expect(menu).toHaveAttribute("data-select-owner", "native-dialog");
});

test("a modal overlay owns its menu outside the clipped dialog", async () => {
  function Harness() {
    const [format, setFormat] = useState("image");
    return (
      <div className="modal-mask">
        <div role="dialog" aria-label="Share" style={{ overflow: "hidden" }}>
          <ChoiceSelect
            label="Export format"
            value={format}
            onChange={(event) => setFormat(event.currentTarget.value)}
          >
            <option value="text">text</option>
            <option value="image">image</option>
            <option value="json">json</option>
          </ChoiceSelect>
        </div>
      </div>
    );
  }
  const { container } = render(<Harness />);
  const dialog = screen.getByRole("dialog", { name: "Share" });
  const trigger = screen.getByRole("combobox", { name: "Export format" });
  fireEvent.click(trigger);
  const menu = await screen.findByRole("listbox");
  expect(container.querySelector(".modal-mask")!.contains(menu)).toBe(true);
  expect(dialog.contains(menu)).toBe(false);
  fireEvent.click(screen.getByRole("option", { name: "text" }));
  await waitFor(() => expect(trigger).toHaveTextContent("text"));
  await choose("json", trigger);
  await choose("image", trigger);
  expect(trigger).toHaveTextContent("image");
});

test("dismissing a nested select keeps the parameter popover open until the next outside click", async () => {
  const onClose = jest.fn();
  const anchor = createRef<HTMLButtonElement>();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button ref={anchor}>Image parameters</button>
        <ComposerParameterPopover
          id="image-parameters"
          label="Image parameters"
          triggerRef={anchor}
          open={open}
          onClose={(reason) => {
            onClose(reason);
            setOpen(false);
          }}
        >
          <ChoiceSelect label="Quality" defaultValue="light">
            {options}
          </ChoiceSelect>
        </ComposerParameterPopover>
      </>
    );
  }

  render(<Harness />);
  const trigger = screen.getByRole("combobox", { name: "Quality" });
  await choose("Dark", trigger);
  expect(
    screen.getByRole("dialog", { name: "Image parameters" }),
  ).toBeVisible();
  expect(trigger).toHaveFocus();
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.click(trigger);
  await screen.findByRole("listbox");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Radix disables pointer events on the trigger, so the second click hits the body.
  fireEvent.pointerDown(document.body, { pointerType: "mouse", button: 0 });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(
    screen.getByRole("dialog", { name: "Image parameters" }),
  ).toBeVisible();
  expect(trigger).toHaveFocus();
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.click(trigger);
  const menu = await screen.findByRole("listbox");
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  expect(
    screen.getByRole("dialog", { name: "Image parameters" }),
  ).toBeVisible();

  fireEvent.pointerDown(document.body, { pointerType: "mouse", button: 0 });
  expect(screen.queryByRole("dialog", { name: "Image parameters" })).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith("outside");
});

test("form reset restores defaultValue without dispatching a change", async () => {
  const onChange = jest.fn();
  const { container } = render(
    <form>
      <ChoiceSelect
        label="Color mode"
        name="theme"
        defaultValue="light"
        onChange={onChange}
      >
        {options}
      </ChoiceSelect>
    </form>,
  );
  await choose("Dark");
  onChange.mockClear();
  await act(async () => container.querySelector("form")!.reset());
  expect(screen.getByRole("combobox")).toHaveTextContent("Light");
  expect(onChange).not.toHaveBeenCalled();
  expect(new FormData(container.querySelector("form")!).get("theme")).toBe(
    "light",
  );
});

test("external form association participates in submission and reset", async () => {
  const { container } = render(
    <>
      <form id="preferences" />
      <ChoiceSelect
        label="Color mode"
        name="theme"
        form="preferences"
        defaultValue="light"
      >
        {options}
      </ChoiceSelect>
    </>,
  );
  await choose("Dark");
  expect(new FormData(container.querySelector("form")!).get("theme")).toBe(
    "dark",
  );
  await act(async () => container.querySelector("form")!.reset());
  expect(screen.getByRole("combobox")).toHaveTextContent("Light");
});

test("required validation focuses and marks the visible trigger", () => {
  const { container } = render(
    <form>
      <ChoiceSelect label="Color mode" name="theme" required defaultValue="">
        {options}
      </ChoiceSelect>
    </form>,
  );
  act(() => {
    expect(container.querySelector("form")!.checkValidity()).toBe(false);
  });
  const trigger = screen.getByRole("combobox");
  expect(trigger).toHaveAttribute("aria-required", "true");
  expect(trigger).toHaveAttribute("aria-invalid", "true");
  expect(trigger).toHaveFocus();
});

test("disabled selects remain unavailable and are omitted from form data", () => {
  const { container } = render(
    <form>
      <ChoiceSelect
        label="Color mode"
        name="theme"
        defaultValue="light"
        disabled
      >
        {options}
      </ChoiceSelect>
    </form>,
  );
  const trigger = screen.getByRole("combobox");
  expect(trigger).toBeDisabled();
  fireEvent.click(trigger);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(new FormData(container.querySelector("form")!).has("theme")).toBe(
    false,
  );
});

test("multiple or listbox select semantics remain native", () => {
  render(
    <ChoiceSelect label="Modes" multiple defaultValue={["light", "dark"]}>
      {options}
    </ChoiceSelect>,
  );
  const listbox = screen.getByRole("listbox", { name: "Modes" });
  expect(listbox.tagName).toBe("SELECT");
  expect(listbox).toHaveValue(["light", "dark"]);
});
