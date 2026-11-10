import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import styles from "./settings.module.scss";
import { AppBrand } from "./app-brand";
import { LocalDataPanel } from "./local-data-panel";
import { CustomProviderSettings } from "./custom-provider-settings";
import { SettingsSelect } from "./settings-select";
import { SpeechSettings } from "./speech-settings";

import ResetIcon from "../icons/reload.svg";
import AddIcon from "../icons/add.svg";
import CopyIcon from "../icons/copy.svg";
import ClearIcon from "../icons/clear.svg";
import LoadingIcon from "../icons/three-dots.svg";

import {
  ChevronLeft,
  ChevronRight,
  Database,
  SlidersHorizontal,
  Sparkles,
  SquarePen as EditIcon,
  X,
} from "lucide-react";
import EyeIcon from "../icons/eye.svg";
import { Input, List, ListItem, Modal, Popover, showConfirm } from "./ui-lib";
import { ModelConfigList } from "./model-config";

import {
  SubmitKey,
  useChatStore,
  Theme,
  COLOR_THEMES,
  type ColorTheme,
  useUpdateStore,
  useAccessStore,
  useAppConfig,
} from "../store";

import Locale, {
  AllLangs,
  ALL_LANG_OPTIONS,
  changeLang,
  getLang,
} from "../locales";
import {
  copyToClipboard,
  clientUpdate,
  semverCompare,
  useMobileScreen,
} from "../utils";
import Link from "next/link";
import { Path, RELEASE_URL, SlotID, UPDATE_URL } from "../constant";
import {
  loadBuiltinPrompts,
  Prompt,
  SearchService,
  usePromptStore,
} from "../store/prompt";
import { ErrorBoundary } from "./error";
import { InputRange } from "./input-range";
import { useNavigate, useLocation } from "react-router-dom";
import { Avatar, AvatarPicker } from "./emoji";
import { getClientConfig } from "../config/client";
import { nanoid } from "nanoid";
import { Checkbox, FieldButton, TextField } from "./form-controls";
import { getMotionPreference } from "../utils/motion";

function EditPromptModal(props: { id: string; onClose: () => void }) {
  const promptStore = usePromptStore();
  const prompt = promptStore.get(props.id);

  return prompt
    ? createPortal(
        <div className="modal-mask">
          <Modal
            title={Locale.Settings.Prompt.EditModal.Title}
            onClose={props.onClose}
            actions={[
              <FieldButton
                key=""
                onClick={props.onClose}
                text={Locale.UI.Confirm}
                bordered
              />,
            ]}
          >
            <div className={styles["edit-prompt-modal"]}>
              <TextField
                fullWidth
                aria-label={Locale.Settings.Prompt.EditModal.Title}
                type="text"
                value={prompt.title}
                readOnly={!prompt.isUser}
                className={styles["edit-prompt-title"]}
                onInput={(e) =>
                  promptStore.updatePrompt(
                    props.id,
                    (prompt) => (prompt.title = e.currentTarget.value),
                  )
                }
              ></TextField>
              <Input
                aria-label={`${Locale.Chat.InputActions.Prompt}: ${prompt.title}`}
                value={prompt.content}
                readOnly={!prompt.isUser}
                className={styles["edit-prompt-content"]}
                rows={10}
                onInput={(e) =>
                  promptStore.updatePrompt(
                    props.id,
                    (prompt) => (prompt.content = e.currentTarget.value),
                  )
                }
              ></Input>
            </div>
          </Modal>
        </div>,
        document.body,
      )
    : null;
}

function UserPromptModal(props: { onClose?: () => void }) {
  const promptStore = usePromptStore();
  const userPrompts = promptStore.getUserPrompts();
  const builtinPrompts = SearchService.builtinPrompts;
  const allPrompts = userPrompts.concat(builtinPrompts);
  const [searchInput, setSearchInput] = useState("");
  const [searchPrompts, setSearchPrompts] = useState<Prompt[]>([]);
  const prompts = searchInput.length > 0 ? searchPrompts : allPrompts;

  const [editingPromptId, setEditingPromptId] = useState<string>();

  useEffect(() => {
    if (searchInput.length > 0) {
      const searchResult = usePromptStore.getState().search(searchInput);
      setSearchPrompts(searchResult);
    } else {
      setSearchPrompts([]);
    }
  }, [searchInput, promptStore.prompts, promptStore.counter]);

  return createPortal(
    <div className="modal-mask">
      <Modal
        title={Locale.Settings.Prompt.Modal.Title}
        onClose={() => props.onClose?.()}
        actions={[
          <FieldButton
            key="add"
            onClick={() => {
              const promptId = promptStore.add({
                id: nanoid(),
                createdAt: Date.now(),
                title: Locale.Settings.Prompt.Modal.DefaultTitle,
                content: Locale.Settings.Prompt.Modal.DefaultContent,
              });
              setEditingPromptId(promptId);
            }}
            icon={<AddIcon />}
            bordered
            text={Locale.Settings.Prompt.Modal.Add}
          />,
        ]}
      >
        <div className={styles["user-prompt-modal"]}>
          <TextField
            fullWidth
            aria-label={Locale.Settings.Prompt.Modal.Search}
            type="text"
            className={styles["user-prompt-search"]}
            placeholder={Locale.Settings.Prompt.Modal.Search}
            value={searchInput}
            onInput={(e) => setSearchInput(e.currentTarget.value)}
          ></TextField>

          <div className={styles["user-prompt-list"]}>
            {prompts.map((v, _) => (
              <div className={styles["user-prompt-item"]} key={v.id ?? v.title}>
                <div className={styles["user-prompt-header"]}>
                  <div className={styles["user-prompt-title"]}>{v.title}</div>
                  <div className={styles["user-prompt-content"] + " one-line"}>
                    {v.content}
                  </div>
                </div>

                <div className={styles["user-prompt-buttons"]}>
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Settings.Prompt.Enable(v.title)}
                    title={Locale.Settings.Prompt.Enable(v.title)}
                    checked={!!promptStore.enabledPromptIds[v.id]}
                    onChange={(event) =>
                      promptStore.setEnabled(v.id, event.currentTarget.checked)
                    }
                  />
                  {v.isUser && (
                    <FieldButton
                      icon={<ClearIcon />}
                      aria={`${Locale.Chat.Actions.Delete} ${v.title}`}
                      title={`${Locale.Chat.Actions.Delete} ${v.title}`}
                      className={styles["user-prompt-button"]}
                      onClick={() => promptStore.remove(v.id!)}
                    />
                  )}
                  {v.isUser ? (
                    <FieldButton
                      icon={<EditIcon size={16} strokeWidth={1.8} />}
                      aria={`${Locale.Settings.Prompt.Edit} ${v.title}`}
                      title={`${Locale.Settings.Prompt.Edit} ${v.title}`}
                      className={styles["user-prompt-button"]}
                      onClick={() => setEditingPromptId(v.id)}
                    />
                  ) : (
                    <FieldButton
                      icon={<EyeIcon />}
                      aria={`${Locale.Mask.Item.View} ${v.title}`}
                      title={`${Locale.Mask.Item.View} ${v.title}`}
                      className={styles["user-prompt-button"]}
                      onClick={() => setEditingPromptId(v.id)}
                    />
                  )}
                  <FieldButton
                    icon={<CopyIcon />}
                    aria={`${Locale.Chat.Actions.Copy} ${v.title}`}
                    title={`${Locale.Chat.Actions.Copy} ${v.title}`}
                    className={styles["user-prompt-button"]}
                    onClick={() => copyToClipboard(v.content)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {editingPromptId !== undefined && (
        <EditPromptModal
          id={editingPromptId!}
          onClose={() => setEditingPromptId(undefined)}
        />
      )}
    </div>,
    document.body,
  );
}

function DangerItems() {
  const chatStore = useChatStore();
  const appConfig = useAppConfig();

  return (
    <List>
      <ListItem
        title={Locale.Settings.Danger.Reset.Title}
        subTitle={Locale.Settings.Danger.Reset.SubTitle}
      >
        <FieldButton
          aria={Locale.Settings.Danger.Reset.Title}
          text={Locale.Settings.Danger.Reset.Action}
          onClick={async () => {
            if (await showConfirm(Locale.Settings.Danger.Reset.Confirm)) {
              appConfig.reset();
            }
          }}
          type="danger"
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.Danger.Clear.Title}
        subTitle={Locale.Settings.Danger.Clear.SubTitle}
      >
        <FieldButton
          aria={Locale.Settings.Danger.Clear.Title}
          text={Locale.Settings.Danger.Clear.Action}
          onClick={async () => {
            if (await showConfirm(Locale.Settings.Danger.Clear.Confirm)) {
              chatStore.clearAllData();
            }
          }}
          type="danger"
        />
      </ListItem>
    </List>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();
  const sections = [
    {
      id: "general",
      label: Locale.Settings.General,
      icon: SlidersHorizontal,
    },
    {
      id: "model",
      label: Locale.Settings.Sections.ModelGeneration,
      icon: Sparkles,
    },
    {
      id: "data",
      label: Locale.Settings.Sections.DataBackup,
      icon: Database,
    },
  ] as const;
  const [activeSection, setActiveSection] =
    useState<(typeof sections)[number]["id"]>("general");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const avatarButtonRef = useRef<HTMLButtonElement>(null);
  const focusDestination = useRef<"title" | "category" | null>(null);
  const activeLabel = sections.find(
    (section) => section.id === activeSection,
  )!.label;

  const selectSection = (section: typeof activeSection) => {
    setActiveSection(section);
    setMobileDetailOpen(true);
    if (settingsRef.current) settingsRef.current.scrollTop = 0;
    if (isMobileScreen) focusDestination.current = "title";
  };
  const showCategories = () => {
    focusDestination.current = "category";
    setShowEmojiPicker(false);
    setMobileDetailOpen(false);
  };

  useEffect(() => {
    if (!isMobileScreen) {
      focusDestination.current = null;
      return;
    }
    if (focusDestination.current === "title") {
      titleRef.current?.focus({ preventScroll: true });
    } else if (focusDestination.current === "category") {
      document
        .getElementById(`settings-tab-${activeSection}`)
        ?.focus({ preventScroll: true });
    }
    focusDestination.current = null;
  }, [isMobileScreen, mobileDetailOpen, activeSection]);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorThemePicker, setShowColorThemePicker] = useState(false);
  const config = useAppConfig();
  const updateConfig = config.update;

  const updateStore = useUpdateStore();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const currentVersion = updateStore.formatVersion(updateStore.version);
  const remoteId = updateStore.formatVersion(updateStore.remoteVersion);
  const hasNewVersion = semverCompare(currentVersion, remoteId) === -1;
  const updateUrl = getClientConfig()?.isApp ? RELEASE_URL : UPDATE_URL;

  function checkUpdate(force = false) {
    setCheckingUpdate(true);
    updateStore.getLatestVersion(force).then(() => {
      setCheckingUpdate(false);
    });
  }

  const accessStore = useAccessStore();

  const promptStore = usePromptStore();
  const builtinCount = SearchService.count.builtin;
  const customCount = promptStore.getUserPrompts().length ?? 0;
  const [shouldShowPromptModal, setShowPromptModal] = useState(false);
  useEffect(() => {
    void loadBuiltinPrompts();
  }, []);
  const location = useLocation();
  useEffect(() => {
    if (!location.state?.managePrompts) return;
    setActiveSection("general");
    setMobileDetailOpen(true);
    setShowPromptModal(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    checkUpdate();
    if (clientConfig?.isApp) {
      accessStore.update((state) => {
        state.useCustomConfig = true;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const keydownEvent = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !e.isComposing &&
        e.keyCode !== 229 &&
        !document.querySelector("[data-modal-dialog], dialog[open]")
      ) {
        if (showEmojiPicker) {
          setShowEmojiPicker(false);
          avatarButtonRef.current?.focus({ preventScroll: true });
        } else if (isMobileScreen && mobileDetailOpen) {
          showCategories();
        } else {
          navigate(Path.Chat);
        }
      }
    };
    document.addEventListener("keydown", keydownEvent);
    return () => {
      document.removeEventListener("keydown", keydownEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobileScreen, mobileDetailOpen, showEmojiPicker, navigate]);

  const clientConfig = useMemo(() => getClientConfig(), []);
  // accessCode（验证密码）已移除，仅保留 ACCESS_PASSWORD 服务端认证

  return (
    <ErrorBoundary>
      <div
        className={styles["settings-workspace"]}
        data-detail-open={mobileDetailOpen}
      >
        <aside
          className={styles["settings-sidebar"]}
          hidden={isMobileScreen && mobileDetailOpen}
          aria-label={Locale.Settings.Title}
        >
          <AppBrand className={styles["settings-brand"]} />
          <button
            type="button"
            className={styles["settings-return"]}
            onClick={() => navigate(Path.Chat)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            <span>{Locale.Settings.BackToChat}</span>
          </button>
          <h2 className={styles["settings-sidebar-title"]}>
            {Locale.Settings.Title}
          </h2>
          <nav className={styles["settings-navigation"]}>
            <div
              role="tablist"
              aria-label={Locale.Settings.Sections.Navigation}
              aria-orientation="vertical"
              className={styles["settings-tabs"]}
            >
              {sections.map((section, index) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    id={`settings-tab-${section.id}`}
                    aria-controls={`settings-panel-${section.id}`}
                    aria-selected={activeSection === section.id}
                    tabIndex={activeSection === section.id ? 0 : -1}
                    onClick={() => selectSection(section.id)}
                    onKeyDown={(event) => {
                      let nextIndex: number;
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowRight"
                      ) {
                        nextIndex = (index + 1) % sections.length;
                      } else if (
                        event.key === "ArrowUp" ||
                        event.key === "ArrowLeft"
                      ) {
                        nextIndex =
                          (index + sections.length - 1) % sections.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = sections.length - 1;
                      } else {
                        return;
                      }
                      event.preventDefault();
                      const nextSection = sections[nextIndex];
                      if (isMobileScreen) {
                        setActiveSection(nextSection.id);
                      } else {
                        selectSection(nextSection.id);
                      }
                      document
                        .getElementById(`settings-tab-${nextSection.id}`)
                        ?.focus();
                    }}
                  >
                    <Icon
                      size={16}
                      strokeWidth={1.8}
                      className={styles["settings-category-icon"]}
                      aria-hidden="true"
                    />
                    <span>{section.label}</span>
                    <ChevronRight
                      size={16}
                      className={styles["settings-category-chevron"]}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>
        <div
          className={styles["settings-main"]}
          hidden={isMobileScreen && !mobileDetailOpen}
        >
          <header className={styles["settings-header"]} data-tauri-drag-region>
            <div className={styles["settings-header-inner"]}>
              <button
                type="button"
                className={styles["settings-mobile-back"]}
                aria-label={Locale.Settings.Sections.Navigation}
                onClick={showCategories}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span>{Locale.Settings.Title}</span>
              </button>
              <h1
                ref={titleRef}
                className={styles["settings-title"]}
                tabIndex={-1}
              >
                {activeLabel}
              </h1>
              <button
                type="button"
                className={styles["settings-close"]}
                aria-label={Locale.UI.Close}
                title={Locale.UI.Close}
                onClick={() => navigate(Path.Chat)}
              >
                <X size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </header>
          <div ref={settingsRef} className={styles["settings"]}>
            <div
              role="tabpanel"
              id="settings-panel-general"
              aria-labelledby="settings-tab-general"
              className={styles["settings-panel"]}
              hidden={activeSection !== "general"}
              tabIndex={0}
            >
              <div className={styles["settings-section"]}>
                <h2 className={styles["settings-section-title"]}>
                  {Locale.Settings.Sections.Appearance}
                </h2>
              </div>
              <List>
                <ListItem title={Locale.Settings.Avatar}>
                  <Popover
                    onClose={() => setShowEmojiPicker(false)}
                    content={
                      <AvatarPicker
                        onEmojiClick={(avatar: string) => {
                          updateConfig((config) => (config.avatar = avatar));
                          setShowEmojiPicker(false);
                        }}
                      />
                    }
                    open={showEmojiPicker}
                  >
                    <button
                      ref={avatarButtonRef}
                      type="button"
                      aria-label={Locale.Settings.Avatar}
                      aria-expanded={showEmojiPicker}
                      className={styles.avatar}
                      onClick={() => {
                        setShowEmojiPicker(!showEmojiPicker);
                      }}
                    >
                      <Avatar avatar={config.avatar} />
                    </button>
                  </Popover>
                </ListItem>

                <ListItem title={Locale.Settings.Theme}>
                  <SettingsSelect
                    title={Locale.Settings.Theme}
                    presentation="segmented"
                    value={config.theme}
                    options={Object.values(Theme).map((value) => ({
                      value,
                      label: Locale.Chat.InputActions.Theme[value],
                    }))}
                    onChange={(value) => {
                      updateConfig((config) => (config.theme = value as Theme));
                    }}
                  />
                </ListItem>

                <ListItem title={Locale.Settings.ColorTheme}>
                  <FieldButton
                    className={styles["settings-color-control"]}
                    aria={Locale.Settings.ColorTheme}
                    onClick={() => setShowColorThemePicker(true)}
                    text={Locale.Settings.ColorThemeNames[config.colorTheme]}
                    icon={
                      <span className={styles["color-theme-current-dot"]} />
                    }
                  />
                </ListItem>

                <ListItem title={Locale.Settings.Motion}>
                  <SettingsSelect
                    title={Locale.Settings.Motion}
                    presentation="segmented"
                    value={getMotionPreference(config)}
                    options={[
                      { value: "system", label: Locale.Settings.MotionSystem },
                      { value: "full", label: Locale.Settings.MotionFull },
                      {
                        value: "reduced",
                        label: Locale.Settings.MotionReduced,
                      },
                    ]}
                    onChange={(value) => {
                      const preference = getMotionPreference({
                        motionPreference: value,
                      });
                      updateConfig((config) => {
                        config.motionPreference = preference;
                        config.reduceMotion = preference === "reduced";
                      });
                    }}
                  />
                </ListItem>

                <ListItem title={Locale.Settings.ShowGridBackground}>
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Settings.ShowGridBackground}
                    checked={config.showGridBackground}
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.showGridBackground = e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>
              </List>

              <div className={styles["settings-section"]}>
                <h2 className={styles["settings-section-title"]}>
                  {Locale.Settings.Sections.InputReading}
                </h2>
              </div>
              <List>
                <ListItem title={Locale.Settings.SendKey}>
                  <SettingsSelect
                    title={Locale.Settings.SendKey}
                    value={config.submitKey}
                    options={Object.values(SubmitKey).map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={(value) => {
                      updateConfig(
                        (config) => (config.submitKey = value as SubmitKey),
                      );
                    }}
                  />
                </ListItem>

                <ListItem title={Locale.Settings.Lang.Name}>
                  <SettingsSelect
                    title={Locale.Settings.Lang.Name}
                    presentation="select"
                    value={getLang()}
                    options={AllLangs.map((value) => ({
                      value,
                      label: ALL_LANG_OPTIONS[value],
                    }))}
                    onChange={(value) => {
                      changeLang(value as (typeof AllLangs)[number]);
                    }}
                  />
                </ListItem>

                <ListItem
                  title={Locale.Settings.FontSize.Title}
                  subTitle={Locale.Settings.FontSize.SubTitle}
                >
                  <InputRange
                    aria={Locale.Settings.FontSize.Title}
                    title={`${config.fontSize ?? 14}px`}
                    value={config.fontSize}
                    min="12"
                    max="40"
                    step="1"
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.fontSize = Number.parseInt(
                            e.currentTarget.value,
                          )),
                      )
                    }
                  ></InputRange>
                </ListItem>

                <ListItem
                  title={Locale.Settings.FontFamily.Title}
                  subTitle={Locale.Settings.FontFamily.SubTitle}
                >
                  <TextField
                    aria-label={Locale.Settings.FontFamily.Title}
                    type="text"
                    value={config.fontFamily}
                    placeholder={Locale.Settings.FontFamily.Placeholder}
                    onChange={(e) =>
                      updateConfig(
                        (config) => (config.fontFamily = e.currentTarget.value),
                      )
                    }
                  ></TextField>
                </ListItem>

                <ListItem
                  title={Locale.Settings.SendPreviewBubble.Title}
                  subTitle={Locale.Settings.SendPreviewBubble.SubTitle}
                >
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Settings.SendPreviewBubble.Title}
                    checked={config.sendPreviewBubble}
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.sendPreviewBubble = e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>

                <ListItem
                  title={Locale.Mask.Config.Artifacts.Title}
                  subTitle={Locale.Mask.Config.Artifacts.SubTitle}
                >
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Mask.Config.Artifacts.Title}
                    checked={config.enableArtifacts}
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.enableArtifacts = e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>
                <ListItem
                  title={Locale.Mask.Config.CodeFold.Title}
                  subTitle={Locale.Mask.Config.CodeFold.SubTitle}
                >
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Mask.Config.CodeFold.Title}
                    checked={config.enableCodeFold}
                    data-testid="enable-code-fold-checkbox"
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.enableCodeFold = e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>
              </List>

              <SpeechSettings />

              <div className={styles["settings-section"]}>
                <h2 className={styles["settings-section-title"]}>
                  {Locale.Settings.Sections.Conversation}
                </h2>
              </div>
              <List>
                <ListItem
                  title={Locale.Settings.AutoGenerateTitle.Title}
                  subTitle={Locale.Settings.AutoGenerateTitle.SubTitle}
                >
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Settings.AutoGenerateTitle.Title}
                    checked={config.enableAutoGenerateTitle}
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.enableAutoGenerateTitle =
                            e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>

                <ListItem
                  title={Locale.Settings.Mask.Splash.Title}
                  subTitle={Locale.Settings.Mask.Splash.SubTitle}
                >
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Settings.Mask.Splash.Title}
                    checked={!config.dontShowMaskSplashScreen}
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.dontShowMaskSplashScreen =
                            !e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>

                <ListItem
                  title={Locale.Settings.Mask.Builtin.Title}
                  subTitle={Locale.Settings.Mask.Builtin.SubTitle}
                >
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Settings.Mask.Builtin.Title}
                    checked={config.hideBuiltinMasks}
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.hideBuiltinMasks = e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>
                <ListItem
                  title={Locale.Settings.Prompt.Disable.Title}
                  subTitle={Locale.Settings.Prompt.Disable.SubTitle}
                >
                  <Checkbox
                    variant="switch"
                    aria-label={Locale.Settings.Prompt.Disable.Title}
                    checked={config.disablePromptHint}
                    onChange={(e) =>
                      updateConfig(
                        (config) =>
                          (config.disablePromptHint = e.currentTarget.checked),
                      )
                    }
                  ></Checkbox>
                </ListItem>

                <ListItem
                  title={Locale.Settings.Prompt.List}
                  subTitle={
                    Locale.Settings.Prompt.ListCount(
                      builtinCount,
                      customCount,
                    ) +
                    Locale.Settings.Prompt.EnabledCount(
                      promptStore.search("", true).length,
                    )
                  }
                >
                  <FieldButton
                    aria={
                      Locale.Settings.Prompt.List + Locale.Settings.Prompt.Edit
                    }
                    icon={<EditIcon size={16} strokeWidth={1.8} />}
                    text={Locale.Settings.Prompt.Edit}
                    onClick={() => setShowPromptModal(true)}
                  />
                </ListItem>
              </List>

              <div className={styles["settings-section"]}>
                <h2 className={styles["settings-section-title"]}>
                  {Locale.Settings.Sections.About}
                </h2>
              </div>
              <List>
                <ListItem
                  title={Locale.Settings.Update.Version(
                    currentVersion ?? "unknown",
                  )}
                  subTitle={
                    checkingUpdate
                      ? Locale.Settings.Update.IsChecking
                      : hasNewVersion
                      ? Locale.Settings.Update.FoundUpdate(remoteId ?? "ERROR")
                      : Locale.Settings.Update.IsLatest
                  }
                >
                  {checkingUpdate ? (
                    <LoadingIcon />
                  ) : hasNewVersion ? (
                    clientConfig?.isApp ? (
                      <FieldButton
                        icon={<ResetIcon></ResetIcon>}
                        text={Locale.Settings.Update.GoToUpdate}
                        onClick={() => clientUpdate()}
                      />
                    ) : (
                      <Link href={updateUrl} target="_blank" className="link">
                        {Locale.Settings.Update.GoToUpdate}
                      </Link>
                    )
                  ) : (
                    <FieldButton
                      icon={<ResetIcon></ResetIcon>}
                      text={Locale.Settings.Update.CheckUpdate}
                      onClick={() => checkUpdate(true)}
                    />
                  )}
                </ListItem>
              </List>
            </div>

            <div
              role="tabpanel"
              id="settings-panel-model"
              aria-labelledby="settings-tab-model"
              className={styles["settings-panel"]}
              hidden={activeSection !== "model"}
              tabIndex={0}
            >
              <div className={styles["settings-section"]}>
                <h2 className={styles["settings-section-title"]}>
                  {Locale.Settings.ModelConfig}
                </h2>
              </div>
              <List id={SlotID.CustomModel}>
                <CustomProviderSettings />
                <ModelConfigList
                  collapseAdvanced
                  modelConfig={config.modelConfig}
                  updateConfig={(updater) => {
                    const modelConfig = { ...config.modelConfig };
                    updater(modelConfig);
                    config.update(
                      (config) => (config.modelConfig = modelConfig),
                    );
                  }}
                />
              </List>

              <div className={styles["settings-section"]}>
                <h2 className={styles["settings-section-title"]}>
                  {Locale.Settings.Sections.ImageGeneration}
                </h2>
              </div>
              <List>
                <ListItem
                  title="生图请求方式"
                  subTitle="异步任务支持刷新后继续查询，需要服务商支持异步图片接口。"
                >
                  <SettingsSelect
                    title="生图请求方式"
                    value={config.modelConfig.imageRequestMode ?? "sync"}
                    options={[
                      { value: "sync", label: "同步请求" },
                      { value: "async", label: "异步任务" },
                    ]}
                    onChange={(value) =>
                      updateConfig((config) => {
                        config.modelConfig.imageRequestMode =
                          value === "async" ? "async" : "sync";
                      })
                    }
                  />
                </ListItem>
                <ListItem
                  className={styles["image-response-setting"]}
                  title="返回格式"
                  subTitle={
                    config.modelConfig.imageRequestMode === "async"
                      ? "异步任务最终返回图片链接，此选项控制模型生成结果的格式。"
                      : "选择图片链接或 Base64 图片数据，需要服务商支持。Responses 模式固定返回图片数据。"
                  }
                >
                  <SettingsSelect
                    title="返回格式"
                    value={config.modelConfig.imageResponseFormat ?? "url"}
                    options={[
                      { value: "url", label: "图片链接（URL）" },
                      { value: "b64_json", label: "图片数据（Base64）" },
                    ]}
                    onChange={(value) => {
                      updateConfig((config) => {
                        config.modelConfig.imageResponseFormat =
                          value === "b64_json" ? "b64_json" : "url";
                      });
                    }}
                  />
                </ListItem>
                <ListItem
                  title="流式生图"
                  subTitle={
                    config.modelConfig.imageRequestMode === "async"
                      ? "异步任务通过查询返回结果，不支持流式预览。"
                      : "逐步接收图片预览，需要模型和服务商支持。"
                  }
                >
                  <Checkbox
                    variant="switch"
                    role="switch"
                    aria-label="流式生图"
                    checked={
                      config.modelConfig.imageRequestMode !== "async" &&
                      (config.modelConfig.imageStream ?? false)
                    }
                    disabled={config.modelConfig.imageRequestMode === "async"}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      updateConfig((config) => {
                        config.modelConfig.imageStream = checked;
                      });
                    }}
                  />
                </ListItem>
                <ListItem
                  title="中间预览图数量"
                  subTitle="开启流式生图后可设置 0–3 张，0 表示不请求中间预览图。"
                >
                  <TextField
                    type="number"
                    aria-label="中间预览图数量"
                    min={0}
                    max={3}
                    step={1}
                    value={config.modelConfig.imagePartialImages ?? 1}
                    disabled={
                      config.modelConfig.imageRequestMode === "async" ||
                      !config.modelConfig.imageStream
                    }
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (!Number.isFinite(value)) return;
                      updateConfig((config) => {
                        config.modelConfig.imagePartialImages = Math.max(
                          0,
                          Math.min(3, Math.round(value)),
                        );
                      });
                    }}
                  />
                </ListItem>
              </List>
            </div>

            {showColorThemePicker &&
              createPortal(
                <div
                  className="modal-mask"
                  onClick={(event) => {
                    if (event.target === event.currentTarget) {
                      setShowColorThemePicker(false);
                    }
                  }}
                >
                  <Modal
                    title={Locale.Settings.ColorTheme}
                    onClose={() => setShowColorThemePicker(false)}
                    actions={[
                      <FieldButton
                        key="confirm"
                        text={Locale.UI.Confirm}
                        bordered
                        onClick={() => setShowColorThemePicker(false)}
                      />,
                    ]}
                  >
                    <div
                      className={styles["color-theme-grid"]}
                      role="group"
                      aria-label={Locale.Settings.ColorTheme}
                    >
                      {COLOR_THEMES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          className={styles["color-theme-card"]}
                          aria-pressed={config.colorTheme === t.value}
                          aria-label={Locale.Settings.ColorThemeNames[t.value]}
                          onClick={() => {
                            updateConfig(
                              (config) =>
                                (config.colorTheme = t.value as ColorTheme),
                            );
                          }}
                        >
                          <div
                            className={`${styles["color-theme-swatch"]} theme-${t.value}`}
                            aria-hidden="true"
                          />
                          <span className={styles["color-theme-name"]}>
                            {Locale.Settings.ColorThemeNames[t.value]}
                          </span>
                          <span
                            className={styles["color-theme-selected"]}
                            aria-hidden="true"
                          >
                            {Locale.Settings.ColorThemeCurrent}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Modal>
                </div>,
                document.body,
              )}

            {shouldShowPromptModal && (
              <UserPromptModal onClose={() => setShowPromptModal(false)} />
            )}

            <div
              role="tabpanel"
              id="settings-panel-data"
              aria-labelledby="settings-tab-data"
              className={styles["settings-panel"]}
              hidden={activeSection !== "data"}
              tabIndex={0}
            >
              <LocalDataPanel className={styles["settings-data-panel"]} />
              <div className={styles["settings-section"]}>
                <h2 className={styles["settings-section-title"]}>
                  {Locale.Settings.Sections.ResetClear}
                </h2>
              </div>
              <DangerItems />
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
