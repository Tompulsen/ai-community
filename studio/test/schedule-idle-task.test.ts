import { jest } from "@jest/globals";
import { scheduleIdleTask } from "../app/utils/schedule-idle-task";

const requestIdle = Object.getOwnPropertyDescriptor(
  window,
  "requestIdleCallback",
);
const cancelIdle = Object.getOwnPropertyDescriptor(
  window,
  "cancelIdleCallback",
);

afterEach(() => {
  jest.useRealTimers();
  for (const [name, descriptor] of [
    ["requestIdleCallback", requestIdle],
    ["cancelIdleCallback", cancelIdle],
  ] as const) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else Reflect.deleteProperty(window, name);
  }
});

test("schedules cancellable idle work with a bounded wait", () => {
  let run: IdleRequestCallback | undefined;
  const request = jest.fn(
    (callback: IdleRequestCallback, _options?: IdleRequestOptions) => {
      run = callback;
      return 7;
    },
  );
  const cancel = jest.fn();
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    value: request,
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    value: cancel,
  });
  const task = jest.fn();
  const cleanup = scheduleIdleTask(task);
  expect(task).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith(task, { timeout: 2000 });
  run?.({ didTimeout: false, timeRemaining: () => 20 });
  expect(task).toHaveBeenCalledTimes(1);
  cleanup();
  expect(cancel).toHaveBeenCalledWith(7);
});

test("falls back to deferred work without an idle API", () => {
  jest.useFakeTimers();
  Reflect.deleteProperty(window, "requestIdleCallback");
  const task = jest.fn();
  scheduleIdleTask(task);
  expect(task).not.toHaveBeenCalled();
  jest.runAllTimers();
  expect(task).toHaveBeenCalledTimes(1);
});

test("cancels fallback work before it runs", () => {
  jest.useFakeTimers();
  Reflect.deleteProperty(window, "requestIdleCallback");
  const task = jest.fn();
  const cleanup = scheduleIdleTask(task);
  cleanup();
  jest.runAllTimers();
  expect(task).not.toHaveBeenCalled();
});
