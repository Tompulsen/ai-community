"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ChevronRight } from "lucide-react";
import type { ModelConfig } from "../store";
import {
  REASONING_EFFORT_OPTIONS,
  reasoningEffort,
  type ReasoningEffort,
} from "../utils/chat-params";
import { ReasoningEffortSlider } from "./reasoning-effort-slider";
import { SelectionDialog } from "./selection-dialog";
import { ComposerParameterPopover } from "./composer-parameter-popover";
import styles from "./model-effort-control.module.scss";

export function ModelEffortControl(props: {
  modelLabel: string;
  modelTitle: string;
  modelPickerId: string;
  onSelectModel: () => void;
  modelConfig: ModelConfig;
  showReasoning: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mobile: boolean;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
  triggerRef?: RefObject<HTMLButtonElement>;
}) {
  const [preview, setPreview] = useState<ReasoningEffort | null>(null);
  const panelId = useId();
  const localTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = props.triggerRef ?? localTriggerRef;
  const effortTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingModel = useRef(false);
  const restoreFocus = useRef(false);
  const previousDesktopOpen = useRef(false);
  const identity = `${props.modelConfig.model}@${props.modelConfig.providerName}`;
  const previousIdentity = useRef(identity);
  const previousReasoning = useRef(props.showReasoning);
  const onOpenChange = useRef(props.onOpenChange);
  const onSelectModel = useRef(props.onSelectModel);
  onOpenChange.current = props.onOpenChange;
  onSelectModel.current = props.onSelectModel;
  const open = props.open && props.showReasoning;
  const effort = reasoningEffort(props.modelConfig.reasoningEffort) ?? "auto";
  const effortLabel = REASONING_EFFORT_OPTIONS.find(
    (option) => option.value === effort,
  )!.label;
  const visibleEffort = preview ?? effort;
  const previewLabel = REASONING_EFFORT_OPTIONS.find(
    (option) => option.value === visibleEffort,
  )!.label;

  const close = useCallback((selectModel = false) => {
    pendingModel.current = selectModel;
    restoreFocus.current = true;
    onOpenChange.current(false);
  }, []);

  useLayoutEffect(() => {
    if (
      previousIdentity.current === identity &&
      previousReasoning.current === props.showReasoning
    )
      return;
    previousIdentity.current = identity;
    previousReasoning.current = props.showReasoning;
    pendingModel.current = false;
    restoreFocus.current = false;
    setPreview(null);
    onOpenChange.current(false);
  }, [identity, props.showReasoning]);

  useLayoutEffect(() => {
    const desktopOpen = open && !props.mobile;
    if (!desktopOpen && previousDesktopOpen.current) {
      const shouldSelect = pendingModel.current;
      pendingModel.current = false;
      if (shouldSelect) triggerRef.current?.focus({ preventScroll: true });
      else if (restoreFocus.current)
        effortTriggerRef.current?.focus({ preventScroll: true });
      restoreFocus.current = false;
      if (shouldSelect) onSelectModel.current();
    }
    previousDesktopOpen.current = desktopOpen;
  }, [open, props.mobile, triggerRef]);

  useEffect(() => {
    if (!open) setPreview(null);
  }, [open]);

  const panel = (
    <div
      className={styles.panel}
      data-effort={visibleEffort}
      data-mobile={props.mobile || undefined}
      data-autofocus={props.mobile ? "" : undefined}
      tabIndex={props.mobile ? -1 : undefined}
      onFocus={(event) => {
        if (event.target === event.currentTarget) {
          event.currentTarget
            .querySelector<HTMLInputElement>('input[type="range"]')
            ?.focus({ preventScroll: true });
        }
      }}
    >
      <div className={styles.header}>
        {!props.mobile && <span className={styles.title}>思考强度</span>}
        <output className={styles.value} aria-live="polite">
          {previewLabel}
        </output>
        <button
          type="button"
          className={styles.automatic}
          aria-pressed={effort === "auto"}
          onClick={() =>
            props.updateConfig((config) => {
              config.reasoningEffort = "auto";
            })
          }
        >
          自动
        </button>
      </div>
      <ReasoningEffortSlider
        key={identity}
        value={effort}
        compact
        onPreviewChange={setPreview}
        onChange={(value) =>
          props.updateConfig((config) => {
            config.reasoningEffort = value;
          })
        }
      />
      {props.mobile && (
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.changeModel}
            aria-label={`更换模型: ${props.modelLabel}`}
            aria-haspopup="dialog"
            aria-controls={props.modelPickerId}
            onClick={() => close(true)}
          >
            更换模型
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className={styles.group}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          title={props.modelTitle}
          aria-label={props.modelTitle}
          aria-haspopup="dialog"
          aria-controls={props.modelPickerId}
          data-model-picker-trigger={props.modelPickerId}
          onClick={() => {
            if (open) close(true);
            else props.onSelectModel();
          }}
        >
          <span className={styles.model}>{props.modelLabel}</span>
        </button>
        {props.showReasoning && (
          <button
            ref={effortTriggerRef}
            type="button"
            className={styles.effortTrigger}
            data-effort={effort}
            title={`思考强度：${effortLabel}`}
            aria-label={`思考强度：${effortLabel}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              if (open) close();
              else {
                pendingModel.current = false;
                restoreFocus.current = false;
                props.onOpenChange(true);
              }
            }}
          >
            <span className={styles.effort}>{effortLabel}</span>
          </button>
        )}
      </div>
      {props.mobile ? (
        <SelectionDialog
          id={panelId}
          title="思考强度"
          compact
          open={open}
          onClose={() => {
            const shouldSelect = pendingModel.current;
            pendingModel.current = false;
            restoreFocus.current = false;
            setPreview(null);
            props.onOpenChange(false);
            if (shouldSelect) {
              triggerRef.current?.focus({ preventScroll: true });
              onSelectModel.current();
            }
          }}
        >
          {panel}
        </SelectionDialog>
      ) : (
        <ComposerParameterPopover
          id={panelId}
          label="思考强度"
          compact
          open={open}
          triggerRef={effortTriggerRef}
          initialFocus='input[type="range"]'
          onClose={(reason) => {
            if (reason === "escape") close();
            else {
              pendingModel.current = false;
              restoreFocus.current = false;
              props.onOpenChange(false);
            }
          }}
        >
          {panel}
        </ComposerParameterPopover>
      )}
    </>
  );
}
