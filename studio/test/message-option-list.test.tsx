import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { MessageOptionList } from "../app/components/message-option-list";
import type { MessageInteractionOptions } from "../app/utils/message-interactions";

afterEach(cleanup);

const definition: MessageInteractionOptions = {
  id: "plan",
  question: "Which plan works for you?",
  selection: "single",
  options: [
    { id: "a", label: "Basic", description: "The smallest plan" },
    { id: "b", label: "Team", description: "Shared workspace" },
    { id: "c", label: "Enterprise" },
  ],
};

test("uses a labeled native radio group and submits only after the explicit command", async () => {
  const onSubmit = jest
    .fn<(selectedIds: string[]) => Promise<boolean>>()
    .mockResolvedValue(true);
  render(<MessageOptionList definition={definition} onSubmit={onSubmit} />);
  expect(
    screen.getByRole("radiogroup", { name: definition.question }),
  ).toBeVisible();
  expect(
    screen.getByRole("radio", { name: "Basic" }),
  ).toHaveAccessibleDescription("The smallest plan");
  const submit = screen.getByRole("button", { name: "提交选择" });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "Basic" }));
  fireEvent.click(screen.getByRole("radio", { name: "Team" }));
  expect(screen.getByRole("radio", { name: "Basic" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Team" })).toBeChecked();
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(submit));
  expect(onSubmit).toHaveBeenCalledWith(["b"]);
  expect(screen.getByRole("status")).toHaveTextContent("已提交选择");
  expect(screen.getByText("Team")).toBeVisible();
  expect(screen.getByText("Shared workspace")).toBeVisible();
  expect(screen.queryByText("Basic")).toBeNull();
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.queryByRole("button", { name: "提交选择" })).toBeNull();
});

test("multiple selection enforces minimum and maximum while allowing selected items to be unchecked", async () => {
  const onSubmit = jest
    .fn<(selectedIds: string[]) => Promise<boolean>>()
    .mockResolvedValue(true);
  render(
    <MessageOptionList
      definition={{
        ...definition,
        selection: "multiple",
        minSelections: 2,
        maxSelections: 2,
      }}
      onSubmit={onSubmit}
    />,
  );
  expect(
    screen.getByRole("group", { name: definition.question }),
  ).toBeVisible();
  const basic = screen.getByRole("checkbox", { name: "Basic" });
  const team = screen.getByRole("checkbox", { name: "Team" });
  const enterprise = screen.getByRole("checkbox", { name: "Enterprise" });
  const submit = screen.getByRole("button", { name: "提交选择" });
  fireEvent.click(basic);
  expect(submit).toBeDisabled();
  fireEvent.click(team);
  expect(submit).toBeEnabled();
  expect(enterprise).toBeDisabled();
  expect(basic).toBeEnabled();
  fireEvent.click(basic);
  expect(enterprise).toBeEnabled();
  expect(submit).toBeDisabled();
  fireEvent.click(enterprise);
  await act(async () => fireEvent.click(submit));
  expect(onSubmit).toHaveBeenCalledWith(["b", "c"]);
});

test("pending submission blocks duplicate form events and cancellation preserves local selection", async () => {
  let resolve!: (result: boolean) => void;
  const onSubmit = jest.fn<(selectedIds: string[]) => Promise<boolean>>(
    () => new Promise((done) => (resolve = done)),
  );
  const view = render(
    <MessageOptionList definition={definition} onSubmit={onSubmit} />,
  );
  const team = screen.getByRole("radio", { name: "Team" });
  fireEvent.click(team);
  const form = view.container.querySelector("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "提交中" })).toBeDisabled();
  expect(team).toBeDisabled();
  await act(async () => resolve(false));
  expect(team).toBeChecked();
  expect(team).toBeEnabled();
  expect(screen.getByRole("button", { name: "提交选择" })).toBeEnabled();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a failed submission retains choices and can be retried without reselecting", async () => {
  const onSubmit = jest
    .fn<(selectedIds: string[]) => Promise<boolean>>()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce(true);
  render(<MessageOptionList definition={definition} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole("radio", { name: "Basic" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "提交选择" })),
  );
  expect(screen.getByRole("radio", { name: "Basic" })).toBeChecked();
  expect(screen.getByRole("alert")).toHaveTextContent("选择暂未提交");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "提交选择" })),
  );
  expect(onSubmit.mock.calls).toEqual([[["a"]], [["a"]]]);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status")).toBeVisible();
});

test("restores external selections without resetting local choices on an equivalent parent render", () => {
  const onSubmit = jest.fn<(selectedIds: string[]) => Promise<boolean>>();
  const view = render(
    <MessageOptionList
      definition={definition}
      selectedIds={["a", "unknown"]}
      onSubmit={onSubmit}
    />,
  );
  expect(screen.getByRole("radio", { name: "Basic" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "Team" }));
  view.rerender(
    <MessageOptionList
      definition={{ ...definition }}
      selectedIds={["a", "unknown"]}
      onSubmit={onSubmit}
    />,
  );
  expect(screen.getByRole("radio", { name: "Team" })).toBeChecked();
  view.rerender(
    <MessageOptionList
      definition={definition}
      selectedIds={["c"]}
      onSubmit={onSubmit}
    />,
  );
  expect(screen.getByRole("radio", { name: "Enterprise" })).toBeChecked();
});

test("a previous definition's success cannot become a new definition's receipt", async () => {
  let resolve!: (result: boolean) => void;
  const onSubmit = jest.fn<(selectedIds: string[]) => Promise<boolean>>(
    () => new Promise((done) => (resolve = done)),
  );
  const view = render(
    <MessageOptionList definition={definition} onSubmit={onSubmit} />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "Basic" }));
  fireEvent.click(screen.getByRole("button", { name: "提交选择" }));
  view.rerender(
    <MessageOptionList
      definition={{ ...definition, id: "new-plan" }}
      onSubmit={onSubmit}
    />,
  );
  await act(async () => resolve(true));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("radio", { name: "Basic" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: "提交选择" })).toBeDisabled();
});

test("disabled history remains readable and a persisted receipt overrides external seeds", () => {
  const onSubmit = jest.fn<(selectedIds: string[]) => Promise<boolean>>();
  const view = render(
    <MessageOptionList
      definition={definition}
      disabled
      selectedIds={["a"]}
      onSubmit={onSubmit}
    />,
  );
  const basic = screen.getByRole("radio", { name: "Basic" });
  expect(basic).toBeVisible();
  expect(basic).toBeDisabled();
  fireEvent.click(basic);
  fireEvent.submit(view.container.querySelector("form")!);
  expect(onSubmit).not.toHaveBeenCalled();
  view.rerender(
    <MessageOptionList
      definition={definition}
      disabled
      selectedIds={["a"]}
      receipt={{ selectedIds: ["b"] }}
      onSubmit={onSubmit}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("已提交选择");
  expect(screen.getByText("Team")).toBeVisible();
  expect(screen.queryByText("Basic")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

test("optional single selection can be cleared and submitted with an empty receipt", async () => {
  const onSubmit = jest
    .fn<(selectedIds: string[]) => Promise<boolean>>()
    .mockResolvedValue(true);
  render(
    <MessageOptionList
      definition={{ ...definition, minSelections: 0 }}
      onSubmit={onSubmit}
    />,
  );
  const submit = screen.getByRole("button", { name: "提交选择" });
  expect(submit).toBeEnabled();
  fireEvent.click(screen.getByRole("radio", { name: "Basic" }));
  fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
  expect(screen.getByRole("radio", { name: "Basic" })).not.toBeChecked();
  await act(async () => fireEvent.click(submit));
  expect(onSubmit).toHaveBeenCalledWith([]);
  expect(screen.getByText("未选择任何选项")).toBeVisible();
});

test("renders no more than eight choices and keeps long labels as text", () => {
  const onSubmit = jest.fn<(selectedIds: string[]) => Promise<boolean>>();
  const longLabel = `<script>${"longword".repeat(80)}</script>`;
  const view = render(
    <MessageOptionList
      definition={{
        ...definition,
        options: Array.from({ length: 12 }, (_, index) => ({
          id: String(index),
          label: index === 0 ? longLabel : `Choice ${index}`,
        })),
      }}
      onSubmit={onSubmit}
    />,
  );
  expect(screen.getAllByRole("radio")).toHaveLength(8);
  expect(screen.getByRole("radio", { name: longLabel })).toBeVisible();
  expect(view.container.querySelector("script")).toBeNull();
  expect(screen.queryByText("Choice 8")).toBeNull();
});
