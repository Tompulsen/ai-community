import {
  ChatOptions,
  LLMApi,
  apiPath,
  ApiFetchError,
  detectBase64Mime,
  apiFetch,
  getHeaders,
} from "@/app/client/api";
import { useAccessStore, useChatStore, useAppConfig } from "../store";
import {
  getMessageTextContent,
  shouldUseImageGenerationApi,
} from "@/app/utils";
import { extractErrorMessage } from "@/app/utils/async-task";
import {
  getLocalTokenId,
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import {
  imageRequestSize,
  imageQuality,
  imageOutputParams,
  validateImagePrompt,
  supportsImageOutputOptions,
  type ImageResponseFormat,
} from "../utils/image-params";
import { imageResultUrls, readImageStream } from "../utils/image-response";
import { prepareAsyncSubmission } from "../utils/async-submission";
import { usesCustomProvider } from "../utils/custom-provider";
import {
  rememberTask,
  pollLocalTask,
  type LocalTask,
} from "../utils/local-tasks";

export interface ImageGenerationCallbacks {
  onPreview?: (imageUrl: string) => void;
  onProgress?: (progress: number, statusLabel?: string) => void;
  onStatusChange?: (
    status: "pending" | "success" | "failed" | "cancelled",
  ) => void;
  onComplete?: (imageUrl: string, imageUrls?: string[]) => void;
  onError?: (error: string, cause?: unknown) => void;
}

type OutputFormat = "png" | "jpeg" | "webp";

export interface ImageGenerationOptions {
  requestMode?: "sync" | "async";
  responseFormat?: ImageResponseFormat;
  outputFormat?: OutputFormat;
  outputCompression?: number;
  referenceImages?: string[];
}

export class ImageGenerationService {
  private api: LLMApi;
  private callbacks: ImageGenerationCallbacks = {};
  private controller: AbortController | null = null;
  private requestStartedAt = 0;
  private completedImages: string[] = [];

  private resultUrl(result: any): string | null {
    this.completedImages = imageResultUrls(result);
    return this.completedImages[0] ?? null;
  }

  private readImageStream(response: Response) {
    return readImageStream(response, this.callbacks.onPreview, (images) => {
      this.completedImages = images;
    });
  }

  constructor(api: LLMApi) {
    this.api = api;
  }

  setCallbacks(callbacks: ImageGenerationCallbacks) {
    this.callbacks = callbacks;
  }

  private getApiUrl(providerName?: string): string {
    return apiPath("images/generations", providerName);
  }

  private requestConfig(config: ChatOptions["config"], requestMode?: "sync" | "async") {
    const preferences = useAppConfig.getState().modelConfig;
    const mode = requestMode ?? preferences.imageRequestMode ?? "sync";
    return {
      ...config,
      imageResponseFormat: preferences.imageResponseFormat ?? "url",
      imageRequestMode: mode,
      imageStream:
        mode === "async"
          ? false
          : preferences.imageStream ?? false,
      imagePartialImages: preferences.imagePartialImages ?? 1,
    };
  }

  private buildImagePayload(
    options: ChatOptions,
    imageOptions?: ImageGenerationOptions,
  ) {
    const prompt = getMessageTextContent(
      options.messages.slice(-1)?.pop() as any,
    );

    const modelConfig = options.config;

    const model = modelConfig.model || "dall-e-3";
    const payload: Record<string, any> = {
      model,
      prompt,
      n: 1,
      size: imageRequestSize(modelConfig.size, modelConfig.resolution, model),
      quality: imageQuality(modelConfig.quality),
      response_format:
        imageOptions?.responseFormat ??
        modelConfig.imageResponseFormat ??
        "url",
      ...(supportsImageOutputOptions(model) &&
        imageOutputParams({
          ...modelConfig,
          ...(imageOptions?.outputFormat && {
            imageOutputFormat: imageOptions.outputFormat,
          }),
          ...(imageOptions?.outputCompression !== undefined && {
            imageOutputCompression: imageOptions.outputCompression,
          }),
        })),
    };

    if (
      imageOptions?.referenceImages &&
      imageOptions.referenceImages.length > 0
    ) {
      payload.init_images = imageOptions.referenceImages;
    }

    return payload;
  }

  async generateImage(
    options: ChatOptions,
    imageOptions?: ImageGenerationOptions,
  ) {
    this.requestStartedAt = Date.now();
    this.completedImages = [];
    const access = useAccessStore.getState();
    const custom = usesCustomProvider(access, options.config.providerName);
    const imageApiMode = custom
      ? options.imageApiMode ?? access.customApiMode
      : "auto";
    const isImage = shouldUseImageGenerationApi(options.config, {
      capabilities: options.modelCapabilities,
      customImageMode: custom && imageApiMode !== "auto",
    });

    if (!isImage) {
      return this.api.chat(options);
    }
    options = {
      ...options,
      accountTokenId: custom
        ? undefined
        : options.accountTokenId === undefined
        ? getLocalTokenId()
        : options.accountTokenId,
      config: this.requestConfig(options.config, imageOptions?.requestMode),
    };

    const refImages = imageOptions?.referenceImages?.filter(Boolean) ?? [];
    const hasImages = refImages.length > 0;

    this.controller = new AbortController();
    // 将 controller 回传给调用方，使其能注册到 ChatControllerPool 以支持取消
    options.onController?.(this.controller);
    this.callbacks.onProgress?.(0, "生成中");

    try {
      if (
        options.config.imageRequestMode === "async" &&
        custom &&
        imageApiMode === "responses"
      ) {
        throw new Error(
          "异步生图不支持 Responses 模式，请在模型来源中选择 Images 接口，或切回同步请求",
        );
      }
      let imageUrl: string | null;
      validateImagePrompt(
        getMessageTextContent(options.messages.at(-1) as any),
      );

      if (custom && imageApiMode === "responses") {
        imageUrl = await this.responsesGeneration(options, refImages);
      } else if (hasImages) {
        // 有参考图 → /v1/images/edits（multipart 图生图）
        const prompt = getMessageTextContent(
          options.messages.slice(-1)?.pop() as any,
        );
        const model = options.config.model || "dall-e-2";
        const size = imageRequestSize(
          options.config.size,
          options.config.resolution,
          model,
        );

        const formData = new FormData();
        const imageField = refImages.length === 1 ? "image" : "image[]";
        refImages.forEach((dataUrl, index) => {
          const image = dataUrlToBlob(dataUrl);
          const extension =
            image.type === "image/jpeg"
              ? "jpg"
              : image.type === "image/webp"
              ? "webp"
              : "png";
          formData.append(imageField, image, `image-${index + 1}.${extension}`);
        });
        formData.append("prompt", prompt);
        formData.append("model", model);
        formData.append("n", "1");
        formData.append("size", size);
        formData.append("quality", imageQuality(options.config.quality));
        formData.append(
          "response_format",
          imageOptions?.responseFormat ??
            options.config.imageResponseFormat ??
            "url",
        );
        for (const [key, value] of Object.entries(
          supportsImageOutputOptions(model)
            ? imageOutputParams(options.config)
            : {},
        )) {
          formData.append(key, String(value));
        }

        imageUrl =
          options.config.imageRequestMode === "async"
            ? await this.asyncGeneration(formData, options)
            : await this.multipartUpload(
                "images/edits",
                formData,
                options.config.providerName,
                options.accountTokenId,
              );
      } else {
        // 纯文字 → /v1/images/generations（JSON 文生图）
        const payload = this.buildImagePayload(options, imageOptions);
        imageUrl =
          options.config.imageRequestMode === "async"
            ? await this.asyncGeneration(payload, options)
            : await this.syncGeneration(payload, options);
      }

      if (this.controller?.signal.aborted) return;
      if (imageUrl) {
        this.callbacks.onComplete?.(
          imageUrl,
          this.completedImages.length ? this.completedImages : [imageUrl],
        );
      }
    } catch (error: any) {
      if (
        this.controller?.signal.aborted ||
        error.name === "AbortError" ||
        error.message === "CANCELLED"
      ) {
        this.callbacks.onStatusChange?.("cancelled");
        return;
      }
      this.callbacks.onError?.(error.message || "生成失败", error);
    }
  }

  private async asyncGeneration(
    payload: Record<string, any> | FormData,
    options: ChatOptions,
  ): Promise<string> {
    const access = useAccessStore.getState();
    const providerName = options.config.providerName;
    const custom = usesCustomProvider(access, providerName);
    const tokenId = custom ? null : options.accountTokenId ?? getLocalTokenId();
    const source = apiPath("", providerName);
    const owner = getLocalScope();
    const multipart = payload instanceof FormData;
    // The async gateway rejects SSE-only fields, even when stream is false.
    if (multipart) {
      payload.delete("stream");
      payload.delete("partial_images");
    } else {
      payload = Object.fromEntries(
        Object.entries(payload).filter(
          ([name]) =>
            !["stream", "partial_images", "init_images"].includes(name),
        ),
      );
    }
    const body = multipart ? (payload as FormData) : JSON.stringify(payload);
    const submission = await prepareAsyncSubmission(
      "image",
      `${source}:${custom ? access.openaiApiKey : tokenId}`,
      body,
      this.controller?.signal,
    );
    const { requestId } = submission;
    if (
      this.controller?.signal.aborted ||
      !isLocalWorkspaceActive() ||
      getLocalScope() !== owner ||
      apiPath("", providerName) !== source ||
      (custom && useAccessStore.getState().openaiApiKey !== access.openaiApiKey)
    ) {
      throw new DOMException("Cancelled", "AbortError");
    }
    const response = await fetch(
      apiPath(`async-images/v1/${multipart ? "edits" : "tasks"}`, providerName),
      {
        method: "POST",
        headers: {
          ...getHeaders(multipart, providerName),
          "Idempotency-Key": requestId,
          ...(tokenId === null ? {} : { "X-New-Api-Token": String(tokenId) }),
        },
        body,
        signal: this.controller?.signal,
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiFetchError(
        typeof error.detail === "string"
          ? error.detail
          : error.error?.message ||
            error.message ||
            `异步任务提交失败 (${response.status})，请核对使用日志，勿重复提交`,
        response.status,
        error,
      );
    }
    const result = await response.json();
    if (!isLocalWorkspaceActive() || getLocalScope() !== owner)
      throw new DOMException("Cancelled", "AbortError");
    if (typeof result.id !== "string" || !result.id)
      throw new Error("异步接口未返回任务 ID，请核对使用日志，勿重复提交");
    const task: LocalTask = {
      id: options.taskContext?.messageId || requestId,
      ...options.taskContext,
      kind: "image",
      protocol: "async",
      requestId,
      upstreamId: result.id,
      tokenId,
      ...(custom ? { customApiBase: source } : {}),
      model: options.config.model,
      prompt: getMessageTextContent(options.messages.at(-1) as any),
      createdAt: Date.now(),
      requestStartedAt: this.requestStartedAt,
    };
    rememberTask(task);
    submission.accepted();
    const completed = await pollLocalTask(
      task,
      (path) => {
        if (
          this.controller?.signal.aborted ||
          apiPath("", providerName) !== source
        )
          throw new DOMException("Cancelled", "AbortError");
        return apiFetch(
          path,
          {
            signal: this.controller?.signal,
            headers:
              tokenId === null ? {} : { "X-New-Api-Token": String(tokenId) },
          },
          providerName,
        );
      },
      this.controller?.signal,
      (data) => {
        this.callbacks.onProgress?.(
          Number(data.progress) || 0,
          data.status === "saving" ? "正在保存图片" : "生成中",
        );
      },
    );
    const url = this.resultUrl(completed);
    if (!url) throw new Error("异步任务未返回图片URL");
    return url;
  }

  private async responsesGeneration(options: ChatOptions, images: string[]) {
    const prompt = getMessageTextContent(options.messages.at(-1) as any);
    const { stream, ...output } = imageOutputParams(options.config);
    const response = await fetch(
      apiPath("responses", options.config.providerName),
      {
        method: "POST",
        headers: getHeaders(false, options.config.providerName),
        signal: this.controller?.signal,
        body: JSON.stringify({
          model: options.config.model,
          store: false,
          stream,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                ...images.map((image_url) => ({
                  type: "input_image",
                  image_url,
                })),
              ],
            },
          ],
          tools: [
            {
              type: "image_generation",
              size: imageRequestSize(
                options.config.size,
                options.config.resolution,
                options.config.model,
              ),
              quality: imageQuality(options.config.quality),
              ...output,
            },
          ],
          tool_choice: { type: "image_generation" },
        }),
      },
    );
    if (
      response.ok &&
      response.headers.get("content-type")?.includes("text/event-stream")
    )
      return this.readImageStream(response);
    const result = await response.json();
    if (!response.ok || result.error)
      throw new ApiFetchError(
        extractErrorMessage(result) || `HTTP ${response.status}`,
        response.status,
        result,
      );
    const image = result.output?.find(
      (item: any) =>
        item.type === "image_generation_call" &&
        typeof item.result === "string",
    );
    if (!image?.result)
      throw new Error(
        "Responses API 未返回生成图片，请确认模型支持图像生成工具",
      );
    return `data:${detectBase64Mime(image.result)};base64,${image.result}`;
  }

  private async syncGeneration(
    payload: Record<string, any>,
    options: ChatOptions,
  ): Promise<string | null> {
    const accessStore = useAccessStore.getState();
    const providerName = options.config.providerName;
    const custom = usesCustomProvider(accessStore, providerName);
    const tokenId = custom ? null : options.accountTokenId ?? getLocalTokenId();
    const source = apiPath("", providerName);
    const apiUrl = this.getApiUrl(providerName);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        ...getHeaders(false, providerName),
        ...(tokenId === null ? {} : { "X-New-Api-Token": String(tokenId) }),
      },
      body: JSON.stringify(payload),
      signal: this.controller?.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg =
        extractErrorMessage(errorData) || `HTTP ${response.status}`;
      throw new ApiFetchError(errorMsg, response.status, errorData);
    }

    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      return this.readImageStream(response);
    }
    const result = await response.json();
    if (result.error)
      throw new ApiFetchError(
        extractErrorMessage(result) || "生图失败",
        response.status,
        result,
      );
    if (typeof result.task_id === "string" && options.taskContext) {
      const task: LocalTask = {
        id: options.taskContext.messageId,
        ...options.taskContext,
        kind: "image",
        upstreamId: result.task_id,
        tokenId,
        ...(custom ? { customApiBase: source } : {}),
        model: String(payload.model),
        prompt: String(payload.prompt),
        createdAt: Date.now(),
        requestStartedAt: this.requestStartedAt,
      };
      rememberTask(task);
      const completed = await pollLocalTask(
        task,
        (path) => {
          if (
            this.controller?.signal.aborted ||
            apiPath("", providerName) !== source
          )
            throw new DOMException("Cancelled", "AbortError");
          return apiFetch(
            path,
            {
              signal: this.controller?.signal,
              headers:
                custom || tokenId === null
                  ? {}
                  : { "X-New-Api-Token": String(tokenId) },
            },
            providerName,
          );
        },
        this.controller?.signal,
      );
      const url = this.resultUrl(completed);
      if (url) return url;
    }
    const imageUrl = this.resultUrl(result);
    if (imageUrl) return imageUrl;

    throw new Error("API未返回图片URL");
  }

  // ---- multipart 上传（保持原有逻辑） ----

  private async multipartUpload(
    endpoint: string,
    formData: FormData,
    providerName?: string,
    accountTokenId?: number | null,
  ): Promise<string> {
    const url = apiPath(endpoint, providerName);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...getHeaders(true, providerName),
        ...(accountTokenId == null
          ? {}
          : { "X-New-Api-Token": String(accountTokenId) }),
      },
      body: formData,
      signal: this.controller?.signal, // 支持取消
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg =
        extractErrorMessage(errorData) || `HTTP ${response.status}`;
      throw new ApiFetchError(errorMsg, response.status, errorData);
    }

    if (response.headers.get("content-type")?.includes("text/event-stream"))
      return this.readImageStream(response);
    const result = await response.json();
    if (result.error)
      throw new ApiFetchError(
        extractErrorMessage(result) || "生图失败",
        response.status,
        result,
      );
    const image = this.resultUrl(result);
    if (!image) throw new Error("API未返回图片URL");
    return image;
  }

  async generateImageEdit(
    imageFile: Blob,
    prompt: string,
    options?: { maskFile?: Blob; model?: string; n?: number; size?: string },
  ): Promise<string> {
    const modelConfig = this.requestConfig(
      useChatStore.getState().currentSession().mask.modelConfig,
    );
    const model = options?.model || modelConfig.model || "dall-e-2";

    const formData = new FormData();
    formData.append("image", imageFile, "image.png");
    formData.append("prompt", prompt);
    formData.append("model", model);
    formData.append("n", String(options?.n || 1));
    formData.append(
      "size",
      options?.size ||
        imageRequestSize(modelConfig.size, modelConfig.resolution, model),
    );
    formData.append("response_format", modelConfig.imageResponseFormat);

    if (options?.maskFile) {
      formData.append("mask", options.maskFile, "mask.png");
    }

    return this.multipartUpload(
      "images/edits",
      formData,
      modelConfig.providerName,
    );
  }

  async generateImageVariation(
    imageFile: Blob,
    options?: { model?: string; n?: number; size?: string },
  ): Promise<string> {
    const modelConfig = this.requestConfig(
      useChatStore.getState().currentSession().mask.modelConfig,
    );
    const model = options?.model || modelConfig.model || "dall-e-2";

    const formData = new FormData();
    formData.append("image", imageFile, "image.png");
    formData.append("model", model);
    formData.append("n", String(options?.n || 1));
    formData.append(
      "size",
      options?.size ||
        imageRequestSize(modelConfig.size, modelConfig.resolution, model),
    );
    formData.append("response_format", modelConfig.imageResponseFormat);

    return this.multipartUpload(
      "images/variations",
      formData,
      modelConfig.providerName,
    );
  }

  cancel() {
    this.controller?.abort();
    this.controller = null;
    this.callbacks.onStatusChange?.("cancelled");
  }
}

/** 将 data:image/...;base64,... 格式的 URL 转为 Blob（避免 CSP 拦截 fetch data: 协议） */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid data URL");
  const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
  const raw = dataUrl.slice(comma + 1);
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export function getImageGenerationService(api: LLMApi): ImageGenerationService {
  return new ImageGenerationService(api);
}
