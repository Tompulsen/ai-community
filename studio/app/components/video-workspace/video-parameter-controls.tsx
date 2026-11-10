"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Copy } from "lucide-react";
import type { VideoDraft } from "../../store/video";
import { videoOptions } from "../../utils/video-api";
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
  const ratio = draft.aspectRatio === "adaptive" ? "auto" : draft.aspectRatio;
  const durations = videoOptions(draft.apiFormat, draft.model).durations;
  const minimum = durations[0];
  const maximum = durations[durations.length - 1];
  const sliderDuration = Math.min(maximum, Math.max(minimum, draft.duration));
  const progress = ((sliderDuration - minimum) / (maximum - minimum)) * 100;

  return (
    <div className={styles.controls} role="group" aria-label="视频参数">
      {children}
      <fieldset className={styles.section}>
        <legend className={styles.label}>分辨率</legend>
        <div className={styles.resolutionChoice}>
          <ChoiceGroup
            label="分辨率"
            value={draft.resolution}
            options={VIDEO_RESOLUTIONS.map((value) => ({
              value,
              label: value === "auto" ? "自动" : value,
            }))}
            onChange={(resolution) => onChange({ resolution })}
          />
        </div>
        {!VIDEO_RESOLUTIONS.includes(draft.resolution) && (
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
            {draft.duration}s
          </output>
        </div>
        <input
          id={durationId}
          className={`${parameterStyles.compressionRange} ${styles.durationRange}`}
          type="range"
          aria-label="视频时长"
          aria-valuetext={`${sliderDuration} 秒`}
          min={minimum}
          max={maximum}
          step={1}
          value={sliderDuration}
          style={{ "--compression-progress": `${progress}%` } as CSSProperties}
          onChange={(event) =>
            onChange({ duration: event.currentTarget.valueAsNumber })
          }
        />
        <div className={styles.durationLimits} aria-hidden="true">
          <span>{minimum}s</span>
          <span>{maximum}s</span>
        </div>
      </div>

      <details className={styles.customDimensions}>
        <summary>
          自定义参数
          <ChevronDown size={12} aria-hidden="true" />
        </summary>
        <label className={styles.customDuration}>
          <span>时长（秒）</span>
          <input
            aria-label="自定义视频时长"
            type="number"
            step="any"
            value={draft.duration}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) onChange({ duration: value });
            }}
          />
        </label>
      </details>
    </div>
  );
}
