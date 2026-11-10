import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { Checkbox } from "../app/components/form-controls";

test("message selection remains a native checkbox with an associated label", () => {
  render(
    <label>
      Select message
      <Checkbox name="message" value="one" defaultChecked />
    </label>,
  );
  const input = screen.getByRole("checkbox", { name: "Select message" });
  expect(input.tagName).toBe("INPUT");
  expect(input).toHaveAttribute("type", "checkbox");
  expect(input).toBeChecked();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  input.focus();
  expect(input).toHaveFocus();
});

test.each(["variant", "role"])(
  "%s exposes a native, named switch without changing form serialization",
  (mode) => {
    const props =
      mode === "variant"
        ? { variant: "switch" as const }
        : { role: "switch" as const };
    const view = render(
      <form>
        <Checkbox
          {...props}
          aria-label="Reduce motion"
          name="reduceMotion"
          value="enabled"
          defaultChecked
        />
      </form>,
    );
    const input = screen.getByRole("switch", { name: "Reduce motion" });
    expect(input).toHaveAttribute("type", "checkbox");
    expect(input).toBeChecked();
    const form = view.container.querySelector("form")!;
    expect(new FormData(form).get("reduceMotion")).toBe("enabled");
    input.focus();
    expect(input).toHaveFocus();
  },
);

test("a controlled switch receives native checked values and preserves label activation", () => {
  const changed = jest.fn<(checked: boolean) => void>();
  function Setting() {
    const [checked, setChecked] = React.useState(false);
    return (
      <label htmlFor="stream-output">
        Stream output
        <Checkbox
          id="stream-output"
          variant="switch"
          checked={checked}
          onChange={(event) => {
            changed(event.currentTarget.checked);
            setChecked(event.currentTarget.checked);
          }}
        />
      </label>
    );
  }
  render(<Setting />);
  const input = screen.getByRole("switch", { name: "Stream output" });
  fireEvent.click(screen.getByText("Stream output"));
  expect(input).toBeChecked();
  expect(changed).toHaveBeenLastCalledWith(true);
  act(() => input.click());
  expect(input).not.toBeChecked();
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(changed).toHaveBeenCalledTimes(2);
});

test("a disabled switch cannot toggle, receive focus, or enter form data", () => {
  const changed = jest.fn();
  const view = render(
    <form>
      <Checkbox
        variant="switch"
        aria-label="Unavailable stream"
        name="stream"
        defaultChecked
        disabled
        onChange={changed}
      />
    </form>,
  );
  const input = screen.getByRole("switch", { name: "Unavailable stream" });
  act(() => input.click());
  input.focus();
  expect(input).toBeDisabled();
  expect(input).toBeChecked();
  expect(input).not.toHaveFocus();
  expect(changed).not.toHaveBeenCalled();
  expect(
    new FormData(view.container.querySelector("form")!).has("stream"),
  ).toBe(false);
});

test("read-only selection and caller input attributes remain intact", () => {
  render(
    <Checkbox
      aria-label="Selected exported message"
      checked
      readOnly
      className="message-selector"
      data-message-id="one"
      tabIndex={-1}
    />,
  );
  const input = screen.getByRole("checkbox", {
    name: "Selected exported message",
  });
  expect(input).toBeChecked();
  expect(input).toHaveAttribute("readonly");
  expect(input).toHaveClass("message-selector");
  expect(input).toHaveAttribute("data-message-id", "one");
  expect(input).toHaveAttribute("tabindex", "-1");
});
