import { documentSkill, documentSkillBody } from "../skills/document-skill";
import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  initializeLocalWorkspace,
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import {
  InstalledSkill,
  SkillDefinition,
  installedSkillSchema,
  skillCollectionSchema,
  loadSkillCatalog,
  readSkillResource,
  verifySkillDocument,
} from "../skills/catalog";

export const useSkillStore = createPersistStore(
  { installed: {} as Record<string, InstalledSkill> },
  (set, get) => ({
    async install(definition: SkillDefinition) {
      const owner = await initializeLocalWorkspace();
      if (!get()._hasHydrated || !isLocalWorkspaceActive())
        throw new Error("本地技能尚未就绪，请稍后重试");
      // Re-read the trusted directory; callers cannot provide arbitrary documents.
      const catalog = await loadSkillCatalog();
      const entry = catalog.find((item) => item.id === definition.id);
      if (!entry || entry.version !== definition.version)
        throw new Error("技能目录已变化，请刷新后安装");
      if (entry.kind === "client") throw new Error("此技能需要在客户端使用");
      if (
        Object.keys(get().installed).length >= 100 &&
        !get().installed[entry.id]
      )
        throw new Error("最多安装 100 个技能，请先移除不再使用的技能");
      const body =
        entry.id === documentSkill.id
          ? documentSkillBody
          : await readSkillResource(entry.documentUrl, 32000);
      await verifySkillDocument(body, entry.sha256);
      const installed = installedSkillSchema.parse({
        ...entry,
        body,
        installedAt: Date.now(),
        enabled: get().installed[entry.id]?.enabled ?? false,
      });
      if (!isLocalWorkspaceActive() || getLocalScope() !== owner)
        throw new Error("账号已变化，请刷新后重试");
      set({ installed: { ...get().installed, [installed.id]: installed } });
    },
    setEnabled(id: string, enabled: boolean) {
      const skill = get().installed[id];
      if (skill) {
        set({ installed: { ...get().installed, [id]: { ...skill, enabled } } });
      }
    },
    remove(id: string) {
      const installed = { ...get().installed };
      delete installed[id];
      set({ installed });
    },
  }),
  {
    name: StoreKey.Skills,
    version: 1,
    merge(persisted: unknown, current) {
      const result = skillCollectionSchema.safeParse(
        (persisted as { installed?: unknown } | undefined)?.installed ?? {},
      );
      return { ...current, installed: result.success ? result.data : {} };
    },
  },
);
