import { useId, type CSSProperties, type ReactNode } from "react";
import { useChatStore } from "../store";
import { ChoiceGroup } from "./choice-group";
import {
  imageOutputParams,
  type ImageOutputConfig,
  type ImageOutputFormat,
  type ImageBackground,
} from "../utils/image-params";
import styles from "./chat.module.scss";
import parameterStyles from "./image-parameter-controls.module.scss";

const backgroundLabels = {
  auto: "自动",
  opaque: "不透明",
  transparent: "透明",
};

export function ImageOutputControls({
  requestSizeHelp,
}: {
  requestSizeHelp?: ReactNode;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = session.mask.modelConfig;
  const output = imageOutputParams(config);
  const compressionDisabled = output.output_format === "png";
  const compressionHintId = useId();
  const compression =
    output.output_compression ??
    Math.max(
      0,
      Math.min(100, Math.round(config.imageOutputCompression ?? 100)),
    );
  const update = (patch: ImageOutputConfig) => {
    chatStore.updateTargetSession(session, (session) => {
      Object.assign(session.mask.modelConfig, patch);
      session.mask.syncGlobalConfig = false;
    });
  };
  const updateCompression = (value: number) => {
    if (!compressionDisabled && Number.isFinite(value)) {
      update({
        imageOutputCompression: Math.max(0, Math.min(100, Math.round(value))),
      });
    }
  };

  return (
    <div className={styles["image-output-settings"]}>
      <div className={parameterStyles.field}>
        <span className={styles["image-param-label"]}>输出格式</span>
        <ChoiceGroup
          label="输出格式"
          value={output.output_format}
          options={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
            { value: "webp", label: "WebP" },
          ]}
          onChange={(selected) => {
            const value = selected as ImageOutputFormat;
            update({
              imageOutputFormat: value,
              ...(value === "jpeg" &&
                output.background === "transparent" && {
                  imageBackground: "opaque",
                }),
            });
          }}
        />
      </div>
      <div className={parameterStyles.field}>
        <span className={styles["image-param-label"]}>背景</span>
        <ChoiceGroup
          label="背景"
          value={output.background}
          options={Object.entries(backgroundLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(selected) => {
            const value = selected as ImageBackground;
            update({
              imageBackground: value,
              ...(value === "transparent" &&
                output.output_format === "jpeg" && {
                  imageOutputFormat: "png",
                }),
            });
          }}
        />
      </div>
      <div
        className={parameterStyles.compression}
        title="范围 0–100，数值越高，图片质量越高"
      >
        <span className={styles["image-param-label"]}>压缩设置</span>
        <div
          className={parameterStyles.compressionControl}
          data-disabled={compressionDisabled || undefined}
          style={
            { "--compression-progress": `${compression}%` } as CSSProperties
          }
        >
          <input
            className={parameterStyles.compressionRange}
            type="range"
            aria-label="压缩设置滑杆"
            aria-describedby={compressionHintId}
            disabled={compressionDisabled}
            min={0}
            max={100}
            step={1}
            value={compression}
            onChange={(event) =>
              updateCompression(event.currentTarget.valueAsNumber)
            }
          />
          <input
            type="number"
            inputMode="numeric"
            aria-label="压缩设置"
            aria-describedby={compressionHintId}
            disabled={compressionDisabled}
            min={0}
            max={100}
            step={1}
            value={compression}
            onChange={(event) =>
              updateCompression(event.currentTarget.valueAsNumber)
            }
          />
        </div>
      </div>
      <div className={parameterStyles.hint} data-panel-layout>
        {requestSizeHelp && <p>{requestSizeHelp}</p>}
        <p id={compressionHintId} aria-live="polite">
          {compressionDisabled
            ? "PNG 不支持压缩调节，可切换 JPEG/WebP。"
            : "透明背景支持 PNG/WebP；JPEG/WebP 可调压缩。"}
        </p>
      </div>
    </div>
  );
}
