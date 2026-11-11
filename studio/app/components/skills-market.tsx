"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Info,
  Loader2,
  Palette,
  Play,
  Power,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { Path } from "../constant";
import {
  CLIENT_SKILL_SOURCES,
  loadSkillCatalog,
  type SkillDefinition,
} from "../skills/catalog";
import { useSkillStore } from "../store/skills";
import { useChatStore } from "../store/chat";
import { useAllModels } from "../utils/hooks";
import { usesCustomProvider } from "../utils/custom-provider";
import { useAccessStore } from "../store/access";
import { skillModelSelection } from "../skills/activate";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import { PageHeader } from "./page-header";
import { SelectionDialog } from "./selection-dialog";
import { Select } from "./ui-lib";
import { SkillIcon, unavailableReason, useSkillCapabilities } from "./skill-ui";
import styles from "./skills-market.module.scss";

export { SkillPicker } from "./skill-picker";

const categoryNames = {
  search: "搜索与研究",
  translation: "翻译",
  image: "图片风格",
  writing: "写作与润色",
  coding: "编程与排错",
  productivity: "思考与效率",
};

const PAGE_SIZE = 20;

function SkillPreviewImage({
  image,
}: {
  image: NonNullable<SkillDefinition["preview"]>["images"][number];
}) {
  const [failedUrl, setFailedUrl] = useState("");
  if (failedUrl === image.url) {
    return (
      <span className={styles.previewError} role="status">
        <Palette size={22} aria-hidden="true" />
        预览暂不可用
      </span>
    );
  }
  return (
    // Upstream examples are loaded directly; they are not generated user images.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt={image.caption}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(image.url)}
    />
  );
}

export function SkillsMarket() {
  const allModels = useAllModels();
  const installed = useSkillStore((state) => state.installed);
  const hydrated = useSkillStore((state) => state._hasHydrated);
  const install = useSkillStore((state) => state.install);
  const remove = useSkillStore((state) => state.remove);
  const session = useChatStore((state) => state.currentSession());
  const chatHydrated = useChatStore((state) => state._hasHydrated);
  const capabilities = useSkillCapabilities();
  const [catalog, setCatalog] = useState<SkillDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<"all" | "installed" | "resources">("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detailSkill, setDetailSkill] = useState<SkillDefinition>();
  const [expandedPreviewId, setExpandedPreviewId] = useState<string>();
  const [preview, setPreview] = useState<{
    skill: SkillDefinition;
    index: number;
  }>();
  const content = useRef<HTMLDivElement>(null);
  const detailPanel = useRef<HTMLElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const activePage = useRef(true);

  const closeDetails = useCallback((restoreFocus = true) => {
    setDetailSkill(undefined);
    if (restoreFocus) detailTrigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!detailSkill) return;
    detailPanel.current?.querySelector("button")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeDetails();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !detailPanel.current?.contains(target) &&
        !detailTrigger.current?.contains(target)
      ) {
        closeDetails(false);
      }
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [detailSkill, closeDetails]);

  useEffect(() => {
    activePage.current = true;
    return () => {
      activePage.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadSkillCatalog()
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch(() => {
        if (active) setError("技能目录加载失败，已安装的技能仍可使用。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const catalogSkills = useMemo(() => {
    const entries = new Map<string, SkillDefinition>(
      catalog.map((skill) => [skill.id, skill]),
    );
    Object.values(installed).forEach((skill) => {
      if (!entries.has(skill.id)) entries.set(skill.id, skill);
    });
    return [...entries.values()].filter((skill) => skill.kind !== "web");
  }, [installed, catalog]);

  const skillNumbers = useMemo(
    () => new Map(catalogSkills.map((skill, index) => [skill.id, index + 1])),
    [catalogSkills],
  );

  const skills = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const numberQuery = needle.replace(/^#/, "");
    return catalogSkills.filter(
      (skill) =>
        (tab !== "installed" || !!installed[skill.id]) &&
        (category === "all" || skill.category === category) &&
        (!needle ||
          (/^\d+$/.test(numberQuery) &&
            skillNumbers.get(skill.id) === Number(numberQuery)) ||
          `${skill.name} ${skill.description}`
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [installed, catalogSkills, skillNumbers, tab, category, query]);

  const pageCount = Math.max(1, Math.ceil(skills.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleSkills = skills.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const scopeHasSkills =
    tab === "installed"
      ? catalogSkills.some((skill) => !!installed[skill.id])
      : catalogSkills.length > 0;
  const filteredEmpty =
    scopeHasSkills && (!!query.trim() || category !== "all");

  function changePage(next: number) {
    setPage(next);
    setExpandedPreviewId(undefined);
    if (content.current) content.current.scrollTop = 0;
  }

  function clearFilters() {
    setQuery("");
    setCategory("all");
    changePage(1);
  }

  async function installSkill(skill: SkillDefinition) {
    setBusyId(skill.id);
    setActionError("");
    try {
      await install(skill);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "下载失败，请检查网络后重试。",
      );
    } finally {
      setBusyId("");
    }
  }

  async function enableSkill(skill: SkillDefinition) {
    setActionError("");
    if (installed[skill.id]?.enabled) {
      useSkillStore.getState().setEnabled(skill.id, false);
      const chat = useChatStore.getState();
      chat.sessions
        .filter((entry) => entry.activeSkillId === skill.id)
        .forEach((entry) =>
          chat.updateTargetSession(entry, (target) => {
            target.activeSkillId = undefined;
          }),
        );
      return;
    }
    setBusyId(skill.id);
    try {
      const owner = getLocalScope();
      const targetId = session.id;
      if (!installed[skill.id]) await install(skill);
      if (!activePage.current) return;
      if (!isLocalWorkspaceActive() || getLocalScope() !== owner)
        throw new Error("账号已变化，请刷新后重试");
      const chat = useChatStore.getState();
      const target = chat.sessions.find((entry) => entry.id === targetId);
      if (!target) throw new Error("该对话已删除，请返回聊天后重试");
      if (chat.currentSession().id !== targetId) return;
      const access = useAccessStore.getState();
      const selection = skillModelSelection(
        useSkillStore.getState().installed[skill.id],
        target.mask.modelConfig,
        allModels.flatMap((model) =>
          model.provider &&
          usesCustomProvider(access, model.provider.providerName) ===
            usesCustomProvider(access, target.mask.modelConfig.providerName)
            ? [{ ...model, provider: model.provider }]
            : [],
        ),
        usesCustomProvider(access, target.mask.modelConfig.providerName) &&
          access.customApiMode !== "auto",
      );
      useSkillStore.getState().setEnabled(skill.id, true);
      chat.updateTargetSession(target, (entry) => {
        entry.activeSkillId = skill.id;
        if (selection) {
          entry.mask = {
            ...entry.mask,
            syncGlobalConfig: false,
            modelConfig: { ...entry.mask.modelConfig, ...selection },
          };
        }
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "启用失败，请重试");
    } finally {
      setBusyId("");
    }
  }

  function removeSkill(id: string) {
    const chat = useChatStore.getState();
    chat.sessions
      .filter((session) => session.activeSkillId === id)
      .forEach((session) =>
        chat.updateTargetSession(session, (target) => {
          target.activeSkillId = undefined;
        }),
      );
    remove(id);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="技能广场"
        icon={<Sparkles size={19} aria-hidden="true" />}
      />
      <div className={styles.content} ref={content}>
        <div className={styles.controls}>
          <div className={styles.toolbar}>
            <div className={styles.tabs} role="group" aria-label="技能范围">
              <button
                type="button"
                aria-pressed={tab === "all"}
                onClick={() => {
                  setTab("all");
                  changePage(1);
                }}
              >
                全部技能
              </button>
              <button
                type="button"
                aria-pressed={tab === "installed"}
                onClick={() => {
                  setTab("installed");
                  changePage(1);
                }}
              >
                我的技能
                <span>
                  {hydrated
                    ? catalogSkills.filter((skill) => !!installed[skill.id])
                        .length
                    : "—"}
                </span>
              </button>
              <button
                type="button"
                aria-pressed={tab === "resources"}
                onClick={() => {
                  setTab("resources");
                  changePage(1);
                }}
              >
                客户端仓库
              </button>
            </div>
            <button
              className={styles.iconButton}
              type="button"
              title="刷新技能目录"
              aria-label="刷新技能目录"
              disabled={loading}
              onClick={() => setRevision((value) => value + 1)}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>

          {tab !== "resources" && (
            <div className={styles.filters}>
              <label className={styles.search}>
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="搜索技能"
                  placeholder="搜索技能名称或序号"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    changePage(1);
                  }}
                />
              </label>
              <Select
                aria-label="技能分类"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  changePage(1);
                }}
              >
                <option value="all">全部分类</option>
                {Object.entries(categoryNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {error && tab !== "resources" && (
          <div className={styles.notice} role="alert">
            {error}
            <button
              type="button"
              disabled={loading}
              onClick={() => setRevision((value) => value + 1)}
            >
              重试
            </button>
          </div>
        )}
        {actionError && (
          <div className={styles.notice} role="alert">
            {actionError}
          </div>
        )}
        {tab !== "resources" && (
          <>
            <div
              className={styles.skillList}
              aria-busy={!hydrated || (tab !== "installed" && loading)}
            >
              {(!hydrated ||
                (tab !== "installed" && loading && !skills.length)) && (
                <div className={styles.empty} role="status">
                  <Loader2
                    size={20}
                    className={styles.spinner}
                    aria-hidden="true"
                  />
                  正在加载技能
                </div>
              )}
              {hydrated &&
                visibleSkills.map((skill) => {
                  const local = installed[skill.id];
                  const update =
                    !!local &&
                    (local.version !== skill.version ||
                      local.documentUrl !== skill.documentUrl ||
                      local.sha256 !== skill.sha256);
                  const reason = unavailableReason(skill, capabilities);
                  const clientOnly = skill.kind === "client";
                  const busy = busyId === skill.id;
                  const active = !!local && session.activeSkillId === skill.id;
                  const enabled = !!local?.enabled;
                  const stylePreview =
                    skill.kind === "image-style" ? skill.preview : undefined;
                  const expanded = expandedPreviewId === skill.id;
                  return (
                    <article className={styles.skill} key={skill.id}>
                      <div className={styles.skillIdentity}>
                        <span className={styles.skillIcon}>
                          <SkillIcon
                            kind={skill.kind}
                            category={skill.category}
                          />
                        </span>
                        <div className={styles.skillTitle}>
                          <div className={styles.skillTitleLine}>
                            <span
                              className={styles.skillNumber}
                              aria-hidden="true"
                            >
                              {String(skillNumbers.get(skill.id)).padStart(
                                2,
                                "0",
                              )}
                            </span>
                            <h2>
                              {stylePreview ? (
                                <button
                                  className={styles.previewToggle}
                                  type="button"
                                  aria-expanded={expanded}
                                  aria-controls={`skill-preview-${skill.id}`}
                                  title={
                                    expanded ? "收起风格示例" : "展开风格示例"
                                  }
                                  onClick={() =>
                                    setExpandedPreviewId(
                                      expanded ? undefined : skill.id,
                                    )
                                  }
                                >
                                  <span>{skill.name}</span>
                                  <ChevronDown size={14} aria-hidden="true" />
                                </button>
                              ) : (
                                skill.name
                              )}
                            </h2>
                          </div>
                          <div className={styles.skillMeta}>
                            <span className={styles.platform}>
                              {clientOnly
                                ? "客户端"
                                : categoryNames[skill.category]}
                            </span>
                            {local && (
                              <span className={styles.installed}>
                                {active
                                  ? "当前对话已启用"
                                  : update
                                  ? "可更新"
                                  : enabled
                                  ? "已启用"
                                  : "已添加"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className={styles.skillBody}>
                        <p>{skill.description}</p>
                        {reason && (
                          <div className={styles.requirement}>{reason}</div>
                        )}
                      </div>
                      <div className={styles.actions}>
                        {clientOnly ? (
                          <a
                            className={styles.action}
                            href={skill.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink size={14} aria-hidden="true" />
                            查看
                          </a>
                        ) : (
                          <>
                            <button
                              className={`${styles.action} ${styles.primary}`}
                              type="button"
                              disabled={
                                !hydrated ||
                                !chatHydrated ||
                                !!busyId ||
                                (!!reason && !enabled)
                              }
                              title={
                                enabled ? "停用技能" : reason || "启用技能"
                              }
                              onClick={() => void enableSkill(skill)}
                            >
                              {busy ? (
                                <Loader2
                                  size={14}
                                  className={styles.spinner}
                                  aria-hidden="true"
                                />
                              ) : enabled ? (
                                <Power size={14} aria-hidden="true" />
                              ) : (
                                <Play size={14} aria-hidden="true" />
                              )}
                              {busy ? "准备中" : enabled ? "停用" : "启用"}
                            </button>
                          </>
                        )}
                        <button
                          className={styles.iconButton}
                          type="button"
                          title={`查看${skill.name}详情`}
                          aria-label={`查看${skill.name}详情`}
                          aria-expanded={detailSkill?.id === skill.id}
                          aria-controls="skill-detail-panel"
                          onClick={(event) => {
                            detailTrigger.current = event.currentTarget;
                            setDetailSkill(skill);
                          }}
                        >
                          <Info size={16} aria-hidden="true" />
                        </button>
                      </div>
                      {stylePreview && expanded && (
                        <div
                          className={styles.previewExpansion}
                          id={`skill-preview-${skill.id}`}
                          role="region"
                          aria-label={`${skill.name}风格示例`}
                        >
                          <div className={styles.previewGalleryClip}>
                            <div className={styles.previewGallery}>
                              {stylePreview.images.map((image, index) => (
                                <div
                                  className={styles.previewSample}
                                  key={image.url}
                                >
                                  <button
                                    type="button"
                                    className={styles.thumbnail}
                                    aria-label={
                                      index === 0
                                        ? `预览${skill.name}风格`
                                        : `预览${skill.name}风格：${image.caption}`
                                    }
                                    title={`放大查看：${image.caption}`}
                                    onClick={() => setPreview({ skill, index })}
                                  >
                                    <SkillPreviewImage image={image} />
                                    <span className={styles.zoomHint}>
                                      <ZoomIn size={14} aria-hidden="true" />
                                    </span>
                                  </button>
                                  <span className={styles.sampleCaption}>
                                    {image.caption}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              {hydrated &&
                (tab === "installed" || !loading) &&
                skills.length === 0 &&
                (!error || tab === "installed" || filteredEmpty) && (
                  <div className={styles.empty}>
                    <Sparkles size={22} aria-hidden="true" />
                    {filteredEmpty
                      ? "没有找到匹配的技能"
                      : tab === "installed"
                      ? "还没有添加技能"
                      : "暂无可用技能"}
                    {filteredEmpty ? (
                      <button type="button" onClick={clearFilters}>
                        清除筛选
                      </button>
                    ) : tab === "installed" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTab("all");
                          clearFilters();
                        }}
                      >
                        浏览全部技能
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevision((value) => value + 1)}
                      >
                        重新加载
                      </button>
                    )}
                  </div>
                )}
            </div>
            {hydrated && skills.length > 0 && (
              <div className={styles.listFooter}>
                <span role="status">共 {skills.length} 个技能</span>
                {pageCount > 1 && (
                  <nav className={styles.pagination} aria-label="技能分页">
                    <button
                      className={styles.iconButton}
                      type="button"
                      aria-label="上一页"
                      title="上一页"
                      disabled={currentPage === 1}
                      onClick={() => changePage(currentPage - 1)}
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <span>
                      {currentPage} / {pageCount}
                    </span>
                    <button
                      className={styles.iconButton}
                      type="button"
                      aria-label="下一页"
                      title="下一页"
                      disabled={currentPage === pageCount}
                      onClick={() => changePage(currentPage + 1)}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </nav>
                )}
              </div>
            )}
          </>
        )}

        {tab === "resources" && (
          <section className={styles.resources} aria-labelledby="client-skills">
            <h2 id="client-skills">客户端技能仓库</h2>
            <p>这些技能可能需要终端、文件系统或额外工具。</p>
            {CLIENT_SKILL_SOURCES.map((source) => (
              <div className={styles.resource} key={source.url}>
                <div>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.name}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                  <p>{source.description}</p>
                </div>
                <a
                  className={styles.iconButton}
                  href={source.downloadUrl}
                  title={`下载${source.name}`}
                  aria-label={`下载${source.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ArrowDownToLine size={16} aria-hidden="true" />
                </a>
              </div>
            ))}
          </section>
        )}
      </div>
      {preview?.skill.preview && (
        <SelectionDialog
          title={`${preview.skill.name}风格预览`}
          onClose={() => setPreview(undefined)}
        >
          <div className={styles.previewContent}>
            <div className={styles.previewStage}>
              <SkillPreviewImage
                image={preview.skill.preview.images[preview.index]}
              />
            </div>
            <div className={styles.previewCaption}>
              <span>{preview.skill.preview.images[preview.index].caption}</span>
              {preview.skill.preview.images.length > 1 && (
                <nav aria-label="风格示例切换" className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="上一张示例"
                    title="上一张示例"
                    disabled={preview.index === 0}
                    onClick={() =>
                      setPreview({ ...preview, index: preview.index - 1 })
                    }
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </button>
                  <span>
                    {preview.index + 1} / {preview.skill.preview.images.length}
                  </span>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="下一张示例"
                    title="下一张示例"
                    disabled={
                      preview.index === preview.skill.preview.images.length - 1
                    }
                    onClick={() =>
                      setPreview({ ...preview, index: preview.index + 1 })
                    }
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </nav>
              )}
            </div>
            <p className={styles.previewDisclaimer}>
              风格示例，实际效果随模型和输入内容变化。
            </p>
            <div className={styles.previewCredit}>
              <a
                href={preview.skill.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                来源：{preview.skill.preview.credit}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              <a
                href={preview.skill.preview.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {preview.skill.preview.license}
              </a>
            </div>
          </div>
        </SelectionDialog>
      )}
      {detailSkill && (
        <aside
          ref={detailPanel}
          id="skill-detail-panel"
          className={styles.detailPanel}
          aria-label={`${detailSkill.name}详情`}
        >
          <div className={styles.detailHeader}>
            <h2>{detailSkill.name}</h2>
            <button
              className={styles.iconButton}
              type="button"
              aria-label="关闭技能详情"
              title="关闭技能详情"
              onClick={() => closeDetails()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <p>{detailSkill.description}</p>
          <dl className={styles.detailMetadata}>
            <dt>适用环境</dt>
            <dd>{detailSkill.kind === "client" ? "本地客户端" : "网页可用"}</dd>
            <dt>分类</dt>
            <dd>{categoryNames[detailSkill.category]}</dd>
            <dt>版本</dt>
            <dd>{detailSkill.version}</dd>
            <dt>许可</dt>
            <dd>{detailSkill.license}</dd>
          </dl>
          <a
            className={styles.sourceLink}
            href={detailSkill.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            查看原始来源 <ExternalLink size={14} aria-hidden="true" />
          </a>
          {installed[detailSkill.id] && (
            <div className={styles.detailActions}>
              {(installed[detailSkill.id].version !== detailSkill.version ||
                installed[detailSkill.id].sha256 !== detailSkill.sha256 ||
                installed[detailSkill.id].documentUrl !==
                  detailSkill.documentUrl) && (
                <button
                  className={styles.action}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => void installSkill(detailSkill)}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  更新技能
                </button>
              )}
              <button
                className={styles.action}
                type="button"
                disabled={!!busyId}
                onClick={() => {
                  removeSkill(detailSkill.id);
                  closeDetails();
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                移除本地技能
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

export default SkillsMarket;
