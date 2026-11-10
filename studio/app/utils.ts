import { useEffect, useState } from "react";
import { showToast } from "./components/ui-lib";
import Locale from "./locales";
import { RequestMessage } from "./client/api";
import {
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS_FOR_THINKING,
} from "./constant";
// import { fetch as tauriFetch, ResponseType } from "@tauri-apps/api/http";
import { fetch as tauriStreamFetch } from "./utils/stream";
import { useAccessStore } from "./store";
import { ModelSize } from "./typing";
import { getModelCapabilities } from "./utils/model-capabilities";
import { usesCustomProvider } from "./utils/custom-provider";

export function trimTopic(topic: string) {
  // Fix an issue where double quotes still show in the Indonesian language
  // This will remove the specified punctuation from the end of the string
  // and also trim quotes from both the start and end if they exist.
  return (
    topic
      // fix for gemini
      .replace(/^["“”*]+|["“”*]+$/g, "")
      .replace(/[，。！？”“"、,.!?*]*$/, "")
  );
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (window.__TAURI__) {
      await window.__TAURI__.writeText(text);
    } else {
      await navigator.clipboard.writeText(text);
    }

    showToast(Locale.Copy.Success);
    return true;
  } catch {
    const active = document.activeElement;
    const input =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement
        ? active
        : undefined;
    const inputSelection =
      input?.selectionStart != null && input.selectionEnd != null
        ? {
            start: input.selectionStart,
            end: input.selectionEnd,
            direction: input.selectionDirection,
            scrollTop: input.scrollTop,
            scrollLeft: input.scrollLeft,
          }
        : undefined;
    const selection = document.getSelection();
    const ranges = inputSelection
      ? []
      : Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) =>
          selection!.getRangeAt(index).cloneRange(),
        );
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.tabIndex = -1;
    textArea.setAttribute("aria-hidden", "true");
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.opacity = "0";
    try {
      document.body.appendChild(textArea);
      textArea.focus({ preventScroll: true });
      textArea.select();
      const copied = document.execCommand("copy") === true;
      showToast(copied ? Locale.Copy.Success : Locale.Copy.Failed);
      return copied;
    } catch {
      showToast(Locale.Copy.Failed);
      return false;
    } finally {
      textArea.remove();
      try {
        if (active instanceof HTMLElement && active.isConnected)
          active.focus({ preventScroll: true });
        if (input?.isConnected && inputSelection) {
          input.setSelectionRange(
            inputSelection.start,
            inputSelection.end,
            inputSelection.direction ?? undefined,
          );
          input.scrollTop = inputSelection.scrollTop;
          input.scrollLeft = inputSelection.scrollLeft;
        } else if (selection) {
          selection.removeAllRanges();
          for (const range of ranges)
            if (
              range.startContainer.isConnected &&
              range.endContainer.isConnected
            )
              selection.addRange(range);
        }
      } catch {
        // Focus restoration must not change the clipboard operation's result.
      }
    }
  }
}

export async function downloadAs(text: string, filename: string) {
  if (window.__TAURI__) {
    const result = await window.__TAURI__.dialog.save({
      defaultPath: `${filename}`,
      filters: [
        {
          name: `${filename.split(".").pop()} files`,
          extensions: [`${filename.split(".").pop()}`],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (result !== null) {
      try {
        await window.__TAURI__.fs.writeTextFile(result, text);
        showToast(Locale.Download.Success);
      } catch {
        showToast(Locale.Download.Failed);
      }
    } else {
      showToast(Locale.Download.Failed);
    }
  } else {
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(text),
    );
    element.setAttribute("download", filename);

    element.style.display = "none";
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
  }
}

export function readFromFile() {
  return new Promise<string>((res, rej) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json";

    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      const fileReader = new FileReader();
      fileReader.onload = (e: any) => {
        res(e.target.result);
      };
      fileReader.onerror = (e) => rej(e);
      fileReader.readAsText(file);
    };

    fileInput.click();
  });
}

export function isIOS() {
  const userAgent = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

export function useWindowSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return size;
}

export const MOBILE_MAX_WIDTH = 600;
export function useMobileScreen() {
  const { width } = useWindowSize();

  return width <= MOBILE_MAX_WIDTH;
}

export function isFirefox() {
  return (
    typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)
  );
}

export function selectOrCopy(el: HTMLElement, content: string) {
  const currentSelection = window.getSelection();

  if (currentSelection?.type === "Range") {
    return false;
  }

  copyToClipboard(content);

  return true;
}

function getDomContentWidth(
  dom: HTMLElement,
  style: CSSStyleDeclaration,
  contentWidth?: number,
) {
  const paddingWidth =
    (parseFloat(style.paddingLeft) || 0) +
    (parseFloat(style.paddingRight) || 0);
  const width =
    (contentWidth === undefined
      ? dom.clientWidth
      : Math.round(contentWidth + paddingWidth)) - paddingWidth;
  return width;
}

function getOrCreateMeasureDom(id: string) {
  let dom = document.getElementById(id);

  if (!dom) {
    dom = document.createElement("span");
    dom.style.all = "initial";
    dom.style.position = "absolute";
    dom.style.display = "block";
    dom.style.visibility = "hidden";
    dom.style.left = "-10000px";
    dom.style.top = "0";
    dom.style.pointerEvents = "none";
    dom.id = id;
    dom.setAttribute("aria-hidden", "true");
    document.body.appendChild(dom);
  }

  return dom!;
}

export function autoGrowTextArea(
  dom: HTMLTextAreaElement,
  contentWidth?: number,
) {
  const style = window.getComputedStyle(dom);
  const width = getDomContentWidth(dom, style, contentWidth);
  if (width <= 0) return 1;

  const properties = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "fontStretch",
    "fontKerning",
    "fontFeatureSettings",
    "fontVariationSettings",
    "lineHeight",
    "letterSpacing",
    "wordSpacing",
    "textTransform",
    "textIndent",
    "wordBreak",
    "overflowWrap",
    "whiteSpace",
    "tabSize",
    "direction",
    "lineBreak",
  ] as const;
  const values = properties.map(
    (property) => [property, style[property]] as const,
  );
  const measureDom = getOrCreateMeasureDom("__measure");
  const singleLineDom = getOrCreateMeasureDom("__single_measure");
  const measuredWidth = width + "px";

  for (const element of [measureDom, singleLineDom]) {
    if (element.style.width !== measuredWidth)
      element.style.width = measuredWidth;
    for (const [property, value] of values) {
      if (element.style[property] !== value) element.style[property] = value;
    }
  }

  // A final line needs a glyph to give it a line box, even when it is empty.
  const text =
    dom.value === "" || dom.value.endsWith("\n")
      ? dom.value + "\u200b"
      : dom.value;
  if (measureDom.textContent !== text) measureDom.textContent = text;
  if (singleLineDom.textContent !== "M") singleLineDom.textContent = "M";
  const height = parseFloat(window.getComputedStyle(measureDom).height);
  const singleLineHeight = parseFloat(
    window.getComputedStyle(singleLineDom).height,
  );

  return Math.max(1, Math.round(height / singleLineHeight) || 1);
}

export function getCSSVar(varName: string) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

/**
 * Detects Macintosh
 */
export function isMacOS(): boolean {
  if (typeof window !== "undefined") {
    let userAgent = window.navigator.userAgent.toLocaleLowerCase();
    const macintosh = /iphone|ipad|ipod|macintosh/.test(userAgent);
    return !!macintosh;
  }
  return false;
}

export function getMessageTextContent(message: RequestMessage) {
  if (typeof message.content === "string") {
    return message.content;
  }
  for (const c of message.content) {
    if (c.type === "text") {
      return c.text ?? "";
    }
  }
  return "";
}

export function getMessageTextContentWithoutThinking(message: RequestMessage) {
  let content = "";

  if (typeof message.content === "string") {
    content = message.content;
  } else {
    for (const c of message.content) {
      if (c.type === "text") {
        content = c.text ?? "";
        break;
      }
    }
  }

  // Filter out thinking lines (starting with "> ")
  return content
    .split("\n")
    .filter((line) => !line.startsWith("> ") && line.trim() !== "")
    .join("\n")
    .trim();
}

export function getMessageImages(message: RequestMessage): string[] {
  if (typeof message.content === "string") {
    return [];
  }
  const urls: string[] = [];
  for (const c of message.content) {
    if (c.type === "image_url") {
      urls.push(c.image_url?.url ?? "");
    }
  }
  return urls;
}

export function isVisionModel(model: string, providerName?: string) {
  const visionModels = useAccessStore.getState().visionModels;
  const envVisionModels = visionModels?.split(",").map((m) => m.trim());
  if (envVisionModels?.includes(model)) {
    return true;
  }
  return getModelCapabilities(model, providerName).vision;
}

export function isDalle3(model: string) {
  return "dall-e-3" === model;
}

// 生图模型：走 images/generations 接口
export function isImageGenerationModel(
  model: string,
  providerName?: string,
): boolean {
  return getModelCapabilities(model, providerName).usesImageApi;
}

export function shouldUseImageGenerationApi(
  config: { model: string; providerName?: string; chatApiFormat?: string },
  options: {
    hasFiles?: boolean;
    capabilities?: ReturnType<typeof getModelCapabilities>;
    customImageMode?: boolean;
  } = {},
): boolean {
  const capabilities =
    options.capabilities ??
    getModelCapabilities(config.model, config.providerName);
  if (
    options.hasFiles ||
    capabilities.category === "video" ||
    capabilities.override === "chat" ||
    capabilities.override === "video"
  )
    return false;
  if (capabilities.override === "image") return true;
  if (config.chatApiFormat && config.chatApiFormat !== "chat-completions")
    return false;
  const customImageMode =
    options.customImageMode ??
    (() => {
      const access = useAccessStore.getState();
      return (
        usesCustomProvider(access, config.providerName) &&
        access.customApiMode !== "auto"
      );
    })();
  return capabilities.usesImageApi || customImageMode;
}

// 多模态识图模型：gpt-4v 等，走 chat/completions 接口
// 统一委托给 isVisionModel（避免两套规则不一致）
export function isVisionModelCheck(
  model: string,
  providerName?: string,
): boolean {
  return isVisionModel(model, providerName);
}

// 文生图模型（兼容旧名称）
export function isImageModelCheck(
  model: string,
  providerName?: string,
): boolean {
  return isImageGenerationModel(model, providerName);
}

export function isImageModel(model: string, providerName?: string): boolean {
  return getModelCapabilities(model, providerName).category === "image";
}

/**
 * 视频生成模型检测
 * 通过模型名称正则匹配 + type 字段判断
 * 支持 t2v(文生视频) / i2v(图生视频) / s2v / sora / runway / pika / kling / hailuo / minimax 等
 */
export function isVideoModel(model: string, providerName?: string): boolean {
  return getModelCapabilities(model, providerName).category === "video";
}

export function getTimeoutMSByModel(model: string) {
  model = model.toLowerCase();
  if (
    model.startsWith("dall-e") ||
    model.startsWith("dalle") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.includes("deepseek-r") ||
    model.includes("-thinking")
  )
    return REQUEST_TIMEOUT_MS_FOR_THINKING;
  return REQUEST_TIMEOUT_MS;
}

export function getModelSizes(model: string): ModelSize[] {
  if (isDalle3(model)) {
    return ["1024x1024", "1792x1024", "1024x1792"];
  }
  if (model.toLowerCase().includes("cogview")) {
    return [
      "1024x1024",
      "768x1344",
      "864x1152",
      "1344x768",
      "1152x864",
      "1440x720",
      "720x1440",
    ];
  }
  return [];
}

export function supportsCustomSize(model: string): boolean {
  return getModelSizes(model).length > 0;
}

export function fetch(
  url: string,
  options?: Record<string, unknown>,
): Promise<any> {
  if (window.__TAURI__) {
    return tauriStreamFetch(url, options);
  }
  return window.fetch(url, options);
}

export function adapter(config: Record<string, unknown>) {
  const { baseURL, url, params, data: body, ...rest } = config;
  const path = baseURL ? `${baseURL}${url}` : url;
  const fetchUrl = params
    ? `${path}?${new URLSearchParams(params as any).toString()}`
    : path;
  return fetch(fetchUrl as string, { ...rest, body }).then((res) => {
    const { status, headers, statusText } = res;
    return res
      .text()
      .then((data: string) => ({ status, statusText, headers, data }));
  });
}

export function safeLocalStorage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
} {
  let storage: Storage | null;

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      storage = window.localStorage;
    } else {
      storage = null;
    }
  } catch (e) {
    console.error("localStorage is not available:", e);
    storage = null;
  }

  return {
    getItem(key: string): string | null {
      if (storage) {
        return storage.getItem(key);
      } else {
        console.warn(
          `Attempted to get item "${key}" from localStorage, but localStorage is not available.`,
        );
        return null;
      }
    },
    setItem(key: string, value: string): void {
      if (storage) {
        storage.setItem(key, value);
      } else {
        console.warn(
          `Attempted to set item "${key}" in localStorage, but localStorage is not available.`,
        );
      }
    },
    removeItem(key: string): void {
      if (storage) {
        storage.removeItem(key);
      } else {
        console.warn(
          `Attempted to remove item "${key}" from localStorage, but localStorage is not available.`,
        );
      }
    },
    clear(): void {
      if (storage) {
          for (let index = storage.length - 1; index >= 0; index--) {
            const key = storage.key(index);
            if (key?.startsWith("octopus:")) storage.removeItem(key);
          }
      } else {
        console.warn(
          "Attempted to clear localStorage, but localStorage is not available.",
        );
      }
    },
  };
}

export function getOperationId(operation: {
  operationId?: string;
  method: string;
  path: string;
}) {
  // pattern '^[a-zA-Z0-9_-]+$'
  return (
    operation?.operationId ||
    `${operation.method.toUpperCase()}${operation.path.replaceAll("/", "_")}`
  );
}

export function clientUpdate() {
  // this a wild for updating client app
  return window.__TAURI__?.updater
    .checkUpdate()
    .then((updateResult) => {
      if (updateResult.shouldUpdate) {
        window.__TAURI__?.updater
          .installUpdate()
          .then(() => {
            showToast(Locale.Settings.Update.Success);
          })
          .catch((e) => {
            console.error("[Install Update Error]", e);
            showToast(Locale.Settings.Update.Failed);
          });
      }
    })
    .catch((e) => {
      console.error("[Check Update Error]", e);
      showToast(Locale.Settings.Update.Failed);
    });
}

// https://gist.github.com/iwill/a83038623ba4fef6abb9efca87ae9ccb
export function semverCompare(a: string, b: string) {
  if (a.startsWith(b + "-")) return -1;
  if (b.startsWith(a + "-")) return 1;
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "case",
    caseFirst: "upper",
  });
}
