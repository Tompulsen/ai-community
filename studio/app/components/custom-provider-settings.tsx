"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { useAccessStore, refetchModels } from "../store/access";
import {
  customApiPath,
  saveCustomProvider,
  type CustomApiMode,
} from "../utils/custom-provider";
import { hasPendingGeneration } from "../utils/account-model-source";
import {
  customModelNames,
  fetchCustomModels,
} from "../utils/custom-provider-models";
import { getLocalScope } from "../utils/local-workspace";
import {
  TextField,
  FieldButton,
  ChoiceButton,
  Checkbox,
} from "./form-controls";
import { ListItem, Select } from "./ui-lib";
import styles from "./settings.module.scss";
import Locale from "../locales";

export function CustomProviderSettings() {
  const access = useAccessStore();
  const text = Locale.Settings.Provider;
  const [source, setSource] = useState(
    access.useCustomConfig ? "custom" : "account",
  );
  const [name, setName] = useState(access.customConfigName);
  const [url, setUrl] = useState(
    access.openaiUrl.startsWith("http") ? access.openaiUrl : "",
  );
  const [key, setKey] = useState(access.openaiApiKey);
  const [mode, setMode] = useState<CustomApiMode>(access.customApiMode);
  const [models, setModels] = useState(access.customModelNames);
  const [available, setAvailable] = useState(() =>
    customModelNames(access.customModelNames),
  );
  const modelRequest = useRef<AbortController>();
  const requestEpoch = useRef(0);
  const profileScope = useRef(getLocalScope());
  const [visible, setVisible] = useState(false);
  const expanded = source === "custom";
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const dirty =
    (source === "custom") !== access.useCustomConfig ||
    name.trim() !== access.customConfigName ||
    url.trim() !==
      (access.openaiUrl.startsWith("http") ? access.openaiUrl : "") ||
    key.trim() !== access.openaiApiKey ||
    mode !== access.customApiMode ||
    models.trim() !== access.customModelNames;
  useEffect(() => {
    setSaved(false);
  }, [source, name, url, key, mode, models]);
  useEffect(() => {
    const epoch = requestEpoch;
    const request = modelRequest;
    epoch.current++;
    modelRequest.current?.abort();
    setRefreshing(false);
    setAvailable(customModelNames(models));
    return () => {
      epoch.current++;
      request.current?.abort();
    };
    // A different endpoint/key must never reuse another provider's model list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key]);
  useEffect(() => {
    setSource(access.useCustomConfig ? "custom" : "account");
    setName(access.customConfigName);
    setUrl(access.openaiUrl.startsWith("http") ? access.openaiUrl : "");
    setKey(access.openaiApiKey);
    setMode(access.customApiMode);
    setModels(access.customModelNames);
    const scope = getLocalScope();
    if (profileScope.current !== scope)
      setAvailable(customModelNames(access.customModelNames));
    profileScope.current = scope;
    setVisible(false);
  }, [
    access.useCustomConfig,
    access.customConfigName,
    access.openaiUrl,
    access.openaiApiKey,
    access.customApiMode,
    access.customModelNames,
  ]);
  async function apply() {
    setError("");
    setSaving(true);
    try {
      if (hasPendingGeneration())
        throw new Error(Locale.Settings.ModelSource.Pending);
      if (source === "custom") {
        customApiPath(url, "models");
        if (!key.trim()) throw new Error(text.KeyRequired);
        if (!customModelNames(models).length)
          throw new Error("请先获取并选择模型");
      }
      const profile = {
        useCustomConfig: source === "custom",
        customConfigName: name.trim(),
        customApiMode: mode,
        customModelNames: models.trim(),
        openaiUrl: url.trim(),
        openaiApiKey: key.trim(),
      };
      window.dispatchEvent(new Event("model-source-changing"));
      saveCustomProvider(profile);
      access.update((state) => Object.assign(state, profile));
      await refetchModels();
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : text.Invalid);
    } finally {
      setSaving(false);
    }
  }
  async function refresh() {
    const epoch = ++requestEpoch.current;
    const scope = getLocalScope();
    const controller = new AbortController();
    modelRequest.current?.abort();
    modelRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setError("");
    setRefreshing(true);
    try {
      const list = await fetchCustomModels(url, key, controller.signal);
      if (epoch !== requestEpoch.current || scope !== getLocalScope()) return;
      setAvailable(list);
      const selected = customModelNames(models).filter((id) =>
        list.includes(id),
      );
      setModels((selected.length ? selected : list).join(","));
    } catch (error) {
      if (epoch === requestEpoch.current && scope === getLocalScope())
        setError(
          controller.signal.aborted
            ? "获取模型超时，请重试"
            : error instanceof Error
            ? error.message
            : text.Invalid,
        );
    } finally {
      clearTimeout(timeout);
      if (epoch === requestEpoch.current) setRefreshing(false);
    }
  }
  return (
    <section className={styles["provider-settings"]} aria-label={text.Title}>
      <ListItem title={text.Source}>
        <Checkbox
          id="provider-model-source"
          role="switch"
          aria-label={text.Source}
          checked={expanded}
          onChange={(event) =>
            setSource(event.target.checked ? "custom" : "account")
          }
          disabled={saving || refreshing}
        />
      </ListItem>
      <div
        className={styles["provider-disclosure"]}
        data-open={expanded}
        aria-hidden={!expanded}
        ref={(element) => {
          element?.toggleAttribute("inert", !expanded);
        }}
      >
        <div className={styles["provider-form-clip"]}>
          <div className={styles["provider-form"]}>
            <label className={styles["provider-field"]}>
              <span>{text.Name}</span>
              <TextField
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={text.NamePlaceholder}
                disabled={saving}
              />
            </label>
            <label className={styles["provider-field"]}>
              <span>{text.Type}</span>
              <Select
                className={styles["provider-select"]}
                style={{ textAlign: "left" }}
                disabled
                value="openai"
              >
                <option value="openai">OpenAI {text.Compatible}</option>
              </Select>
            </label>
            <label className={styles["provider-field"]}>
              <span>API URL</span>
              <TextField
                fullWidth
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                disabled={saving}
              />
            </label>
            <div className={styles["provider-field"]}>
              <label htmlFor="custom-provider-key">API Key</label>
              <div className={styles["field-group"]}>
                <TextField
                  id="custom-provider-key"
                  fullWidth
                  type={visible ? "text" : "password"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                  disabled={saving}
                />
                <FieldButton
                  icon={visible ? <EyeOff size={16} /> : <Eye size={16} />}
                  aria={visible ? text.HideKey : text.ShowKey}
                  title={visible ? text.HideKey : text.ShowKey}
                  onClick={() => setVisible(!visible)}
                />
              </div>
            </div>
            <label className={styles["provider-field"]}>
              <span>{text.Endpoint}</span>
              <Select
                className={styles["provider-select"]}
                style={{ textAlign: "left" }}
                value={mode}
                onChange={(e) => setMode(e.target.value as CustomApiMode)}
                disabled={saving}
              >
                <option value="auto">Chat Completions / Images API</option>
                <option value="images">Images API (/v1/images)</option>
                <option value="responses">Responses API (/v1/responses)</option>
              </Select>
            </label>
            <div className={styles["provider-field"]}>
              <div className={styles["provider-model-header"]}>
                <span>
                  模型
                  {available.length
                    ? ` · ${customModelNames(models).length}/${
                        available.length
                      }`
                    : ""}
                </span>
                <FieldButton
                  icon={<RefreshCw size={16} />}
                  text="获取模型"
                  busy={refreshing}
                  busyText="正在获取模型"
                  onClick={() => void refresh()}
                  disabled={saving || refreshing}
                />
              </div>
              {available.length > 0 && (
                <div
                  className={styles["provider-model-list"]}
                  role="group"
                  aria-label="选择自定义模型"
                >
                  {available.map((id) => (
                    <ChoiceButton
                      key={id}
                      selected={customModelNames(models).includes(id)}
                      disabled={saving || refreshing}
                      onClick={() => {
                        const selected = customModelNames(models);
                        setModels(
                          (selected.includes(id)
                            ? selected.filter((name) => name !== id)
                            : [...selected, id]
                          ).join(","),
                        );
                      }}
                    >
                      {id}
                    </ChoiceButton>
                  ))}
                </div>
              )}
              <details>
                <summary>手动补充模型</summary>
                <TextField
                  fullWidth
                  aria-label="补充模型 ID"
                  placeholder="模型 ID，多个用英文逗号分隔"
                  value={models}
                  onChange={(event) => setModels(event.target.value)}
                  disabled={saving || refreshing}
                />
              </details>
            </div>
            <p className={styles["provider-note"]}>
              {mode === "responses" ? text.ResponsesHint : text.LocalHint}
            </p>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles["provider-error"]}>
          {error}
        </p>
      )}
      {(dirty || saving || saved) && (
        <div className={styles["provider-actions"]}>
          {saved && !dirty && !saving ? (
            <span role="status" className={styles["provider-note"]}>
              {text.Saved}
            </span>
          ) : (
            <FieldButton
              icon={<Save size={16} />}
              text={text.Apply}
              busy={saving}
              busyText={Locale.Account.Saving}
              type="primary"
              onClick={() => void apply()}
              disabled={saving || refreshing || access.switchingToken}
            />
          )}
        </div>
      )}
    </section>
  );
}
