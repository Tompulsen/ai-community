import { jest } from "@jest/globals";

const copy = jest.fn<(text: string) => Promise<boolean>>();
jest.unstable_mockModule("@/app/utils", () => ({
  copyToClipboard: copy,
}));

const { captureTextEditTarget, canRunTextEditCommand, runTextEditCommand } =
  await import("../app/utils/text-edit-command");

const nativeEdit =
  jest.fn<(command: string, ui?: boolean, value?: string) => boolean>();
const readText = jest.fn<() => Promise<string>>();
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalExec = Object.getOwnPropertyDescriptor(document, "execCommand");

function inputTarget(value = "one two three", start = 4, end = 7) {
  const input = document.createElement("textarea");
  document.body.appendChild(input);
  input.value = value;
  input.focus();
  input.setSelectionRange(start, end, "forward");
  return { input, target: captureTextEditTarget()! };
}

beforeEach(() => {
  copy.mockReset().mockResolvedValue(true);
  readText.mockReset().mockResolvedValue("pasted");
  nativeEdit.mockReset().mockReturnValue(true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: nativeEdit,
  });
});

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  if (originalClipboard)
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (originalExec)
    Object.defineProperty(document, "execCommand", originalExec);
  else Reflect.deleteProperty(document, "execCommand");
});

test("a menu command restores the original input and selected text", async () => {
  const { input, target } = inputTarget();
  const menu = document.createElement("button");
  document.body.appendChild(menu);
  menu.focus();

  expect(await runTextEditCommand("copy", target, () => true)).toBe("success");
  expect(copy).toHaveBeenCalledWith("two");
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([4, 7]);
});

test("failed clipboard writes never delete the original selection", async () => {
  const { input, target } = inputTarget();
  copy.mockResolvedValue(false);
  expect(await runTextEditCommand("cut", target, () => true)).toBe(
    "unavailable",
  );
  expect(input.value).toBe("one two three");
  expect(nativeEdit).not.toHaveBeenCalled();
});

test("successful cut deletes the exact saved selection with native undo support", async () => {
  const { input, target } = inputTarget();
  expect(await runTextEditCommand("cut", target, () => true)).toBe("success");
  expect(copy).toHaveBeenCalledWith("two");
  expect(nativeEdit).toHaveBeenCalledWith("delete", false, undefined);
  expect([input.selectionStart, input.selectionEnd]).toEqual([4, 7]);
});

test.each([
  [false, "forwardDelete"],
  [true, "delete"],
] as const)(
  "collapsed deletion follows platform direction (Mac: %s)",
  async (isMac, command) => {
    const { target } = inputTarget("abc", 1, 1);
    await runTextEditCommand("delete", target, () => true, isMac);
    expect(nativeEdit).toHaveBeenCalledWith(command, false, undefined);
  },
);

test("select all works on readonly fields while destructive actions are disabled", async () => {
  const { input, target } = inputTarget();
  input.readOnly = true;
  for (const command of ["cut", "paste", "undo", "redo", "delete"] as const)
    expect(canRunTextEditCommand(command, target)).toBe(false);
  expect(await runTextEditCommand("select-all", target, () => true)).toBe(
    "success",
  );
  expect([input.selectionStart, input.selectionEnd]).toEqual([
    0,
    input.value.length,
  ]);
});

test.each([
  "session",
  "value",
  "focus",
  "selection",
  "readonly",
  "disabled",
] as const)("a delayed paste cannot overwrite a changed %s", async (change) => {
  const { input, target } = inputTarget();
  let resolvePaste!: (text: string) => void;
  readText.mockReturnValue(
    new Promise<string>((resolve) => {
      resolvePaste = resolve;
    }),
  );
  let currentSession = true;
  const operation = runTextEditCommand("paste", target, () => currentSession);
  if (change === "session") currentSession = false;
  else if (change === "value") input.value = "a newer draft";
  else if (change === "focus") {
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
  } else if (change === "selection") input.setSelectionRange(0, 0);
  else if (change === "readonly") input.readOnly = true;
  else input.disabled = true;

  resolvePaste("late text");
  expect(await operation).toBe("unavailable");
  expect(nativeEdit).not.toHaveBeenCalled();
  expect(input.value).toBe(
    change === "value" ? "a newer draft" : "one two three",
  );
});

test("a delayed cut never deletes a newer draft after clipboard confirmation", async () => {
  const { input, target } = inputTarget();
  let resolveCopy!: (success: boolean) => void;
  copy.mockReturnValue(
    new Promise<boolean>((resolve) => {
      resolveCopy = resolve;
    }),
  );
  const operation = runTextEditCommand("cut", target, () => true);
  input.value = "a newer draft";
  resolveCopy(true);
  expect(await operation).toBe("unavailable");
  expect(nativeEdit).not.toHaveBeenCalled();
});

test("permission denial preserves text and reports the paste fallback", async () => {
  const { input, target } = inputTarget();
  readText.mockRejectedValue(new Error("NotAllowedError"));
  expect(await runTextEditCommand("paste", target, () => true)).toBe(
    "paste-failed",
  );
  expect(input.value).toBe("one two three");
  expect(nativeEdit).not.toHaveBeenCalled();
});

test.each([false, true])(
  "native mutations notify controlled inputs once (native input event: %s)",
  async (emitsInput) => {
    const { input, target } = inputTarget();
    const onInput = jest.fn();
    input.addEventListener("input", onInput);
    nativeEdit.mockImplementation(() => {
      input.value = "one pasted three";
      if (emitsInput)
        input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    expect(await runTextEditCommand("paste", target, () => true)).toBe(
      "success",
    );
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(nativeEdit).toHaveBeenCalledWith("insertText", false, "pasted");
  },
);

test("disconnected targets and password copying are unavailable", async () => {
  const { input, target } = inputTarget();
  input.remove();
  expect(await runTextEditCommand("delete", target, () => true)).toBe(
    "unavailable",
  );
  const password = document.createElement("input");
  password.type = "password";
  password.value = "private";
  document.body.appendChild(password);
  password.focus();
  password.select();
  expect(canRunTextEditCommand("copy", captureTextEditTarget())).toBe(false);
  expect(nativeEdit).not.toHaveBeenCalled();
  expect(copy).not.toHaveBeenCalled();
});

test("a target that cannot receive focus never edits the other active field", async () => {
  const { input, target } = inputTarget();
  const other = document.createElement("textarea");
  document.body.appendChild(other);
  other.value = "another draft";
  other.focus();
  input.focus = jest.fn();
  expect(await runTextEditCommand("delete", target, () => true)).toBe(
    "unavailable",
  );
  expect(nativeEdit).not.toHaveBeenCalled();
  expect(other.value).toBe("another draft");
});

test("selected message text can be copied without making it editable", async () => {
  const paragraph = document.createElement("p");
  paragraph.textContent = "read only message";
  document.body.appendChild(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  window.getSelection()!.addRange(range);
  const target = captureTextEditTarget();
  expect(await runTextEditCommand("copy", target, () => true)).toBe("success");
  expect(copy).toHaveBeenCalledWith("read only message");
  expect(canRunTextEditCommand("delete", target)).toBe(false);
  expect(canRunTextEditCommand("paste", target)).toBe(false);
});
