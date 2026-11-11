import React, {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { getModelMetadata } from "../app/utils/model-metadata";

type ModelType = "auto" | "chat" | "image" | "video";
const preferenceListeners = new Set<() => void>();
const subscribePreferences = (listener: () => void) => {
  preferenceListeners.add(listener);
  return () => preferenceListeners.delete(listener);
};
const setModelType = (key: string, type: ModelType) => {
  const overrides = { ...preferences.overrides };
  if (type === "auto") delete overrides[key];
  else overrides[key] = type;
  preferences = { ...preferences, overrides };
  preferenceListeners.forEach((listener) => listener());
};
let preferences = {
  overrides: {} as Record<string, Exclude<ModelType, "auto">>,
  apiFormats: {},
  _hasHydrated: true,
  setModelType,
  setModelApiFormat: jest.fn(),
};
const access = {
  newApiEnabled: false,
  useCustomConfig: false,
  switchingToken: false,
  modelListStatus: "ready",
};

jest.unstable_mockModule("@/app/store", () => ({
  useAppConfig: () => ({ favoriteModels: [], update: jest.fn() }),
  useAccessStore: () => access,
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: () => access,
}));
jest.unstable_mockModule("@/app/components/account-model-source", () => ({
  AccountModelSource: () => null,
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => <span aria-hidden="true" />,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
jest.unstable_mockModule("@/app/store/model-preferences", () => ({
  useModelPreferenceStore: <T,>(selector: (state: typeof preferences) => T) => {
    const state = useSyncExternalStore(
      subscribePreferences,
      () => preferences,
      () => preferences,
    );
    return selector(state);
  },
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  useModelCapabilitiesResolver: () => {
    const state = useSyncExternalStore(
      subscribePreferences,
      () => preferences,
      () => preferences,
    );
    return useCallback(
      (name: string, providerName?: string) => {
        const override = state.overrides[`${name}@${providerName}`];
        return {
          ...getModelMetadata(name),
          ...(override ? { category: override } : {}),
          override: override ?? "auto",
        };
      },
      [state],
    );
  },
  getModelPreferenceKey: (name: string, providerName?: string) =>
    `${name}@${providerName}`,
  getModelCapabilities: (name: string, providerName?: string) => {
    const override = preferences.overrides[`${name}@${providerName}`];
    return {
      ...getModelMetadata(name),
      ...(override ? { category: override } : {}),
      override: override ?? "auto",
    };
  },
}));
jest.unstable_mockModule("@/app/icons/down.svg", () => ({
  default: () => <span aria-hidden="true" />,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Settings: {
      ChatApiFormat: { Title: "接口格式", SubTitle: "" },
      ModelPicker: {
        Search: "Search models",
        ClearSearch: "Clear search",
        All: "All",
        Other: "Other",
        Favorites: "Favorites",
        Favorite: "Favorite",
        Unfavorite: "Unfavorite",
        Empty: "No matching models",
        Tags: { chat: "Chat", image: "Image" },
        Descriptions: { chat: "Chat model", image: "Image model" },
      },
    },
  },
}));

const { ModelSelect } = await import("../app/components/model-select");
const { useChatModelPicker } = await import(
  "../app/utils/use-chat-model-picker"
);
const { SelectionDialog } = await import("../app/components/selection-dialog");
const models = [
  { name: "gpt-4.1", provider: { providerName: "Test" } },
  { name: "gpt-image-2", provider: { providerName: "Test" } },
  { name: "gemini-3-pro-image", provider: { providerName: "Test" } },
  { name: "unknown-model", provider: { providerName: "Test" } },
];
const imageOpen = jest.fn();
const selectModel = jest.fn();
const showDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeEach(() => {
  preferences = { ...preferences, overrides: {} };
  imageOpen.mockClear();
  selectModel.mockClear();
  document.body.classList.add("reduce-motion");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
      this.querySelector<HTMLButtonElement>("button")?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  document.body.classList.remove("reduce-motion");
  for (const [property, descriptor] of [
    ["showModal", showDescriptor],
    ["close", closeDescriptor],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, property, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, property);
  }
});

function Fixture({ available = models }: { available?: typeof models }) {
  const location = useLocation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const beforeImageOpen = useCallback(() => {
    imageOpen();
    trigger.current?.focus();
  }, []);
  const picker = useChatModelPicker(available, beforeImageOpen);
  const [model, setModel] = useState("gpt-4.1@Test");
  const [draft, setDraft] = useState("An unfinished draft");

  return (
    <>
      <button
        onClick={() => navigate("/chat", { state: { selectImageModel: true } })}
      >
        Start image
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
      <button onClick={() => navigate("/gallery")}>Gallery</button>
      <output data-testid="route">{JSON.stringify(location)}</output>
      <section hidden={location.pathname !== "/chat"}>
        <textarea
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <output data-testid="current-model">{model}</output>
        <button ref={trigger} onClick={picker.openAll}>
          Open all models
        </button>
        <SelectionDialog
          open={picker.open}
          title={picker.imageOnly ? "Image models" : "Models"}
          onClose={picker.close}
        >
          <ModelSelect
            models={picker.models}
            embedded
            value={model}
            onChange={(value) => {
              selectModel(value);
              setModel(value);
              picker.close();
            }}
          />
        </SelectionDialog>
      </section>
    </>
  );
}

function route() {
  return JSON.parse(screen.getByTestId("route").textContent!);
}

test("a mounted chat consumes the gallery intent once and cancellation preserves its draft and model", async () => {
  render(
    <React.StrictMode>
      <MemoryRouter initialEntries={["/gallery"]}>
        <Fixture />
      </MemoryRouter>
    </React.StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start image" }));

  expect(screen.getByRole("dialog", { name: "Image models" })).toHaveAttribute(
    "open",
  );
  expect(imageOpen).toHaveBeenCalledTimes(1);
  expect(route().state).toBeNull();
  expect(
    screen.getByRole("button", { name: "gpt-image-2 (Test)" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "gemini-3-pro-image (Test)" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "gpt-4.1 (Test)" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "unknown-model (Test)" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Open all models" }),
    ).toHaveFocus(),
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
    "An unfinished draft",
  );
  expect(screen.getByTestId("current-model")).toHaveTextContent("gpt-4.1@Test");
  expect(selectModel).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(route().pathname).toBe("/gallery");
  fireEvent.click(screen.getByRole("button", { name: "Forward" }));
  expect(route().pathname).toBe("/chat");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(imageOpen).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Open all models" }));
  expect(screen.getByRole("dialog", { name: "Models" })).toBeVisible();
  expect(screen.getByRole("button", { name: "gpt-4.1 (Test)" })).toBeVisible();
});

test("consumption preserves unrelated state, search and hash across rerenders and remounts", () => {
  const initialEntry = {
    pathname: "/chat",
    search: "?from=gallery",
    hash: "#draft",
    state: { selectImageModel: true, keep: "route data" },
  };
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Fixture />
    </MemoryRouter>,
  );
  expect(route()).toMatchObject({
    pathname: "/chat",
    search: "?from=gallery",
    hash: "#draft",
    state: { keep: "route data" },
  });
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  view.rerender(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Fixture />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const consumedEntry = route();
  view.unmount();
  render(
    <MemoryRouter initialEntries={[consumedEntry]}>
      <Fixture />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(imageOpen).toHaveBeenCalledTimes(1);
});

test("only an explicit image model choice updates the selected model", () => {
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: "/chat", state: { selectImageModel: true } },
      ]}
    >
      <Fixture />
    </MemoryRouter>,
  );
  expect(selectModel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "gpt-image-2 (Test)" }));
  expect(selectModel).toHaveBeenCalledTimes(1);
  expect(selectModel).toHaveBeenCalledWith("gpt-image-2@Test");
  expect(screen.getByTestId("current-model")).toHaveTextContent(
    "gpt-image-2@Test",
  );
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
    "An unfinished draft",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("no image models uses the existing empty state and never selects a fallback", () => {
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: "/chat", state: { selectImageModel: true } },
      ]}
    >
      <Fixture available={[models[0], models[3]]} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("dialog", { name: "Image models" })).toBeVisible();
  expect(
    within(screen.getByRole("dialog")).getByRole("status"),
  ).toHaveTextContent("No matching models");
  expect(selectModel).not.toHaveBeenCalled();
  expect(screen.getByTestId("current-model")).toHaveTextContent("gpt-4.1@Test");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "Open all models" }));
  expect(screen.getByRole("button", { name: "gpt-4.1 (Test)" })).toBeVisible();
});

test("a user model correction updates image filtering without selecting a model", () => {
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <Fixture />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open all models" }));
  fireEvent.click(
    screen.getByRole("button", { name: "调整模型类型: unknown-model" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "模型类型" }), {
    target: { value: "image" },
  });
  expect(preferences.overrides["unknown-model@Test"]).toBe("image");
  expect(selectModel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "Start image" }));
  expect(
    screen.getByRole("button", { name: "unknown-model (Test)" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "调整模型类型: gpt-image-2" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "模型类型" }), {
    target: { value: "chat" },
  });
  expect(
    screen.queryByRole("button", { name: "gpt-image-2 (Test)" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "unknown-model (Test)" }),
  ).toBeVisible();
  expect(screen.getByTestId("current-model")).toHaveTextContent("gpt-4.1@Test");
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
    "An unfinished draft",
  );
  expect(selectModel).not.toHaveBeenCalled();
});

test("leaving a mounted chat closes the picker and a fresh gallery action can open it again", () => {
  render(
    <MemoryRouter initialEntries={["/gallery"]}>
      <Fixture />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start image" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Gallery" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start image" }));
  expect(screen.getByRole("dialog", { name: "Image models" })).toBeVisible();
  expect(imageOpen).toHaveBeenCalledTimes(2);
});

test("explicit selection preserves image filtering until the existing exit animation finishes", async () => {
  document.body.classList.remove("reduce-motion");
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: "/chat", state: { selectImageModel: true } },
      ]}
    >
      <Fixture />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "gpt-image-2 (Test)" }));
  const dialog = screen.getByRole("dialog", { name: "Image models" });
  expect(dialog).toHaveAttribute("open");
  expect(dialog).toHaveAttribute("data-closing", "true");
  expect(
    screen.queryByRole("button", { name: "gpt-4.1 (Test)" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "gpt-image-2 (Test)" }));
  expect(selectModel).toHaveBeenCalledTimes(1);

  dialog.style.animationName = "picker-exit";
  const exit = new Event("animationend", { bubbles: true });
  Object.defineProperty(exit, "animationName", { value: "picker-exit" });
  fireEvent(dialog, exit);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Open all models" }),
    ).toHaveFocus(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
