import { jest } from "@jest/globals";

class MockChannel {
  readyState = "connecting";
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  send = jest.fn((data: string) => this.sent.push(data));
  close = jest.fn(() => {
    this.readyState = "closed";
    this.onclose?.();
  });
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
}

let offerResult: Promise<RTCSessionDescriptionInit> | undefined;
class MockPeer {
  static instances: MockPeer[] = [];
  channel = new MockChannel();
  onicecandidate: unknown = null;
  ondatachannel: ((event: { channel: MockChannel }) => void) | null = null;
  constructor() {
    MockPeer.instances.push(this);
  }
  createDataChannel = () => this.channel;
  createOffer = () =>
    offerResult || Promise.resolve({ type: "offer" as const, sdp: "offer" });
  createAnswer = async () => ({ type: "answer", sdp: "answer" });
  setLocalDescription = async () => {};
  setRemoteDescription = async () => {};
  addIceCandidate = async () => {};
  close = jest.fn();
}
Object.defineProperty(globalThis, "RTCPeerConnection", {
  configurable: true,
  value: MockPeer,
});

const { WebRTCSharer, WebRTCReceiver } = await import(
  "../app/utils/webrtc-share"
);
const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;
const requests = () =>
  jest.mocked(fetch).mock.calls.filter(([, init]) => !init?.method);
const readySignals = () => {
  jest.mocked(fetch).mockImplementation(async (url) => {
    const type = new URL(String(url), "https://fixture").searchParams.get(
      "type",
    );
    return response(
      type === "answer"
        ? { type: "answer", sdp: "answer" }
        : type === "offer"
        ? { type: "offer", sdp: "offer" }
        : [],
    );
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  MockPeer.instances = [];
  offerResult = undefined;
  jest.mocked(fetch).mockReset().mockResolvedValue(response(null));
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test.each(["sender", "receiver"])(
  "cancelling a %s waiting for empty signaling stops requests and timers",
  async (role) => {
    const participant =
      role === "sender"
        ? new WebRTCSharer("ROOMAA")
        : new WebRTCReceiver("ROOMAA");
    const states = jest.fn();
    const connecting =
      participant instanceof WebRTCSharer
        ? participant.connect(states)
        : participant.connect(states, () => {});
    await flush();
    expect(requests()).toHaveLength(1);
    participant.cancel();
    await expect(connecting).resolves.toBeUndefined();
    const count = requests().length;
    await jest.advanceTimersByTimeAsync(120_000);
    expect(requests()).toHaveLength(count);
    expect(jest.getTimerCount()).toBe(0);
    expect(MockPeer.instances[0].close).toHaveBeenCalledTimes(1);
    expect(states.mock.calls.some(([state]) => state === "error")).toBe(false);
  },
);

test("cancellation aborts an in-flight signaling GET without waiting for fetch", async () => {
  let querySignal: AbortSignal | undefined;
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method) return response(null);
    querySignal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const sender = new WebRTCSharer("ROOMAA");
  const connecting = sender.connect(() => {});
  await flush();
  expect(querySignal?.aborted).toBe(false);
  sender.cancel();
  await expect(connecting).resolves.toBeUndefined();
  expect(querySignal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test("cancel ends a pending native offer and never posts it later", async () => {
  let resolveOffer!: (offer: RTCSessionDescriptionInit) => void;
  offerResult = new Promise((resolve) => {
    resolveOffer = resolve;
  });
  const sender = new WebRTCSharer("ROOMAA");
  const connecting = sender.connect(() => {});
  sender.cancel();
  await expect(connecting).resolves.toBeUndefined();
  resolveOffer({ type: "offer", sdp: "late" });
  await flush();
  expect(
    jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
});

test("cancelling while a data channel is opening clears its connection wait", async () => {
  readySignals();
  const sender = new WebRTCSharer("ROOMAA");
  const states = jest.fn();
  const connecting = sender.connect(states);
  await flush();
  expect(MockPeer.instances[0].channel.onopen).not.toBeNull();
  sender.cancel();
  await expect(connecting).resolves.toBeUndefined();
  expect(jest.getTimerCount()).toBe(0);
  expect(MockPeer.instances[0].channel.close).toHaveBeenCalledTimes(1);
  expect(
    states.mock.calls.some(([state]) =>
      ["error", "disconnected"].includes(String(state)),
    ),
  ).toBe(false);
});

test("a real signaling timeout closes the peer and releases its polling timers", async () => {
  const sender = new WebRTCSharer("ROOMAA");
  const connecting = sender.connect(() => {});
  const failure = expect(connecting).rejects.toThrow("信令交换超时");
  await flush();
  await jest.advanceTimersByTimeAsync(60_001);
  await failure;
  expect(MockPeer.instances[0].close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("a stalled signaling POST times out before polling and closes its peer", async () => {
  let postSignal: AbortSignal | undefined;
  jest.mocked(fetch).mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return response(null);
    postSignal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const sender = new WebRTCSharer("ROOMAA");
  const connecting = sender.connect(() => {});
  const failure = expect(connecting).rejects.toThrow("信令提交超时");
  await flush();
  jest.advanceTimersByTime(60_001);
  await failure;
  expect(postSignal?.aborted).toBe(true);
  expect(requests()).toHaveLength(0);
  expect(MockPeer.instances[0].close).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("rejected signaling POSTs fail without continuing to answer polling", async () => {
  jest.mocked(fetch).mockResolvedValue({
    ...response(null),
    ok: false,
    status: 403,
  });
  const sender = new WebRTCSharer("ROOMAA");
  await expect(sender.connect(() => {})).rejects.toThrow("信令提交失败 (403)");
  expect(requests()).toHaveLength(0);
  expect(MockPeer.instances[0].close).toHaveBeenCalledTimes(1);
});

test("a completed transfer keeps the existing start, chunk and complete format", async () => {
  readySignals();
  const sender = new WebRTCSharer("ROOMAA");
  const connecting = sender.connect(() => {});
  await flush();
  const channel = MockPeer.instances[0].channel;
  channel.open();
  await connecting;
  const payload = {
    topic: "Example",
    messages: [{ role: "user" as const, content: "Hello" }],
  };
  await sender.sendPayload(payload, () => {});
  const frames = channel.sent.map((frame) => JSON.parse(frame));
  expect(frames.map((frame) => frame.type)).toEqual([
    "start",
    "chunk",
    "complete",
  ]);
  expect(JSON.parse(frames[1].data)).toEqual(payload);
  sender.cancel();
  expect(jest.getTimerCount()).toBe(0);
});

test("cancel immediately ends a transfer waiting for its buffered data to drain", async () => {
  readySignals();
  const sender = new WebRTCSharer("ROOMAA");
  const connecting = sender.connect(() => {});
  await flush();
  const channel = MockPeer.instances[0].channel;
  channel.open();
  await connecting;
  channel.bufferedAmount = 100_000;
  const sending = sender.sendPayload(
    { topic: "Example", messages: [] },
    () => {},
  );
  const cancelled = expect(sending).rejects.toMatchObject({
    name: "AbortError",
  });
  sender.cancel();
  await cancelled;
  expect(jest.getTimerCount()).toBe(0);
  expect(
    channel.sent.some((frame) => JSON.parse(frame).type === "complete"),
  ).toBe(false);
});

test.each(["closed", "stalled"])(
  "a %s channel cannot leave buffered transfer polling forever",
  async (state) => {
    readySignals();
    const sender = new WebRTCSharer("ROOMAA");
    const connecting = sender.connect(() => {});
    await flush();
    const channel = MockPeer.instances[0].channel;
    channel.open();
    await connecting;
    channel.bufferedAmount = 100_000;
    const sending = sender.sendPayload(
      { topic: "Example", messages: [] },
      () => {},
    );
    const failure = expect(sending).rejects.toThrow(
      state === "closed" ? "传输已中断" : "传输超时",
    );
    if (state === "closed") channel.close();
    jest.advanceTimersByTime(state === "closed" ? 11 : 60_001);
    await failure;
    expect(jest.getTimerCount()).toBe(0);
    sender.cancel();
  },
);

test("the receiver still assembles the existing transfer frames", async () => {
  readySignals();
  const receiver = new WebRTCReceiver("ROOMAA");
  const receive = jest.fn();
  await receiver.connect(() => {}, receive);
  const peer = MockPeer.instances[0];
  peer.ondatachannel?.({ channel: peer.channel });
  const payload = {
    topic: "Example",
    messages: [{ role: "user", content: "Hello" }],
  };
  for (const frame of [
    { type: "start", topic: payload.topic, count: 1, totalChunks: 1 },
    { type: "chunk", index: 0, data: JSON.stringify(payload) },
    { type: "complete" },
  ])
    peer.channel.onmessage?.({ data: JSON.stringify(frame) });
  expect(receive).toHaveBeenCalledWith(payload);
  receiver.cancel();
  expect(jest.getTimerCount()).toBe(0);
});
