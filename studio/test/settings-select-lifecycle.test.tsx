import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";

for (const icon of [
  "three-dots",
  "close",
  "eye",
  "eye-off",
  "down",
  "confirm",
  "cancel",
  "max",
  "min",
]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg />,
  }));
}
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    UI: { Close: "Close" },
    Chat: {
      Actions: {
        FullScreen: "Full Screen",
        ExitFullScreen: "Exit Full Screen",
      },
    },
  },
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => null,
}));
let mobile = false;
jest.unstable_mockModule("@/app/utils", () => ({
  useMobileScreen: () => mobile,
}));
const { SettingsSelect } = await import("../app/components/settings-select");

const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const options = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

beforeEach(() => {
  mobile = false;
  jest.useFakeTimers();
  document.body.classList.remove("reduce-motion");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 40, height: 40 }] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
  document.body.classList.remove("reduce-motion");
  if (mediaDescriptor) {
    Object.defineProperty(window, "matchMedia", mediaDescriptor);
  } else {
    Reflect.deleteProperty(window, "matchMedia");
  }
});

function openSelect() {
  const trigger = screen.getByRole("button", { name: "Appearance" });
  trigger.focus();
  fireEvent.click(trigger);
  return {
    trigger,
    dialog: screen.getByRole("dialog", { name: "Appearance" }),
    mask: document.querySelector<HTMLElement>(".modal-mask")!,
  };
}

function finishExit(mask: HTMLElement) {
  fireEvent.animationEnd(mask);
  act(() => jest.runAllTicks());
}

test("a small picker focuses its current option and cycles focus without a maximize button", () => {
  render(
    <SettingsSelect
      title="Appearance"
      value="system"
      options={options}
      presentation="dialog"
      onChange={jest.fn()}
    />,
  );
  const { dialog, trigger } = openSelect();
  const selected = within(dialog).getByRole("button", { name: "System" });
  const first = within(dialog).getByRole("button", { name: "Close" });
  const last = within(dialog).getByRole("button", { name: "Dark" });
  expect(selected).toHaveFocus();
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(
    within(dialog).queryByRole("button", { name: "Full Screen" }),
  ).not.toBeInTheDocument();
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
});

test("a choice commits once after exit, restores focus and can be changed on reopening", () => {
  const onChange = jest.fn();
  function Picker() {
    const [value, setValue] = React.useState("system");
    return (
      <SettingsSelect
        title="Appearance"
        value={value}
        options={options}
        presentation="dialog"
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Picker />);
  const first = openSelect();
  fireEvent.click(within(first.dialog).getByRole("button", { name: "Dark" }));
  fireEvent.click(within(first.dialog).getByRole("button", { name: "Light" }));
  fireEvent.keyDown(first.dialog, { key: "Escape" });
  expect(first.mask).toHaveClass("modal-closing");
  expect(onChange).not.toHaveBeenCalled();
  finishExit(first.mask);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith("dark");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(first.trigger).toHaveFocus();
  expect(first.trigger).toHaveTextContent("Dark");

  const second = openSelect();
  expect(
    within(second.dialog).getByRole("button", { name: "Dark" }),
  ).toHaveFocus();
  fireEvent.click(within(second.dialog).getByRole("button", { name: "Light" }));
  finishExit(second.mask);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith("light");
  expect(second.trigger).toHaveFocus();
});

test.each(["escape", "backdrop", "close"])(
  "%s cancels after its animation and restores its trigger",
  (method) => {
    mobile = true;
    const onChange = jest.fn();
    render(
      <SettingsSelect
        title="Appearance"
        value="system"
        options={options}
        presentation="dialog"
        onChange={onChange}
      />,
    );
    const { trigger, dialog, mask } = openSelect();
    if (method === "escape") fireEvent.keyDown(dialog, { key: "Escape" });
    else if (method === "backdrop") fireEvent.click(mask);
    else fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(mask).toHaveClass("modal-closing");
    expect(dialog).toBeInTheDocument();
    finishExit(mask);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  },
);

test("a range picker stays compact and focuses its slider", () => {
  render(
    <SettingsSelect
      title="Appearance"
      value="14"
      options={[]}
      presentation="dialog"
      onChange={jest.fn()}
      renderOptions={() => (
        <input type="range" aria-label="Font size" defaultValue="14" />
      )}
    />,
  );
  const { dialog } = openSelect();
  expect(screen.getByRole("slider", { name: "Font size" })).toHaveFocus();
  expect(
    within(dialog).queryByRole("button", { name: "Full Screen" }),
  ).not.toBeInTheDocument();
});

test("an explicitly selected dropdown retains the native change bridge", () => {
  const onChange = jest.fn();
  render(
    <SettingsSelect
      title="Appearance"
      value="system"
      options={options}
      presentation="select"
      onChange={onChange}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Appearance" })).toBeVisible();
  const select = document.querySelector("select")!;
  fireEvent.change(select, { target: { value: "dark" } });
  expect(onChange).toHaveBeenCalledWith("dark");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test.each([false, true])(
  "short choices stay directly visible as a native radio group on mobile=%s",
  (isMobile) => {
    mobile = isMobile;
    const onChange = jest.fn();
    render(
      <SettingsSelect
        title="Appearance"
        value="system"
        options={options}
        onChange={onChange}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(within(group).getByRole("radio", { name: "System" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

test("four choices and long labels use the shared Select instead of squeezing into segments", () => {
  const { rerender } = render(
    <SettingsSelect
      title="Appearance"
      value="system"
      options={[...options, { value: "contrast", label: "Contrast" }]}
      onChange={jest.fn()}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Appearance" })).toBeVisible();
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  rerender(
    <SettingsSelect
      title="Appearance"
      value="system"
      options={[
        { value: "system", label: "Use the current system preference" },
        { value: "light", label: "Light" },
      ]}
      onChange={jest.fn()}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Appearance" })).toBeVisible();
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
});

test("explicit segments retain disabled semantics and the supplied identifier", () => {
  const onChange = jest.fn();
  render(
    <SettingsSelect
      id="appearance-options"
      title="Appearance"
      value="system"
      options={options}
      presentation="segmented"
      disabled
      onChange={onChange}
    />,
  );
  const group = screen.getByRole("radiogroup", { name: "Appearance" });
  expect(group).toHaveAttribute("id", "appearance-options");
  const radio = within(group).getByRole("radio", { name: "Dark" });
  expect(radio).toBeDisabled();
  fireEvent.click(radio);
  expect(onChange).not.toHaveBeenCalled();
});

test("custom option content keeps the dialog route even without forcing its presentation", () => {
  render(
    <SettingsSelect
      title="Appearance"
      value="14"
      options={options}
      onChange={jest.fn()}
      renderOptions={() => (
        <input type="range" aria-label="Font size" defaultValue="14" />
      )}
    />,
  );
  const { dialog } = openSelect();
  expect(
    within(dialog).getByRole("slider", { name: "Font size" }),
  ).toHaveFocus();
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
});

test("a custom trigger keeps its expanded and control relationship and its dialog behavior", () => {
  render(
    <SettingsSelect
      title="Appearance"
      value="system"
      options={options}
      onChange={jest.fn()}
      renderTrigger={({ onClick, expanded, controls, disabled }) => (
        <button
          onClick={onClick}
          aria-expanded={expanded}
          aria-controls={controls}
          disabled={disabled}
        >
          Appearance
        </button>
      )}
    />,
  );
  const { trigger, dialog, mask } = openSelect();
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(
    document.getElementById(trigger.getAttribute("aria-controls")!),
  ).toContainElement(dialog);
  fireEvent.keyDown(dialog, { key: "Escape" });
  finishExit(mask);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
});
