import { ModalConfigValidator, ModelConfig } from "../store";
import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Brain, ChevronDown } from "lucide-react";
import styles from "./model-config.module.scss";

import Locale from "../locales";
import {
  getModelPreferenceKey,
  useModelCapabilities,
} from "../utils/model-capabilities";
import { useModelPreferenceStore } from "../store/model-preferences";
import { ChatAction } from "./chat-action";
import { InputRange } from "./input-range";
import { ListItem, Modal, showToast, useModalClose } from "./ui-lib";
import { useAllModels } from "../utils/hooks";
import { CUSTOM_MODEL_PROVIDER } from "../utils/custom-provider";
import { getModelProvider } from "../utils/model";
import { ModelSelect } from "./model-select";
import {
  Checkbox,
  FieldButton,
  TextField,
  TextAreaField,
} from "./form-controls";
import { SettingsSelect } from "./settings-select";
import { ReasoningEffortSlider } from "./reasoning-effort-slider";
import { chatApiFormat } from "../utils/chat-api-format";
import {
  REASONING_EFFORT_OPTIONS,
  reasoningEffort,
} from "../utils/chat-params";
import {
  effectiveOutputTokens,
  validCompressThreshold,
} from "../utils/context-budget";

function BudgetInput(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  normalize: (value: number) => number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      type="number"
      aria-label={props.label}
      min={props.min}
      max={props.max}
      value={draft ?? props.normalize(props.value)}
      onChange={(event) => {
        const value = event.currentTarget.value;
        setDraft(value);
        const number = event.currentTarget.valueAsNumber;
        if (
          Number.isFinite(number) &&
          number >= props.min &&
          number <= props.max
        ) {
          props.onChange(props.normalize(number));
        }
      }}
      onBlur={() => {
        if (draft !== null) props.onChange(props.normalize(Number(draft)));
        setDraft(null);
      }}
    />
  );
}

/** 模型选择器触发标签 */
function ModelTriggerLabel(props: { label: string; onClick: () => void }) {
  return (
    <FieldButton
      text={props.label}
      title={props.label}
      onClick={props.onClick}
      constrained
    />
  );
}

/** 模型选择弹窗 */
function ModelPickerModal(props: {
  title: string;
  models: Array<{
    name: string;
    displayName?: string;
    provider?: { providerName?: string };
  }>;
  value: string;
  onSelect: (val: string) => void;
  onClose: () => void;
}) {
  const { maskRef, requestClose, onBackdropClick } = useModalClose(
    props.onClose,
  );

  return createPortal(
    <div ref={maskRef} className="modal-mask" onClick={onBackdropClick}>
      <Modal title={props.title} onClose={() => requestClose()}>
        <div
          style={{
            height: "50vh",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <ModelSelect
            models={props.models}
            embedded
            value={props.value}
            onChange={(val) => requestClose(() => props.onSelect(val))}
          />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}

export function ReasoningEffortSelect(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
  toolbar?: boolean;
}) {
  const { category } = useModelCapabilities(
    props.modelConfig.model,
    props.modelConfig.providerName,
  );
  const effort = reasoningEffort(props.modelConfig.reasoningEffort) ?? "auto";
  const label =
    REASONING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ??
    "自动";
  const updateEffort = (value: string) =>
    props.updateConfig((config) => {
      config.reasoningEffort = reasoningEffort(value) ?? "auto";
    });

  if (
    category === "image" ||
    category === "video" ||
    (props.toolbar && !props.modelConfig.model)
  )
    return null;

  return (
    <SettingsSelect
      title="推理强度"
      value={effort}
      options={REASONING_EFFORT_OPTIONS}
      description="自动使用服务商默认设置；当前接口不支持所选档位时恢复自动。"
      renderOptions={() => (
        <ReasoningEffortSlider value={effort} onChange={updateEffort} />
      )}
      renderTrigger={
        props.toolbar
          ? (trigger) => (
              <ChatAction
                {...trigger}
                icon={<Brain />}
                text={`推理 · ${label}`}
                title={`推理强度：${label}`}
                showLabel
              />
            )
          : undefined
      }
      onChange={updateEffort}
    />
  );
}

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
  hideReasoningEffort?: boolean;
  collapseAdvanced?: boolean;
}) {
  const { updateConfig } = props;
  const { category, apiFormat } = useModelCapabilities(
    props.modelConfig.model,
    props.modelConfig.providerName,
  );
  const setModelApiFormat = useModelPreferenceStore(
    (state) => state.setModelApiFormat,
  );
  const allModels = useAllModels();
  const availableModels = useMemo(
    () => allModels.filter((v) => v.available),
    [allModels],
  );
  const value = `${props.modelConfig.model}@${props.modelConfig?.providerName}`;
  const [pickerKey, setPickerKey] = useState<"model" | null>(null);

  const selectedModel = useMemo(
    () =>
      availableModels.find(
        (m) => `${m.name}@${m.provider?.providerName}` === value,
      ),
    [availableModels, value],
  );

  const handleModelSelect = useCallback(
    (val: string) => {
      const [model, providerName] = getModelProvider(val);
      updateConfig((config) => {
        config.model = ModalConfigValidator.model(model);
        config.providerName = providerName as any;
      });
    },
    [updateConfig],
  );

  const samplingItems = (
    <>
      <ListItem
        title={Locale.Settings.Temperature.Title}
        subTitle={Locale.Settings.Temperature.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.Temperature.Title}
          value={props.modelConfig.temperature?.toFixed(1)}
          min="0"
          max="1"
          step="0.1"
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.temperature = ModalConfigValidator.temperature(
                  e.currentTarget.valueAsNumber,
                )),
            )
          }
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.TopP.Title}
        subTitle={Locale.Settings.TopP.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.TopP.Title}
          value={(props.modelConfig.top_p ?? 1).toFixed(1)}
          min="0"
          max="1"
          step="0.1"
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.top_p = ModalConfigValidator.top_p(
                  e.currentTarget.valueAsNumber,
                )),
            )
          }
        />
      </ListItem>
    </>
  );
  const advancedItems = (
    <>
      <ListItem
        title="停止序列"
        subTitle="遇到指定内容时停止生成，每行一项，最多 4 项；留空不设置。"
      >
        <TextAreaField
          aria-label="停止序列"
          rows={2}
          value={props.modelConfig.stop ?? ""}
          onChange={(event) =>
            props.updateConfig((config) => {
              config.stop = event.currentTarget.value;
            })
          }
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.PresencePenalty.Title}
        subTitle={Locale.Settings.PresencePenalty.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.PresencePenalty.Title}
          value={props.modelConfig.presence_penalty?.toFixed(1)}
          min="-2"
          max="2"
          step="0.1"
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.presence_penalty =
                  ModalConfigValidator.presence_penalty(
                    e.currentTarget.valueAsNumber,
                  )),
            )
          }
        />
      </ListItem>
      <ListItem
        title={Locale.Settings.FrequencyPenalty.Title}
        subTitle={Locale.Settings.FrequencyPenalty.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.FrequencyPenalty.Title}
          value={props.modelConfig.frequency_penalty?.toFixed(1)}
          min="-2"
          max="2"
          step="0.1"
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.frequency_penalty =
                  ModalConfigValidator.frequency_penalty(
                    e.currentTarget.valueAsNumber,
                  )),
            )
          }
        />
      </ListItem>
    </>
  );

  return (
    <>
      <ListItem title={Locale.Settings.Model}>
        <ModelTriggerLabel
          label={
            selectedModel
              ? `${selectedModel.displayName || selectedModel.name} (${
                  selectedModel.provider?.providerName === CUSTOM_MODEL_PROVIDER
                    ? "自定义"
                    : selectedModel.provider?.providerName
                })`
              : Locale.Settings.ModelPicker.Placeholder
          }
          onClick={() => setPickerKey("model")}
        />
      </ListItem>

      <ListItem
        title={Locale.Settings.ChatApiFormat.Title}
        subTitle={Locale.Settings.ChatApiFormat.SubTitle}
      >
        <SettingsSelect
          title={Locale.Settings.ChatApiFormat.Title}
          value={apiFormat ?? chatApiFormat(props.modelConfig.chatApiFormat)}
          options={[
            { value: "chat-completions", label: "OpenAI Chat Completions" },
            { value: "responses", label: "OpenAI Responses" },
            { value: "gemini", label: "Gemini" },
            { value: "claude", label: "Claude Messages" },
          ]}
          onChange={(value) => {
            if (apiFormat) {
              try {
                setModelApiFormat(
                  getModelPreferenceKey(
                    props.modelConfig.model,
                    props.modelConfig.providerName,
                  ),
                  chatApiFormat(value),
                );
              } catch {
                showToast("接口格式保存失败，请重试");
              }
              return;
            }
            props.updateConfig((config) => {
              config.chatApiFormat = chatApiFormat(value);
            });
          }}
        />
      </ListItem>

      {pickerKey === "model" && (
        <ModelPickerModal
          title={Locale.Settings.ModelPicker.Title}
          models={availableModels}
          value={value}
          onSelect={handleModelSelect}
          onClose={() => setPickerKey(null)}
        />
      )}

      {!props.collapseAdvanced && samplingItems}

      <ListItem
        title="最大输出 Token"
        subTitle="本次最多生成的 Token 数，实际支持上限由模型决定。"
      >
        <BudgetInput
          label="最大输出 Token"
          min={1}
          max={512000}
          normalize={effectiveOutputTokens}
          value={effectiveOutputTokens(props.modelConfig.max_tokens)}
          onChange={(value) =>
            props.updateConfig((config) => (config.max_tokens = value))
          }
        />
      </ListItem>

      {!props.hideReasoningEffort &&
        category !== "image" &&
        category !== "video" && (
          <ListItem
            title="推理强度"
            subTitle="模型支持的档位因服务商而异；不支持时恢复自动。"
          >
            <ReasoningEffortSelect
              modelConfig={props.modelConfig}
              updateConfig={props.updateConfig}
            />
          </ListItem>
        )}

      <ListItem title="流式输出" subTitle="逐步显示回复；关闭后等待完整结果。">
        <Checkbox
          variant="switch"
          aria-label="流式输出"
          checked={props.modelConfig.stream ?? true}
          onChange={(event) =>
            props.updateConfig((config) => {
              config.stream = event.currentTarget.checked;
            })
          }
        />
      </ListItem>

      {!props.collapseAdvanced && advancedItems}

      <ListItem
        title="自动压缩容量"
        subTitle="上下文占用超过此容量的 90% 时自动压缩较早的文字，保留摘要与素材；原始聊天记录仍保存在本机。"
      >
        <BudgetInput
          label="自动压缩容量"
          min={500}
          max={2000000}
          normalize={validCompressThreshold}
          value={props.modelConfig.compressionThreshold}
          onChange={(value) =>
            props.updateConfig(
              (config) => (config.compressionThreshold = value),
            )
          }
        />
      </ListItem>
      {props.collapseAdvanced && (
        <details
          className={styles["advanced-settings"]}
          data-advanced-model-settings
        >
          <summary>
            <span>高级参数</span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className={styles["advanced-content"]}>
            {samplingItems}
            {advancedItems}
          </div>
        </details>
      )}
    </>
  );
}
