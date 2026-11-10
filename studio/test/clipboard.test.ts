import { jest } from "@jest/globals";

const toast = jest.fn();
const writeText = jest.fn<(text: string) => Promise<void>>();
const command = jest.fn<(name: string) => boolean>();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const commandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);
const tauriDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI__");

jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: toast,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Copy: { Success: "Copied", Failed: "Copy failed" } },
}));
jest.unstable_mockModule("@/app/utils/stream", () => ({
  fetch: jest.fn(),
}));
jest.unstable_mockModule("@/app/store", () => ({
  useAccessStore: { getState: () => ({}) },
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelCapabilities: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/custom-provider", () => ({
  usesCustomProvider: jest.fn(),
}));

const { copyToClipboard } = await import("../app/utils");

function pendingWrite() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function field(text = "hello selected world") {
  const input = document.createElement("textarea");
  input.value = text;
  document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(6, 14, "backward");
  return input;
}

beforeEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  toast.mockClear();
  writeText.mockReset().mockResolvedValue(undefined);
  command.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: command,
  });
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: undefined,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  for (const [target, name, descriptor] of [
    [navigator, "clipboard", clipboardDescriptor],
    [document, "execCommand", commandDescriptor],
    [window, "__TAURI__", tauriDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

test("confirmed Clipboard API writes return true without touching the input selection", async () => {
  const input = field();
  await expect(copyToClipboard("copied text")).resolves.toBe(true);
  expect(writeText).toHaveBeenCalledWith("copied text");
  expect(command).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith("Copied");
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([6, 14, "backward"]);
});

test("Tauri writes must finish before reporting success", async () => {
  const pending = pendingWrite();
  const tauriWrite = jest.fn(() => pending.promise);
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: { writeText: tauriWrite },
  });
  let settled = false;
  const copied = copyToClipboard("native text").then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(toast).not.toHaveBeenCalled();
  pending.resolve();
  await expect(copied).resolves.toBe(true);
  expect(tauriWrite).toHaveBeenCalledWith("native text");
  expect(writeText).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalled();
});

test("fallback confirms the copy command and restores the exact input selection and scroll", async () => {
  const input = field();
  input.scrollTop = 20;
  input.scrollLeft = 9;
  writeText.mockRejectedValue(new Error("Clipboard permission denied"));
  command.mockImplementation((name) => {
    const temporary = document.activeElement as HTMLTextAreaElement;
    expect(name).toBe("copy");
    expect(temporary).not.toBe(input);
    expect(temporary.value).toBe("fallback text");
    expect(temporary.selectionStart).toBe(0);
    expect(temporary.selectionEnd).toBe(temporary.value.length);
    return true;
  });
  await expect(copyToClipboard("fallback text")).resolves.toBe(true);
  expect(document.activeElement).toBe(input);
  expect([
    input.selectionStart,
    input.selectionEnd,
    input.selectionDirection,
  ]).toEqual([6, 14, "backward"]);
  expect([input.scrollTop, input.scrollLeft]).toEqual([20, 9]);
  expect(document.querySelectorAll("textarea")).toHaveLength(1);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith("Copied");
});

test.each(["false", "throw"])(
  "a %s copy fallback returns false and reports failure",
  async (failure) => {
    const input = field();
    writeText.mockRejectedValue(new Error("No clipboard access"));
    command.mockImplementation(() => {
      if (failure === "throw") throw new Error("Copy command unavailable");
      return false;
    });
    await expect(copyToClipboard("cannot copy")).resolves.toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Copy failed");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 14]);
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  },
);

test("rejected Tauri writes also use the confirmed fallback result", async () => {
  Object.defineProperty(window, "__TAURI__", {
    configurable: true,
    value: {
      writeText: jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("Tauri copy failed")),
    },
  });
  command.mockReturnValue(false);
  await expect(copyToClipboard("native failure")).resolves.toBe(false);
  expect(command).toHaveBeenCalledWith("copy");
  expect(toast).toHaveBeenCalledWith("Copy failed");
});

test("fallback restores selected message text after its temporary field is removed", async () => {
  const paragraph = document.createElement("p");
  paragraph.textContent = "A selected message";
  const button = document.createElement("button");
  document.body.append(paragraph, button);
  button.focus();
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, 2);
  range.setEnd(paragraph.firstChild!, 10);
  document.getSelection()!.addRange(range);
  writeText.mockRejectedValue(new Error("Clipboard unavailable"));
  command.mockImplementation(() => {
    document.getSelection()!.removeAllRanges();
    return true;
  });
  await expect(copyToClipboard("selected")).resolves.toBe(true);
  expect(document.activeElement).toBe(button);
  expect(document.getSelection()!.toString()).toBe("selected");
  expect(document.querySelectorAll("textarea")).toHaveLength(0);
});

test("an async write failure preserves the field focused just before fallback", async () => {
  field("first field draft");
  const pending = pendingWrite();
  writeText.mockReturnValue(pending.promise);
  const copied = copyToClipboard("captured copy");
  const later = field("later field draft");
  later.setSelectionRange(1, 4);
  pending.reject(new Error("Permission request rejected"));
  await expect(copied).resolves.toBe(true);
  expect(document.activeElement).toBe(later);
  expect([later.selectionStart, later.selectionEnd]).toEqual([1, 4]);
});

test("fallback cleanup does not focus a target that was disconnected", async () => {
  const input = field();
  const focus = jest.spyOn(input, "focus");
  writeText.mockRejectedValue(new Error("Clipboard unavailable"));
  command.mockImplementation(() => {
    input.remove();
    return true;
  });
  await expect(copyToClipboard("copied")).resolves.toBe(true);
  expect(focus).not.toHaveBeenCalled();
  expect(document.querySelectorAll("textarea")).toHaveLength(0);
});
