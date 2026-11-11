/**
 * WebRTC 点对点分享工具模块
 *
 * 提供分享方(Sender)和接收方(Receiver)的完整 WebRTC 连接管理，
 * 包括信令交换、数据通道建立、分片传输协议。
 *
 * 全程不持久化任何数据到服务端，仅用信令接口临时交换握手信息。
 */

const SIGNALING_BASE = "/studio/api/signal";
const CHUNK_SIZE = 16 * 1024; // 16KB 分片
const ICE_POLL_INTERVAL = 500; // ICE 轮询间隔
const SIGNALING_TIMEOUT = 60 * 1000; // 60秒超时

// ── 类型定义 ──

export type ShareMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[]; // base64 data URL
  model?: string;
  date?: string;
};

export type SharePayload = {
  topic: string;
  messages: ShareMessage[];
};

export type TransferState =
  | "idle"
  | "creating"
  | "waiting"
  | "connecting"
  | "transferring"
  | "completed"
  | "error"
  | "disconnected";

export type ProgressCallback = (
  state: TransferState,
  progress: number, // 0-1
  detail?: string,
) => void;

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

// ── 信令辅助 ──

async function signalPost(
  room: string,
  type: string,
  data: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), SIGNALING_TIMEOUT);
  try {
    const response = await abortable(
      fetch(SIGNALING_BASE, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, type, data }),
      }),
      controller.signal,
    );
    if (!response.ok) throw new Error(`信令提交失败 (${response.status})`);
  } catch (error) {
    if (!signal?.aborted && controller.signal.aborted)
      throw new Error("信令提交超时");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function signalGet<T>(
  room: string,
  type: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const res = await fetch(
    `${SIGNALING_BASE}?room=${encodeURIComponent(room)}&type=${type}`,
    { signal },
  );
  const json = await res.json();
  return json.data ?? null;
}

async function signalDelete(room: string): Promise<void> {
  await fetch(`${SIGNALING_BASE}?room=${encodeURIComponent(room)}`, {
    method: "DELETE",
  });
}

async function pollSignal<T>(
  room: string,
  type: string,
  onResult: (data: T) => boolean,
  timeout = SIGNALING_TIMEOUT,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(pollTimer);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new DOMException("Cancelled", "AbortError"));
    const poll = async () => {
      try {
        const data = await signalGet<T>(room, type, controller.signal);
        if (finished) return;
        if (data && onResult(data)) {
          finish();
          return;
        }
      } catch {
        // 忽略网络错误继续轮询
      }
      if (!finished) pollTimer = setTimeout(poll, ICE_POLL_INTERVAL);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    deadline = setTimeout(() => finish(new Error("信令交换超时")), timeout);
    void poll();
  });
}

// ── 房间码生成 ──

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function buildShareLink(room: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/share?p=${room}`;
}

// ── 图片转 base64 ──

export async function fetchImageAsBase64(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  // 已经是 data URL 直接返回
  if (url.startsWith("data:")) return url;

  try {
    const res = await fetch(url, { signal });
    const blob = await res.blob();
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      const onAbort = () => {
        reader.abort();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      reader.onload = () => {
        cleanup();
        resolve(reader.result as string);
      };
      reader.onerror = () => {
        cleanup();
        reject(reader.error);
      };
      reader.onabort = cleanup;
      signal?.addEventListener("abort", onAbort, { once: true });
      reader.readAsDataURL(blob);
    });
  } catch {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    return "";
  }
}

// ── WebRTC 连接管理 ──

export class WebRTCSharer {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private room: string;
  private controller = new AbortController();

  constructor(room: string) {
    this.room = room;
  }

  async connect(onState: ProgressCallback): Promise<void> {
    const signal = this.controller.signal;
    if (signal.aborted) return;
    try {
      onState("creating", 0, "创建P2P连接…");

      const pc = (this.pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      }));
      this.dc = pc.createDataChannel("share", { ordered: true });
      pc.onicecandidate = (e) => {
        if (e.candidate && !signal.aborted)
          signalPost(
            this.room,
            "ice-caller",
            e.candidate.toJSON(),
            signal,
          ).catch(() => {});
      };

      const offer = await abortable(pc.createOffer(), signal);
      if (signal.aborted) return;
      await abortable(pc.setLocalDescription(offer), signal);
      if (signal.aborted) return;
      await signalPost(this.room, "offer", offer, signal);
      if (signal.aborted) return;
      onState("waiting", 0.1, "等待接收方连接…");

      let answer: RTCSessionDescriptionInit | undefined;
      await pollSignal(
        this.room,
        "answer",
        (value: RTCSessionDescriptionInit) => {
          answer = value;
          return true;
        },
        SIGNALING_TIMEOUT,
        signal,
      );
      if (signal.aborted) return;
      await abortable(pc.setRemoteDescription(answer!), signal);
      if (signal.aborted) return;

      void pollSignal(
        this.room,
        "ice-callee",
        (candidates: RTCIceCandidateInit[]) => {
          for (const candidate of candidates)
            pc.addIceCandidate(candidate).catch(() => {});
          return true;
        },
        120 * 1000,
        signal,
      ).catch(() => {});

      await new Promise<void>((resolve, reject) => {
        const dc = this.dc!;
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          dc.onopen = null;
          dc.onerror = null;
          if (error) reject(error);
          else resolve();
        };
        const onAbort = () =>
          finish(new DOMException("Cancelled", "AbortError"));
        const timeout = setTimeout(
          () => finish(new Error("连接超时")),
          SIGNALING_TIMEOUT,
        );
        dc.onopen = () => {
          onState("connecting", 0.3, "P2P通道已建立");
          finish();
        };
        dc.onerror = () => finish(new Error("数据通道错误"));
        dc.onclose = () => {
          if (!signal.aborted) onState("disconnected", 1, "连接已断开");
          finish(new Error("连接已断开"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        else if (dc.readyState === "open") {
          onState("connecting", 0.3, "P2P通道已建立");
          finish();
        }
      });
    } catch (error) {
      const cancelled = signal.aborted;
      this.close();
      if (!cancelled) throw error;
    }
  }

  async sendPayload(
    payload: SharePayload,
    onState: ProgressCallback,
  ): Promise<void> {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("数据通道未就绪");
    }

    onState("transferring", 0.3, "正在传输对话数据…");

    // 序列化
    const json = JSON.stringify(payload);
    const totalSize = json.length;
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

    // 发送开始标记
    this.dc.send(
      JSON.stringify({
        type: "start",
        topic: payload.topic,
        count: payload.messages.length,
        totalChunks,
        totalSize,
      }),
    );

    // 分片发送
    for (let i = 0; i < totalChunks; i++) {
      if (
        this.controller.signal.aborted ||
        !this.dc ||
        this.dc.readyState !== "open"
      ) {
        throw new Error("传输已中断");
      }

      const start = i * CHUNK_SIZE;
      const chunk = json.slice(start, start + CHUNK_SIZE);
      this.dc.send(
        JSON.stringify({
          type: "chunk",
          index: i,
          total: totalChunks,
          data: chunk,
        }),
      );

      // 流控：缓冲区过高时等待
      if (this.dc.bufferedAmount > 4 * CHUNK_SIZE) {
        await new Promise<void>((resolve, reject) => {
          const signal = this.controller.signal;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const cleanup = () => {
            clearTimeout(timer);
            clearTimeout(deadline);
            signal.removeEventListener("abort", onAbort);
          };
          const onAbort = () => {
            cleanup();
            reject(new DOMException("Cancelled", "AbortError"));
          };
          const check = () => {
            if (!this.dc || this.dc.readyState !== "open") {
              cleanup();
              reject(new Error("传输已中断"));
            } else if (this.dc.bufferedAmount < CHUNK_SIZE) {
              cleanup();
              resolve();
            } else {
              timer = setTimeout(check, 10);
            }
          };
          const deadline = setTimeout(() => {
            cleanup();
            reject(new Error("传输超时"));
          }, SIGNALING_TIMEOUT);
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
          else check();
        });
      }

      const progress = 0.3 + (0.65 * (i + 1)) / totalChunks;
      onState("transferring", progress, `传输中 ${i + 1}/${totalChunks}`);
    }

    // 发送完成标记
    if (
      this.controller.signal.aborted ||
      !this.dc ||
      this.dc.readyState !== "open"
    )
      throw new DOMException("Cancelled", "AbortError");
    this.dc.send(JSON.stringify({ type: "complete" }));

    onState("completed", 1, "传输完成");
  }

  cancel(): void {
    this.close();
  }

  close(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    if (this.dc) {
      this.dc.onopen = null;
      this.dc.onerror = null;
      this.dc.onclose = null;
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.close();
      this.pc = null;
    }
    signalDelete(this.room).catch(() => {});
  }
}

export class WebRTCReceiver {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private room: string;
  private controller = new AbortController();
  private chunks: string[] = [];
  private totalChunks = 0;
  private topic = "";
  private messageCount = 0;

  constructor(room: string) {
    this.room = room;
  }

  async connect(
    onState: ProgressCallback,
    onPayload: (payload: SharePayload) => void,
  ): Promise<void> {
    const signal = this.controller.signal;
    if (signal.aborted) return;
    try {
      onState("waiting", 0, "等待分享方上线…");
      const pc = (this.pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      }));

      pc.ondatachannel = (e) => {
        if (signal.aborted) {
          e.channel.close();
          return;
        }
        this.dc = e.channel;
        this.dc.onopen = () => {
          if (!signal.aborted) onState("connecting", 0.1, "P2P通道已建立");
        };
        this.dc.onmessage = (e) => {
          if (!signal.aborted) this.handleMessage(e.data, onState, onPayload);
        };
        this.dc.onclose = () => {
          if (!signal.aborted) onState("disconnected", 1, "分享方已断开连接");
        };
        this.dc.onerror = () => {
          if (!signal.aborted) onState("error", 0, "数据通道错误");
        };
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && !signal.aborted)
          signalPost(
            this.room,
            "ice-callee",
            e.candidate.toJSON(),
            signal,
          ).catch(() => {});
      };
      let offer: RTCSessionDescriptionInit | undefined;
      await pollSignal(
        this.room,
        "offer",
        (value: RTCSessionDescriptionInit) => {
          offer = value;
          return true;
        },
        SIGNALING_TIMEOUT,
        signal,
      );
      if (signal.aborted) return;
      await abortable(pc.setRemoteDescription(offer!), signal);
      if (signal.aborted) return;
      const answer = await abortable(pc.createAnswer(), signal);
      if (signal.aborted) return;
      await abortable(pc.setLocalDescription(answer), signal);
      if (signal.aborted) return;
      await signalPost(this.room, "answer", answer, signal);
      if (signal.aborted) return;
      onState("connecting", 0.05, "等待ICE连接…");
      void pollSignal(
        this.room,
        "ice-caller",
        (candidates: RTCIceCandidateInit[]) => {
          for (const candidate of candidates)
            pc.addIceCandidate(candidate).catch(() => {});
          return true;
        },
        120 * 1000,
        signal,
      ).catch(() => {});
    } catch (error) {
      const cancelled = signal.aborted;
      this.close();
      if (!cancelled) throw error;
    }
  }

  private handleMessage(
    data: string,
    onState: ProgressCallback,
    onPayload: (payload: SharePayload) => void,
  ): void {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case "start":
          this.topic = msg.topic || "";
          this.totalChunks = msg.totalChunks || 0;
          this.messageCount = msg.count || 0;
          this.chunks = new Array(this.totalChunks);
          onState("transferring", 0.1, `接收中 (0/${this.totalChunks})`);
          break;

        case "chunk": {
          this.chunks[msg.index] = msg.data;
          const received = this.chunks.filter(Boolean).length;
          const progress = 0.1 + (0.8 * received) / this.totalChunks;
          onState(
            "transferring",
            progress,
            `接收中 (${received}/${this.totalChunks})`,
          );
          break;
        }

        case "complete": {
          onState("completed", 0.95, "正在解析数据…");
          const json = this.chunks.join("");
          const payload = JSON.parse(json) as SharePayload;
          onState("completed", 1, "接收完成");
          onPayload(payload);
          break;
        }
      }
    } catch {
      onState("error", 0, "数据解析错误");
    }
  }

  cancel(): void {
    this.close();
  }

  close(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    if (this.dc) {
      this.dc.onopen = null;
      this.dc.onmessage = null;
      this.dc.onerror = null;
      this.dc.onclose = null;
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ondatachannel = null;
      this.pc.close();
      this.pc = null;
    }
    this.chunks = [];
  }
}
