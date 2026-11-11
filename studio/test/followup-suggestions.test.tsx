import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { FollowupSuggestions } from "../app/components/followup-suggestions";

afterEach(cleanup);

test("shows up to three distinct nonempty suggestions as plain text", () => {
  const onSelect = jest.fn<(text: string) => Promise<boolean>>();
  const view = render(
    <FollowupSuggestions suggestions={[]} onSelect={onSelect} />,
  );
  expect(screen.queryByTestId("followup-suggestions")).toBeNull();
  view.rerender(
    <FollowupSuggestions
      suggestions={[
        " ",
        "  Compare costs  ",
        "Compare costs",
        "<script>plain text</script>",
        "Third question",
        "Fourth question",
      ]}
      onSelect={onSelect}
    />,
  );
  expect(screen.getByRole("region", { name: "继续追问" })).toBeVisible();
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Compare costs" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "<script>plain text</script>" }),
  ).toBeVisible();
  expect(view.container.querySelector("script")).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

test("forwards the selected text once and preserves suggestions after cancellation", async () => {
  let resolve!: (result: boolean) => void;
  const onSelect = jest.fn<(text: string) => Promise<boolean>>(
    () => new Promise((done) => (resolve = done)),
  );
  render(
    <FollowupSuggestions
      suggestions={["First question", "Second question"]}
      onSelect={onSelect}
    />,
  );
  const first = screen.getByRole("button", { name: "First question" });
  const second = screen.getByRole("button", { name: "Second question" });
  fireEvent.click(first);
  fireEvent.click(first);
  fireEvent.click(second);
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith("First question");
  expect(first).toBeDisabled();
  expect(second).toBeDisabled();
  expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
  await act(async () => resolve(false));
  expect(first).toBeEnabled();
  expect(second).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "false");
});

test("disabled suggestions remain readable and never invoke their callback", () => {
  const onSelect = jest.fn<(text: string) => Promise<boolean>>();
  render(
    <FollowupSuggestions
      suggestions={["Saved suggestion"]}
      disabled
      onSelect={onSelect}
    />,
  );
  const suggestion = screen.getByRole("button", { name: "Saved suggestion" });
  expect(suggestion).toBeVisible();
  expect(suggestion).toBeDisabled();
  fireEvent.click(suggestion);
  expect(onSelect).not.toHaveBeenCalled();
});

test("a rejected callback keeps the suggestion available for an explicit retry", async () => {
  const onSelect = jest
    .fn<(text: string) => Promise<boolean>>()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce(true);
  render(
    <FollowupSuggestions
      suggestions={["Try this question"]}
      onSelect={onSelect}
    />,
  );
  const button = screen.getByRole("button", { name: "Try this question" });
  await act(async () => fireEvent.click(button));
  expect(screen.getByRole("alert")).toHaveTextContent("建议暂未填入");
  expect(button).toBeEnabled();
  await act(async () => fireEvent.click(button));
  expect(onSelect).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a prior suggestion's pending callback cannot change a replacement list", async () => {
  let resolve!: (result: boolean) => void;
  const onSelect = jest.fn<(text: string) => Promise<boolean>>(
    () => new Promise((done) => (resolve = done)),
  );
  const view = render(
    <FollowupSuggestions suggestions={["Old question"]} onSelect={onSelect} />,
  );
  fireEvent.click(screen.getByRole("button"));
  view.rerender(
    <FollowupSuggestions suggestions={["New question"]} onSelect={onSelect} />,
  );
  const replacement = screen.getByRole("button", { name: "New question" });
  expect(replacement).toBeEnabled();
  await act(async () => resolve(true));
  expect(replacement).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
});
