import React, { useSyncExternalStore } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { ChatApiFormat } from "../app/utils/chat-api-format";

type TestConfig = {
  favoriteModels: string[];
  update: (updater: (config: TestConfig) => void) => void;
};

let config: TestConfig;
let access = {
  newApiEnabled: false,
  useCustomConfig: false,
  switchingToken: false,
  modelListStatus: "ready",
};
const configListeners = new Set<() => void>();
const subscribeConfig = (listener: () => void) => {
  configListeners.add(listener);
  return () => configListeners.delete(listener);
};
const showToast = jest.fn();
type ModelType = "auto" | "chat" | "image" | "video";
const modelPreferenceListeners = new Set<() => void>();
const subscribeModelPreferences = (listener: () => void) => {
  modelPreferenceListeners.add(listener);
  return () => modelPreferenceListeners.delete(listener);
};
const setModelType = jest.fn<(key: string, type: ModelType) => void>();
const setModelApiFormat =
  jest.fn<(key: string, format: ChatApiFormat | "auto") => void>();
let modelPreferences = {
  overrides: {} as Record<string, Exclude<ModelType, "auto">>,
  apiFormats: {} as Record<string, ChatApiFormat>,
  _hasHydrated: true,
  setModelType,
  setModelApiFormat,
};

jest.unstable_mockModule("@/app/store", () => ({
  useAppConfig: () =>
    useSyncExternalStore(
      subscribeConfig,
      () => config,
      () => config,
    ),
  useAccessStore: () => access,
}));
jest.unstable_mockModule("@/app/components/account-model-source", () => ({
  AccountModelSource: (props: { onGroupChange?: () => void }) => (
    <button data-testid="account-model-source" onClick={props.onGroupChange}>
      Account models
    </button>
  ),
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => <span aria-hidden="true" />,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast,
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
jest.unstable_mockModule("@/app/icons/down.svg", () => ({
  default: () => <span aria-hidden="true" />,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "test",
  localKey: (key: string) => key,
}));
jest.unstable_mockModule("@/app/store/model-preferences", () => ({
  useModelPreferenceStore: <T,>(
    selector: (state: typeof modelPreferences) => T,
  ) => {
    const state = useSyncExternalStore(
      subscribeModelPreferences,
      () => modelPreferences,
      () => modelPreferences,
    );
    return selector(state);
  },
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelPreferenceKey: (name: string, providerName?: string) =>
    `${name}@${providerName}`,
  getModelCapabilities: (name: string, providerName?: string) => {
    const override = modelPreferences.overrides[`${name}@${providerName}`];
    return {
      category: override ?? "chat",
      override: override ?? "auto",
      usesImageApi: override === "image",
    };
  },
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Settings: {
      ModelPicker: {
        Title: "Choose model",
        Search: "Search models",
        ClearSearch: "Clear search",
        All: "All",
        Other: "Other",
        Favorites: "Favorites",
        Favorite: "Favorite",
        Unfavorite: "Unfavorite",
        Favorited: "Added to favorites",
        Unfavorited: "Removed from favorites",
        Empty: "No matching models",
        Tags: { chat: "Chat", image: "Image", video: "Video" },
        Descriptions: {
          chat: "A chat model",
          image: "An image model",
          video: "A video model",
          custom: "A custom model",
        },
      },
      ModelSource: {
        ModelsFailed: "Models unavailable",
        ModelsLoading: "Loading models",
      },
      ChatApiFormat: {
        Title: "聊天接口格式",
        SubTitle: "Your provider must support this API.",
      },
    },
  },
}));

const { CUSTOM_MODEL_PROVIDER } = await import("../app/utils/custom-provider");
const { LOCAL_PREVIEW_PROVIDER } = await import(
  "../app/utils/local-preview-models"
);
const { ModelSelect } = await import("../app/components/model-select");

const models = [
  {
    name: "gpt-4o",
    displayName: "Atlas Chat",
    description: "Fast reasoning and concise answers",
    provider: { providerName: "NorthCloud" },
  },
  {
    name: "claude-sonnet-4",
    displayName: "Orion Writer",
    description: "Long context writing",
    provider: { providerName: "SouthProxy" },
  },
  {
    name: "private-code",
    displayName: "Local Coder",
    description: "Offline coding assistant",
    provider: { providerName: CUSTOM_MODEL_PROVIDER },
  },
];
const atlasKey = "gpt-4o@NorthCloud";
const orionKey = "claude-sonnet-4@SouthProxy";
const customKey = `private-code@${CUSTOM_MODEL_PROVIDER}`;
const atlasLabel = "Atlas Chat (NorthCloud)";
const orionLabel = "Orion Writer (SouthProxy)";
const customLabel = `Local Coder (${CUSTOM_MODEL_PROVIDER})`;

beforeEach(() => {
  config = {
    favoriteModels: [],
    update(updater) {
      const next = { ...config, favoriteModels: [...config.favoriteModels] };
      updater(next);
      config = next;
      configListeners.forEach((listener) => listener());
    },
  };
  access = {
    newApiEnabled: false,
    useCustomConfig: false,
    switchingToken: false,
    modelListStatus: "ready",
  };
  showToast.mockClear();
  setModelType.mockReset();
  setModelApiFormat.mockReset();
  modelPreferences = {
    overrides: {},
    apiFormats: {},
    _hasHydrated: true,
    setModelType,
    setModelApiFormat,
  };
  setModelType.mockImplementation((key, type) => {
    const overrides = { ...modelPreferences.overrides };
    if (type === "auto") delete overrides[key];
    else overrides[key] = type;
    modelPreferences = { ...modelPreferences, overrides };
    modelPreferenceListeners.forEach((listener) => listener());
  });
  setModelApiFormat.mockImplementation((key, format) => {
    const apiFormats = { ...modelPreferences.apiFormats };
    if (format === "auto") delete apiFormats[key];
    else apiFormats[key] = format;
    modelPreferences = { ...modelPreferences, apiFormats };
    modelPreferenceListeners.forEach((listener) => listener());
  });
});

function setup(embedded = true) {
  const onChange = jest.fn();
  function Picker() {
    const [value, setValue] = React.useState(atlasKey);
    return (
      <ModelSelect
        models={models}
        value={value}
        embedded={embedded}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Picker />);
  return { onChange, search: screen.getByRole("searchbox") };
}

test("a deliberate account group change notifies its owner without selecting a model", () => {
  access.newApiEnabled = true;
  const onChange = jest.fn();
  const onGroupChange = jest.fn();
  render(
    <ModelSelect
      models={models}
      value={atlasKey}
      embedded
      onChange={onChange}
      onGroupChange={onGroupChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Account models" }));
  expect(onGroupChange).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: atlasLabel })).toBeVisible();
});

test.each([
  ["name", "GpT-4O"],
  ["display name", "aTlAs cHaT"],
  ["description", "CoNcIsE"],
  ["provider", "NoRtHcLoUd"],
])("search matches %s without case sensitivity", (_field, query) => {
  setup();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: query },
  });
  expect(screen.getByRole("button", { name: atlasLabel })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: orionLabel }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: customLabel }),
  ).not.toBeInTheDocument();
});

test("vendor groups filter models and recover when a search removes the group", () => {
  setup();
  const openAI = screen.getByRole("button", { name: /^OpenAI\b/ });
  fireEvent.click(openAI);
  expect(openAI).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: atlasLabel })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: orionLabel }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "WRITING" },
  });
  expect(
    screen.queryByRole("button", { name: /^OpenAI\b/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^All\b/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: orionLabel })).toBeVisible();
});

test("no results shows an empty state and clearing restores models and search focus", () => {
  const { search } = setup();
  fireEvent.change(search, { target: { value: "no-model-matches-this" } });
  expect(screen.getByRole("status")).toHaveTextContent("No matching models");
  expect(
    screen.queryByRole("button", { name: atlasLabel }),
  ).not.toBeInTheDocument();
  const clear = screen.getByRole("button", { name: "Clear search" });
  clear.focus();
  fireEvent.click(clear);
  expect(search).toHaveValue("");
  expect(search).toHaveFocus();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Clear search" }),
  ).not.toBeInTheDocument();
  for (const name of [atlasLabel, orionLabel, customLabel]) {
    expect(screen.getByRole("button", { name })).toBeVisible();
  }
});

test("native model buttons are focusable and reflect the selected value", () => {
  const { onChange } = setup();
  const atlas = screen.getByRole("button", { name: atlasLabel });
  const orion = screen.getByRole("button", { name: orionLabel });
  expect(atlas).toHaveAttribute("type", "button");
  expect(atlas).toHaveAttribute("aria-pressed", "true");
  expect(orion).toHaveAttribute("aria-pressed", "false");
  orion.focus();
  expect(orion).toHaveFocus();
  fireEvent.click(orion);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(orionKey);
  expect(orion).toHaveAttribute("aria-pressed", "true");
  expect(atlas).toHaveAttribute("aria-pressed", "false");
});

test("favorites update separately from model selection and their group stays usable", () => {
  const { onChange } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Favorite: Atlas Chat" }));
  expect(config.favoriteModels).toEqual([atlasKey]);
  expect(onChange).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith("Added to favorites");
  const unfavorite = screen.getByRole("button", {
    name: "Unfavorite: Atlas Chat",
  });
  expect(unfavorite).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: /^Favorites\b/ }));
  expect(screen.getByRole("button", { name: atlasLabel })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: orionLabel }),
  ).not.toBeInTheDocument();
  fireEvent.click(unfavorite);
  expect(config.favoriteModels).toEqual([]);
  expect(onChange).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenLastCalledWith("Removed from favorites");
  expect(
    screen.queryByRole("button", { name: /^Favorites\b/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: orionLabel })).toBeVisible();
});

test("model types update without selecting the row and can return to automatic detection", () => {
  const { onChange } = setup();
  const adjust = screen.getByRole("button", {
    name: "调整模型类型: Orion Writer",
  });
  expect(adjust).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(adjust);
  const panel = screen.getByRole("group", { name: "模型类型: Orion Writer" });
  const type = within(panel).getByRole("combobox", { name: "模型类型" });
  expect(type).toHaveFocus();
  expect(type).toHaveValue("auto");
  expect(
    within(type)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["自动识别", "对话", "生图", "视频"]);
  fireEvent.change(type, { target: { value: "image" } });
  expect(setModelType).toHaveBeenLastCalledWith(orionKey, "image");
  expect(type).toHaveValue("image");
  expect(screen.getByText("Image")).toBeVisible();
  expect(screen.getByText("手动")).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: atlasLabel })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: orionLabel })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  fireEvent.change(type, { target: { value: "auto" } });
  expect(setModelType).toHaveBeenLastCalledWith(orionKey, "auto");
  expect(type).toHaveValue("auto");
  expect(modelPreferences.overrides).toEqual({});
  expect(screen.queryByText("手动")).not.toBeInTheDocument();
  expect(screen.queryByText("Image")).not.toBeInTheDocument();
});

test("only one model setting is expanded and its button closes it", () => {
  setup();
  const atlas = screen.getByRole("button", {
    name: "调整模型类型: Atlas Chat",
  });
  const orion = screen.getByRole("button", {
    name: "调整模型类型: Orion Writer",
  });
  fireEvent.click(atlas);
  fireEvent.click(orion);
  expect(
    screen.queryByRole("group", { name: "模型类型: Atlas Chat" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("combobox")).toHaveLength(2);
  expect(atlas).toHaveAttribute("aria-expanded", "false");
  expect(orion).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(orion);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(orion).toHaveAttribute("aria-expanded", "false");
});

test("Escape closes the type settings before the picker and restores button focus", () => {
  setup(false);
  const adjust = screen.getByRole("button", {
    name: "调整模型类型: Atlas Chat",
  });
  fireEvent.click(adjust);
  fireEvent.keyDown(screen.getByRole("combobox", { name: "模型类型" }), {
    key: "Escape",
  });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(adjust).toHaveFocus();
  expect(screen.getByRole("searchbox")).toBeVisible();
  fireEvent.keyDown(adjust, { key: "Escape" });
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});

test("changing search or vendor group dismisses previous type settings", () => {
  const { search } = setup();
  const adjustAtlas = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "调整模型类型: Atlas Chat" }),
    );
  adjustAtlas();
  fireEvent.change(search, { target: { value: "atlas" } });
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  adjustAtlas();
  fireEvent.click(screen.getByRole("button", { name: /^OpenAI\b/ }));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

test("switching an account group dismisses model type settings without choosing a model", () => {
  access.newApiEnabled = true;
  const { onChange } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "调整模型类型: Atlas Chat" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Account models" }));
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

test("unhydrated preferences cannot be changed", () => {
  modelPreferences = { ...modelPreferences, _hasHydrated: false };
  setup();
  const adjust = screen.getByRole("button", {
    name: "调整模型类型: Atlas Chat",
  });
  expect(adjust).toBeDisabled();
  fireEvent.click(adjust);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(setModelType).not.toHaveBeenCalled();
});

test("a failed save keeps the existing type and reports the failure", () => {
  modelPreferences = {
    ...modelPreferences,
    overrides: { [atlasKey]: "video" },
  };
  setModelType.mockImplementationOnce(() => {
    throw new Error("local storage unavailable");
  });
  const { onChange } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "调整模型类型: Atlas Chat" }),
  );
  const type = screen.getByRole("combobox", { name: "模型类型" });
  expect(type).toHaveValue("video");
  fireEvent.change(type, { target: { value: "image" } });
  expect(type).toHaveValue("video");
  expect(modelPreferences.overrides[atlasKey]).toBe("video");
  expect(showToast).toHaveBeenCalledWith("模型类型保存失败，请重试");
  expect(onChange).not.toHaveBeenCalled();
});

test("protocol changes stay local to the model without selecting it or closing its settings", () => {
  const { onChange } = setup();
  const adjust = screen.getByRole("button", {
    name: "调整模型类型: Orion Writer",
  });
  fireEvent.click(adjust);
  const format = screen.getByRole("combobox", { name: "聊天接口格式" });
  expect(format).toHaveValue("auto");
  fireEvent.change(format, { target: { value: "gemini" } });
  expect(setModelApiFormat).toHaveBeenLastCalledWith(orionKey, "gemini");
  expect(format).toHaveValue("gemini");
  expect(screen.getByRole("combobox", { name: "模型类型" })).toHaveValue(
    "auto",
  );
  expect(adjust).toHaveAttribute("aria-expanded", "true");
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: atlasLabel })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "调整模型类型: Atlas Chat" }),
  );
  expect(screen.getByRole("combobox", { name: "聊天接口格式" })).toHaveValue(
    "auto",
  );
  fireEvent.click(adjust);
  expect(screen.getByRole("combobox", { name: "聊天接口格式" })).toHaveValue(
    "gemini",
  );
  fireEvent.change(screen.getByRole("combobox", { name: "聊天接口格式" }), {
    target: { value: "auto" },
  });
  expect(modelPreferences.apiFormats).toEqual({});
});

test("image and video generation types hide chat protocol settings without deleting the preference", () => {
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: "调整模型类型: Atlas Chat" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "聊天接口格式" }), {
    target: { value: "gemini" },
  });
  const type = screen.getByRole("combobox", { name: "模型类型" });
  for (const value of ["image", "video"]) {
    fireEvent.change(type, { target: { value } });
    expect(
      screen.queryByRole("combobox", { name: "聊天接口格式" }),
    ).not.toBeInTheDocument();
  }
  fireEvent.change(type, { target: { value: "chat" } });
  expect(screen.getByRole("combobox", { name: "聊天接口格式" })).toHaveValue(
    "gemini",
  );
});

test("a failed protocol save reports the error and preserves the previous choice", () => {
  modelPreferences = {
    ...modelPreferences,
    apiFormats: { [atlasKey]: "responses" },
  };
  setModelApiFormat.mockImplementationOnce(() => {
    throw new Error("local storage unavailable");
  });
  const { onChange } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "调整模型类型: Atlas Chat" }),
  );
  const format = screen.getByRole("combobox", { name: "聊天接口格式" });
  fireEvent.change(format, { target: { value: "gemini" } });
  expect(format).toHaveValue("responses");
  expect(modelPreferences.apiFormats[atlasKey]).toBe("responses");
  expect(showToast).toHaveBeenCalledWith("接口格式保存失败，请重试");
  expect(onChange).not.toHaveBeenCalled();
});

test("Escape closes a standalone picker and returns focus to its trigger", () => {
  const { search, onChange } = setup(false);
  const trigger = screen.getByRole("button", { expanded: true });
  search.focus();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("searchbox")).toBeVisible();
});

test.each([
  { isComposing: true, keyCode: 27 },
  { isComposing: false, keyCode: 229 },
])(
  "Escape during input composition keeps the picker open ($isComposing, $keyCode)",
  (keyboardState) => {
    const { search } = setup(false);
    const trigger = screen.getByRole("button", { expanded: true });
    search.focus();
    fireEvent.keyDown(search, { key: "Escape", ...keyboardState });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "Escape", keyCode: 27 });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  },
);

test.each([
  { modelListStatus: "loading", switchingToken: false },
  { modelListStatus: "error", switchingToken: false },
  { modelListStatus: "ready", switchingToken: true },
])(
  "unavailable account models do not hide custom models ($modelListStatus, switching=$switchingToken)",
  (state) => {
    access = { ...access, ...state, newApiEnabled: true };
    const { onChange } = setup();
    expect(screen.getByTestId("account-model-source")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: atlasLabel }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: orionLabel }),
    ).not.toBeInTheDocument();
    const custom = screen.getByRole("button", { name: customLabel });
    expect(custom).toBeEnabled();
    fireEvent.click(custom);
    expect(onChange).toHaveBeenCalledWith(customKey);
    expect(custom).toHaveAttribute("aria-pressed", "true");
  },
);

test.each([
  { modelListStatus: "idle", switchingToken: false },
  { modelListStatus: "loading", switchingToken: false },
  { modelListStatus: "error", switchingToken: false },
  { modelListStatus: "ready", switchingToken: true },
])(
  "unavailable account models keep local previews selectable ($modelListStatus, switching=$switchingToken)",
  (state) => {
    access = { ...access, ...state, newApiEnabled: true };
    const onChange = jest.fn();
    const preview = {
      name: "gpt-6-astra",
      displayName: "GPT-6 Astra · 预览",
      provider: { providerName: LOCAL_PREVIEW_PROVIDER },
    };
    const lookalike = {
      name: "gpt-6-astra-copy",
      displayName: "Account model with a similar provider name",
      provider: { providerName: `${LOCAL_PREVIEW_PROVIDER}-other` },
    };
    render(
      <ModelSelect
        models={[...models, preview, lookalike]}
        value={atlasKey}
        embedded
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    for (const label of [atlasLabel, orionLabel]) {
      expect(
        screen.queryByRole("button", { name: label }),
      ).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", {
        name: `${lookalike.displayName} (${lookalike.provider.providerName})`,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: customLabel })).toBeEnabled();
    const option = screen.getByRole("button", {
      name: `${preview.displayName} (${LOCAL_PREVIEW_PROVIDER})`,
    });
    expect(option).toBeEnabled();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      `${preview.name}@${LOCAL_PREVIEW_PROVIDER}`,
    );
  },
);
