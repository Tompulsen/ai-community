import { IconButton } from "./button";

import styles from "./mask.module.scss";

import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/delete.svg";
import CopyIcon from "../icons/copy.svg";
import DragIcon from "../icons/drag.svg";

import type { Mask } from "../store/mask";
import {
  ChatMessage,
  createMessage,
  ModelConfig,
  useAppConfig,
} from "../store";
import { MultimodalContent, ROLES } from "../client/api";
import { List, ListItem, Popover, Select, showConfirm } from "./ui-lib";
import { AvatarPicker } from "./emoji";
import Locale from "../locales";

import { useId, useState } from "react";
import { copyToClipboard, getMessageImages } from "../utils";
import { Updater } from "../typing";
import { ModelConfigList } from "./model-config";
import { Path } from "../constant";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
  DraggableProvidedDragHandleProps,
} from "@hello-pangea/dnd";
import { getMessageTextContent } from "../utils";
import { Checkbox, TextField } from "./form-controls";
import { PromptContent } from "./prompt-content";
import { MaskAvatar } from "./mask-avatar";

// drag and drop helper function
function reorder<T>(list: T[], startIndex: number, endIndex: number): T[] {
  const result = [...list];
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

export function MaskConfig(props: {
  mask: Mask;
  updateMask: Updater<Mask>;
  extraListItems?: JSX.Element;
  readonly?: boolean;
  shouldSyncFromGlobal?: boolean;
  hideReasoningEffort?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [activeTab, setActiveTab] = useState<"presets" | "parameters">(
    "presets",
  );
  const tabId = useId();

  const updateConfig = (updater: (config: ModelConfig) => void) => {
    if (props.readonly) return;

    const config = { ...props.mask.modelConfig };
    updater(config);
    props.updateMask((mask) => {
      mask.modelConfig = config;
      // if user changed current session mask, it will disable auto sync
      mask.syncGlobalConfig = false;
    });
  };

  const copyMaskLink = () => {
    const maskLink = `${location.protocol}//${location.host}/#${Path.NewChat}?mask=${props.mask.id}`;
    copyToClipboard(maskLink);
  };

  const globalConfig = useAppConfig();

  return (
    <div className={styles["mask-config"]}>
      <div
        className={styles["config-tabs"]}
        role="tablist"
        aria-label={Locale.Mask.Name}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "presets"
              : event.key === "End"
              ? "parameters"
              : activeTab === "presets"
              ? "parameters"
              : "presets";
          setActiveTab(next);
          event.currentTarget
            .querySelector<HTMLButtonElement>(
              `#${CSS.escape(`${tabId}-tab-${next}`)}`,
            )
            ?.focus();
        }}
      >
        {(["presets", "parameters"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${tabId}-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`${tabId}-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "presets"
              ? Locale.Context.Presets
              : Locale.Context.Parameters}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`${tabId}-presets`}
        aria-labelledby={`${tabId}-tab-presets`}
        hidden={activeTab !== "presets"}
      >
        <ContextPrompts
          context={props.mask.context}
          readonly={props.readonly}
          updateContext={(updater) => {
            const context = props.mask.context.slice();
            updater(context);
            props.updateMask((mask) => (mask.context = context));
          }}
        />
      </section>
      <section
        role="tabpanel"
        id={`${tabId}-parameters`}
        aria-labelledby={`${tabId}-tab-parameters`}
        hidden={activeTab !== "parameters"}
      >
        <fieldset className={styles["config-fields"]} disabled={props.readonly}>
          <List>
            <ListItem title={Locale.Mask.Config.Avatar}>
              <Popover
                content={
                  <AvatarPicker
                    onEmojiClick={(emoji) => {
                      props.updateMask((mask) => (mask.avatar = emoji));
                      setShowPicker(false);
                    }}
                  ></AvatarPicker>
                }
                open={showPicker}
                onClose={() => setShowPicker(false)}
              >
                <div
                  tabIndex={props.readonly ? -1 : 0}
                  aria-disabled={props.readonly}
                  aria-label={Locale.Mask.Config.Avatar}
                  className={styles["mask-avatar-picker"]}
                  onClick={() => !props.readonly && setShowPicker(true)}
                  style={{ cursor: "pointer" }}
                >
                  <MaskAvatar
                    avatar={props.mask.avatar}
                    model={props.mask.modelConfig.model}
                  />
                </div>
              </Popover>
            </ListItem>
            <ListItem title={Locale.Mask.Config.Name}>
              <TextField
                aria-label={Locale.Mask.Config.Name}
                type="text"
                value={props.mask.name}
                onInput={(e) =>
                  props.updateMask((mask) => {
                    mask.name = e.currentTarget.value;
                  })
                }
              ></TextField>
            </ListItem>
            <ListItem
              title={Locale.Mask.Config.HideContext.Title}
              subTitle={Locale.Mask.Config.HideContext.SubTitle}
            >
              <Checkbox
                aria-label={Locale.Mask.Config.HideContext.Title}
                checked={props.mask.hideContext}
                onChange={(e) => {
                  props.updateMask((mask) => {
                    mask.hideContext = e.currentTarget.checked;
                  });
                }}
              ></Checkbox>
            </ListItem>

            {globalConfig.enableArtifacts && (
              <ListItem
                title={Locale.Mask.Config.Artifacts.Title}
                subTitle={Locale.Mask.Config.Artifacts.SubTitle}
              >
                <Checkbox
                  aria-label={Locale.Mask.Config.Artifacts.Title}
                  checked={props.mask.enableArtifacts !== false}
                  onChange={(e) => {
                    props.updateMask((mask) => {
                      mask.enableArtifacts = e.currentTarget.checked;
                    });
                  }}
                ></Checkbox>
              </ListItem>
            )}
            {globalConfig.enableCodeFold && (
              <ListItem
                title={Locale.Mask.Config.CodeFold.Title}
                subTitle={Locale.Mask.Config.CodeFold.SubTitle}
              >
                <Checkbox
                  aria-label={Locale.Mask.Config.CodeFold.Title}
                  checked={props.mask.enableCodeFold !== false}
                  onChange={(e) => {
                    props.updateMask((mask) => {
                      mask.enableCodeFold = e.currentTarget.checked;
                    });
                  }}
                ></Checkbox>
              </ListItem>
            )}

            {!props.shouldSyncFromGlobal ? (
              <ListItem
                title={Locale.Mask.Config.Share.Title}
                subTitle={Locale.Mask.Config.Share.SubTitle}
              >
                <IconButton
                  aria={Locale.Mask.Config.Share.Title}
                  icon={<CopyIcon />}
                  text={Locale.Mask.Config.Share.Action}
                  onClick={copyMaskLink}
                />
              </ListItem>
            ) : null}

            {props.shouldSyncFromGlobal ? (
              <ListItem
                title={Locale.Mask.Config.Sync.Title}
                subTitle={Locale.Mask.Config.Sync.SubTitle}
              >
                <Checkbox
                  aria-label={Locale.Mask.Config.Sync.Title}
                  checked={props.mask.syncGlobalConfig}
                  onChange={async (e) => {
                    const checked = e.currentTarget.checked;
                    if (
                      checked &&
                      (await showConfirm(Locale.Mask.Config.Sync.Confirm))
                    ) {
                      props.updateMask((mask) => {
                        mask.syncGlobalConfig = checked;
                        mask.modelConfig = { ...globalConfig.modelConfig };
                      });
                    } else if (!checked) {
                      props.updateMask((mask) => {
                        mask.syncGlobalConfig = checked;
                      });
                    }
                  }}
                ></Checkbox>
              </ListItem>
            ) : null}
          </List>
          <List>
            <ModelConfigList
              modelConfig={{ ...props.mask.modelConfig }}
              updateConfig={updateConfig}
              hideReasoningEffort={props.hideReasoningEffort}
            />
            {props.extraListItems}
          </List>
        </fieldset>
      </section>
    </div>
  );
}

function ContextPromptItem(props: {
  index: number;
  prompt: ChatMessage;
  update: (prompt: ChatMessage) => void;
  remove: () => void;
  readonly?: boolean;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
}) {
  return (
    <article className={styles["context-item"]}>
      <div className={styles["context-header"]}>
        <div className={styles["context-role"]}>
          {!props.readonly && (
            <button
              type="button"
              {...props.dragHandleProps}
              className={styles["context-drag"]}
              aria-label={Locale.Context.Move}
              title={Locale.Context.Move}
            >
              <DragIcon />
            </button>
          )}
          {props.readonly ? (
            <span>{Locale.Context.Roles[props.prompt.role]}</span>
          ) : (
            <Select
              value={props.prompt.role}
              aria-label={`${Locale.Context.Presets} ${props.index + 1}`}
              onChange={(e) =>
                props.update({
                  ...props.prompt,
                  role: e.target.value as any,
                })
              }
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {Locale.Context.Roles[r]}
                </option>
              ))}
            </Select>
          )}
        </div>
        {!props.readonly && (
          <IconButton
            icon={<DeleteIcon />}
            aria={Locale.Context.Delete}
            title={Locale.Context.Delete}
            onClick={() => props.remove()}
            bordered
          />
        )}
      </div>
      <PromptContent
        value={getMessageTextContent(props.prompt)}
        label={`${Locale.Context.Roles[props.prompt.role]} ${props.index + 1}`}
        readOnly={props.readonly}
        onChange={(value) => props.update({ ...props.prompt, content: value })}
      />
    </article>
  );
}

export function ContextPrompts(props: {
  context: ChatMessage[];
  updateContext: (updater: (context: ChatMessage[]) => void) => void;
  readonly?: boolean;
}) {
  const context = props.context;

  const addContextPrompt = (prompt: ChatMessage, i: number) => {
    props.updateContext((context) => context.splice(i, 0, prompt));
  };

  const removeContextPrompt = (i: number) => {
    props.updateContext((context) => context.splice(i, 1));
  };

  const updateContextPrompt = (i: number, prompt: ChatMessage) => {
    props.updateContext((context) => {
      const images = getMessageImages(context[i]);
      context[i] = prompt;
      if (images.length > 0) {
        const text = getMessageTextContent(context[i]);
        const newContext: MultimodalContent[] = [{ type: "text", text }];
        for (const img of images) {
          newContext.push({ type: "image_url", image_url: { url: img } });
        }
        context[i].content = newContext;
      }
    });
  };

  const onDragEnd: OnDragEndResponder = (result) => {
    if (!result.destination) {
      return;
    }
    const newContext = reorder(
      context,
      result.source.index,
      result.destination.index,
    );
    props.updateContext((context) => {
      context.splice(0, context.length, ...newContext);
    });
  };

  return (
    <>
      <div className={styles["context-list"]}>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="context-prompt-list">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {context.map((c, i) => (
                  <Draggable
                    draggableId={c.id || i.toString()}
                    index={i}
                    key={c.id || i}
                    isDragDisabled={props.readonly}
                    disableInteractiveElementBlocking
                  >
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.draggableProps}>
                        <ContextPromptItem
                          index={i}
                          prompt={c}
                          readonly={props.readonly}
                          dragHandleProps={provided.dragHandleProps}
                          update={(prompt) => updateContextPrompt(i, prompt)}
                          remove={() => removeContextPrompt(i)}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {props.readonly && props.context.length === 0 && (
          <div className={styles["context-empty"]}>{Locale.Context.Empty}</div>
        )}
        {!props.readonly && (
          <div className={styles["context-add"]}>
            <IconButton
              icon={<AddIcon />}
              text={Locale.Context.Add}
              bordered
              onClick={() =>
                addContextPrompt(
                  createMessage({
                    role: "user",
                    content: "",
                    date: "",
                  }),
                  props.context.length,
                )
              }
            />
          </div>
        )}
      </div>
    </>
  );
}
