import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useId,
} from "react";
import styles from "./model-select.module.scss";
import clsx from "clsx";
import DownIcon from "../icons/down.svg";
import { Check, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { useAppConfig, useAccessStore } from "../store";
import {
  isAccountModelMode,
  CUSTOM_MODEL_PROVIDER,
} from "../utils/custom-provider";
import { AccountModelSource } from "./account-model-source";
import { Select, showToast } from "./ui-lib";
import Locale from "../locales";
import { Avatar } from "./emoji";
import { getModelVendorName } from "../utils/model";
import {
  getModelCapabilities,
  getModelPreferenceKey,
} from "../utils/model-capabilities";
import { useModelPreferenceStore } from "../store/model-preferences";
import type { ChatApiFormat } from "../utils/chat-api-format";
import {
  isLocalPreviewEnabled,
  isLocalPreviewModel,
} from "../utils/local-preview-models";

type ModelTag =
  | "chat"
  | "video"
  | "voice"
  | "code"
  | "image"
  | "embed"
  | "tts"
  | "asr"
  | null;

function getTagLabel(tag: ModelTag): string {
  return tag ? Locale.Settings.ModelPicker.Tags[tag] : "";
}

function getTagClassName(tag: ModelTag): string {
  switch (tag) {
    case "chat":
      return styles.chat;
    case "video":
      return styles.video;
    case "voice":
      return styles.voice;
    case "code":
      return styles.code;
    case "image":
      return styles.image;
    case "embed":
      return styles.embed;
    case "tts":
      return styles.tts;
    case "asr":
      return styles.asr;
    default:
      return "";
  }
}

export function ModelSelect(props: {
  models: Array<{
    name: string;
    displayName?: string;
    description?: string;
    provider?: { providerName?: string };
  }>;
  value: string;
  onChange: (value: string) => void;
  onGroupChange?: () => void;
  className?: string;
  embedded?: boolean;
}) {
  const { models, value, onChange, className, embedded } = props;
  const [open, setOpen] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [query, setQuery] = useState("");
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modelTypeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();
  const config = useAppConfig();
  const access = useAccessStore();
  useModelPreferenceStore((state) => state.overrides);
  const apiFormats = useModelPreferenceStore((state) => state.apiFormats);
  const modelPreferencesReady = useModelPreferenceStore(
    (state) => state._hasHydrated,
  );
  const setModelType = useModelPreferenceStore((state) => state.setModelType);
  const setModelApiFormat = useModelPreferenceStore(
    (state) => state.setModelApiFormat,
  );
  const accountMode = isAccountModelMode(access);
  const localPreviewMode =
    isLocalPreviewEnabled() &&
    models.some((model) => isLocalPreviewModel(model.provider?.providerName));
  const unavailable =
    accountMode &&
    (access.switchingToken || access.modelListStatus !== "ready");
  const favoriteModels = useMemo(
    () => config.favoriteModels ?? [],
    [config.favoriteModels],
  );

  const selectedModel = models.find(
    (m) => `${m.name}@${m.provider?.providerName}` === value,
  );

  const matchingModels = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return models;
    return models.filter((model) =>
      [
        model.name,
        model.displayName,
        model.description,
        model.provider?.providerName,
        getModelVendorName(model.name),
      ].some((text) => text?.toLocaleLowerCase().includes(search)),
    );
  }, [models, query]);

  const toggleFavorite = useCallback(
    (modelKey: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const isRemoving =
        Array.isArray(config.favoriteModels) &&
        config.favoriteModels.includes(modelKey);
      config.update((c) => {
        const favorites = c.favoriteModels || [];
        if (isRemoving) {
          c.favoriteModels = favorites.filter((f) => f !== modelKey);
        } else {
          c.favoriteModels = [...favorites, modelKey];
        }
      });
      showToast(
        isRemoving
          ? Locale.Settings.ModelPicker.Unfavorited
          : Locale.Settings.ModelPicker.Favorited,
      );
    },
    [config],
  );

  const leftGroups = useMemo(() => {
    const favCount = matchingModels.filter((model) =>
      favoriteModels.includes(`${model.name}@${model.provider?.providerName}`),
    ).length;
    const vendorMap = new Map<string, number>();

    for (const m of matchingModels) {
      const vendor =
        getModelVendorName(m.name) ?? Locale.Settings.ModelPicker.Other;
      vendorMap.set(vendor, (vendorMap.get(vendor) || 0) + 1);
    }

    const result: Array<{
      key: string;
      label: string;
      count: number;
      isFavorite?: boolean;
    }> = [];

    result.push({
      key: "all",
      label: Locale.Settings.ModelPicker.All,
      count: matchingModels.length,
    });

    if (favCount > 0) {
      result.push({
        key: "favorites",
        label: Locale.Settings.ModelPicker.Favorites,
        count: favCount,
        isFavorite: true,
      });
    }

    const sortedVendors = Array.from(vendorMap.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    for (const [vendor, count] of sortedVendors) {
      result.push({ key: vendor, label: vendor, count });
    }

    return result;
  }, [matchingModels, favoriteModels]);

  const currentGroupModels = useMemo(() => {
    if (selectedGroup === "all" || !selectedGroup) {
      return matchingModels;
    }
    if (selectedGroup === "favorites") {
      return matchingModels.filter((m) => {
        const val = `${m.name}@${m.provider?.providerName}`;
        return favoriteModels?.includes(val);
      });
    }
    return matchingModels.filter((m) => {
      const vendor =
        getModelVendorName(m.name) ?? Locale.Settings.ModelPicker.Other;
      return vendor === selectedGroup;
    });
  }, [matchingModels, selectedGroup, favoriteModels]);

  const selectableModels = currentGroupModels.filter(
    (model) =>
      !unavailable ||
      model.provider?.providerName === CUSTOM_MODEL_PROVIDER ||
      isLocalPreviewModel(model.provider?.providerName),
  );

  useEffect(() => {
    if (!leftGroups.some((group) => group.key === selectedGroup))
      setSelectedGroup("all");
  }, [leftGroups, selectedGroup]);

  useEffect(() => {
    if (open && !selectedGroup) {
      setSelectedGroup("all");
    }
  }, [open, selectedGroup]);

  useEffect(() => {
    setExpandedModel(null);
  }, [query, selectedGroup, access.switchingToken]);

  useEffect(() => {
    if (!embedded) {
      const handler = (e: PointerEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setOpen(false);
        }
      };
      document.addEventListener("pointerdown", handler);
      return () => document.removeEventListener("pointerdown", handler);
    }
  }, [embedded]);

  return (
    <div
      className={clsx(styles["model-select"], className)}
      ref={containerRef}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229
        )
          return;
        if (expandedModel) {
          event.preventDefault();
          event.stopPropagation();
          setExpandedModel(null);
          modelTypeTriggerRef.current?.focus();
        } else if (!embedded && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {!embedded && (
        <button
          type="button"
          ref={triggerRef}
          className={styles["model-select-trigger"]}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={pickerId}
        >
          <span className={styles["model-select-value"]}>
            {selectedModel
              ? `${selectedModel.displayName || selectedModel.name} (${
                  selectedModel.provider?.providerName === CUSTOM_MODEL_PROVIDER
                    ? "自定义"
                    : selectedModel.provider?.providerName
                })`
              : Locale.Settings.ModelPicker.Title}
          </span>
          <DownIcon
            className={clsx(styles["model-select-arrow"], {
              [styles.open]: open,
            })}
          />
        </button>
      )}
      {(embedded || open) && (accountMode || localPreviewMode) && (
        <AccountModelSource
          preview={localPreviewMode && !accountMode}
          onGroupChange={() => {
            setExpandedModel(null);
            props.onGroupChange?.();
          }}
        />
      )}
      {(embedded || open) && (
        <div className={styles["model-select-content"]} id={pickerId}>
          <div className={styles["model-select-dropdown"]}>
            <div className={styles["model-select-left"]}>
              <div className={styles["model-select-groups"]}>
                {leftGroups.map((group) => (
                  <button
                    type="button"
                    key={group.key}
                    className={clsx(styles["model-select-group-item"], {
                      [styles.active]: selectedGroup === group.key,
                      [styles["is-favorite"]]: group.isFavorite,
                      [styles["all-group-item"]]: group.key === "all",
                    })}
                    onClick={() => setSelectedGroup(group.key)}
                    aria-pressed={selectedGroup === group.key}
                  >
                    {group.isFavorite && (
                      <Star className={styles["favorite-icon"]} size={14} />
                    )}
                    <span className={styles["group-name"]}>{group.label}</span>
                    <span className={styles["group-count"]}>{group.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles["model-select-right"]}>
              <div className={styles["model-select-list-toolbar"]}>
                <div className={styles["model-search"]}>
                  <Search size={18} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    aria-label={Locale.Settings.ModelPicker.Search}
                    placeholder={Locale.Settings.ModelPicker.Search}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                  {query && (
                    <button
                      type="button"
                      className={styles["search-clear"]}
                      title={Locale.Settings.ModelPicker.ClearSearch}
                      aria-label={Locale.Settings.ModelPicker.ClearSearch}
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <span className={styles["model-select-result-count"]}>
                  {typeof Locale.Settings.ModelPicker.ResultCount === "function"
                    ? Locale.Settings.ModelPicker.ResultCount(
                        selectableModels.length,
                      )
                    : selectableModels.length}
                </span>
              </div>
              <div className={styles["model-select-list"]}>
                {selectableModels.length === 0 && (
                  <div className={styles["model-select-empty"]} role="status">
                    {unavailable
                      ? access.modelListStatus === "error"
                        ? Locale.Settings.ModelSource.ModelsFailed
                        : Locale.Settings.ModelSource.ModelsLoading
                      : Locale.Settings.ModelPicker.Empty}
                  </div>
                )}
                {selectableModels.map((m, index) => {
                  const val = `${m.name}@${m.provider?.providerName}`;
                  const preferenceKey = getModelPreferenceKey(
                    m.name,
                    m.provider?.providerName,
                  );
                  const isExpanded = expandedModel === preferenceKey;
                  const typePanelId = `${pickerId}-model-type-${index}`;
                  const typeSelectId = `${typePanelId}-select`;
                  const formatSelectId = `${typePanelId}-format`;
                  const isSelected = val === value;
                  const isFav =
                    Array.isArray(favoriteModels) &&
                    favoriteModels.includes(val);
                  const favoriteLabel = `${
                    isFav
                      ? Locale.Settings.ModelPicker.Unfavorite
                      : Locale.Settings.ModelPicker.Favorite
                  }: ${m.displayName || m.name}`;
                  const metadata = getModelCapabilities(
                    m.name,
                    m.provider?.providerName,
                  );
                  const modelType = metadata.override;
                  const tag = metadata.category;
                  const showApiFormat =
                    !metadata.usesImageApi && tag !== "video";
                  const apiFormat = apiFormats[preferenceKey] ?? "auto";
                  const searchModel = m.name.toLowerCase().split("/").pop();
                  const description =
                    m.description?.trim() ||
                    (searchModel === "tavily-quick" ||
                    searchModel === "tavily-deep"
                      ? Locale.Settings.ModelPicker.Descriptions[searchModel]
                      : /^agnes-(?:2\.5|2\.0)-flash$/i.test(
                          m.name.split("/").pop() ?? "",
                        )
                      ? Locale.Settings.ModelPicker.Descriptions.agnes
                      : Locale.Settings.ModelPicker.Descriptions[
                          tag ?? "custom"
                        ]);
                  return (
                    <div
                      key={val}
                      className={clsx(styles["model-select-item"], {
                        [styles.selected]: isSelected,
                      })}
                    >
                      <div className={styles["model-select-row"]}>
                        <button
                          type="button"
                          className={styles["model-select-option"]}
                          aria-pressed={isSelected}
                          aria-label={`${m.displayName || m.name}${
                            m.provider?.providerName
                              ? ` (${m.provider.providerName})`
                              : ""
                          }`}
                          onClick={() => {
                            onChange(val);
                            if (!embedded) {
                              setOpen(false);
                              triggerRef.current?.focus();
                            }
                          }}
                        >
                          <Avatar model={m.name} />
                          <span className={styles["model-select-item-info"]}>
                            <span
                              className={styles["model-select-item-heading"]}
                            >
                              <span
                                className={styles["model-select-item-name"]}
                              >
                                {m.displayName || m.name}
                              </span>
                              {m.provider?.providerName ===
                                CUSTOM_MODEL_PROVIDER && (
                                <span
                                  className={clsx(
                                    styles["model-type-tag"],
                                    styles.custom,
                                  )}
                                >
                                  自定义
                                </span>
                              )}
                              {tag && (
                                <span
                                  className={clsx(
                                    styles["model-type-tag"],
                                    getTagClassName(tag),
                                  )}
                                >
                                  {getTagLabel(tag)}
                                </span>
                              )}
                              {modelType !== "auto" && (
                                <span
                                  className={styles["model-type-manual"]}
                                  title="已手动指定模型类型"
                                >
                                  手动
                                </span>
                              )}
                            </span>
                            <span
                              className={
                                styles["model-select-item-description"]
                              }
                            >
                              {m.provider?.providerName &&
                                m.provider.providerName !==
                                  CUSTOM_MODEL_PROVIDER && (
                                  <>{m.provider.providerName} · </>
                                )}
                              {description}
                            </span>
                          </span>
                          <Check
                            size={18}
                            className={clsx(styles["model-select-check"], {
                              [styles.checked]: isSelected,
                            })}
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          className={clsx(styles["model-type-btn"], {
                            [styles["model-type-active"]]: isExpanded,
                          })}
                          aria-label={`调整模型类型: ${
                            m.displayName || m.name
                          }`}
                          aria-expanded={isExpanded}
                          aria-controls={typePanelId}
                          title={
                            !modelPreferencesReady
                              ? "正在加载模型设置"
                              : "调整模型类型与接口"
                          }
                          disabled={!modelPreferencesReady}
                          onClick={(event) => {
                            event.stopPropagation();
                            modelTypeTriggerRef.current = event.currentTarget;
                            setExpandedModel(isExpanded ? null : preferenceKey);
                          }}
                        >
                          <SlidersHorizontal size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={clsx(styles["favorite-btn"], {
                            [styles["favorite-active"]]: isFav,
                          })}
                          onClick={(e) => toggleFavorite(val, e)}
                          title={favoriteLabel}
                          aria-label={favoriteLabel}
                          aria-pressed={isFav}
                        >
                          <Star
                            size={16}
                            fill={isFav ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                      {isExpanded && (
                        <div
                          className={clsx(styles["model-type-settings"], {
                            [styles["model-type-settings-single"]]:
                              !showApiFormat,
                          })}
                          id={typePanelId}
                          role="group"
                          aria-label={`模型类型: ${m.displayName || m.name}`}
                        >
                          <div className={styles["model-setting"]}>
                            <label htmlFor={typeSelectId}>模型类型</label>
                            <Select
                              id={typeSelectId}
                              className={styles["model-type-select"]}
                              value={modelType}
                              disabled={!modelPreferencesReady}
                              autoFocus
                              onChange={(event) => {
                                const next = event.currentTarget.value as
                                  | "auto"
                                  | "chat"
                                  | "image"
                                  | "video";
                                try {
                                  setModelType(preferenceKey, next);
                                } catch {
                                  showToast("模型类型保存失败，请重试");
                                }
                              }}
                            >
                              <option value="auto">自动识别</option>
                              <option value="chat">对话</option>
                              <option value="image">生图</option>
                              <option value="video">视频</option>
                            </Select>
                          </div>
                          {showApiFormat && (
                            <div className={styles["model-setting"]}>
                              <label htmlFor={formatSelectId}>
                                {Locale.Settings.ChatApiFormat.Title}
                              </label>
                              <Select
                                id={formatSelectId}
                                className={styles["model-type-select"]}
                                title={Locale.Settings.ChatApiFormat.SubTitle}
                                value={apiFormat}
                                disabled={!modelPreferencesReady}
                                onChange={(event) => {
                                  const next = event.currentTarget.value as
                                    | ChatApiFormat
                                    | "auto";
                                  try {
                                    setModelApiFormat(preferenceKey, next);
                                  } catch {
                                    showToast("接口格式保存失败，请重试");
                                  }
                                }}
                              >
                                <option value="auto">跟随设置</option>
                                <option value="chat-completions">
                                  Chat Completions
                                </option>
                                <option value="responses">Responses</option>
                                <option value="gemini">Gemini 原生</option>
                                <option value="claude">Claude 原生</option>
                              </Select>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
