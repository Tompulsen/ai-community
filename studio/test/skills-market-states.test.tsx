import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { MemoryRouter } from "react-router-dom";
import type { InstalledSkill, SkillDefinition } from "../app/skills/catalog";

const loadSkillCatalog = jest.fn<() => Promise<SkillDefinition[]>>();
let installed: Record<string, InstalledSkill> = {};
const install = jest.fn<(skill: SkillDefinition) => Promise<void>>();
const setEnabled = jest.fn<(id: string, enabled: boolean) => void>(
  (id, enabled) => {
    if (installed[id]) {
      installed = {
        ...installed,
        [id]: { ...installed[id], enabled },
      };
    }
  },
);
const remove = jest.fn<(id: string) => void>((id) => {
  const remaining = { ...installed };
  delete remaining[id];
  installed = remaining;
});
const getSkillState = () => ({
  installed,
  _hasHydrated: true,
  install,
  setEnabled,
  remove,
});
const session = {
  id: "current-session",
  activeSkillId: undefined as string | undefined,
  mask: { modelConfig: {} },
};
const updateTargetSession = jest.fn<
  (target: typeof session, update: (target: typeof session) => void) => void
>((target, update) => update(target));
const getChatState = () => ({
  currentSession: () => session,
  sessions: [session],
  _hasHydrated: true,
  updateTargetSession,
});
jest.unstable_mockModule("@/app/skills/catalog", () => ({
  loadSkillCatalog,
  CLIENT_SKILL_SOURCES: [],
}));
jest.unstable_mockModule("@/app/store/skills", () => ({
  useSkillStore: Object.assign(
    (selector: (state: ReturnType<typeof getSkillState>) => unknown) =>
      selector(getSkillState()),
    { getState: getSkillState },
  ),
}));
jest.unstable_mockModule("@/app/store/chat", () => ({
  useChatStore: Object.assign(
    (selector: (state: ReturnType<typeof getChatState>) => unknown) =>
      selector(getChatState()),
    { getState: getChatState },
  ),
}));
jest.unstable_mockModule("@/app/store/access", () => ({
  useAccessStore: Object.assign(jest.fn(), { getState: () => ({}) }),
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  getHeaders: () => ({}),
}));
jest.unstable_mockModule("@/app/utils/hooks", () => ({
  useAllModels: () => [],
}));
jest.unstable_mockModule("@/app/utils/custom-provider", () => ({
  usesCustomProvider: () => false,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalScope: () => "test",
  isLocalWorkspaceActive: () => true,
}));
jest.unstable_mockModule("@/app/skills/activate", () => ({
  skillModelSelection: jest.fn(),
}));
jest.unstable_mockModule("@/app/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <header>{title}</header>,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
jest.unstable_mockModule("@/app/components/chat-action", () => ({
  ChatAction: ({ text, onClick }: { text: string; onClick: () => void }) => (
    <button onClick={onClick}>{text}</button>
  ),
}));
jest.unstable_mockModule("@/app/components/selection-dialog", () => ({
  SelectionDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const { SkillsMarket, SkillPicker } = await import(
  "../app/components/skills-market"
);
const skill = {
  id: "writing",
  name: "写作助手",
  description: "润色已有内容",
  category: "writing",
  kind: "prompt",
  version: "1",
} as SkillDefinition;

function addInstalledSkill(enabled = false) {
  installed[skill.id] = {
    ...skill,
    body: "A locally saved skill.",
    installedAt: 1,
    enabled,
  };
}

beforeEach(() => {
  installed = {};
  session.activeSkillId = undefined;
  loadSkillCatalog.mockReset().mockResolvedValue([skill]);
  install.mockReset().mockResolvedValue(undefined);
  setEnabled.mockClear();
  remove.mockClear();
  updateTargetSession.mockClear();
  jest.mocked(fetch).mockClear();
});

test("installed skills remain manageable when the remote catalog fails", async () => {
  addInstalledSkill();
  loadSkillCatalog.mockRejectedValueOnce(new Error("catalog unavailable"));
  const { rerender } = render(<SkillsMarket />);

  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: /我的技能/ }));

  expect(screen.getByRole("heading", { name: "写作助手" })).toBeInTheDocument();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.queryByText("还没有添加技能")).toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "启用" }));
  });
  rerender(<SkillsMarket />);

  expect(setEnabled).toHaveBeenLastCalledWith(skill.id, true);
  expect(session.activeSkillId).toBe(skill.id);
  expect(install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "停用" }));
  rerender(<SkillsMarket />);

  expect(setEnabled).toHaveBeenLastCalledWith(skill.id, false);
  expect(session.activeSkillId).toBeUndefined();
  expect(screen.getByRole("button", { name: "启用" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "查看写作助手详情" }));
  expect(
    screen.getByRole("complementary", { name: "写作助手详情" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "移除本地技能" }));

  expect(remove).toHaveBeenCalledWith(skill.id);
  expect(screen.queryByRole("heading", { name: "写作助手" })).toBeNull();
  expect(screen.getByText("还没有添加技能")).toBeInTheDocument();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(loadSkillCatalog).toHaveBeenCalledTimes(1);
});

test("catalog retry keeps local skills visible and recovers the remote list", async () => {
  addInstalledSkill();
  let resolve!: (skills: SkillDefinition[]) => void;
  loadSkillCatalog
    .mockRejectedValueOnce(new Error("catalog unavailable"))
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
  render(<SkillsMarket />);

  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: /我的技能/ }));
  fireEvent.click(screen.getByRole("button", { name: "重试" }));

  expect(screen.getByRole("heading", { name: "写作助手" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "启用" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "刷新技能目录" })).toBeDisabled();
  expect(screen.queryByText("正在加载技能")).toBeNull();
  await act(async () =>
    resolve([{ ...skill, id: "coding", name: "编程助手" }]),
  );

  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("heading", { name: "写作助手" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "编程助手" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "全部技能" }));
  expect(screen.getByRole("heading", { name: "编程助手" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "写作助手" })).toBeInTheDocument();
  expect(loadSkillCatalog).toHaveBeenCalledTimes(2);
});

test("local filtering and clearing remain available after catalog failure", async () => {
  addInstalledSkill();
  loadSkillCatalog.mockRejectedValueOnce(new Error("catalog unavailable"));
  render(<SkillsMarket />);

  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: /我的技能/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "搜索技能" }), {
    target: { value: "no match" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "技能分类" }), {
    target: { value: "coding" },
  });

  expect(screen.getByText("没有找到匹配的技能")).toBeInTheDocument();
  expect(screen.queryByText("还没有添加技能")).toBeNull();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

  expect(screen.getByRole("textbox", { name: "搜索技能" })).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "技能分类" })).toHaveValue("all");
  expect(screen.getByRole("heading", { name: "写作助手" })).toBeInTheDocument();
});

test("catalog errors show only retry and recover without a contradictory empty state", async () => {
  loadSkillCatalog.mockRejectedValueOnce(new Error("catalog unavailable"));
  render(<SkillsMarket />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "技能目录加载失败",
  );
  expect(screen.queryByText("此分类暂无技能")).toBeNull();
  expect(screen.queryByText("暂无可用技能")).toBeNull();
  expect(screen.queryByText("正在加载技能")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));

  await screen.findByRole("heading", { name: "写作助手" });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("loading and an empty catalog are mutually exclusive", async () => {
  let resolve!: (skills: SkillDefinition[]) => void;
  loadSkillCatalog.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<SkillsMarket />);
  expect(screen.getByText("正在加载技能")).toBeInTheDocument();
  expect(screen.queryByText("暂无可用技能")).toBeNull();

  await act(async () => resolve([]));

  expect(screen.getByText("暂无可用技能")).toBeInTheDocument();
  expect(screen.queryByText("正在加载技能")).toBeNull();
  expect(screen.queryByText("没有找到匹配的技能")).toBeNull();
});

test("clearing an empty search resets both query and category", async () => {
  render(<SkillsMarket />);
  await screen.findByRole("heading", { name: "写作助手" });
  const search = screen.getByRole("textbox", { name: "搜索技能" });
  const category = screen.getByRole("combobox", { name: "技能分类" });
  fireEvent.change(search, { target: { value: "no match" } });
  fireEvent.change(category, { target: { value: "coding" } });

  expect(screen.getByText("没有找到匹配的技能")).toBeInTheDocument();
  expect(screen.queryByText("暂无可用技能")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

  expect(search).toHaveValue("");
  expect(category).toHaveValue("all");
  expect(screen.getByRole("heading", { name: "写作助手" })).toBeInTheDocument();
});

test("browsing all skills from an empty installed tab clears stale filters", async () => {
  render(<SkillsMarket />);
  await screen.findByRole("heading", { name: "写作助手" });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索技能" }), {
    target: { value: "no match" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "技能分类" }), {
    target: { value: "coding" },
  });
  fireEvent.click(screen.getByRole("button", { name: /我的技能/ }));

  expect(screen.getByText("还没有添加技能")).toBeInTheDocument();
  expect(screen.queryByText("没有找到匹配的技能")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "浏览全部技能" }));

  expect(screen.getByRole("textbox", { name: "搜索技能" })).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "技能分类" })).toHaveValue("all");
  expect(screen.getByRole("heading", { name: "写作助手" })).toBeInTheDocument();
});

test("the composer picker hides legacy web skills and does not query their capabilities", async () => {
  installed.web = {
    ...skill,
    id: "web",
    name: "联网搜索",
    kind: "web",
    body: "Search the web.",
    installedAt: 1,
    enabled: true,
  };
  render(
    <MemoryRouter>
      <SkillPicker sessionId={session.id} isImage={false} onOpen={() => {}} />
    </MemoryRouter>,
  );
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "技能" }));
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "联网搜索" })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test("web skills stay hidden from both remote and previously installed marketplace entries", async () => {
  const web = {
    ...skill,
    id: "web-search",
    name: "联网搜索",
    kind: "web" as const,
  };
  installed[web.id] = {
    ...web,
    body: "Search.",
    installedAt: 1,
    enabled: true,
  };
  loadSkillCatalog.mockResolvedValue([skill, web]);
  render(<SkillsMarket />);
  await screen.findByRole("heading", { name: "写作助手" });
  expect(screen.queryByRole("heading", { name: "联网搜索" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /我的技能/ }));
  expect(screen.getByText("还没有添加技能")).toBeInTheDocument();
});

test("prompt-only skills do not need a retrieval capability request when opened", async () => {
  addInstalledSkill(true);
  render(
    <MemoryRouter>
      <SkillPicker sessionId={session.id} isImage={false} onOpen={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "技能" }));
  await act(async () => {});
  expect(screen.getByRole("button", { name: /写作助手/ })).toBeEnabled();
  expect(fetch).not.toHaveBeenCalled();
});
