import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";

jest.unstable_mockModule("@/app/utils/image-asset", () => ({
  fetchImageBlob: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/chat", () => ({
  uploadImage: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "user-7",
  isLocalWorkspaceActive: () => true,
}));
jest.unstable_mockModule("@/app/components/canvas-reference-picker", () => ({
  CanvasReferencePicker: () => null,
}));
const actualCanvas = await import("@/app/utils/image-canvas");
const mockLoad = jest.fn<typeof actualCanvas.loadCanvasImage>();
const mockRender = jest.fn<typeof actualCanvas.renderCanvasImage>();
jest.unstable_mockModule("@/app/utils/image-canvas", () => ({
  ...actualCanvas,
  loadCanvasImage: mockLoad,
  renderCanvasImage: mockRender,
}));
const { ImageCanvasEditor } = await import(
  "../app/components/image-canvas-editor"
);
const { fetchImageBlob } = await import("../app/utils/image-asset");
const { uploadImage } = await import("../app/utils/chat");
type Draft = import("../app/utils/image-canvas").CanvasEditDraft;
let decodedImage: HTMLImageElement;
let dispose: jest.Mock;

async function openEditor(
  onSubmit = jest
    .fn<(draft: Draft) => Promise<void>>()
    .mockResolvedValue(undefined),
  validateContext = jest.fn(),
) {
  const view = render(
    <ImageCanvasEditor
      src="blob:original"
      onBack={jest.fn()}
      onSubmit={onSubmit}
      validateContext={validateContext}
    />,
  );
  const canvas = await screen.findByRole("img", { name: /可编辑图片/ });
  Object.defineProperties(canvas, {
    getBoundingClientRect: {
      value: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
      configurable: true,
    },
    setPointerCapture: { value: jest.fn(), configurable: true },
    hasPointerCapture: { value: () => true, configurable: true },
    releasePointerCapture: { value: jest.fn(), configurable: true },
  });
  return { ...view, canvas, onSubmit, validateContext };
}
function pointer(canvas: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "pointerId", { value: 7 });
  fireEvent(canvas, event);
}

beforeEach(() => {
  jest.resetAllMocks();
  decodedImage = new Image();
  decodedImage.src = "blob:owned-original";
  Object.defineProperties(decodedImage, {
    naturalWidth: { value: 1000 },
    naturalHeight: { value: 600 },
  });
  dispose = jest.fn();
  mockLoad.mockResolvedValue({ image: decodedImage, dispose });
  mockRender.mockResolvedValue(new Blob(["guide"], { type: "image/png" }));
  jest
    .mocked(fetchImageBlob)
    .mockResolvedValue(new Blob(["original"], { type: "image/png" }));
  jest.mocked(uploadImage).mockResolvedValue("data:image/png;base64,cmVm");
});

it("draws a region, undoes, redoes, cancels a gesture and retains the selected text controls", async () => {
  const { canvas } = await openEditor();
  pointer(canvas, "pointerdown", 100, 90);
  pointer(canvas, "pointermove", 350, 220);
  pointer(canvas, "pointerup", 350, 220);
  expect(screen.getByLabelText("修改目标")).toHaveValue("text");
  expect(canvas.querySelectorAll("g[data-annotation-id]")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(canvas.querySelectorAll("g[data-annotation-id]")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "重做" }));
  pointer(canvas, "pointerdown", 200, 200);
  pointer(canvas, "pointermove", 400, 300);
  pointer(canvas, "pointercancel", 400, 300);
  expect(canvas.querySelectorAll("g[data-annotation-id]")).toHaveLength(1);
});

it("sends 14 references with the full original and numbered guide without dropping images", async () => {
  const { onSubmit } = await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "添加中心选区" }));
  fireEvent.change(screen.getByLabelText("上传本地参考图"), {
    target: {
      files: Array.from(
        { length: 14 },
        (_, i) => new File(["ref"], `ref-${i}.png`, { type: "image/png" }),
      ),
    },
  });
  await waitFor(() => expect(screen.getByText("14 / 14")).toBeVisible());
  expect(screen.getByLabelText("修改目标")).toHaveValue("object");
  fireEvent.click(screen.getByRole("button", { name: "交给 AI 修改" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const draft = onSubmit.mock.calls[0][0];
  expect(draft.images).toHaveLength(16);
  expect(draft.images.slice(0, 2)).toEqual([
    "data:image/png;base64,b3JpZ2luYWw=",
    "data:image/png;base64,Z3VpZGU=",
  ]);
  expect(draft.prompt).toContain("图 3 中的人物或物品");
  expect(draft.prompt).toContain("图 16：参考图");
});

it("clears a removed reference association and preserves annotations after a submit failure", async () => {
  const onSubmit = jest
    .fn<(draft: Draft) => Promise<void>>()
    .mockRejectedValue(new Error("当前模型不可用"));
  const { canvas } = await openEditor(onSubmit);
  fireEvent.click(screen.getByRole("button", { name: "添加中心选区" }));
  fireEvent.change(screen.getByLabelText("上传本地参考图"), {
    target: {
      files: [new File(["ref"], "reference.png", { type: "image/png" })],
    },
  });
  await screen.findByText("1 / 14");
  fireEvent.click(screen.getByRole("button", { name: "移除参考图 1" }));
  expect(screen.getByLabelText("替换参考图")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  fireEvent.click(screen.getByRole("button", { name: "重做" }));
  expect(screen.getByLabelText("替换参考图")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("整体修改要求"), {
    target: { value: "修改为暖色调" },
  });
  fireEvent.click(screen.getByRole("button", { name: "交给 AI 修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("当前模型不可用");
  expect(canvas.querySelectorAll("g[data-annotation-id]")).toHaveLength(1);
  expect(screen.getByLabelText("整体修改要求")).toHaveValue("修改为暖色调");
});

it("rejects empty edit instructions and blocks sending when the opening context changed", async () => {
  const { onSubmit, validateContext } = await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "交给 AI 修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请填写整体修改要求",
  );
  expect(mockRender).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("整体修改要求"), {
    target: { value: "修改光线" },
  });
  validateContext.mockImplementation(() => {
    throw new Error("账号或对话已切换");
  });
  fireEvent.click(screen.getByRole("button", { name: "交给 AI 修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "账号或对话已切换",
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

it("shows a loading failure and releases the independently owned image on close", async () => {
  mockLoad.mockRejectedValueOnce(new Error("图片加载失败"));
  const view = render(
    <ImageCanvasEditor src="blob:original" onBack={jest.fn()} />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("图片加载失败");
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByRole("img", { name: /可编辑图片/ });
  view.unmount();
  expect(dispose).toHaveBeenCalledTimes(1);
});

it.each(["closed", "context changed"])(
  "does not submit if the editor is %s during image preparation",
  async (reason) => {
    let complete!: (blob: Blob) => void;
    mockRender.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { onSubmit, validateContext, unmount } = await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "添加中心选区" }));
    fireEvent.change(screen.getByLabelText("整体修改要求"), {
      target: { value: "替换选区内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "交给 AI 修改" }));
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));
    if (reason === "closed") unmount();
    else
      validateContext.mockImplementation(() => {
        throw new Error("账号或对话已切换");
      });
    await act(async () => {
      complete(new Blob(["guide"], { type: "image/png" }));
    });
    if (reason !== "closed")
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "账号或对话已切换",
      );
    expect(onSubmit).not.toHaveBeenCalled();
  },
);
