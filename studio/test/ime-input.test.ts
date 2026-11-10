import { createImeGuard } from "../app/utils/ime-input";

test("candidate selection and trailing Enter cannot submit, deliberate Enter can", () => {
  let now = 1000;
  const guard = createImeGuard(() => now);
  guard.start();
  expect(guard.blocks({ key: "Enter" })).toBe(true);
  expect(guard.blocks({ key: "ArrowUp" })).toBe(true);
  guard.end();
  expect(guard.blocks({ key: "Enter" })).toBe(true);
  now += 199;
  expect(guard.blocks({ key: "Enter" })).toBe(true);
  now += 1;
  expect(guard.blocks({ key: "Enter" })).toBe(false);
  expect(guard.blocks({ key: "Enter", repeat: true })).toBe(true);
  expect(guard.blocks({ key: "Enter", isComposing: true })).toBe(true);
  expect(guard.blocks({ key: "Enter", keyCode: 229 })).toBe(true);
});

test("fresh input and non-Enter shortcuts have no commit delay", () => {
  const guard = createImeGuard(() => 0);
  expect(guard.blocks({ key: "Enter" })).toBe(false);
  guard.end();
  expect(guard.blocks({ key: "a" })).toBe(false);
  expect(guard.blocks({ key: "ArrowUp" })).toBe(false);
});

test("releasing the candidate Enter allows a deliberate second press immediately", () => {
  const guard = createImeGuard(() => 1000);
  guard.start();
  expect(guard.blocks({ key: "Enter", isComposing: true })).toBe(true);
  guard.end();
  guard.release({ key: "Enter" });
  expect(guard.blocks({ key: "Enter" })).toBe(false);
});

test("composition ending before keydown still blocks the commit until release", () => {
  const guard = createImeGuard(() => 1000);
  guard.start();
  guard.end();
  expect(guard.blocks({ key: "Enter" })).toBe(true);
  expect(guard.blocks({ key: "Enter", repeat: true })).toBe(true);
  guard.release({ key: "Enter" });
  expect(guard.blocks({ key: "Enter" })).toBe(false);
  expect(guard.blocks({ key: "Enter", repeat: true })).toBe(true);
});

test("release never bypasses active composition or a subsequent candidate commit", () => {
  const guard = createImeGuard(() => 1000);
  guard.start();
  guard.release({ key: "Enter" });
  expect(guard.blocks({ key: "Enter" })).toBe(true);
  guard.end();
  guard.release({ key: "Enter" });
  expect(guard.blocks({ key: "Enter" })).toBe(false);

  guard.start();
  guard.end();
  guard.release({ key: "Shift" });
  expect(guard.blocks({ key: "Enter" })).toBe(true);
  guard.release({ key: "Unidentified", keyCode: 13 });
  expect(guard.blocks({ key: "Enter" })).toBe(false);
});

test.each([" ", "1", "5", "9"])(
  "selecting a candidate with %p allows the first deliberate Enter after key release",
  (key) => {
    const guard = createImeGuard(() => 1000);
    guard.start();
    expect(guard.blocks({ key, isComposing: true })).toBe(true);
    guard.end();
    guard.release({ key });
    expect(guard.blocks({ key: "Enter" })).toBe(false);
    expect(guard.blocks({ key: "Enter", repeat: true })).toBe(true);
    expect(guard.blocks({ key: "Enter", isComposing: true })).toBe(true);
    expect(guard.blocks({ key: "Enter", keyCode: 229 })).toBe(true);
  },
);

test.each([" ", "2"])(
  "a %p keyup after compositionend releases the barrier without a matching keydown",
  (key) => {
    const guard = createImeGuard(() => 1000);
    guard.start();
    guard.end();
    guard.release({ key });
    expect(guard.blocks({ key: "Enter" })).toBe(false);
  },
);

test.each([" ", "3"])(
  "releasing %p cannot bypass an active composition or a later Enter commit",
  (key) => {
    const guard = createImeGuard(() => 1000);
    guard.start();
    guard.release({ key });
    expect(guard.blocks({ key: "Enter" })).toBe(true);
    guard.end();
    expect(guard.blocks({ key: "Enter" })).toBe(true);
    guard.release({ key: "Shift" });
    expect(guard.blocks({ key: "Enter" })).toBe(true);
    guard.release({ key: "Enter" });
    expect(guard.blocks({ key: "Enter" })).toBe(false);
  },
);

test.each([
  { key: " ", isComposing: true },
  { key: "2", keyCode: 229 },
])("an unresolved candidate release %p keeps the Enter barrier", (event) => {
  const guard = createImeGuard(() => 1000);
  guard.start();
  guard.end();
  guard.release(event);
  expect(guard.blocks({ key: "Enter" })).toBe(true);
  guard.release({ key: event.key });
  expect(guard.blocks({ key: "Enter" })).toBe(false);
});
