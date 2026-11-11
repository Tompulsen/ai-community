import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { MessageEditor } from "../app/components/message-editor";

afterEach(cleanup);

function createEditor(
  options: Partial<React.ComponentProps<typeof MessageEditor>> = {},
) {
  const onSave = jest
    .fn<(text: string) => Promise<boolean | void>>()
    .mockResolvedValue(true);
  const onCancel = jest.fn();
  const view = render(
    <MessageEditor
      initialValue="Original question"
      onSave={onSave}
      onCancel={onCancel}
      {...options}
    />,
  );
  return {
    ...view,
    input: screen.getByRole("textbox", { name: "消息内容" }),
    onSave,
    onCancel,
  };
}

test("focuses the original input and cancels local edits without saving", () => {
  const { input, onSave, onCancel } = createEditor();
  expect(input).toHaveFocus();
  expect(input).toHaveValue("Original question");
  expect((input as HTMLTextAreaElement).selectionStart).toBe(17);
  fireEvent.change(input, { target: { value: "Unsaved replacement" } });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});

test("submits the edited raw value once and locks controls while saving", async () => {
  let resolve!: (value: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  const onSave = jest
    .fn<(text: string) => Promise<boolean>>()
    .mockReturnValue(pending);
  const { input } = createEditor({ onSave });
  fireEvent.change(input, { target: { value: "  Edited\nquestion  " } });
  const form = screen.getByRole("form", { name: "编辑消息" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledWith("  Edited\nquestion  ");
  expect(input).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存并重新生成" })).toBeDisabled();
  await act(async () => resolve(true));
});

test.each([false, new Error("Model is no longer available")])(
  "failed save %s retains the edited draft and exposes a retryable error",
  async (result) => {
    const onSave =
      result instanceof Error
        ? jest
            .fn<(text: string) => Promise<boolean>>()
            .mockRejectedValue(result)
        : jest
            .fn<(text: string) => Promise<boolean>>()
            .mockResolvedValue(result);
    const { input } = createEditor({ onSave });
    fireEvent.change(input, {
      target: { value: "Preserve my edited question" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: "编辑消息" }));
    });
    expect(input).toHaveValue("Preserve my edited question");
    expect(screen.getByRole("alert")).toHaveTextContent(
      result instanceof Error ? result.message : "当前无法保存",
    );
    expect(input).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "保存并重新生成" }),
    ).not.toBeDisabled();
  },
);

test("empty text cannot submit unless original attachments allow it", async () => {
  const { input, onSave, rerender, onCancel } = createEditor();
  fireEvent.change(input, { target: { value: " \n " } });
  expect(screen.getByRole("button", { name: "保存并重新生成" })).toBeDisabled();
  fireEvent.submit(screen.getByRole("form", { name: "编辑消息" }));
  expect(onSave).not.toHaveBeenCalled();
  rerender(
    <MessageEditor
      initialValue="Original question"
      allowEmpty
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  await act(async () => {
    fireEvent.submit(screen.getByRole("form", { name: "编辑消息" }));
  });
  expect(onSave).toHaveBeenCalledWith(" \n ");
});

test("Escape cancels without saving and disabled editors never submit", () => {
  const { input, onSave, onCancel } = createEditor({ disabled: true });
  fireEvent.submit(screen.getByRole("form", { name: "编辑消息" }));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test.each([{ ctrlKey: true }, { metaKey: true }])(
  "deliberate %j Enter submits while plain Enter preserves newlines",
  async (modifier) => {
    const { input, onSave } = createEditor();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", ...modifier });
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  },
);

test("IME composition and its trailing Enter never submit or cancel", async () => {
  const { input, onSave, onCancel } = createEditor();
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onSave).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.keyUp(input, { key: "Enter" });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  });
  expect(onSave).toHaveBeenCalledTimes(1);
});
