import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";

const navigate = jest.fn();
const updateConfig = jest.fn();
let includePrompts = false;
let mobile = false;
let managePrompts = false;
const promptLocationState = { managePrompts: true };
const userPrompt = {
  id: "user-one",
  title: "Writing helper",
  content: "Keep the draft concise.",
  isUser: true,
  createdAt: 1,
};
const builtinPrompt = {
  id: "builtin-one",
  title: "Built-in helper",
  content: "Read-only instructions.",
  isUser: false,
  createdAt: 1,
};
const promptStore = {
  getUserPrompts: () => (includePrompts ? [userPrompt] : []),
  search: () => [],
  prompts: {},
  counter: 0,
  enabledPromptIds: {},
  setEnabled: jest.fn(),
  get: (id: string) => (id === userPrompt.id ? userPrompt : builtinPrompt),
  updatePrompt: jest.fn(),
  remove: jest.fn(),
};
const config = {
  avatar: "1f600",
  submitKey: "Enter",
  theme: "light",
  colorTheme: "blue",
  fontSize: 17,
  fontFamily: "",
  reduceMotion: false,
  showGridBackground: false,
  enableAutoGenerateTitle: true,
  sendPreviewBubble: true,
  enableArtifacts: true,
  enableCodeFold: true,
  dontShowMaskSplashScreen: true,
  hideBuiltinMasks: false,
  disablePromptHint: false,
  modelConfig: { imageRequestMode: "sync", imageStream: false },
  update: updateConfig,
  reset: jest.fn(),
};

jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({}),
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  SubmitKey: { Enter: "Enter" },
}));
const { default: locale } = await import("../app/locales/cn");
jest.unstable_mockModule("@/app/locales", () => ({
  default: locale,
  AllLangs: ["cn"],
  ALL_LANG_OPTIONS: { cn: "Chinese" },
  getLang: () => "cn",
  changeLang: jest.fn(),
}));
jest.unstable_mockModule("@/app/store", () => ({
  SubmitKey: { Enter: "Enter" },
  Theme: { Light: "light", Dark: "dark", Auto: "auto" },
  COLOR_THEMES: [{ value: "blue", color: "#0071e3" }],
  useAppConfig: () => config,
  useAccessStore: () => ({ update: jest.fn() }),
  useChatStore: () => ({ clearAllData: jest.fn() }),
  useUpdateStore: () => ({
    version: "1.0",
    remoteVersion: "1.0",
    formatVersion: (version: string) => version,
    getLatestVersion: async () => {},
  }),
}));
jest.unstable_mockModule("@/app/store/prompt", () => ({
  loadBuiltinPrompts: async () => {},
  SearchService: {
    count: { builtin: 0 },
    get builtinPrompts() {
      return includePrompts ? [builtinPrompt] : [];
    },
  },
  usePromptStore: () => promptStore,
}));
jest.unstable_mockModule("@/app/utils", () => ({
  copyToClipboard: jest.fn(),
  clientUpdate: jest.fn(),
  semverCompare: () => 0,
  useMobileScreen: () => mobile,
}));
jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({
    pathname: "/settings",
    state: managePrompts ? promptLocationState : null,
  }),
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => <span aria-hidden="true" />,
  AvatarPicker: () => <span />,
}));
jest.unstable_mockModule("@/app/icons/octopus-icon", () => ({
  default: () => <span aria-hidden="true" />,
}));
jest.unstable_mockModule("@/app/components/error", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
for (const [file, component] of [
  ["custom-provider-settings", "CustomProviderSettings"],
  ["speech-settings", "SpeechSettings"],
  ["model-config", "ModelConfigList"],
]) {
  jest.unstable_mockModule(`@/app/components/${file}`, () => ({
    [component]: () => null,
  }));
}
jest.unstable_mockModule("@/app/components/local-data-panel", () => ({
  LocalDataPanel: () => (
    <section aria-label="本地数据与备份">
      <button>导出备份</button>
    </section>
  ),
}));
for (const icon of [
  "reload",
  "add",
  "close",
  "copy",
  "clear",
  "three-dots",
  "eye",
  "download",
  "upload",
  "eye-off",
  "down",
  "confirm",
  "cancel",
  "max",
  "min",
]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg aria-hidden="true" />,
  }));
}

const { Settings } = await import("../app/components/settings");
const { Modal } = await import("../app/components/ui-lib");
const { Path } = await import("../app/constant");

beforeEach(() => {
  includePrompts = false;
  mobile = false;
  managePrompts = false;
  navigate.mockClear();
  updateConfig.mockClear();
});

async function renderSettings() {
  await act(async () => {
    render(<Settings />);
  });
}

test("an unhandled Escape leaves settings when no dialog is open", async () => {
  await renderSettings();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(navigate).toHaveBeenCalledWith(Path.Chat);
});

test("return to chat and close both leave settings for the active chat", async () => {
  await renderSettings();
  fireEvent.click(
    screen.getByRole("button", { name: locale.Settings.BackToChat }),
  );
  expect(navigate).toHaveBeenLastCalledWith(Path.Chat);
  navigate.mockClear();
  fireEvent.click(screen.getByRole("button", { name: locale.UI.Close }));
  expect(navigate).toHaveBeenLastCalledWith(Path.Chat);
});

test("Escape closes the active settings dialog without leaving the settings page", async () => {
  await renderSettings();
  const close = jest.fn();
  render(<Modal title="Nested settings" onClose={close} />);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});

test("an open native dialog also retains Escape without background navigation", async () => {
  await renderSettings();
  render(<dialog open aria-label="Native settings" />);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(navigate).not.toHaveBeenCalled();
});

test.each([{ isComposing: true }, { keyCode: 229 }])(
  "IME metadata %j keeps Escape local to the input method",
  async (metadata) => {
    await renderSettings();
    fireEvent.keyDown(document, { key: "Escape", ...metadata });
    expect(navigate).not.toHaveBeenCalled();
  },
);

test("a previously handled Escape does not navigate", async () => {
  await renderSettings();
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  event.preventDefault();
  fireEvent(document, event);
  expect(navigate).not.toHaveBeenCalled();
});

test("settings exposes a three-way motion preference while toggles and avatar retain native controls", async () => {
  await renderSettings();
  const motion = within(
    screen.getByRole("radiogroup", { name: locale.Settings.Motion }),
  );
  expect(
    motion.getByRole("radio", { name: locale.Settings.MotionSystem }),
  ).toBeChecked();
  fireEvent.click(
    motion.getByRole("radio", { name: locale.Settings.MotionFull }),
  );
  const apply = updateConfig.mock.calls.at(-1)![0] as (
    config: Record<string, unknown>,
  ) => void;
  const next: Record<string, unknown> = { reduceMotion: true };
  apply(next);
  expect(next).toEqual({ motionPreference: "full", reduceMotion: false });
  expect(
    screen.getByRole("switch", { name: locale.Settings.ShowGridBackground }),
  ).not.toBeChecked();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  const avatar = screen.getByRole("button", { name: locale.Settings.Avatar });
  expect(avatar).toHaveAttribute("aria-expanded", "false");
  avatar.focus();
  expect(avatar).toHaveFocus();
  fireEvent.click(avatar);
  expect(avatar).toHaveAttribute("aria-expanded", "true");
});

test("settings categories reveal only their related controls", async () => {
  await renderSettings();
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(
    screen.getByRole("tab", { name: locale.Settings.General }),
  ).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
    locale.Settings.General,
  );
  expect(
    screen.queryByRole("button", { name: "导出备份" }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "模型与生成" }));
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName("模型与生成");
  expect(screen.getByText("生图请求方式")).toBeVisible();
  expect(
    screen.queryByRole("radiogroup", { name: locale.Settings.Motion }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "数据与备份" }));
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName("数据与备份");
  expect(screen.getByRole("button", { name: "导出备份" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "导出配置" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: locale.Settings.Danger.Reset.Title }),
  ).toBeVisible();
});

test("chat model settings precede image generation settings", async () => {
  await renderSettings();
  fireEvent.click(screen.getByRole("tab", { name: "模型与生成" }));
  const model = screen.getByRole("heading", {
    name: locale.Settings.ModelConfig,
  });
  const image = screen.getByRole("heading", { name: "生图设置" });
  expect(model.compareDocumentPosition(image)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

test("settings tabs support arrows, Home and End with one keyboard stop", async () => {
  await renderSettings();
  expect(
    screen.getByRole("tablist", { name: locale.Settings.Sections.Navigation }),
  ).toHaveAttribute("aria-orientation", "vertical");
  const general = screen.getByRole("tab", { name: locale.Settings.General });
  const model = screen.getByRole("tab", { name: "模型与生成" });
  const data = screen.getByRole("tab", { name: "数据与备份" });
  general.focus();
  fireEvent.keyDown(general, { key: "ArrowRight" });
  expect(model).toHaveFocus();
  expect(model).toHaveAttribute("aria-selected", "true");
  expect(general).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(model, { key: "End" });
  expect(data).toHaveFocus();
  fireEvent.keyDown(data, { key: "ArrowRight" });
  expect(general).toHaveFocus();
  fireEvent.keyDown(general, { key: "ArrowLeft" });
  expect(data).toHaveFocus();
  fireEvent.keyDown(data, { key: "Home" });
  expect(general).toHaveFocus();
  fireEvent.keyDown(general, { key: "ArrowDown" });
  expect(model).toHaveFocus();
  expect(model).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(model, { key: "ArrowUp" });
  expect(general).toHaveFocus();
});

test("switching categories keeps hidden panels mounted", async () => {
  await renderSettings();
  const generalPanel = screen.getByRole("tabpanel");
  const avatar = screen.getByRole("button", { name: locale.Settings.Avatar });
  fireEvent.click(screen.getByRole("tab", { name: "模型与生成" }));
  expect(generalPanel).toBeInTheDocument();
  expect(generalPanel).not.toBeVisible();
  expect(avatar).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: locale.Settings.General }));
  expect(screen.getByRole("tabpanel")).toBe(generalPanel);
  expect(screen.getByRole("button", { name: locale.Settings.Avatar })).toBe(
    avatar,
  );
});

test("mobile settings start with categories and focus the selected detail heading", async () => {
  mobile = true;
  await renderSettings();
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: locale.Settings.BackToChat }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "模型与生成" }));
  const heading = screen.getByRole("heading", {
    name: "模型与生成",
    level: 1,
  });
  await waitFor(() => expect(heading).toHaveFocus());
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName("模型与生成");
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.getByText("生图请求方式")).toBeVisible();
});

test("mobile back restores the original category focus and keeps detail controls mounted", async () => {
  mobile = true;
  await renderSettings();
  const model = screen.getByRole("tab", { name: "模型与生成" });
  fireEvent.click(model);
  const modelPanel = screen.getByRole("tabpanel");
  const imageRequest = screen.getByText("生图请求方式");
  fireEvent.click(
    screen.getByRole("button", { name: locale.Settings.Sections.Navigation }),
  );
  await waitFor(() => expect(model).toHaveFocus());
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  expect(modelPanel).toBeInTheDocument();
  expect(modelPanel).not.toBeVisible();
  fireEvent.click(model);
  expect(screen.getByRole("tabpanel")).toBe(modelPanel);
  expect(screen.getByText("生图请求方式")).toBe(imageRequest);
  expect(navigate).not.toHaveBeenCalled();
});

test("mobile Escape returns from detail to categories before leaving for chat", async () => {
  mobile = true;
  await renderSettings();
  const data = screen.getByRole("tab", { name: "数据与备份" });
  fireEvent.click(data);
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(data).toHaveFocus());
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(navigate).toHaveBeenCalledWith(Path.Chat);
});

test("mobile Escape closes the avatar picker before returning to categories", async () => {
  mobile = true;
  await renderSettings();
  fireEvent.click(screen.getByRole("tab", { name: locale.Settings.General }));
  const avatar = screen.getByRole("button", { name: locale.Settings.Avatar });
  fireEvent.click(avatar);
  expect(avatar).toHaveAttribute("aria-expanded", "true");

  fireEvent.keyDown(document, { key: "Escape" });
  expect(avatar).toHaveAttribute("aria-expanded", "false");
  await waitFor(() => expect(avatar).toHaveFocus());
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
    locale.Settings.General,
  );
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();

  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("tab", { name: locale.Settings.General }));
  expect(
    screen.getByRole("button", { name: locale.Settings.Avatar }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(navigate).not.toHaveBeenCalled();
});

test("a mobile modal consumes Escape without closing the settings detail", async () => {
  mobile = true;
  await renderSettings();
  fireEvent.click(screen.getByRole("tab", { name: locale.Settings.General }));
  const close = jest.fn();
  render(<Modal title="Mobile nested settings" onClose={close} />);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
    locale.Settings.General,
  );
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
});

test("manage-prompts opens general settings on mobile and clears only the route state", async () => {
  mobile = true;
  managePrompts = true;
  includePrompts = true;
  await renderSettings();
  expect(
    screen.getByRole("heading", {
      name: locale.Settings.General,
      level: 1,
    }),
  ).toBeVisible();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: `${locale.Settings.Prompt.Edit} ${userPrompt.title}`,
    }),
  ).toBeVisible();
  expect(navigate).toHaveBeenCalledWith("/settings", {
    replace: true,
    state: null,
  });
  navigate.mockClear();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName(
    locale.Settings.General,
  );
  expect(navigate).not.toHaveBeenCalled();
});

test("prompt actions and the editor content have names that identify the prompt", async () => {
  includePrompts = true;
  await renderSettings();
  fireEvent.click(
    screen.getByRole("button", {
      name: locale.Settings.Prompt.List + locale.Settings.Prompt.Edit,
    }),
  );
  for (const name of [
    `${locale.Chat.Actions.Delete} ${userPrompt.title}`,
    `${locale.Settings.Prompt.Edit} ${userPrompt.title}`,
    `${locale.Mask.Item.View} ${builtinPrompt.title}`,
    `${locale.Chat.Actions.Copy} ${userPrompt.title}`,
    `${locale.Chat.Actions.Copy} ${builtinPrompt.title}`,
  ]) {
    expect(screen.getByRole("button", { name })).toHaveAttribute("title", name);
  }
  fireEvent.click(
    screen.getByRole("button", {
      name: `${locale.Settings.Prompt.Edit} ${userPrompt.title}`,
    }),
  );
  expect(
    screen.getByRole("textbox", {
      name: `${locale.Chat.InputActions.Prompt}: ${userPrompt.title}`,
    }),
  ).toHaveValue(userPrompt.content);
});
