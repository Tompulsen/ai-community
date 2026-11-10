import React, { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { jest } from "@jest/globals";
import { ChoiceGroup } from "../app/components/choice-group";

const options = [
  { value: "auto", label: "自动" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

test("the group exposes labeled native radios with one controlled selection", () => {
  function Harness() {
    const [value, setValue] = useState("auto");
    return (
      <ChoiceGroup
        label="颜色模式"
        value={value}
        options={options}
        onChange={setValue}
      />
    );
  }
  render(<Harness />);
  const group = screen.getByRole("radiogroup", { name: "颜色模式" });
  const radios = within(group).getAllByRole("radio");
  expect(radios).toHaveLength(3);
  expect(radios.every((radio) => radio.tagName === "INPUT")).toBe(true);
  expect(new Set(radios.map((radio) => radio.getAttribute("name"))).size).toBe(
    1,
  );
  expect(screen.getByRole("radio", { name: "自动" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "深色" }));
  expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "自动" })).not.toBeChecked();
});

test("clicking an already selected radio does not commit twice", () => {
  const onChange = jest.fn();
  render(
    <ChoiceGroup
      label="颜色模式"
      value="auto"
      options={options}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "自动" }));
  expect(onChange).not.toHaveBeenCalled();
});

test("neighboring choice groups have independent native selection names", () => {
  render(
    <>
      <ChoiceGroup
        label="颜色模式"
        value="auto"
        options={options}
        onChange={jest.fn()}
      />
      <ChoiceGroup
        label="预览模式"
        value="auto"
        options={options}
        onChange={jest.fn()}
      />
    </>,
  );
  const [first, second] = screen.getAllByRole("radiogroup");
  const firstRadio = within(first).getByRole("radio", { name: "自动" });
  const secondRadio = within(second).getByRole("radio", { name: "自动" });
  expect(firstRadio).toBeChecked();
  expect(secondRadio).toBeChecked();
  expect(firstRadio.getAttribute("name")).not.toBe(
    secondRadio.getAttribute("name"),
  );
});

test("the native radio selection participates in forms", () => {
  const { container } = render(
    <form>
      <ChoiceGroup
        id="theme"
        label="颜色模式"
        value="dark"
        options={options}
        onChange={jest.fn()}
      />
    </form>,
  );
  const data = new FormData(container.querySelector("form")!);
  expect(data.get("theme-value")).toBe("dark");
});

test("a disabled fieldset prevents all changes and omits its value from form data", () => {
  const onChange = jest.fn();
  const { container } = render(
    <form>
      <ChoiceGroup
        id="theme"
        label="颜色模式"
        value="auto"
        options={options}
        onChange={onChange}
        disabled
      />
    </form>,
  );
  for (const radio of screen.getAllByRole("radio"))
    expect(radio).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "深色" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(
    new FormData(container.querySelector("form")!).has("theme-value"),
  ).toBe(false);
});

test("individual unavailable options are disabled without disabling other choices", () => {
  const onChange = jest.fn();
  render(
    <ChoiceGroup
      label="颜色模式"
      value="auto"
      options={options.map((option) => ({
        ...option,
        disabled: option.value === "dark",
      }))}
      onChange={onChange}
    />,
  );
  const dark = screen.getByRole("radio", { name: "深色" });
  expect(dark).toBeDisabled();
  fireEvent.click(dark);
  expect(onChange).not.toHaveBeenCalled();
  const light = screen.getByRole("radio", { name: "浅色" });
  expect(light).toBeEnabled();
  fireEvent.click(light);
  expect(onChange).toHaveBeenCalledWith("light");
});

test("grid labels accept visual figures without polluting the accessible option name", () => {
  render(
    <ChoiceGroup
      label="图片比例"
      value="square"
      variant="grid"
      columns={2}
      options={[
        {
          value: "square",
          label: <span>1:1</span>,
          visual: <svg aria-label="装饰方形" />,
        },
        {
          value: "portrait",
          label: "3:4",
          visual: <span>长方形</span>,
        },
      ]}
      onChange={jest.fn()}
    />,
  );
  const group = screen.getByRole("radiogroup", { name: "图片比例" });
  expect(group).toHaveAttribute("data-variant", "grid");
  expect(group.style.getPropertyValue("--choice-columns")).toBe("2");
  expect(screen.getByRole("radio", { name: "1:1" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "3:4" })).not.toBeChecked();
  expect(
    screen.queryByRole("img", { name: "装饰方形" }),
  ).not.toBeInTheDocument();
});
