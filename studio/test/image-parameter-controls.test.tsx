import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { jest } from "@jest/globals";

jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));

const { ImageParameterControls } = await import(
  "../app/components/image-parameter-controls"
);

function makeProps() {
  return {
    active: true,
    ratio: "auto" as const,
    ratioLabel: "自动",
    resolution: "auto" as const,
    resolutionLabel: "自动",
    quality: "auto" as const,
    fixedSize: false,
    onRatioChange: jest.fn(),
    onResolutionChange: jest.fn(),
    onQualityChange: jest.fn(),
    onReset: jest.fn(),
  };
}

test("ratios open in the same panel as a nine-option visual group", () => {
  const props = makeProps();
  render(<ImageParameterControls {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "比例：自动" }));
  const group = screen.getByRole("radiogroup", { name: "比例" });
  expect(within(group).getAllByRole("radio")).toHaveLength(9);
  expect(within(group).getByRole("radio", { name: "自动" })).toBeChecked();
  expect(within(group).getByRole("radio", { name: "自动" })).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(props.onRatioChange).not.toHaveBeenCalled();
});

test("choosing a ratio commits once and restores the parameter entry", () => {
  const props = makeProps();
  render(<ImageParameterControls {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "比例：自动" }));
  fireEvent.click(screen.getByRole("radio", { name: "16:9" }));
  expect(props.onRatioChange).toHaveBeenCalledTimes(1);
  expect(props.onRatioChange).toHaveBeenCalledWith("16:9");
  expect(screen.queryByRole("radiogroup", { name: "比例" })).toBeNull();
  expect(screen.getByRole("button", { name: "比例：自动" })).toHaveFocus();
  expect(screen.getByRole("radiogroup", { name: "分辨率" })).toBeVisible();
});

test("activating the current ratio also confirms and returns", () => {
  const props = makeProps();
  render(<ImageParameterControls {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "比例：自动" }));
  fireEvent.click(screen.getByRole("radio", { name: "自动" }));
  expect(props.onRatioChange).toHaveBeenCalledTimes(1);
  expect(props.onRatioChange).toHaveBeenCalledWith("auto");
  expect(screen.getByRole("button", { name: "比例：自动" })).toHaveFocus();
});

test.each(["Enter", " "])("%s confirms the focused ratio", (key) => {
  const props = makeProps();
  render(<ImageParameterControls {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "比例：自动" }));
  fireEvent.keyDown(screen.getByRole("radio", { name: "16:9" }), { key });
  expect(props.onRatioChange).toHaveBeenCalledWith("16:9");
  expect(screen.queryByRole("radiogroup", { name: "比例" })).toBeNull();
});

test("Escape returns without changing the ratio or dismissing the outer panel", () => {
  const props = makeProps();
  const outerKey = jest.fn();
  render(
    <div onKeyDown={outerKey}>
      <ImageParameterControls {...props} />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "比例：自动" }));
  fireEvent.keyDown(screen.getByRole("radio", { name: "自动" }), {
    key: "Escape",
  });
  expect(props.onRatioChange).not.toHaveBeenCalled();
  expect(outerKey).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "比例：自动" })).toHaveFocus();
});

test("a fixed-size model exposes its fixed resolution instead of editable presets", () => {
  const props = makeProps();
  render(
    <ImageParameterControls {...props} fixedSize resolutionLabel="模型固定" />,
  );
  expect(screen.getByText("模型固定")).toBeVisible();
  expect(screen.queryByRole("radiogroup", { name: "分辨率" })).toBeNull();
  expect(props.onResolutionChange).not.toHaveBeenCalled();
});

test("closing the parameter panel clears the editor without committing a choice", () => {
  const props = makeProps();
  const { rerender } = render(<ImageParameterControls {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "比例：自动" }));
  rerender(<ImageParameterControls {...props} active={false} />);
  expect(screen.queryByRole("radiogroup", { name: "比例" })).toBeNull();
  expect(props.onRatioChange).not.toHaveBeenCalled();
});
