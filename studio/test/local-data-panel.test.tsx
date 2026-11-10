import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import type { LocalBackup } from "../app/utils/local-backup";

const parseBackup = jest.fn<(input: unknown) => LocalBackup>();
const importBackup =
  jest.fn<(backup: LocalBackup, copy: boolean) => Promise<void>>();
const confirm = jest.fn<() => Promise<boolean>>(async () => false);

jest.unstable_mockModule("@/app/utils/local-backup", () => ({
  parseLocalBackup: parseBackup,
  importLocalBackup: importBackup,
  createLocalBackup: jest.fn(),
  readLocalState: async () => undefined,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "legacy",
  localKey: (key: string) => key,
  beginLocalMaintenance: jest.fn(),
  endLocalMaintenance: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/local-tasks", () => ({
  pendingTasks: () => [],
  forgetTask: jest.fn(),
}));
jest.unstable_mockModule("@/app/store/gallery", () => ({
  getImageCount: async () => 0,
}));
jest.unstable_mockModule("@/app/store/video", () => ({
  useVideoStore: { getState: () => ({ isGenerating: false }) },
}));
jest.unstable_mockModule("@/app/client/controller", () => ({
  ChatControllerPool: { hasPending: () => false },
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  List: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ListItem: ({
    title,
    subTitle,
    children,
  }: {
    title: string;
    subTitle?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{title}</span>
      <span>{subTitle}</span>
      {children}
    </div>
  ),
  showConfirm: confirm,
  showToast: jest.fn(),
}));
const { LocalDataPanel } = await import("../app/components/local-data-panel");

const backup: LocalBackup = {
  format: "octopus-local-backup",
  version: 1,
  exportedAt: "2026-10-31T12:00:00.000Z",
  chats: [],
  images: [],
  videos: [],
  settings: { theme: "light" },
};

async function selectFile(name: string, text: string) {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: async () => text,
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("选择备份文件"), {
      target: { files: [file] },
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  parseBackup.mockReturnValue(backup);
});

test("a selected backup is validated and previewed before any import", async () => {
  render(<LocalDataPanel />);
  await selectFile("octopus-backup.json", JSON.stringify(backup));
  expect(parseBackup).toHaveBeenCalledWith(backup);
  expect(screen.getByText("octopus-backup.json · 本地数据备份")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(
    "待导入：0 个会话，0 张图片，0 个视频链接，0 个技能，包含设置。",
  );
  expect(importBackup).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(importBackup).not.toHaveBeenCalled();
});

test("legacy config uses the same preview and confirmation flow", async () => {
  render(<LocalDataPanel />);
  const legacy = {
    version: 1,
    timestamp: "2026-10-31T12:00:00.000Z",
    config: { theme: "light" },
  };
  await selectFile("chatgpt-config.json", JSON.stringify(legacy));
  expect(parseBackup).toHaveBeenCalledWith(legacy);
  expect(screen.getByText("chatgpt-config.json · 旧版配置备份")).toBeVisible();
  expect(screen.getByRole("button", { name: "确认导入" })).toBeEnabled();
  expect(importBackup).not.toHaveBeenCalled();
});

test("an invalid replacement clears the previous preview and duplicate option", async () => {
  render(<LocalDataPanel />);
  await selectFile("valid.json", JSON.stringify(backup));
  fireEvent.click(
    screen.getByRole("switch", { name: "相同记录也作为新副本导入" }),
  );
  parseBackup.mockImplementationOnce(() => {
    throw new Error("无法识别此备份格式，请选择本应用导出的备份文件。");
  });
  await selectFile("unrelated.json", JSON.stringify({ hello: "world" }));
  expect(screen.queryByRole("button", { name: "确认导入" })).toBeNull();
  expect(screen.queryByText("valid.json · 本地数据备份")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("无法识别此备份格式");
  expect(screen.getByRole("button", { name: "选择备份文件" })).toBeEnabled();
  expect(importBackup).not.toHaveBeenCalled();
  await selectFile("valid-again.json", JSON.stringify(backup));
  expect(
    screen.getByRole("switch", { name: "相同记录也作为新副本导入" }),
  ).not.toBeChecked();
});

test("broken JSON gives a recoverable error without passing it to the parser", async () => {
  render(<LocalDataPanel />);
  await selectFile("broken.json", "{");
  expect(screen.getByRole("status")).toHaveTextContent("无法读取 JSON 备份");
  expect(screen.queryByRole("button", { name: "确认导入" })).toBeNull();
  expect(parseBackup).not.toHaveBeenCalled();
  expect(importBackup).not.toHaveBeenCalled();
});
