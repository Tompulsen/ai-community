import {
  CACHE_URL_PREFIX,
  UPLOAD_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import { getCachedImage, setCachedImage } from "./image-cache";
import {
  MultimodalContent,
  RequestMessage,
  type ChatGenerationProgress,
} from "@/app/client/api";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "./format";
import { getUserFriendlyError } from "./error-hints";
import { fetch as tauriFetch } from "./stream";
import { createReasoningStream, type ReasoningDelta } from "./reasoning-stream";
import { estimateTokenLength } from "./token-estimate";

const TOOL_RETRY_DELAY_MS = 60;
let heicConverter: Promise<typeof import("heic2any").default> | undefined;

/**
 * 智能图片压缩
 * - 小图片（<200KB）不压缩，保持原始质量
 * - 中等图片（200KB-1MB）轻微压缩
 * - 大图片（>1MB）aggressive 压缩（尺寸 + 质量）
 * - 优先使用 WebP 格式，Safari 回退到 JPEG
 */
export async function compressImage(
  file: Blob,
  maxSize: number,
): Promise<string> {
  function readDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const cleanup = () => {
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
      };
      reader.onload = () => {
        const result = reader.result;
        cleanup();
        if (typeof result === "string") resolve(result);
        else reject(new Error("Image data could not be read"));
      };
      reader.onerror = () => {
        const error = reader.error;
        cleanup();
        reject(error ?? new Error("Image data could not be read"));
      };
      reader.onabort = () => {
        cleanup();
        reject(new DOMException("Image reading was aborted", "AbortError"));
      };
      try {
        reader.readAsDataURL(blob);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  function dataUrlLength(blob: Blob) {
    return (
      Math.ceil(blob.size / 3) * 4 +
      `data:${blob.type || "application/octet-stream"};base64,`.length
    );
  }

  function encode(
    canvas: HTMLCanvasElement,
    type: string,
    quality: number,
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Image could not be encoded")),
        type,
        quality,
      );
    });
  }

  let source = file;
  if (file.type.includes("heic")) {
    const heic2any = await (heicConverter ??= import("heic2any")
      .then((module) => module.default)
      .catch((error) => {
        heicConverter = undefined;
        throw error;
      }));
    const converted: Blob | Blob[] = await heic2any({
      blob: file,
      toType: "image/jpeg",
    });
    source = Array.isArray(converted) ? converted[0] : converted;
    if (!source) throw new Error("HEIC image could not be converted");
  }

  const originalSizeKB = dataUrlLength(source) / 1024;
  if (originalSizeKB < 200) return readDataUrl(source);

  const image = new Image();
  const objectUrl = URL.createObjectURL(source);
  let canvas: HTMLCanvasElement | undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image could not be decoded"));
      image.onabort = () =>
        reject(new DOMException("Image loading was aborted", "AbortError"));
      image.src = objectUrl;
    });
    if (typeof image.decode === "function") await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("Image dimensions are invalid");
    }
    canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return await readDataUrl(source);

    const isPng = source.type === "image/png" || source.type === "image/gif";
    let quality: number;
    let maxDimension = 2048;
    if (originalSizeKB < 512) {
      quality = 0.9;
    } else if (originalSizeKB < 1024) {
      quality = 0.85;
    } else if (originalSizeKB < 2048) {
      quality = 0.75;
      maxDimension = 1536;
    } else {
      quality = 0.65;
      maxDimension = 1280;
    }

    // Keep thin images inside the same bounds without enlarging either edge.
    const scale = Math.min(
      Math.sqrt(maxSize / (originalSizeKB * 768)),
      maxDimension / image.naturalWidth,
      maxDimension / image.naturalHeight,
      1,
    );
    let width = Math.max(1, Math.floor(image.naturalWidth * scale));
    let height = Math.max(1, Math.floor(image.naturalHeight * scale));
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(source, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "high",
        });
      } catch {
        // Browsers without bitmap resizing can still use the decoded image.
      }
    }
    let outputFormat = isPng ? "image/png" : "image/webp";
    let encoded: Blob | undefined;
    for (let attempt = 0; attempt < 15; attempt++) {
      canvas.width = width;
      canvas.height = height;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap ?? image, 0, 0, width, height);
      encoded = await encode(canvas, outputFormat, quality);
      if (
        !isPng &&
        outputFormat === "image/webp" &&
        encoded.type !== outputFormat
      ) {
        outputFormat = "image/jpeg";
        encoded = await encode(canvas, outputFormat, quality);
      }
      if (dataUrlLength(encoded) <= maxSize) break;
      if (!isPng && quality > 0.5) {
        quality -= 0.1;
      } else {
        width = Math.max(1, Math.floor(width * 0.85));
        height = Math.max(1, Math.floor(height * 0.85));
      }
    }
    if (!encoded) throw new Error("Image could not be encoded");
    return await readDataUrl(encoded);
  } finally {
    image.onload = null;
    image.onerror = null;
    image.onabort = null;
    image.src = "";
    URL.revokeObjectURL(objectUrl);
    bitmap?.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export async function preProcessImageContentBase(
  content: RequestMessage["content"],
  transformImageUrl: (url: string) => Promise<{ [key: string]: any }>,
) {
  if (typeof content === "string") {
    return content;
  }
  const result = [];
  for (const part of content) {
    if (part?.type == "image_url" && part?.image_url?.url) {
      try {
        const url = await cacheImageToBase64Image(part?.image_url?.url);
        result.push(await transformImageUrl(url));
      } catch (error) {
        console.error("Error processing image URL:", error);
        throw new Error("图片读取失败，请重新上传后再发送");
      }
    } else {
      result.push({ ...part });
    }
  }
  return result;
}

export async function preProcessImageContent(
  content: RequestMessage["content"],
) {
  return preProcessImageContentBase(content, async (url) => ({
    type: "image_url",
    image_url: { url },
  })) as Promise<MultimodalContent[] | string>;
}

export async function preProcessImageContentForAlibabaDashScope(
  content: RequestMessage["content"],
) {
  return preProcessImageContentBase(content, async (url) => ({
    image: url,
  }));
}

const imageCaches: Record<string, string | Promise<string>> = {};
export function cacheImageToBase64Image(imageUrl: string): Promise<string> {
  if (imageUrl.includes(CACHE_URL_PREFIX)) {
    // 先从内存缓存查
    if (imageCaches[imageUrl]) {
      return Promise.resolve(imageCaches[imageUrl]);
    }
    // 再从 IndexedDB 查（刷新页面后也能恢复）
    const cachePromise = (async () => {
      const cached = await getCachedImage(imageUrl);
      if (cached) {
        imageCaches[imageUrl] = cached;
        return cached;
      }
      // 都没有则发起请求，压缩后存入 IndexedDB
      const blob = await fetch(imageUrl, {
        method: "GET",
        mode: "cors",
        credentials: "include",
      }).then((res) => res.blob());
      const dataUrl = await compressImage(blob, 256 * 1024);
      imageCaches[imageUrl] = dataUrl;
      setCachedImage(imageUrl, dataUrl); // 异步存储，不阻塞返回
      return dataUrl;
    })();
    imageCaches[imageUrl] = cachePromise;
    return cachePromise;
  }
  return Promise.resolve(imageUrl);
}

export function base64Image2Blob(base64Data: string, contentType: string) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

export function uploadImage(file: Blob): Promise<string> {
  // 先压缩为 data URL（保证预览可用）
  const compressed = compressImage(file, 512 * 1024);

  // SW 可用时额外缓存到 /api/cache/xxx（持久化），不影响返回
  if ((window as any)._SW_ENABLED) {
    compressed
      .then((dataUrl) => {
        // 用压缩后的 dataUrl 转 Blob 再上传，避免原图过大
        return fetch(dataUrl)
          .then((r) => r.blob())
          .then((blob) => {
            const fd = new FormData();
            fd.append("file", blob, "image.png");
            return fetch(UPLOAD_URL, {
              method: "post",
              body: fd,
              mode: "cors",
              credentials: "include",
            });
          });
      })
      .catch(() => {}); // SW 缓存失败不影响展示
  }

  return compressed;
}

function createStreamTextAnimator(update: (flush: boolean) => boolean) {
  let frameId: number | undefined;
  let stopped = false;

  function cancelFrame() {
    if (frameId !== undefined) {
      cancelAnimationFrame(frameId);
      frameId = undefined;
    }
  }

  function animate() {
    frameId = undefined;
    if (!stopped && update(document.hidden)) {
      schedule();
    }
  }

  function schedule() {
    if (stopped) return;
    if (document.hidden) {
      cancelFrame();
      update(true);
    } else if (frameId === undefined) {
      frameId = requestAnimationFrame(animate);
    }
  }

  // Background tabs pause animation frames, but incoming text must still persist.
  function onVisibilityChange() {
    cancelFrame();
    if (!stopped) update(true);
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    schedule,
    flush() {
      cancelFrame();
      if (!stopped) update(true);
    },
    stop() {
      stopped = true;
      cancelFrame();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

export function stream(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (text: string, runTools: any[]) => string | undefined,
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  const accountMode = new Headers(headers).has("X-New-Api-User");
  let responseText = "";
  let remainText = "";
  let finished = false;
  let running = false;
  let runTools: any[] = [];
  let responseRes: Response;
  let requestTimeoutId: ReturnType<typeof setTimeout> | undefined;

  const animator = createStreamTextAnimator((flush) => {
    if (finished || controller.signal.aborted) return false;
    if (remainText.length > 0) {
      const fetchCount = flush
        ? remainText.length
        : Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }
    return remainText.length > 0;
  });

  function clearRequestTimeout() {
    clearTimeout(requestTimeoutId);
    requestTimeoutId = undefined;
  }

  function fail(error: unknown) {
    if (finished || controller.signal.aborted) return;
    clearRequestTimeout();
    try {
      animator.flush();
    } catch (callbackError) {
      console.error("[ChatAPI] update callback failed", callbackError);
    }
    finished = true;
    animator.stop();
    runTools = [];
    running = false;
    try {
      const failure = error instanceof Error ? error : new Error(String(error));
      Promise.resolve(
        options?.onError?.(new Error(getUserFriendlyError(failure))),
      ).catch((callbackError) => {
        console.error("[ChatAPI] error callback failed", callbackError);
      });
    } catch (callbackError) {
      console.error("[ChatAPI] error callback failed", callbackError);
    }
  }

  const finish = () => {
    clearRequestTimeout();
    if (controller.signal.aborted) {
      runTools = [];
      running = false;
    }
    if (!finished) {
      if (!running && runTools.length > 0) {
        const toolCallMessage = {
          role: "assistant",
          tool_calls: [...runTools],
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            return Promise.resolve()
              .then(() => options?.onBeforeTool?.(tool))
              .then(() =>
                Promise.resolve()
                  .then(() =>
                    funcs[tool.function.name](
                      tool?.function?.arguments
                        ? JSON.parse(tool?.function?.arguments)
                        : {},
                    ),
                  )
                  .then((res) => {
                    let content = res.data || res?.statusText;
                    // hotfix #5614
                    content =
                      typeof content === "string"
                        ? content
                        : JSON.stringify(content);
                    if (res.status >= 300) {
                      return Promise.reject(content);
                    }
                    return content;
                  })
                  .then(
                    async (content) => {
                      await options?.onAfterTool?.({
                        ...tool,
                        content,
                        isError: false,
                      });
                      return content;
                    },
                    async (error) => {
                      const errorMsg = String(error);
                      await options?.onAfterTool?.({
                        ...tool,
                        isError: true,
                        errorMsg,
                      });
                      return errorMsg;
                    },
                  ),
              )
              .then((content) => ({
                name: tool.function.name,
                role: "tool",
                content,
                tool_call_id: tool.id,
              }));
          }),
        )
          .then(async (toolCallResult) => {
            if (finished || controller.signal.aborted) return;
            await processToolMessage(
              requestPayload,
              toolCallMessage,
              toolCallResult,
            );
            if (finished || controller.signal.aborted) return;
            setTimeout(() => {
              if (finished || controller.signal.aborted) return;
              try {
                running = false;
                chatApi(chatPath, headers, requestPayload, tools);
              } catch (error) {
                fail(error);
              }
            }, TOOL_RETRY_DELAY_MS);
          })
          .catch(fail);
        return;
      }
      if (running) {
        return;
      }
      finished = true;
      animator.stop();
      responseText += remainText;
      remainText = "";
      if (!responseText && !controller.signal.aborted) {
        options.onError?.(new Error("empty response from server"));
        return;
      }
      options.onFinish(
        responseText,
        controller.signal.aborted
          ? new Response(null, { status: 499 })
          : responseRes,
      );
    }
  };

  controller.signal.onabort = finish;
  if (controller.signal.aborted) {
    finish();
    return;
  }

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    if (finished || controller.signal.aborted) return;
    let roundCompleted = false;
    const finishRound = () => {
      if (roundCompleted || finished) return;
      roundCompleted = true;
      return finish();
    };
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
    };
    requestTimeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    fetchEventSource(chatPath, {
      fetch: options.fetch ?? tauriFetch,
      ...chatPayload,
      async onopen(res) {
        if (roundCompleted || finished || controller.signal.aborted) return;
        clearRequestTimeout();
        const contentType = res.headers.get("content-type");
        responseRes = res;

        if (res.ok && contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finishRound();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (accountMode && (res.status === 401 || res.status === 409)) {
            try {
              window.dispatchEvent(new CustomEvent("new-api-session-changed"));
            } catch {}
            responseTexts.push(
              res.status === 401
                ? "章鱼登录状态已失效，请在账号页面重新登录"
                : "章鱼登录账号已变化，请在账号页面确认后重试",
            );
          } else if (res.status === 401 && !/^https?:\/\//.test(chatPath)) {
            // token 失效，触发全局密码重新输入
            try {
              window.dispatchEvent(new CustomEvent("token-invalid"));
            } catch {}
            responseTexts.push("访问已过期，请重新输入密码");
          } else if (res.status === 429) {
            responseTexts.push("请求过于频繁，请稍后再试");
          } else if (res.status >= 500) {
            responseTexts.push(`服务器暂时不可用（${res.status}），请稍后重试`);
          } else if (res.status === 403) {
            responseTexts.push("没有权限访问此功能");
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");

          return finishRound();
        }
      },
      onmessage(msg) {
        if (roundCompleted || finished) return;
        if (msg.data === "[DONE]") {
          return finishRound();
        }
        const text = msg.data;
        // Skip empty messages
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          const chunk = parseSSE(text, runTools);
          if (chunk) {
            remainText += chunk;
            animator.schedule();
          }
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
        }
      },
      onclose() {
        finishRound();
      },
      onerror(e) {
        if (roundCompleted || finished || controller.signal.aborted) throw e;
        // Every model POST may already be billed, including custom providers.
        clearRequestTimeout();
        throw e;
      },
      openWhenHidden: true,
    }).catch((e) => {
      if (roundCompleted || finished || controller.signal.aborted) return;
      roundCompleted = true;
      fail(e);
    });
  }
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}

export function streamWithThink(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (
    text: string,
    runTools: any[],
  ) => {
    isThinking: boolean;
    content: string | undefined;
    reasoning?: string;
    done?: boolean;
    error?: string;
  },
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  const accountMode = new Headers(headers).has("X-New-Api-User");
  let responseText = "";
  let remainText = "";
  let finished = false;
  let running = false;
  let runTools: any[] = [];
  let responseRes: Response;
  let requestTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let reasoningText = "";
  let generationDurationMs = 0;
  let generationTimingObservable = true;
  let generationOutputText = "";
  let lastGenerationProgressAt: number | undefined;
  let lastGenerationProgress: ChatGenerationProgress | undefined;
  const onGenerationProgress = options.onGenerationProgress as
    | ((progress: ChatGenerationProgress) => void)
    | undefined;
  const publishGenerationProgress = (durationMs: number) => {
    if (!onGenerationProgress) return;
    const progress = {
      outputTokens: estimateTokenLength(generationOutputText),
      durationMs,
    };
    if (
      lastGenerationProgress &&
      progress.outputTokens === lastGenerationProgress.outputTokens &&
      progress.durationMs === lastGenerationProgress.durationMs
    )
      return;
    lastGenerationProgress = progress;
    try {
      onGenerationProgress({ ...progress });
    } catch (error) {
      console.error("[ChatAPI] generation progress callback failed", error);
    }
  };
  const reasoningStream = createReasoningStream();
  const appendDelta = (delta: ReasoningDelta) => {
    remainText += delta.content;
    if (delta.reasoning) {
      reasoningText += delta.reasoning;
      options.onReasoningUpdate?.(reasoningText, delta.reasoning);
    }
  };

  const animator = createStreamTextAnimator((flush) => {
    if (finished || controller.signal.aborted) return false;
    if (remainText.length > 0) {
      const fetchCount = flush
        ? remainText.length
        : Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }
    return remainText.length > 0;
  });

  function clearRequestTimeout() {
    clearTimeout(requestTimeoutId);
    requestTimeoutId = undefined;
  }

  function fail(error: unknown) {
    if (finished || controller.signal.aborted) return;
    clearRequestTimeout();
    try {
      animator.flush();
    } catch (callbackError) {
      console.error("[ChatAPI] update callback failed", callbackError);
    }
    finished = true;
    animator.stop();
    runTools = [];
    running = false;
    try {
      const failure = error instanceof Error ? error : new Error(String(error));
      Promise.resolve(
        options?.onError?.(new Error(getUserFriendlyError(failure))),
      ).catch((callbackError) => {
        console.error("[ChatAPI] error callback failed", callbackError);
      });
    } catch (callbackError) {
      console.error("[ChatAPI] error callback failed", callbackError);
    }
  }

  const finish = () => {
    clearRequestTimeout();
    if (controller.signal.aborted) {
      runTools = [];
      running = false;
    }
    if (!finished) {
      if (!running && runTools.length > 0) {
        const toolCallMessage = {
          role: "assistant",
          tool_calls: [...runTools],
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            return Promise.resolve()
              .then(() => options?.onBeforeTool?.(tool))
              .then(() =>
                Promise.resolve()
                  .then(() =>
                    funcs[tool.function.name](
                      tool?.function?.arguments
                        ? JSON.parse(tool?.function?.arguments)
                        : {},
                    ),
                  )
                  .then((res) => {
                    let content = res.data || res?.statusText;
                    // hotfix #5614
                    content =
                      typeof content === "string"
                        ? content
                        : JSON.stringify(content);
                    if (res.status >= 300) {
                      return Promise.reject(content);
                    }
                    return content;
                  })
                  .then(
                    async (content) => {
                      await options?.onAfterTool?.({
                        ...tool,
                        content,
                        isError: false,
                      });
                      return content;
                    },
                    async (error) => {
                      const errorMsg = String(error);
                      await options?.onAfterTool?.({
                        ...tool,
                        isError: true,
                        errorMsg,
                      });
                      return errorMsg;
                    },
                  ),
              )
              .then((content) => ({
                name: tool.function.name,
                role: "tool",
                content,
                tool_call_id: tool.id,
              }));
          }),
        )
          .then(async (toolCallResult) => {
            if (finished || controller.signal.aborted) return;
            await processToolMessage(
              requestPayload,
              toolCallMessage,
              toolCallResult,
            );
            if (finished || controller.signal.aborted) return;
            setTimeout(() => {
              if (finished || controller.signal.aborted) return;
              try {
                running = false;
                chatApi(chatPath, headers, requestPayload, tools);
              } catch (error) {
                fail(error);
              }
            }, TOOL_RETRY_DELAY_MS);
          })
          .catch(fail);
        return;
      }
      if (running) {
        return;
      }
      appendDelta(reasoningStream.finish());
      finished = true;
      animator.stop();
      responseText += remainText;
      remainText = "";
      if (!responseText && !reasoningText && !controller.signal.aborted) {
        options.onError?.(new Error("empty response from server"));
        return;
      }
      if (
        !controller.signal.aborted &&
        generationTimingObservable &&
        Number.isFinite(generationDurationMs) &&
        generationDurationMs > 0
      ) {
        publishGenerationProgress(generationDurationMs);
        try {
          options.onGenerationTiming?.(generationDurationMs);
        } catch (error) {
          console.error("[ChatAPI] generation timing callback failed", error);
        }
      }
      options.onFinish(
        responseText,
        controller.signal.aborted
          ? new Response(null, { status: 499 })
          : responseRes,
      );
    }
  };

  controller.signal.onabort = finish;
  if (controller.signal.aborted) {
    finish();
    return;
  }

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    if (finished || controller.signal.aborted) return;
    let roundCompleted = false;
    let eventStreamOpened = false;
    let firstOutputAt: number | undefined;
    let lastOutputAt: number | undefined;
    const finishRound = () => {
      if (roundCompleted || finished) return;
      roundCompleted = true;
      const durationMs =
        firstOutputAt === undefined || lastOutputAt === undefined
          ? 0
          : lastOutputAt - firstOutputAt;
      // Separate rounds exclude tool execution and the next first-token wait.
      if (
        !eventStreamOpened ||
        !Number.isFinite(durationMs) ||
        durationMs <= 0
      ) {
        generationTimingObservable = false;
      } else {
        generationDurationMs += durationMs;
      }
      return finish();
    };
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
    };
    requestTimeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    fetchEventSource(chatPath, {
      fetch: options.fetch ?? tauriFetch,
      ...chatPayload,
      async onopen(res) {
        if (roundCompleted || finished || controller.signal.aborted) return;
        clearRequestTimeout();
        const contentType = res.headers.get("content-type");
        responseRes = res;

        if (res.ok && contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finishRound();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (options.strictApiErrors) {
            if (accountMode && (res.status === 401 || res.status === 409))
              window.dispatchEvent(new CustomEvent("new-api-session-changed"));
            fail(new Error(extraInfo || `请求失败 (${res.status})`));
            controller.abort();
            return;
          }

          if (accountMode && (res.status === 401 || res.status === 409)) {
            try {
              window.dispatchEvent(new CustomEvent("new-api-session-changed"));
            } catch {}
            responseTexts.push(
              res.status === 401
                ? "章鱼登录状态已失效，请在账号页面重新登录"
                : "章鱼登录账号已变化，请在账号页面确认后重试",
            );
          } else if (res.status === 401 && !/^https?:\/\//.test(chatPath)) {
            // token 失效，触发全局密码重新输入
            try {
              window.dispatchEvent(new CustomEvent("token-invalid"));
            } catch {}
            responseTexts.push("访问已过期，请重新输入密码");
          } else if (res.status === 429) {
            responseTexts.push("请求过于频繁，请稍后再试");
          } else if (res.status >= 500) {
            responseTexts.push(`服务器暂时不可用（${res.status}），请稍后重试`);
          } else if (res.status === 403) {
            responseTexts.push("没有权限访问此功能");
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");

          return finishRound();
        }
        eventStreamOpened = true;
      },
      onmessage(msg) {
        if (roundCompleted || finished) return;
        if (msg.data === "[DONE]") {
          return finishRound();
        }
        const text = msg.data;
        // Skip empty messages
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          const chunk = parseSSE(text, runTools);
          if (chunk?.error) {
            fail(new Error(chunk.error));
            controller.abort();
            return;
          }
          const receivedAt = performance.now();
          if (chunk?.content?.length || chunk?.reasoning?.length) {
            firstOutputAt ??= receivedAt;
            lastOutputAt = receivedAt;
            if (onGenerationProgress) {
              generationOutputText +=
                (chunk.content ?? "") + (chunk.reasoning ?? "");
              const roundDurationMs = lastOutputAt - firstOutputAt;
              if (
                eventStreamOpened &&
                generationTimingObservable &&
                roundDurationMs > 0 &&
                (lastGenerationProgressAt === undefined ||
                  receivedAt - lastGenerationProgressAt >= 250)
              ) {
                lastGenerationProgressAt = receivedAt;
                publishGenerationProgress(
                  generationDurationMs + roundDurationMs,
                );
              }
            }
          }
          if (chunk.reasoning)
            appendDelta({ content: "", reasoning: chunk.reasoning });
          // Skip if content is empty
          if (!chunk?.content || chunk.content.length === 0) {
            if (chunk?.done) return finishRound();
            return;
          }

          appendDelta(reasoningStream.push(chunk.content, chunk.isThinking));
          animator.schedule();
          if (chunk.done) return finishRound();
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
          // Don't throw error for parse failures, just log them
        }
      },
      onclose() {
        finishRound();
      },
      onerror(e) {
        if (roundCompleted || finished || controller.signal.aborted) throw e;
        // Every model POST may already be billed, including custom providers.
        clearRequestTimeout();
        throw e;
      },
      openWhenHidden: true,
    }).catch((e) => {
      if (roundCompleted || finished || controller.signal.aborted) return;
      roundCompleted = true;
      fail(e);
    });
  }
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}
