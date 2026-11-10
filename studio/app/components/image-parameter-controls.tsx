import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronLeft, Sparkles } from "lucide-react";
import {
  IMAGE_QUALITIES,
  IMAGE_RATIOS,
  IMAGE_RESOLUTIONS,
  type ImageResolution,
} from "../utils/image-params";
import type { DalleQuality, ModelSize } from "../typing";
import { ChoiceGroup } from "./choice-group";
import { Select } from "./ui-lib";
import chatStyles from "./chat.module.scss";
import styles from "./image-parameter-controls.module.scss";

export function ImageParameterControls(props: {
  active: boolean;
  showHeading?: boolean;
  ratio: (typeof IMAGE_RATIOS)[number];
  ratioLabel: string;
  resolution: ImageResolution;
  resolutionLabel: string;
  quality: DalleQuality;
  fixedSize: boolean;
  onRatioChange: (value: ModelSize) => void;
  onResolutionChange: (value: ImageResolution) => void;
  onQualityChange: (value: DalleQuality) => void;
  onReset: () => void;
  children?: ReactNode;
}) {
  const [editingRatio, setEditingRatio] = useState(false);
  const [draftRatio, setDraftRatio] = useState(props.ratio);
  const ratioTrigger = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const focusAfterChange = useRef(false);
  const navigatingRatio = useRef(false);

  useLayoutEffect(() => {
    if (!props.active) {
      setEditingRatio(false);
      focusAfterChange.current = false;
    }
  }, [props.active]);

  useLayoutEffect(() => {
    if (!focusAfterChange.current) return;
    focusAfterChange.current = false;
    if (editingRatio) {
      editor.current
        ?.querySelector<HTMLInputElement>("input:checked")
        ?.focus({ preventScroll: true });
    } else {
      ratioTrigger.current?.focus({ preventScroll: true });
    }
  }, [editingRatio]);

  const finishRatio = () => {
    navigatingRatio.current = false;
    focusAfterChange.current = true;
    setEditingRatio(false);
  };

  const commitRatio = (value: string) => {
    props.onRatioChange(value as ModelSize);
    finishRatio();
  };

  if (editingRatio) {
    return (
      <div
        ref={editor}
        className={styles.editor}
        onPointerDownCapture={() => {
          navigatingRatio.current = false;
        }}
        onClickCapture={(event) => {
          if (navigatingRatio.current || !(event.target instanceof Element))
            return;
          const input = event.target
            .closest("label")
            ?.querySelector<HTMLInputElement>('input[type="radio"]');
          if (!input) return;
          event.preventDefault();
          event.stopPropagation();
          commitRatio(input.value);
        }}
        onKeyDownCapture={(event) => {
          if (
            !(event.target instanceof HTMLInputElement) ||
            event.target.type !== "radio"
          )
            return;
          if (event.key.startsWith("Arrow")) {
            navigatingRatio.current = true;
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            commitRatio(event.target.value);
          }
        }}
        onKeyUp={() => {
          navigatingRatio.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          finishRatio();
        }}
      >
        <div className={styles.editorHeader}>
          <button
            type="button"
            className={styles.back}
            aria-label="返回生图参数"
            onClick={finishRatio}
          >
            <ChevronLeft size={14} aria-hidden="true" />
            比例
          </button>
          <span>{draftRatio === "auto" ? "自动" : draftRatio}</span>
        </div>
        <ChoiceGroup
          label="比例"
          variant="grid"
          columns={3}
          value={draftRatio}
          options={IMAGE_RATIOS.map((value) => {
            const [width, height] =
              value === "auto" ? [1, 1] : value.split(":").map(Number);
            return {
              value,
              label: value === "auto" ? "自动" : value,
              visual: (
                <span className={styles.ratioFigure} aria-hidden="true">
                  {value === "auto" ? (
                    <Sparkles size={18} />
                  ) : (
                    <span
                      className={styles.ratioShape}
                      style={
                        {
                          "--ratio-width": `${Math.round(
                            24 * Math.min(1, width / height),
                          )}px`,
                          "--ratio-height": `${Math.round(
                            24 * Math.min(1, height / width),
                          )}px`,
                        } as CSSProperties
                      }
                    />
                  )}
                </span>
              ),
            };
          })}
          onChange={(value) =>
            setDraftRatio(value as (typeof IMAGE_RATIOS)[number])
          }
        />
      </div>
    );
  }

  return (
    <>
      {props.showHeading !== false && (
        <div className={chatStyles["composer-parameter-heading"]}>
          <span>生图参数</span>
          <button type="button" onClick={props.onReset}>
            重置
          </button>
        </div>
      )}
      <div className={styles.controls}>
        <button
          ref={ratioTrigger}
          type="button"
          className={styles.ratioTrigger}
          aria-label={`比例：${props.ratioLabel}`}
          aria-expanded={false}
          onClick={(event) => {
            setDraftRatio(props.ratio);
            navigatingRatio.current = false;
            focusAfterChange.current = event.detail === 0;
            setEditingRatio(true);
          }}
        >
          <span className={styles.label}>比例</span>
          <span className={styles.value}>
            {props.ratioLabel}
            <ChevronDown size={12} aria-hidden="true" />
          </span>
        </button>
        <div
          className={styles.field}
          title={props.fixedSize ? "该模型使用固定尺寸" : undefined}
        >
          <span className={styles.label}>分辨率</span>
          {props.fixedSize ? (
            <span className={styles.fixedValue}>{props.resolutionLabel}</span>
          ) : (
            <ChoiceGroup
              label="分辨率"
              value={props.resolution}
              options={IMAGE_RESOLUTIONS.map((value) => ({
                value,
                label: value === "auto" ? "自动" : value.toUpperCase(),
              }))}
              onChange={(value) =>
                props.onResolutionChange(value as ImageResolution)
              }
            />
          )}
        </div>
        <div className={styles.selectField}>
          <span className={styles.label}>画质</span>
          <Select
            aria-label="画质"
            value={props.quality}
            onChange={(event) =>
              props.onQualityChange(event.currentTarget.value as DalleQuality)
            }
          >
            {IMAGE_QUALITIES.map((value) => (
              <option key={value} value={value}>
                {value === "auto" ? "自动" : value}
              </option>
            ))}
          </Select>
        </div>
        {props.children}
      </div>
    </>
  );
}
