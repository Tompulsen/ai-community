import { useId, useRef } from "react";
import { Settings2 } from "lucide-react";
import { useChatStore } from "../store/chat";
import { DEFAULT_DRAFT, type VideoDraft } from "../store/video";
import { useMobileScreen } from "../utils";
import { chatVideoConfig } from "../utils/chat-video";
import { selectedVideoSize } from "../utils/video-size";
import { ChatAction } from "./chat-action";
import { ComposerParameterPopover } from "./composer-parameter-popover";
import { SelectionDialog } from "./selection-dialog";
import { Select } from "./ui-lib";
import { VideoParameterControls } from "./video-workspace/video-parameter-controls";
import styles from "./chat.module.scss";
import parameterStyles from "./image-parameter-controls.module.scss";
import videoParameterStyles from "./video-workspace/video-parameter-controls.module.scss";

export function ChatVideoParameters({
  open,
  onOpenChange,
  referenceCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referenceCount: number;
}) {
  const store = useChatStore();
  const session = store.currentSession();
  const config = session.mask.modelConfig;
  const parameters = chatVideoConfig(config.videoConfig ?? {});
  const draft: VideoDraft = {
    ...DEFAULT_DRAFT,
    size: "auto",
    aspectRatio: "auto",
    resolution: "auto",
    ...parameters,
    model: config.model,
    mode:
      parameters.mode ??
      (referenceCount > 1
        ? "reference-to-video"
        : referenceCount
        ? "image-to-video"
        : "text-to-video"),
    materials: [],
  };
  const trigger = useRef<HTMLDivElement>(null);
  const id = useId();
  const mobile = useMobileScreen();
  const update = (patch: Partial<VideoDraft>) =>
    store.updateTargetSession(session, (target) => {
      const next = {
        ...chatVideoConfig(target.mask.modelConfig.videoConfig ?? {}),
        ...patch,
      };
      if (patch.resolution !== undefined || patch.aspectRatio !== undefined)
        next.size = selectedVideoSize({ ...draft, ...next });
      target.mask.modelConfig.videoConfig = chatVideoConfig(next);
      target.mask.syncGlobalConfig = false;
    });
  const reset = () =>
    store.updateTargetSession(session, (target) => {
      target.mask.modelConfig.videoConfig = undefined;
      target.mask.syncGlobalConfig = false;
    });
  const close = (restoreFocus: boolean) => {
    onOpenChange(false);
    if (restoreFocus)
      trigger.current?.querySelector("button")?.focus({ preventScroll: true });
  };
  const content = (
    <>
      {!mobile && (
        <div className={styles["composer-parameter-heading"]}>
          <span>视频参数</span>
          <button type="button" onClick={reset}>
            重置
          </button>
        </div>
      )}
      <VideoParameterControls draft={draft} onChange={update}>
        <div
          className={`${parameterStyles.selectField} ${videoParameterStyles.modeField}`}
        >
          <span className={parameterStyles.label}>生成方式</span>
          <Select
            aria-label="视频生成方式"
            value={parameters.mode ?? "auto"}
            onChange={(event) =>
              update({
                mode:
                  event.currentTarget.value === "auto"
                    ? undefined
                    : (event.currentTarget.value as VideoDraft["mode"]),
              })
            }
          >
            <option value="auto">自动</option>
            <option value="text-to-video" disabled={referenceCount > 0}>
              文生视频
            </option>
            <option value="image-to-video" disabled={referenceCount !== 1}>
              图生视频
            </option>
            <option value="first-last-frame" disabled={referenceCount !== 2}>
              首尾帧
            </option>
            <option value="reference-to-video" disabled={referenceCount === 0}>
              多图参考
            </option>
          </Select>
        </div>
      </VideoParameterControls>
    </>
  );
  const summary = `${
    draft.resolution === "auto" ? "自动" : draft.resolution
  } · ${draft.aspectRatio === "auto" ? "自动" : draft.aspectRatio} · ${
    draft.duration
  }s`;
  return (
    <>
      <div ref={trigger} className={styles["chat-input-auxiliary-action"]}>
        <ChatAction
          text={`视频参数 · ${summary}`}
          title={`视频参数：${summary}`}
          icon={<Settings2 />}
          onClick={() => onOpenChange(!open)}
          selected={open}
          expanded={open}
          controls={id}
        />
      </div>
      <ComposerParameterPopover
        id={id}
        label="视频参数"
        compact
        smoothResize
        open={open && !mobile}
        triggerRef={trigger}
        initialFocus="[data-select-trigger]"
        onClose={(reason) => close(reason === "escape")}
      >
        {content}
      </ComposerParameterPopover>
      <SelectionDialog
        id={id}
        title="视频参数"
        compact
        smoothResize
        headerActions={
          <button type="button" onClick={reset}>
            重置
          </button>
        }
        open={open && mobile}
        onClose={() => close(false)}
      >
        {content}
      </SelectionDialog>
    </>
  );
}
