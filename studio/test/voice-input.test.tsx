import { act, cleanup, renderHook } from "@testing-library/react";
import { jest } from "@jest/globals";
import { useVoiceInput } from "../app/utils/use-voice-input";

type RecognitionHandler = ((event: any) => void) | null;

class MockRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: RecognitionHandler = null;
  onresult: RecognitionHandler = null;
  onerror: RecognitionHandler = null;
  onend: RecognitionHandler = null;
  start = jest.fn(() => {
    if (nextStartError) {
      const error = nextStartError;
      nextStartError = undefined;
      throw error;
    }
  });
  stop = jest.fn();
  abort = jest.fn();
}

let instances: MockRecognition[] = [];
let nextStartError: Error | undefined;
let recognitionConstructor: ReturnType<typeof jest.fn<() => MockRecognition>>;
const replacements: Array<{
  target: object;
  key: PropertyKey;
  descriptor?: PropertyDescriptor;
}> = [];

function replaceProperty(target: object, key: PropertyKey, value: unknown) {
  replacements.push({
    target,
    key,
    descriptor: Object.getOwnPropertyDescriptor(target, key),
  });
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value,
  });
}

function resultEvent(text: string, isFinal = true) {
  return {
    resultIndex: 0,
    results: [{ isFinal, 0: { transcript: text } }],
  };
}

beforeEach(() => {
  instances = [];
  nextStartError = undefined;
  recognitionConstructor = jest.fn(() => {
    const recognition = new MockRecognition();
    instances.push(recognition);
    return recognition;
  });
  replaceProperty(window, "isSecureContext", true);
  replaceProperty(window, "SpeechRecognition", recognitionConstructor);
  replaceProperty(window, "webkitSpeechRecognition", undefined);
  replaceProperty(window, "AudioContext", undefined);
  replaceProperty(navigator, "mediaDevices", undefined);
});

afterEach(() => {
  cleanup();
  for (const { target, key, descriptor } of replacements.reverse()) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
  replacements.length = 0;
});

test("unsupported browsers report an actionable error without starting recognition", () => {
  replaceProperty(window, "SpeechRecognition", undefined);
  const { result } = renderHook(() => useVoiceInput());
  expect(result.current.isSupported).toBe(false);
  act(() => result.current.start());
  expect(result.current.error).toMatch(/不支持/);
  expect(result.current.isListening).toBe(false);
  expect(recognitionConstructor).not.toHaveBeenCalled();
});

test("an insecure page explains the HTTPS requirement before requesting recognition", () => {
  replaceProperty(window, "isSecureContext", false);
  const { result } = renderHook(() => useVoiceInput());
  act(() => result.current.start());
  expect(result.current.error).toMatch(/HTTPS|安全/i);
  expect(result.current.isListening).toBe(false);
  expect(recognitionConstructor).not.toHaveBeenCalled();
});

test("the prefixed recognition API remains supported", () => {
  replaceProperty(window, "SpeechRecognition", undefined);
  replaceProperty(window, "webkitSpeechRecognition", recognitionConstructor);
  const { result } = renderHook(() => useVoiceInput());
  expect(result.current.isSupported).toBe(true);
  act(() => result.current.start());
  expect(instances[0].start).toHaveBeenCalledTimes(1);
});

test("a synchronous constructor failure reports an error and allows retry", () => {
  recognitionConstructor.mockImplementationOnce(() => {
    throw new DOMException("Microphone permission denied", "NotAllowedError");
  });
  const { result } = renderHook(() => useVoiceInput());
  expect(() => {
    act(() => result.current.start());
  }).not.toThrow();
  expect(result.current.error).toBeTruthy();
  expect(result.current.isListening).toBe(false);

  act(() => result.current.start());
  act(() => instances[0].onstart?.({}));
  expect(result.current.error).toBeNull();
  expect(result.current.isListening).toBe(true);
  expect(recognitionConstructor).toHaveBeenCalledTimes(2);
});

test("a synchronous start failure reports an error and allows retry", () => {
  nextStartError = new Error("Recognition could not start");
  const { result } = renderHook(() => useVoiceInput());
  expect(() => {
    act(() => result.current.start());
  }).not.toThrow();
  expect(result.current.error).toBeTruthy();
  expect(result.current.isListening).toBe(false);

  act(() => result.current.start());
  const retry = instances.at(-1)!;
  act(() => retry.onstart?.({}));
  expect(result.current.error).toBeNull();
  expect(result.current.isListening).toBe(true);
  expect(retry.start).toHaveBeenCalledTimes(1);
});

test("repeated starts before onstart create only one recognition request", () => {
  const { result } = renderHook(() => useVoiceInput());
  act(() => {
    result.current.start();
    result.current.start();
  });
  expect(recognitionConstructor).toHaveBeenCalledTimes(1);
  expect(instances[0].start).toHaveBeenCalledTimes(1);
  expect(instances[0].stop).not.toHaveBeenCalled();
});

test("interim Chinese text becomes final text without duplicating the interim result", () => {
  const { result } = renderHook(() => useVoiceInput({ lang: "zh-CN" }));
  act(() => result.current.start());
  const recognition = instances[0];
  expect(recognition.lang).toBe("zh-CN");
  act(() => recognition.onstart?.({}));
  act(() => recognition.onresult?.(resultEvent("你好", false)));
  expect(result.current.transcript).toBe("");
  expect(result.current.interimTranscript).toBe("你好");

  act(() => recognition.onresult?.(resultEvent("你好世界")));
  expect(result.current.transcript).toBe("你好世界");
  expect(result.current.interimTranscript).toBe("");
  expect(result.current.error).toBeNull();
});

test("stopping recognition still accepts its final result", () => {
  const { result } = renderHook(() => useVoiceInput());
  act(() => result.current.start());
  const recognition = instances[0];
  act(() => recognition.onstart?.({}));
  act(() => recognition.onresult?.(resultEvent("最后一句", false)));
  act(() => result.current.stop());
  expect(recognition.stop).toHaveBeenCalledTimes(1);
  expect(recognition.abort).not.toHaveBeenCalled();

  act(() => recognition.onresult?.(resultEvent("最后一句话")));
  act(() => recognition.onend?.({}));
  expect(result.current.transcript).toBe("最后一句话");
  expect(result.current.interimTranscript).toBe("");
  expect(result.current.isListening).toBe(false);
  expect(result.current.error).toBeNull();
});

test("an explicit restart before the stopped instance ends starts a new request and ignores old events", () => {
  const { result } = renderHook(() => useVoiceInput());
  act(() => result.current.start());
  const previous = instances[0];
  const stale = {
    start: previous.onstart,
    result: previous.onresult,
    error: previous.onerror,
    end: previous.onend,
  };
  act(() => previous.onstart?.({}));
  act(() => result.current.stop());
  expect(result.current.isListening).toBe(false);

  act(() => result.current.start());
  expect(recognitionConstructor).toHaveBeenCalledTimes(2);
  expect(previous.abort).toHaveBeenCalledTimes(1);
  const current = instances[1];
  expect(current.start).toHaveBeenCalledTimes(1);
  act(() => current.onstart?.({}));
  act(() => current.onresult?.(resultEvent("Restarted content")));
  act(() => {
    stale.start?.({});
    stale.result?.(resultEvent("Stopped content"));
    stale.error?.({ error: "network" });
    stale.end?.({});
  });
  expect(result.current.transcript).toBe("Restarted content");
  expect(result.current.isListening).toBe(true);
  expect(result.current.error).toBeNull();
});

test("a synchronous stop failure releases the request and permits retry", () => {
  const { result } = renderHook(() => useVoiceInput());
  act(() => result.current.start());
  const previous = instances[0];
  act(() => previous.onstart?.({}));
  previous.stop.mockImplementationOnce(() => {
    throw new Error("Recognition could not stop");
  });
  expect(() => {
    act(() => result.current.stop());
  }).not.toThrow();
  expect(result.current.isListening).toBe(false);
  expect(previous.abort).toHaveBeenCalledTimes(1);

  act(() => result.current.start());
  expect(recognitionConstructor).toHaveBeenCalledTimes(2);
  act(() => instances[1].onstart?.({}));
  expect(result.current.isListening).toBe(true);
  expect(result.current.error).toBeNull();
});

test("recognition permission errors are exposed and the next attempt can retry", () => {
  const { result } = renderHook(() => useVoiceInput());
  act(() => result.current.start());
  act(() => instances[0].onerror?.({ error: "not-allowed" }));
  act(() => instances[0].onend?.({}));
  expect(result.current.error).toMatch(/权限|允许/);
  expect(result.current.isListening).toBe(false);

  act(() => result.current.start());
  act(() => instances[1].onstart?.({}));
  expect(result.current.error).toBeNull();
  expect(result.current.isListening).toBe(true);
});

test("a restarted recognition ignores the previous instance's late events", () => {
  const { result } = renderHook(() => useVoiceInput());
  act(() => result.current.start());
  const previous = instances[0];
  const stale = {
    start: previous.onstart,
    result: previous.onresult,
    error: previous.onerror,
    end: previous.onend,
  };
  act(() => previous.onstart?.({}));
  act(() => previous.onend?.({}));
  expect(result.current.isListening).toBe(false);

  act(() => result.current.start());
  const current = instances[1];
  act(() => current.onstart?.({}));
  act(() => current.onresult?.(resultEvent("新的内容")));
  act(() => {
    stale.start?.({});
    stale.result?.(resultEvent("旧的内容"));
    stale.error?.({ error: "network" });
    stale.end?.({});
  });
  expect(result.current.transcript).toBe("新的内容");
  expect(result.current.interimTranscript).toBe("");
  expect(result.current.isListening).toBe(true);
  expect(result.current.error).toBeNull();
});

test("unmount aborts recognition and late events cannot affect a new hook", () => {
  const first = renderHook(() => useVoiceInput());
  act(() => first.result.current.start());
  const previous = instances[0];
  const stale = {
    start: previous.onstart,
    result: previous.onresult,
    error: previous.onerror,
    end: previous.onend,
  };
  act(() => previous.onstart?.({}));
  first.unmount();
  expect(previous.abort).toHaveBeenCalledTimes(1);

  const next = renderHook(() => useVoiceInput());
  act(() => next.result.current.start());
  act(() => instances[1].onstart?.({}));
  act(() => {
    stale.start?.({});
    stale.result?.(resultEvent("Unmounted content"));
    stale.error?.({ error: "network" });
    stale.end?.({});
  });
  expect(next.result.current.isListening).toBe(true);
  expect(next.result.current.transcript).toBe("");
  expect(next.result.current.interimTranscript).toBe("");
  expect(next.result.current.error).toBeNull();
});
