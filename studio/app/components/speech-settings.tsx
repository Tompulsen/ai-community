"use client";

import { Square, Volume2 } from "lucide-react";
import { useAppConfig } from "../store";
import { useReadAloud } from "../utils/use-read-aloud";
import { getLang } from "../locales";
import { useMobileScreen } from "../utils";
import { FieldButton } from "./form-controls";
import { InputRange } from "./input-range";
import { SettingsSelect } from "./settings-select";
import { List, ListItem } from "./ui-lib";
import styles from "./settings.module.scss";
import speechStyles from "./speech-settings.module.scss";

export function SpeechSettings() {
  const config = useAppConfig();
  const mobile = useMobileScreen();
  const reader = useReadAloud({
    voiceURI: config.speechVoiceURI,
    rate: config.speechRate,
    lang: getLang() === "cn" ? "zh-CN" : "en-US",
  });
  const voiceAvailable = reader.voices.some(
    (voice) => voice.voiceURI === config.speechVoiceURI,
  );
  const options = [
    { value: "", label: "自动选择" },
    ...reader.voices.map((voice) => ({
      value: voice.voiceURI,
      label: `${voice.name} · ${voice.lang}${
        voice.localService ? " · 本地" : " · 在线"
      }`,
    })),
  ];
  return (
    <>
      <div className={styles["settings-section"]}>
        <div className={styles["settings-section-title"]}>语音朗读</div>
      </div>
      <List>
        <ListItem
          title="声音"
          vertical={mobile}
          subTitle={
            reader.supported
              ? "优先选择本地声音；标注“在线”的声音可能通过设备语音服务处理。"
              : "当前浏览器不支持朗读，请尝试使用系统浏览器。"
          }
        >
          <SettingsSelect
            title="朗读声音"
            presentation="dialog"
            className={speechStyles.voice}
            value={voiceAvailable ? config.speechVoiceURI : ""}
            options={options}
            disabled={!reader.supported}
            onChange={(value) => {
              reader.stop();
              config.update((state) => {
                state.speechVoiceURI = value;
              });
            }}
          />
        </ListItem>
        {reader.supported && (
          <>
            <ListItem title="语速">
              <InputRange
                aria="朗读语速"
                title={`${(config.speechRate ?? 1).toFixed(1)}×`}
                value={config.speechRate ?? 1}
                min="0.5"
                max="2"
                step="0.1"
                onChange={(event) => {
                  reader.stop();
                  const value = Number(event.currentTarget.value);
                  config.update((state) => {
                    state.speechRate = value;
                  });
                }}
              />
            </ListItem>
            <ListItem title="试听" subTitle={reader.error ?? undefined}>
              <FieldButton
                aria={reader.activeId ? "停止试听" : "试听声音"}
                text={reader.activeId ? "停止" : "试听"}
                icon={
                  reader.activeId ? <Square size={16} /> : <Volume2 size={16} />
                }
                onClick={() =>
                  reader.activeId
                    ? reader.stop()
                    : reader.speak(
                        "preview",
                        "你好，很高兴与你交流。这是当前的朗读声音。",
                      )
                }
              />
            </ListItem>
          </>
        )}
      </List>
    </>
  );
}
