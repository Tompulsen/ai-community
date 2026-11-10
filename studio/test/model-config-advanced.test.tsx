import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import type { ModelConfig } from "../app/store";
import type { ChatApiFormat } from "../app/utils/chat-api-format";

let modelCategory: "chat" | "image" | "video" = "chat";
let modelApiFormat: ChatApiFormat | undefined;
const setModelApiFormat = jest.fn();

jest.unstable_mockModule("@/app/store", () => ({
  ModalConfigValidator: {
    model: (value: string) => value,
    temperature: (value: number) => value,
    top_p: (value: number) => value,
    presence_penalty: (value: number) => value,
    frequency_penalty: (value: number) => value,
  },
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Settings: {
      Model: "模型",
      ModelPicker: { Placeholder: "选择模型", Title: "模型选择" },
      ChatApiFormat: { Title: "接口格式", SubTitle: "" },
      Temperature: { Title: "Temperature", SubTitle: "" },
      TopP: { Title: "Top P", SubTitle: "" },
      PresencePenalty: { Title: "Presence penalty", SubTitle: "" },
      FrequencyPenalty: { Title: "Frequency penalty", SubTitle: "" },
    },
  },
}));
jest.unstable_mockModule("@/app/utils/hooks", () => ({
  useAllModels: () => [],
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  useModelCapabilities: () => ({
    category: modelCategory,
    override: modelCategory,
    apiFormat: modelApiFormat,
  }),
  getModelPreferenceKey: (model: string, provider: string) =>
    `${model}@${provider}`,
}));
jest.unstable_mockModule("@/app/store/model-preferences", () => ({
  useModelPreferenceStore: (
    selector: (state: {
      setModelApiFormat: typeof setModelApiFormat;
    }) => unknown,
  ) => selector({ setModelApiFormat }),
}));
jest.unstable_mockModule("@/app/utils/custom-provider", () => ({
  CUSTOM_MODEL_PROVIDER: "custom",
}));
jest.unstable_mockModule("@/app/utils/model", () => ({
  getModelProvider: (value: string) => value.split("@"),
}));
jest.unstable_mockModule("@/app/components/button", () => ({
  IconButton: ({ text, onClick }: { text: string; onClick: () => void }) => (
    <button onClick={onClick}>{text}</button>
  ),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  ListItem: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div data-testid="model-config-row" data-title={title}>
      <span>{title}</span>
      {children}
    </div>
  ),
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  showToast: jest.fn(),
  useModalClose: (onClose: () => void) => ({
    maskRef: { current: null },
    requestClose: (onConfirm?: () => void) => {
      onConfirm?.();
      onClose();
    },
    onBackdropClick: (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
  }),
}));
jest.unstable_mockModule("@/app/components/model-select", () => ({
  ModelSelect: () => null,
}));
jest.unstable_mockModule("@/app/components/chat-action", () => ({
  ChatAction: () => null,
}));
jest.unstable_mockModule("@/app/components/reasoning-effort-slider", () => ({
  ReasoningEffortSlider: () => null,
}));
jest.unstable_mockModule("@/app/components/settings-select", () => ({
  SettingsSelect: ({
    title,
    value,
    options,
    onChange,
  }: {
    title: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={title}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const { ModelConfigList, ReasoningEffortSelect } = await import(
  "../app/components/model-config"
);

beforeEach(() => {
  modelCategory = "chat";
  modelApiFormat = undefined;
  setModelApiFormat.mockReset();
});

function ConfigHarness({
  collapseAdvanced,
  hideReasoningEffort,
  initialEffort = "auto",
}: {
  collapseAdvanced?: boolean;
  hideReasoningEffort?: boolean;
  initialEffort?: ModelConfig["reasoningEffort"];
}) {
  const [config, setConfig] = useState({
    model: "gpt-4o",
    providerName: "OpenAI",
    chatApiFormat: "chat-completions",
    temperature: 0.4,
    top_p: 0.8,
    max_tokens: 52000,
    reasoningEffort: initialEffort,
    stream: true,
    stop: "",
    presence_penalty: 0,
    frequency_penalty: 0,
    compressionThreshold: 272000,
  } as ModelConfig);
  return (
    <ModelConfigList
      modelConfig={config}
      collapseAdvanced={collapseAdvanced}
      hideReasoningEffort={hideReasoningEffort}
      updateConfig={(update) => {
        const next = { ...config };
        update(next);
        setConfig(next);
      }}
    />
  );
}

test("advanced settings start collapsed and keep edits when closed and reopened", () => {
  render(<ConfigHarness collapseAdvanced />);
  const summary = screen.getByText("高级参数").closest("summary")!;
  const details = summary.closest("details")!;
  const stop = screen.getByLabelText("停止序列");
  const temperature = screen.getByLabelText("Temperature");
  expect(details).not.toHaveAttribute("open");
  expect(stop).not.toBeVisible();
  expect(temperature).not.toBeVisible();
  expect(screen.getByRole("switch", { name: "流式输出" })).toBeVisible();
  expect(screen.getByLabelText("最大输出 Token")).toBeVisible();
  expect(screen.getByLabelText("自动压缩容量")).toBeVisible();

  fireEvent.click(summary);
  expect(details).toHaveAttribute("open");
  expect(stop).toBeVisible();
  fireEvent.change(stop, { target: { value: "END\nSTOP" } });
  fireEvent.change(temperature, { target: { value: "0.7" } });
  fireEvent.change(screen.getByLabelText("Top P"), {
    target: { value: "0.9" },
  });
  fireEvent.change(screen.getByLabelText("Presence penalty"), {
    target: { value: "0.2" },
  });
  fireEvent.change(screen.getByLabelText("Frequency penalty"), {
    target: { value: "0.3" },
  });
  fireEvent.click(summary);
  expect(stop).not.toBeVisible();
  expect(screen.getByLabelText("停止序列")).toBe(stop);
  fireEvent.click(summary);

  expect(stop).toBeVisible();
  expect(stop).toHaveValue("END\nSTOP");
  expect(temperature).toHaveValue("0.7");
  expect(screen.getByLabelText("Top P")).toHaveValue("0.9");
  expect(screen.getByLabelText("Presence penalty")).toHaveValue("0.2");
  expect(screen.getByLabelText("Frequency penalty")).toHaveValue("0.3");
  expect(screen.getByLabelText("最大输出 Token")).toHaveValue(52000);
  expect(screen.getByRole("switch", { name: "流式输出" })).toBeChecked();
});

test("default callers keep all original controls visible in the original order", () => {
  const { container } = render(<ConfigHarness />);
  expect(container.querySelector("details")).toBeNull();
  expect(
    screen.getAllByTestId("model-config-row").map((row) => row.dataset.title),
  ).toEqual([
    "模型",
    "接口格式",
    "Temperature",
    "Top P",
    "最大输出 Token",
    "推理强度",
    "流式输出",
    "停止序列",
    "Presence penalty",
    "Frequency penalty",
    "自动压缩容量",
  ]);
  for (const label of [
    "Temperature",
    "Top P",
    "停止序列",
    "Presence penalty",
    "Frequency penalty",
  ]) {
    expect(screen.getByLabelText(label)).toBeVisible();
  }
  fireEvent.change(screen.getByLabelText("停止序列"), {
    target: { value: "DONE" },
  });
  expect(screen.getByLabelText("停止序列")).toHaveValue("DONE");
});

test("the existing hideReasoningEffort option remains independent of folding", () => {
  render(<ConfigHarness collapseAdvanced hideReasoningEffort />);
  expect(
    screen.queryByRole("combobox", { name: "推理强度" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("高级参数")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "接口格式" })).toBeVisible();
});

test.each(["image", "video"] as const)(
  "a model corrected to %s hides reasoning controls while keeping other settings",
  (category) => {
    modelCategory = category;
    render(<ConfigHarness collapseAdvanced />);
    expect(
      screen.queryByRole("combobox", { name: "推理强度" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("推理强度")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "接口格式" })).toBeVisible();
    expect(screen.getByRole("switch", { name: "流式输出" })).toBeVisible();
    expect(screen.getByLabelText("最大输出 Token")).toBeVisible();
  },
);

test("restoring a model to chat restores reasoning controls", () => {
  modelCategory = "image";
  const view = render(<ConfigHarness />);
  expect(screen.queryByText("推理强度")).not.toBeInTheDocument();
  modelCategory = "chat";
  view.rerender(<ConfigHarness />);
  expect(screen.getByRole("combobox", { name: "推理强度" })).toBeVisible();
});

test("conversation settings show and update the model-specific interface instead of an ignored default", () => {
  modelApiFormat = "gemini";
  render(<ConfigHarness />);
  const format = screen.getByRole("combobox", { name: "接口格式" });
  expect(format).toHaveValue("gemini");
  expect(screen.getByRole("combobox", { name: "推理强度" })).toHaveValue(
    "auto",
  );
  fireEvent.change(format, { target: { value: "responses" } });
  expect(setModelApiFormat).toHaveBeenCalledWith("gpt-4o@OpenAI", "responses");
});

test("switching conversation interfaces preserves the selected reasoning strength", () => {
  render(<ConfigHarness initialEffort="max" />);
  const reasoning = screen.getByRole("combobox", { name: "推理强度" });
  const format = screen.getByRole("combobox", { name: "接口格式" });
  for (const value of ["gemini", "claude", "responses", "chat-completions"]) {
    fireEvent.change(format, { target: { value } });
    expect(format).toHaveValue(value);
    expect(reasoning).toHaveValue("max");
  }
});

test.each(["chat-completions", "responses", "gemini", "claude"] as const)(
  "a text model keeps its reasoning control and choice with the %s interface",
  (format) => {
    modelApiFormat = format;
    render(
      <ReasoningEffortSelect
        modelConfig={
          {
            model: "custom-text-alias",
            providerName: "OpenAI",
            chatApiFormat: "chat-completions",
            reasoningEffort: "high",
          } as ModelConfig
        }
        updateConfig={() => {}}
        toolbar
      />,
    );
    const control = screen.getByRole("combobox", { name: "推理强度" });
    expect(control).toBeVisible();
    expect(control).toHaveValue("high");
    expect(control.querySelectorAll("option")).toHaveLength(7);
  },
);
