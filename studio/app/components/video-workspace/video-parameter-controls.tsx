"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { Copy } from "lucide-react";
import type { VideoDraft } from "../../store/video";
import { videoOptions } from "../../utils/video-api";
import {
  normalizeVideoParameters,
  videoDurationLabel,
} from "../../utils/video-capabilities";
import { VIDEO_RATIOS, VIDEO_RESOLUTIONS } from "../../utils/video-size";
import { ChoiceGroup } from "../choice-group";
import parameterStyles from "../image-parameter-controls.module.scss";
import styles from "./video-parameter-controls.module.scss";

export function VideoParameterControls({
  draft,
  onChange,
  children,
}: {
  draft: VideoDraft;
  onChange: (patch: Partial<VideoDraft>) => void;
  children?: ReactNode;
}) {
  const durationId = useId();
  const resolutionHintId = useId();
  const durationHintId = useId();
  draft = normalizeVideoParameters(draft);
  const ratio = draft.aspectRatio === "adaptive" ? "auto" : draft.aspectRatio;
  const options = videoOptions(
    draft.apiFormat,
    draft.model,
    draft.mode,
    draft.resolution,
  );
  const { durations, limitsKnown } = options;
  const resolutions = [
    ...new Set([
      ...VIDEO_RESOLUTIONS.filter((value) => value !== "auto"),
      ...options.resolutions.filter((value) => value !== "auto"),
    ]),
    "auto",
  ];
  const supportedResolutions = options.resolutions.filter(
    (value) => value !== "auto",
  );
  const minimum = durations[0] ?? 0;
  const maximum = durations[durations.length - 1] ?? 0;
  const sliderDuration = Math.min(maximum, Math.max(minimum, draft.duration));
  const progress =
    maximum === minimum
      ? 0
      : ((sliderDuration - minimum) / (maximum - minimum)) * 100;

  return (
    <div className={styles.controls} role="group" aria-label="视频参数">
      {children}
      <fieldset className={styles.section} aria-describedby={resolutionHintId}>
        <legend className={styles.label}>分辨率</legend>
        <div className={styles.resolutionChoice}>
          <ChoiceGroup
            label="分辨率"
            value={limitsKnown ? draft.resolution : "auto"}
            options={resolutions.map((value) => ({
              value,
              label: value === "auto" ? "自动" : value.toUpperCase(),
              disabled: !options.resolutions.includes(value),
            }))}
            onChange={(resolution) => onChange({ resolution })}
          />
        </div>
        <p id={resolutionHintId} className={styles.limitHint}>
          {limitsKnown
            ? `支持 ${supportedResolutions
                .map((value) => value.toUpperCase())
                .join(" / ")}，最高 ${supportedResolutions
                .at(-1)
                ?.toUpperCase()}`
            : "此模型尚未配置分辨率和时长，请联系管理员补充后使用。"}
        </p>
        {limitsKnown && !resolutions.includes(draft.resolution) && (
          <span className={styles.customValue}>{draft.resolution}</span>
        )}
      </fieldset>

      <fieldset className={styles.section}>
        <legend className={styles.label}>比例</legend>
        <div className={styles.ratioChoice}>
          <ChoiceGroup
            label="画面比例"
            variant="grid"
            columns={4}
            value={ratio}
            options={[
              "auto",
              ...VIDEO_RATIOS.filter((value) => value !== "auto"),
            ].map((value) => {
              const [w, h] =
                value === "auto" ? [1, 1] : value.split(":").map(Number);
              return {
                value,
                label: value === "auto" ? "自动" : value,
                visual: (
                  <span
                    className={parameterStyles.ratioFigure}
                    aria-hidden="true"
                  >
                    {value === "auto" ? (
                      <Copy size={18} />
                    ) : (
                      <span
                        className={parameterStyles.ratioShape}
                        style={
                          {
                            "--ratio-width": `${Math.round(
                              22 * Math.min(1, w / h),
                            )}px`,
                            "--ratio-height": `${Math.round(
                              22 * Math.min(1, h / w),
                            )}px`,
                          } as CSSProperties
                        }
                      />
                    )}
                  </span>
                ),
              };
            })}
            onChange={(aspectRatio) => onChange({ aspectRatio })}
          />
        </div>
        {!VIDEO_RATIOS.includes(ratio) && (
          <span className={styles.customValue}>{ratio}</span>
        )}
      </fieldset>

      <div className={styles.section}>
        <div className={styles.durationHeading}>
          <label className={styles.label} htmlFor={durationId}>
            时长
          </label>
          <output className={styles.currentDuration} htmlFor={durationId}>
            {limitsKnown ? `${draft.duration}s` : "待配置"}
          </output>
        </div>
        {!limitsKnown ? null : durations.length <= 6 ? (
          <ChoiceGroup
            label="视频时长"
            value={String(draft.duration)}
            options={durations.map((duration) => ({
              value: String(duration),
              label: `${duration}s`,
            }))}
            onChange={(duration) => onChange({ duration: Number(duration) })}
          />
        ) : (
          <input
            id={durationId}
            className={`${parameterStyles.compressionRange} ${styles.durationRange}`}
            type="range"
            aria-label="视频时长"
            aria-valuetext={`${sliderDuration} 秒`}
            aria-describedby={durationHintId}
            min={minimum}
            max={maximum}
            step={1}
            value={sliderDuration}
            style={
              { "--compression-progress": `${progress}%` } as CSSProperties
            }
            onChange={(event) =>
              onChange({ duration: event.currentTarget.valueAsNumber })
            }
          />
        )}
        {durations.length > 6 && (
          <div className={styles.durationLimits} aria-hidden="true">
            <span>{minimum}s</span>
            <span>{maximum}s</span>
          </div>
        )}
        {limitsKnown && (
          <p id={durationHintId} className={styles.limitHint}>
            {durations.length === 1
              ? `此模式固定为 ${minimum} 秒`
              : `支持 ${videoDurationLabel(durations)}`}
          </p>
        )}
      </div>
    </div>
  );
}
