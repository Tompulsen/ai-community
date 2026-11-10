import React, { useSyncExternalStore } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { ImageOutputConfig } from "../app/utils/image-params";

type Session = {
  id: string;
  mask: {
    syncGlobalConfig: boolean;
    modelConfig: ImageOutputConfig & {
      model: string;
      providerName: string;
      temperature: number;
    };
  };
};

let session: Session;
let revision = 0;
const listeners = new Set<() => void>();
const store = {
  currentSession: () => session,
  updateTargetSession: jest.fn(
    (target: Session, updater: (target: Session) => void) => {
      updater(target);
      revision += 1;
      listeners.forEach((listener) => listener());
    },
  ),
};
jest.unstable_mockModule("@/app/store", () => ({
  useChatStore: () => {
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => revision,
      () => revision,
    );
    return store;
  },
}));

const { ImageOutputControls } = await import(
  "../app/components/image-output-controls"
);

beforeEach(() => {
  revision = 0;
  store.updateTargetSession.mockClear();
  session = {
    id: "current-session",
    mask: {
      syncGlobalConfig: true,
      modelConfig: {
        model: "gpt-image-2",
        providerName: "custom-provider",
        temperature: 0.7,
        imageOutputFormat: "png",
        imageBackground: "auto",
        imageOutputCompression: 73,
      },
    },
  };
});

function outputChoice(group: string, label: string) {
  return within(screen.getByRole("radiogroup", { name: group })).getByRole(
    "radio",
    { name: label },
  );
}

test("output settings are visible immediately without an extra disclosure", () => {
  render(<ImageOutputControls />);
  expect(screen.queryByText("更多参数")).not.toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "输出格式" })).toBeVisible();
  expect(screen.getByRole("radiogroup", { name: "背景" })).toBeVisible();
  expect(outputChoice("输出格式", "PNG")).toBeChecked();
  expect(outputChoice("背景", "自动")).toBeChecked();
  const compression = screen.getByRole("spinbutton", { name: "压缩设置" });
  const slider = screen.getByRole("slider", { name: "压缩设置滑杆" });
  expect(compression).toBeVisible();
  expect(compression).toBeDisabled();
  expect(compression).toHaveValue(73);
  expect(slider).toBeDisabled();
  expect(slider).toHaveValue("73");
  expect(store.updateTargetSession).not.toHaveBeenCalled();
});

test("choosing JPEG from a transparent output keeps format and background compatible", () => {
  session.mask.modelConfig.imageBackground = "transparent";
  render(<ImageOutputControls />);
  fireEvent.click(outputChoice("输出格式", "JPEG"));
  expect(outputChoice("背景", "不透明")).toBeChecked();
  expect(outputChoice("输出格式", "JPEG")).toBeChecked();
  expect(screen.getByRole("spinbutton", { name: "压缩设置" })).toHaveValue(73);
  expect(screen.getByRole("spinbutton", { name: "压缩设置" })).toBeEnabled();
  expect(screen.getByRole("slider", { name: "压缩设置滑杆" })).toBeEnabled();
  expect(session.mask.syncGlobalConfig).toBe(false);
  expect(session.mask.modelConfig).toMatchObject({
    model: "gpt-image-2",
    providerName: "custom-provider",
    temperature: 0.7,
    imageOutputFormat: "jpeg",
    imageBackground: "opaque",
  });
});

test("choosing a transparent JPEG background switches to PNG and disables compression in place", () => {
  session.mask.modelConfig.imageOutputFormat = "jpeg";
  render(<ImageOutputControls />);
  const compression = screen.getByRole("spinbutton", { name: "压缩设置" });
  const slider = screen.getByRole("slider", { name: "压缩设置滑杆" });
  fireEvent.click(outputChoice("背景", "透明"));
  expect(outputChoice("输出格式", "PNG")).toBeChecked();
  expect(outputChoice("背景", "透明")).toBeChecked();
  expect(screen.getByRole("spinbutton", { name: "压缩设置" })).toBe(
    compression,
  );
  expect(screen.getByRole("slider", { name: "压缩设置滑杆" })).toBe(slider);
  expect(compression).toBeDisabled();
  expect(compression).toHaveValue(73);
  expect(slider).toBeDisabled();
  expect(slider).toHaveValue("73");
  expect(session.mask.modelConfig.imageOutputCompression).toBe(73);
});

test("compression survives format changes and keeps its numeric bounds", () => {
  session.mask.modelConfig.imageOutputFormat = "webp";
  render(<ImageOutputControls />);
  const compression = screen.getByRole("spinbutton", { name: "压缩设置" });
  fireEvent.change(compression, { target: { value: "84.7" } });
  expect(compression).toHaveValue(85);
  fireEvent.change(compression, { target: { value: "150" } });
  expect(compression).toHaveValue(100);
  fireEvent.change(compression, { target: { value: "-10" } });
  expect(compression).toHaveValue(0);
  fireEvent.change(compression, { target: { value: "69" } });
  fireEvent.click(outputChoice("输出格式", "PNG"));
  expect(screen.getByRole("spinbutton", { name: "压缩设置" })).toBe(
    compression,
  );
  expect(compression).toBeDisabled();
  expect(compression).toHaveValue(69);
  fireEvent.click(outputChoice("输出格式", "WebP"));
  expect(screen.getByRole("spinbutton", { name: "压缩设置" })).toHaveValue(69);
  expect(compression).toBeEnabled();
});

test("compression slider and numeric entry update the same stored value", () => {
  session.mask.modelConfig.imageOutputFormat = "jpeg";
  render(<ImageOutputControls />);
  const slider = screen.getByRole("slider", { name: "压缩设置滑杆" });
  const numericEntry = screen.getByRole("spinbutton", { name: "压缩设置" });
  expect(slider).toHaveValue("73");

  fireEvent.change(slider, { target: { value: "42" } });
  expect(numericEntry).toHaveValue(42);
  expect(session.mask.modelConfig.imageOutputCompression).toBe(42);

  fireEvent.change(numericEntry, { target: { value: "84.7" } });
  expect(slider).toHaveValue("85");
  expect(numericEntry).toHaveValue(85);
  expect(session.mask.modelConfig.imageOutputCompression).toBe(85);
  expect(session.mask.syncGlobalConfig).toBe(false);

  fireEvent.click(outputChoice("输出格式", "PNG"));
  expect(screen.getByRole("slider", { name: "压缩设置滑杆" })).toBe(slider);
  expect(screen.getByRole("spinbutton", { name: "压缩设置" })).toBe(
    numericEntry,
  );
  expect(slider).toBeDisabled();
  expect(slider).toHaveValue("85");
  expect(numericEntry).toBeDisabled();
  expect(numericEntry).toHaveValue(85);

  store.updateTargetSession.mockClear();
  fireEvent.change(slider, { target: { value: "12" } });
  fireEvent.change(numericEntry, { target: { value: "16" } });
  expect(store.updateTargetSession).not.toHaveBeenCalled();
  expect(session.mask.modelConfig.imageOutputCompression).toBe(85);

  fireEvent.click(outputChoice("输出格式", "JPEG"));
  expect(screen.getByRole("slider", { name: "压缩设置滑杆" })).toHaveValue(
    "85",
  );
  expect(slider).toBeEnabled();
  expect(numericEntry).toBeEnabled();
});

test("output selectors stay inside their parent sheet and create no nested dialog", () => {
  render(
    <dialog open aria-label="生图参数">
      <ImageOutputControls />
    </dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "生图参数" });
  expect(within(dialog).getAllByRole("radiogroup")).toHaveLength(2);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});

test("concise size and compatibility guidance is visible without a separate information entry", () => {
  render(
    <ImageOutputControls
      requestSizeHelp={<span>请求尺寸：1024 × 1024</span>}
    />,
  );
  const sizeHelp = screen.getByText("请求尺寸：1024 × 1024");
  const compatibilityHelp = screen.getByText(
    "PNG 不支持压缩调节，可切换 JPEG/WebP。",
  );
  expect(screen.queryByText("限制说明")).not.toBeInTheDocument();
  expect(sizeHelp).toBeVisible();
  expect(compatibilityHelp).toBeVisible();
  expect(compatibilityHelp).toHaveAttribute("aria-live", "polite");
  expect(screen.getByRole("spinbutton", { name: "压缩设置" })).toHaveAttribute(
    "aria-describedby",
    compatibilityHelp.id,
  );

  fireEvent.click(outputChoice("输出格式", "JPEG"));
  expect(sizeHelp).toBeVisible();
  expect(screen.getByText("透明背景支持 PNG/WebP；JPEG/WebP 可调压缩。")).toBe(
    compatibilityHelp,
  );
});
