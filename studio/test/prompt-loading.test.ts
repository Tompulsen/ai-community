import { jest } from "@jest/globals";
import { create } from "zustand";

let rehydrate: (state: any) => void;
jest.unstable_mockModule("@/app/utils/store", () => ({
  createPersistStore: (state: any, methods: any, options: any) => {
    rehydrate = options.onRehydrateStorage();
    return create((set, get) => ({ ...state, ...methods(set, get) }));
  },
}));
jest.unstable_mockModule("@/app/locales", () => ({ getLang: () => "cn" }));
const { usePromptStore, SearchService, loadBuiltinPrompts } = await import(
  "../app/store/prompt"
);
const initial = usePromptStore.getState();

beforeEach(() => {
  usePromptStore.setState(
    { ...initial, prompts: {}, enabledPromptIds: {}, counter: 0 },
    true,
  );
  SearchService.ready = false;
  SearchService.builtinPrompts = [];
  SearchService.builtinEngine.setCollection([]);
  SearchService.userEngine.setCollection([]);
  SearchService.count.builtin = 0;
  jest.mocked(fetch).mockReset();
});

test("hydration indexes local prompts without downloading the builtin library", () => {
  usePromptStore.setState({
    prompts: {
      local: {
        id: "local",
        title: "Local prompt",
        content: "saved",
        createdAt: 1,
      },
    },
  });
  rehydrate(usePromptStore.getState());
  expect(fetch).not.toHaveBeenCalled();
  expect(usePromptStore.getState().search("Local")[0]?.id).toBe("local");
  expect(SearchService.ready).toBe(false);
});

test("idle and immediate loading share a request and preserve edits made while waiting", async () => {
  let resolve!: (response: Response) => void;
  jest.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const first = loadBuiltinPrompts();
  expect(loadBuiltinPrompts()).toBe(first);
  const id = usePromptStore.getState().add({
    id: "",
    title: "New local",
    content: "latest",
    createdAt: 1,
  });
  resolve({
    ok: true,
    json: async () => ({
      cn: [
        ["Builtin", "first"],
        ["Builtin", "second"],
      ],
    }),
  } as Response);
  await first;
  expect(usePromptStore.getState().search("New")[0]?.id).toBe(id);
  expect(SearchService.builtinPrompts.map((prompt) => prompt.id)).toEqual([
    "builtin:cn:Builtin:0",
    "builtin:cn:Builtin:1",
  ]);
  usePromptStore.getState().setEnabled("builtin:cn:Builtin:1", true);
  expect(usePromptStore.getState().search("Builtin", true)[0]?.content).toBe(
    "second",
  );
  expect(usePromptStore.getState().counter).toBe(2);
  await loadBuiltinPrompts();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a failed builtin request leaves local search usable and can be retried", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    usePromptStore.getState().add({
      id: "",
      title: "Local",
      content: "saved",
      createdAt: 1,
    });
    jest.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await loadBuiltinPrompts();
    expect(SearchService.ready).toBe(false);
    expect(usePromptStore.getState().search("Local")).toHaveLength(1);
    jest.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cn: [["Builtin", "ready"]] }),
    } as Response);
    await loadBuiltinPrompts();
    expect(SearchService.ready).toBe(true);
    expect(usePromptStore.getState().search("Local")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
  }
});

test("late hydration keeps both builtin and restored local search results", async () => {
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ cn: [["Builtin", "ready"]] }),
  } as Response);
  await loadBuiltinPrompts();
  usePromptStore.setState({
    prompts: {
      restored: {
        id: "restored",
        title: "Restored local",
        content: "saved",
        createdAt: 1,
      },
    },
  });
  rehydrate(usePromptStore.getState());
  expect(usePromptStore.getState().search("Restored")[0]?.id).toBe("restored");
  expect(usePromptStore.getState().search("Builtin")[0]?.content).toBe("ready");
});
