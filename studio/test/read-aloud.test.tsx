import React from "react";
import { act, render, renderHook } from "@testing-library/react";
import { jest } from "@jest/globals";
import {
  speechChunks,
  speechText,
  useReadAloud,
} from "../app/utils/use-read-aloud";

const localVoice = {
  voiceURI: "local-zh",
  name: "中文",
  lang: "zh-CN",
  localService: true,
} as SpeechSynthesisVoice;
const remoteVoice = {
  voiceURI: "remote-zh",
  name: "在线中文",
  lang: "zh-CN",
  localService: false,
} as SpeechSynthesisVoice;
let available: SpeechSynthesisVoice[] = [];
let utterances: SpeechSynthesisUtterance[] = [];
let synth: EventTarget & {
  getVoices: () => SpeechSynthesisVoice[];
  speak: ReturnType<typeof jest.fn>;
  cancel: ReturnType<typeof jest.fn>;
};

beforeEach(() => {
  available = [remoteVoice, localVoice];
  utterances = [];
  synth = Object.assign(new EventTarget(), {
    getVoices: () => available,
    speak: jest.fn((utterance: SpeechSynthesisUtterance) => {
      utterances.push(utterance);
    }),
    cancel: jest.fn(),
  });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: synth,
  });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    value: class {
      constructor(public text: string) {}
    },
  });
});

test("reads prose and link labels, skipping fenced code, image and raw URLs", async () => {
  expect(
    await speechText(
      '## 你好 **世界**\n[参考](https://example.com)\n![图片](https://fixture/a.png)\n```js\nalert("不要朗读");\n```\n继续 https://example.com',
    ),
  ).toBe("你好 世界 参考 继续");
  expect(await speechText("~~~svg\n<svg>代码</svg>\n~~~")).toBe("");
  expect(await speechText("正文\n```js\n未闭合代码")).toBe("正文");
});

test("chunks long text without losing characters or splitting emoji", () => {
  const text = "你".repeat(200) + "。" + "😀".repeat(181);
  const chunks = speechChunks(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((chunk) => Array.from(chunk).length <= 180)).toBe(true);
});

test("selects a local matching voice by default, clamps rate, plays all chunks in order", async () => {
  const { result } = renderHook(() =>
    useReadAloud({ lang: "zh-CN", rate: 100 }),
  );
  await act(() => result.current.speak("a", "第一句。第二句。"));
  expect(result.current.activeId).toBe("a");
  expect(utterances[0].voice).toBe(localVoice);
  expect(utterances[0].rate).toBe(2);
  expect(utterances[0].text).toBe("第一句。");
  act(() => utterances[0].onend?.({} as SpeechSynthesisEvent));
  expect(utterances[1].text).toBe("第二句。");
  act(() => utterances[1].onend?.({} as SpeechSynthesisEvent));
  expect(result.current.activeId).toBeNull();
});

test("explicit voice selection is respected and late-loaded voices refresh", async () => {
  available = [];
  const { result } = renderHook(() => useReadAloud({ voiceURI: "remote-zh" }));
  expect(result.current.voices).toHaveLength(0);
  act(() => {
    available = [localVoice, remoteVoice];
    synth.dispatchEvent(new Event("voiceschanged"));
  });
  expect(result.current.voices).toHaveLength(2);
  await act(() => result.current.speak("a", "你好"));
  expect(utterances[0].voice).toBe(remoteVoice);
});

test("switching message cancels playback and ignores stale callbacks", async () => {
  const { result } = renderHook(() => useReadAloud());
  await act(() => result.current.speak("a", "第一句。第二句。"));
  const stale = utterances[0].onend!;
  await act(() => result.current.speak("b", "新消息"));
  expect(synth.cancel).toHaveBeenCalledTimes(1);
  act(() => stale.call(utterances[0], {} as SpeechSynthesisEvent));
  expect(utterances.map((item) => item.text)).toEqual(["第一句。", "新消息"]);
  expect(result.current.activeId).toBe("b");
});

test("stop and unmount release playback without queuing more speech", async () => {
  const { result, unmount } = renderHook(() => useReadAloud());
  await act(() => result.current.speak("a", "第一句。第二句。"));
  act(() => result.current.stop());
  expect(result.current.activeId).toBeNull();
  expect(utterances[0].onend).toBeNull();
  await act(() => result.current.speak("b", "另一句"));
  unmount();
  expect(synth.cancel).toHaveBeenCalledTimes(2);
  expect(utterances[1].onend).toBeNull();
});

test("unsupported devices and empty prose report actionable errors", async () => {
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: undefined,
  });
  const { result } = renderHook(() => useReadAloud());
  expect(result.current.supported).toBe(false);
  await act(() => result.current.speak("a", "你好"));
  expect(result.current.error).toContain("不支持");
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: synth,
  });
  await act(() => result.current.speak("b", "```js\ncode\n```"));
  expect(result.current.error).toContain("没有可朗读");
  expect(synth.speak).not.toHaveBeenCalled();
});

test("synthesis error clears playing state and allows retry", async () => {
  const { result } = renderHook(() => useReadAloud());
  await act(() => result.current.speak("a", "你好"));
  act(
    () =>
      utterances[0].onerror?.({
        error: "voice-unavailable",
      } as SpeechSynthesisErrorEvent),
  );
  expect(result.current.activeId).toBeNull();
  expect(result.current.error).toContain("更换声音");
  await act(() => result.current.speak("a", "你好"));
  expect(result.current.error).toBeNull();
  expect(result.current.activeId).toBe("a");
});

test("a loading reply can be stopped before any utterance is queued", async () => {
  const { result } = renderHook(() => useReadAloud());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.speak("loading", "Do not queue this reply.");
  });
  expect(result.current.activeId).toBe("loading");
  expect(synth.speak).not.toHaveBeenCalled();
  act(() => result.current.stop());
  await act(async () => {
    await pending;
  });
  expect(synth.speak).not.toHaveBeenCalled();
  expect(result.current.activeId).toBeNull();
  expect(result.current.error).toBeNull();
});

test("only the newest reply starts when requests overlap during parser loading", async () => {
  const { result } = renderHook(() => useReadAloud());
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.speak("first", "The stale reply.");
    second = result.current.speak("second", "The selected reply.");
  });
  await act(async () => {
    await Promise.all([first, second]);
  });
  expect(utterances.map((utterance) => utterance.text)).toEqual([
    "The selected reply.",
  ]);
  expect(result.current.activeId).toBe("second");
  expect(result.current.error).toBeNull();
});

test("an older parser failure cannot replace the newer reply or its error state", async () => {
  const { result } = renderHook(() => useReadAloud());
  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = result.current.speak("broken", null as unknown as string);
    second = result.current.speak("new", "A valid reply.");
  });
  await act(async () => {
    await Promise.all([first, second]);
  });
  expect(utterances.map((utterance) => utterance.text)).toEqual([
    "A valid reply.",
  ]);
  expect(result.current.activeId).toBe("new");
  expect(result.current.error).toBeNull();
});

test("unmount while loading cannot start speech or leave callbacks behind", async () => {
  const { result, unmount } = renderHook(() => useReadAloud());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.speak("loading", "Do not play after unmount.");
  });
  unmount();
  await pending;
  expect(synth.speak).not.toHaveBeenCalled();
  expect(utterances).toEqual([]);
});

test("switching the keyed conversation cancels speech that is still loading", async () => {
  let reader!: ReturnType<typeof useReadAloud>;
  function Reader() {
    reader = useReadAloud();
    return null;
  }
  const { rerender } = render(<Reader key="old-conversation" />);
  let pending!: Promise<void>;
  act(() => {
    pending = reader.speak("old-reply", "Do not play in another conversation.");
  });
  rerender(<Reader key="new-conversation" />);
  await pending;
  expect(synth.speak).not.toHaveBeenCalled();
  expect(reader.activeId).toBeNull();
  expect(reader.error).toBeNull();
});

test("a parser failure clears loading state and a later request can retry", async () => {
  const { result } = renderHook(() => useReadAloud());
  await act(() => result.current.speak("broken", null as unknown as string));
  expect(result.current.activeId).toBeNull();
  expect(result.current.error).toContain("未能启动");
  await act(() => result.current.speak("retry", "A valid retry."));
  expect(result.current.activeId).toBe("retry");
  expect(result.current.error).toBeNull();
  expect(utterances.map((utterance) => utterance.text)).toEqual([
    "A valid retry.",
  ]);
});

test("a synchronous synthesis exception preserves the startup error and permits retry", async () => {
  const { result } = renderHook(() => useReadAloud());
  synth.speak.mockImplementationOnce(() => {
    throw new Error("Voice could not start.");
  });
  await act(() => result.current.speak("broken", "A reply."));
  expect(result.current.activeId).toBeNull();
  expect(result.current.error).toContain("未能启动");
  await act(() => result.current.speak("retry", "A valid retry."));
  expect(result.current.activeId).toBe("retry");
  expect(result.current.error).toBeNull();
});
