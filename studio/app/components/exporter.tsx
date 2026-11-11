/* eslint-disable @next/next/no-img-element */
import { ChatMessage, useAppConfig, useChatStore } from "../store";
import Locale from "../locales";
import styles from "./exporter.module.scss";
import {
  List,
  ListItem,
  Modal,
  Select,
  showImageModal,
  showModal,
  showToast,
  useModalClose,
} from "./ui-lib";
import { IconButton } from "./button";
import { Checkbox } from "./form-controls";
import {
  copyToClipboard,
  downloadAs,
  getMessageImages,
  useMobileScreen,
} from "../utils";

import CopyIcon from "../icons/copy.svg";
import LoadingIcon from "../icons/three-dots.svg";
import ShareIcon from "../icons/share.svg";

import DownloadIcon from "../icons/download.svg";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSelector, useMessageSelector } from "./message-selector";
import { Avatar } from "./emoji";
import dynamic from "next/dynamic";

import { toBlob, toPng } from "html-to-image";

import { prettyObject } from "../utils/format";
import { EXPORT_MESSAGE_CLASS_NAME } from "../constant";
import { getClientConfig } from "../config/client";
import { getMessageTextContent } from "../utils";
import { MaskAvatar } from "./mask-avatar";
import clsx from "clsx";
import {
  WebRTCSharer,
  generateRoomCode,
  buildShareLink,
  fetchImageAsBase64,
  type SharePayload,
  type ShareMessage,
} from "../utils/webrtc-share";

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
  ssr: false,
});

import { createPortal } from "react-dom";

export function ExportMessageModal(props: { onClose: () => void }) {
  const { maskRef, requestClose } = useModalClose(props.onClose);

  return createPortal(
    <div ref={maskRef} className="modal-mask">
      <Modal
        title={Locale.Export.Title}
        onClose={() => requestClose()}
        footer={
          <div
            style={{
              width: "100%",
              textAlign: "center",
              fontSize: 14,
              opacity: 0.5,
            }}
          >
            {Locale.Exporter.Description.Title}
          </div>
        }
      >
        <div style={{ minHeight: "40vh" }}>
          <MessageExporter />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}

function useSteps(
  steps: Array<{
    name: string;
    value: string;
  }>,
) {
  const stepCount = steps.length;
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const nextStep = () =>
    setCurrentStepIndex((currentStepIndex + 1) % stepCount);
  const prevStep = () =>
    setCurrentStepIndex((currentStepIndex - 1 + stepCount) % stepCount);

  return {
    currentStepIndex,
    setCurrentStepIndex,
    nextStep,
    prevStep,
    currentStep: steps[currentStepIndex],
  };
}

function Steps<
  T extends {
    name: string;
    value: string;
  }[],
>(props: { steps: T; onStepChange?: (index: number) => void; index: number }) {
  const steps = props.steps;
  const stepCount = steps.length;

  return (
    <div className={styles["steps"]}>
      <div className={styles["steps-progress"]}>
        <div
          className={styles["steps-progress-inner"]}
          style={{
            width: `${((props.index + 1) / stepCount) * 100}%`,
          }}
        ></div>
      </div>
      <div className={styles["steps-inner"]}>
        {steps.map((step, i) => {
          return (
            <div
              key={i}
              className={clsx("clickable", styles["step"], {
                [styles["step-finished"]]: i <= props.index,
                [styles["step-current"]]: i === props.index,
              })}
              onClick={() => {
                props.onStepChange?.(i);
              }}
              role="button"
            >
              <span className={styles["step-index"]}>{i + 1}</span>
              <span className={styles["step-name"]}>{step.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MessageExporter() {
  const steps = [
    {
      name: Locale.Export.Steps.Select,
      value: "select",
    },
    {
      name: Locale.Export.Steps.Preview,
      value: "preview",
    },
  ];
  const { currentStep, setCurrentStepIndex, currentStepIndex } =
    useSteps(steps);
  const formats = ["text", "image", "json"] as const;
  type ExportFormat = (typeof formats)[number];

  const [exportConfig, setExportConfig] = useState({
    format: "image" as ExportFormat,
    includeContext: true,
  });

  function updateExportConfig(updater: (config: typeof exportConfig) => void) {
    const config = { ...exportConfig };
    updater(config);
    setExportConfig(config);
  }

  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const { selection, updateSelection } = useMessageSelector();
  const selectedMessages = useMemo(() => {
    const ret: ChatMessage[] = [];
    if (exportConfig.includeContext) {
      ret.push(...session.mask.context);
    }
    ret.push(...session.messages.filter((m) => selection.has(m.id)));
    return ret;
  }, [
    exportConfig.includeContext,
    session.messages,
    session.mask.context,
    selection,
  ]);
  function preview() {
    if (exportConfig.format === "text") {
      return (
        <MarkdownPreviewer messages={selectedMessages} topic={session.topic} />
      );
    } else if (exportConfig.format === "json") {
      return (
        <JsonPreviewer messages={selectedMessages} topic={session.topic} />
      );
    } else {
      return (
        <ImagePreviewer messages={selectedMessages} topic={session.topic} />
      );
    }
  }
  return (
    <>
      <Steps
        steps={steps}
        index={currentStepIndex}
        onStepChange={setCurrentStepIndex}
      />
      <div
        className={styles["message-exporter-body"]}
        style={currentStep.value !== "select" ? { display: "none" } : {}}
      >
        <List>
          <ListItem
            title={Locale.Export.Format.Title}
            subTitle={Locale.Export.Format.SubTitle}
          >
            <Select
              value={exportConfig.format}
              onChange={(e) =>
                updateExportConfig(
                  (config) =>
                    (config.format = e.currentTarget.value as ExportFormat),
                )
              }
            >
              {formats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </ListItem>
          <ListItem
            title={Locale.Export.IncludeContext.Title}
            subTitle={Locale.Export.IncludeContext.SubTitle}
          >
            <Checkbox
              aria-label={Locale.Export.IncludeContext.Title}
              checked={exportConfig.includeContext}
              onChange={(e) => {
                updateExportConfig(
                  (config) => (config.includeContext = e.currentTarget.checked),
                );
              }}
            />
          </ListItem>
        </List>
        <MessageSelector
          selection={selection}
          updateSelection={updateSelection}
          defaultSelectAll
        />
      </div>
      {currentStep.value === "preview" && (
        <div className={styles["message-exporter-body"]}>{preview()}</div>
      )}
    </>
  );
}

export function RenderExport(props: {
  messages: ChatMessage[];
  onRender: (messages: ChatMessage[]) => void;
}) {
  const domRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!domRef.current) return;
    const dom = domRef.current;
    const messages = Array.from(
      dom.getElementsByClassName(EXPORT_MESSAGE_CLASS_NAME),
    );

    if (messages.length !== props.messages.length) {
      return;
    }

    const renderMsgs = messages.map((v, i) => {
      const [role, _] = v.id.split(":");
      return {
        id: i.toString(),
        role: role as any,
        content: role === "user" ? v.textContent ?? "" : v.innerHTML,
        date: "",
      };
    });

    props.onRender(renderMsgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={domRef}>
      {props.messages.map((m, i) => (
        <div
          key={i}
          id={`${m.role}:${i}`}
          className={EXPORT_MESSAGE_CLASS_NAME}
        >
          <Markdown content={getMessageTextContent(m)} defaultShow />
        </div>
      ))}
    </div>
  );
}

export function PreviewActions(props: {
  download: () => void;
  copy: () => void;
  showCopy?: boolean;
  messages?: ChatMessage[];
  topic?: string;
}) {
  const [loading, setLoading] = useState(false);
  const sharerRef = useRef<WebRTCSharer | null>(null);
  const operationRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  const share = async () => {
    if (operationRef.current || !props.messages?.length) return;
    const operation = new AbortController();
    const signal = operation.signal;
    operationRef.current = operation;
    sharerRef.current?.cancel();
    sharerRef.current = null;
    setLoading(true);
    let sharer: WebRTCSharer | null = null;

    try {
      // 1. 生成房间码和链接
      const room = generateRoomCode();
      const link = buildShareLink(room);

      // 2. 准备 payload（转换图片为 base64）
      const shareMessages: ShareMessage[] = [];
      for (const m of props.messages) {
        const images = getMessageImages(m);
        const base64Images: string[] = [];
        for (const img of images) {
          const base64 = await fetchImageAsBase64(img, signal);
          if (signal.aborted) return;
          if (base64) base64Images.push(base64);
        }
        shareMessages.push({
          role: m.role,
          content: getMessageTextContent(m),
          images: base64Images.length > 0 ? base64Images : undefined,
          model: m.model,
          date: m.date,
        });
      }

      const payload: SharePayload = {
        topic: props.topic || "分享对话",
        messages: shareMessages,
      };

      // 3. 创建 WebRTC 分享方
      if (signal.aborted) return;
      sharer = new WebRTCSharer(room);
      sharerRef.current = sharer;

      // 4. 复制链接到剪贴板
      await copyToClipboard(link);
      if (signal.aborted) return;

      // 5. 弹窗提示
      showModal({
        title: "临时分享链接已创建",
        children: [
          <div
            key="info"
            style={{
              marginBottom: 12,
              fontSize: 14,
              color: "var(--second-in-gray)",
            }}
          >
            链接已复制到剪贴板。分享链接仅在当前页面打开时有效，关闭页面后链接失效。
          </div>,
          <input
            type="text"
            value={link}
            key="input"
            style={{
              width: "100%",
              maxWidth: "unset",
            }}
            readOnly
            onClick={(e) => e.currentTarget.select()}
          />,
        ],
        actions: [
          <IconButton
            icon={<CopyIcon />}
            text="再次复制"
            key="copy"
            onClick={() => copyToClipboard(link)}
          />,
        ],
      });

      // 6. 建立 P2P 连接并传输
      await sharer.connect(() => {});
      if (signal.aborted) return;
      await sharer.sendPayload(payload, () => {});
      if (!signal.aborted) showToast("对话分享完成");
    } catch (e) {
      sharer?.cancel();
      if (sharerRef.current === sharer) sharerRef.current = null;
      if (!signal.aborted && mountedRef.current) {
        console.error("[Share]", e);
        showToast(prettyObject(e));
      }
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  };

  // 组件卸载时清理
  useEffect(() => {
    mountedRef.current = true;
    const cancel = () => {
      operationRef.current?.abort();
      sharerRef.current?.cancel();
      sharerRef.current = null;
    };
    window.addEventListener("beforeunload", cancel);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeunload", cancel);
      cancel();
    };
  }, []);

  return (
    <>
      <div className={styles["preview-actions"]}>
        {props.showCopy && (
          <IconButton
            text={Locale.Export.Copy}
            bordered
            shadow
            icon={<CopyIcon />}
            onClick={props.copy}
          ></IconButton>
        )}
        <IconButton
          text={Locale.Export.Download}
          bordered
          shadow
          icon={<DownloadIcon />}
          onClick={props.download}
        ></IconButton>
        <IconButton
          text="临时链接"
          bordered
          shadow
          icon={<ShareIcon />}
          busy={loading}
          onClick={share}
        ></IconButton>
      </div>
    </>
  );
}

export function ImagePreviewer(props: {
  messages: ChatMessage[];
  topic: string;
}) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const mask = session.mask;
  const config = useAppConfig();

  const previewRef = useRef<HTMLDivElement>(null);

  const copy = () => {
    showToast(Locale.Export.Image.Toast);
    const dom = previewRef.current;
    if (!dom) return;
    toBlob(dom).then((blob) => {
      if (!blob) return;
      try {
        navigator.clipboard
          .write([
            new ClipboardItem({
              "image/png": blob,
            }),
          ])
          .then(() => {
            showToast(Locale.Copy.Success);
            refreshPreview();
          });
      } catch (e) {
        console.error("[Copy Image] ", e);
        showToast(Locale.Copy.Failed);
      }
    });
  };

  const isMobile = useMobileScreen();

  const download = async () => {
    showToast(Locale.Export.Image.Toast);
    const dom = previewRef.current;
    if (!dom) return;

    const isApp = getClientConfig()?.isApp;

    try {
      const blob = await toPng(dom);
      if (!blob) return;

      if (isMobile || (isApp && window.__TAURI__)) {
        if (isApp && window.__TAURI__) {
          const result = await window.__TAURI__.dialog.save({
            defaultPath: `${props.topic}.png`,
            filters: [
              {
                name: "PNG Files",
                extensions: ["png"],
              },
              {
                name: "All Files",
                extensions: ["*"],
              },
            ],
          });

          if (result !== null) {
            const response = await fetch(blob);
            const buffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(buffer);
            await window.__TAURI__.fs.writeBinaryFile(result, uint8Array);
            showToast(Locale.Download.Success);
          } else {
            showToast(Locale.Download.Failed);
          }
        } else {
          showImageModal(blob);
        }
      } else {
        const link = document.createElement("a");
        link.download = `${props.topic}.png`;
        link.href = blob;
        link.click();
        refreshPreview();
      }
    } catch {
      showToast(Locale.Download.Failed);
    }
  };

  const refreshPreview = () => {
    const dom = previewRef.current;
    if (dom) {
      dom.innerHTML = dom.innerHTML; // Refresh the content of the preview by resetting its HTML for fix a bug glitching
    }
  };

  return (
    <div className={styles["image-previewer"]}>
      <PreviewActions
        copy={copy}
        download={download}
        showCopy={!isMobile}
        messages={props.messages}
        topic={props.topic}
      />
      <div
        className={clsx(styles["preview-body"], styles["default-theme"])}
        ref={previewRef}
      >
        <div className={styles["chat-info"]}>
          <div className={styles["chat-info-brand"]}>
            <div className={clsx(styles["brand-logo"], "no-dark")}>
              <img
                src="/studio/macos.png"
                alt="logo"
                width={40}
                height={40}
                style={{
                  display: "block",
                  borderRadius: 8,
                  flexShrink: 0,
                  objectFit: "cover",
                }}
              />
            </div>
            <div className={styles["brand-text"]}>
              <div className={styles["main-title"]}>章鱼公益平台</div>
              <div className={styles["sub-title"]}>zhangyuapi.com</div>
            </div>
          </div>

          <div className={styles["chat-info-meta"]}>
            <div className={styles["meta-avatars"]}>
              <MaskAvatar avatar={config.avatar} />
              <span className={styles["meta-connector"]}>&</span>
              <MaskAvatar
                avatar={mask.avatar}
                model={session.mask.modelConfig.model}
              />
            </div>
            <div className={styles["meta-list"]}>
              <div className={styles["meta-item"]}>
                <span className={styles["meta-label"]}>
                  {Locale.Exporter.Model}
                </span>
                <span className={styles["meta-value"]}>
                  {mask.modelConfig.model}
                </span>
              </div>
              <div className={styles["meta-item"]}>
                <span className={styles["meta-label"]}>
                  {Locale.Exporter.Messages}
                </span>
                <span className={styles["meta-value"]}>
                  {props.messages.length}
                </span>
              </div>
              <div className={styles["meta-item"]}>
                <span className={styles["meta-label"]}>
                  {Locale.Exporter.Topic}
                </span>
                <span className={styles["meta-value"]}>{session.topic}</span>
              </div>
              <div className={styles["meta-item"]}>
                <span className={styles["meta-label"]}>
                  {Locale.Exporter.Time}
                </span>
                <span className={styles["meta-value"]}>
                  {new Date(
                    props.messages.at(-1)?.date ?? Date.now(),
                  ).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
        {props.messages.map((m, i) => {
          return (
            <div
              className={clsx(styles["message"], styles["message-" + m.role])}
              key={i}
            >
              <div className={styles["avatar"]}>
                {m.role === "user" ? (
                  <Avatar avatar={config.avatar}></Avatar>
                ) : (
                  <MaskAvatar
                    avatar={session.mask.avatar}
                    model={m.model || session.mask.modelConfig.model}
                  />
                )}
              </div>

              <div className={styles["body"]}>
                <Markdown
                  content={getMessageTextContent(m)}
                  fontSize={config.fontSize}
                  fontFamily={config.fontFamily}
                  defaultShow
                />
                {getMessageImages(m).length == 1 && (
                  <img
                    key={i}
                    src={getMessageImages(m)[0]}
                    alt="message"
                    className={styles["message-image"]}
                  />
                )}
                {getMessageImages(m).length > 1 && (
                  <div
                    className={styles["message-images"]}
                    style={
                      {
                        "--image-count": getMessageImages(m).length,
                      } as React.CSSProperties
                    }
                  >
                    {getMessageImages(m).map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt="message"
                        className={styles["message-image-multi"]}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MarkdownPreviewer(props: {
  messages: ChatMessage[];
  topic: string;
}) {
  const mdText =
    `# ${props.topic}\n\n` +
    props.messages
      .map((m) => {
        return m.role === "user"
          ? `## ${Locale.Export.MessageFromYou}:\n${getMessageTextContent(m)}`
          : `## ${Locale.Export.MessageFromChatGPT}:\n${getMessageTextContent(
              m,
            ).trim()}`;
      })
      .join("\n\n");

  const copy = () => {
    copyToClipboard(mdText);
  };
  const download = () => {
    downloadAs(mdText, `${props.topic}.md`);
  };
  return (
    <>
      <PreviewActions
        copy={copy}
        download={download}
        showCopy={true}
        messages={props.messages}
        topic={props.topic}
      />
      <div className="markdown-body">
        <pre className={styles["export-content"]}>{mdText}</pre>
      </div>
    </>
  );
}

export function JsonPreviewer(props: {
  messages: ChatMessage[];
  topic: string;
}) {
  const msgs = {
    messages: [
      {
        role: "system",
        content: `${Locale.FineTuned.Sysmessage} ${props.topic}`,
      },
      ...props.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ],
  };
  const mdText = "```json\n" + JSON.stringify(msgs, null, 2) + "\n```";
  const minifiedJson = JSON.stringify(msgs);

  const copy = () => {
    copyToClipboard(minifiedJson);
  };
  const download = () => {
    downloadAs(JSON.stringify(msgs), `${props.topic}.json`);
  };

  return (
    <>
      <PreviewActions
        copy={copy}
        download={download}
        showCopy={false}
        messages={props.messages}
        topic={props.topic}
      />
      <div className="markdown-body" onClick={copy}>
        <Markdown content={mdText} />
      </div>
    </>
  );
}
