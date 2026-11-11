/** @jest-environment node */

import { jest } from "@jest/globals";
import { createProxyLifecycle } from "../app/utils/proxy-lifecycle";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("header timeout aborts the upstream and can release its timer", async () => {
  const lifecycle = createProxyLifecycle(new AbortController().signal, 50);
  await jest.advanceTimersByTimeAsync(49);
  expect(lifecycle.signal.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(lifecycle.signal.aborted).toBe(true);
  lifecycle.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

test("stream forwards bytes and releases all timers after normal completion", async () => {
  const client = new AbortController();
  const lifecycle = createProxyLifecycle(client.signal, 50);
  const body = lifecycle.stream(new Response("first\nsecond").body);
  expect(await new Response(body).text()).toBe("first\nsecond");
  await jest.advanceTimersByTimeAsync(100);
  expect(lifecycle.signal.aborted).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

test("a stalled body aborts upstream, cancels its reader, and rejects the read", async () => {
  const cancel = jest.fn<() => void>();
  const lifecycle = createProxyLifecycle(new AbortController().signal, 50);
  const body = lifecycle.stream(new ReadableStream({ cancel }))!;
  const result = body.getReader().read();
  const rejected = expect(result).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await jest.advanceTimersByTimeAsync(50);
  await rejected;
  expect(lifecycle.signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("body idle time resets after each upstream chunk", async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const lifecycle = createProxyLifecycle(new AbortController().signal, 50);
  const reader = lifecycle
    .stream(
      new ReadableStream({
        start(controller) {
          source = controller;
        },
      }),
    )!
    .getReader();
  const first = reader.read();
  await jest.advanceTimersByTimeAsync(40);
  source.enqueue(new Uint8Array([1]));
  expect((await first).value).toEqual(new Uint8Array([1]));
  const second = reader.read();
  await jest.advanceTimersByTimeAsync(40);
  expect(lifecycle.signal.aborted).toBe(false);
  source.enqueue(new Uint8Array([2]));
  expect((await second).value).toEqual(new Uint8Array([2]));
  source.close();
  expect((await reader.read()).done).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test("downstream backpressure is not mistaken for an idle upstream", async () => {
  const lifecycle = createProxyLifecycle(new AbortController().signal, 50);
  const body = lifecycle.stream(new Response("ready").body)!;
  await jest.advanceTimersByTimeAsync(500);
  expect(lifecycle.signal.aborted).toBe(false);
  expect(await new Response(body).text()).toBe("ready");
  expect(jest.getTimerCount()).toBe(0);
});

test("client disconnect after headers cancels a pending upstream read", async () => {
  const client = new AbortController();
  const cancel = jest.fn<() => void>();
  const lifecycle = createProxyLifecycle(client.signal, 50);
  const result = lifecycle
    .stream(new ReadableStream({ cancel }))!
    .getReader()
    .read();
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  client.abort();
  await rejected;
  expect(lifecycle.signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("consumer cancellation aborts upstream and releases timers", async () => {
  const cancel = jest.fn<() => void>();
  const lifecycle = createProxyLifecycle(new AbortController().signal, 50);
  const reader = lifecycle.stream(new ReadableStream({ cancel }))!.getReader();
  const pending = reader.read();
  await reader.cancel();
  expect((await pending).done).toBe(true);
  expect(lifecycle.signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
