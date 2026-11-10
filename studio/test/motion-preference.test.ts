import { jest } from "@jest/globals";
import { getMotionPreference, prefersReducedMotion } from "../app/utils/motion";

test.each([
  [{ motionPreference: "system", reduceMotion: true }, "system"],
  [{ motionPreference: "full", reduceMotion: true }, "full"],
  [{ motionPreference: "reduced", reduceMotion: false }, "reduced"],
  [{ reduceMotion: true }, "reduced"],
  [{ reduceMotion: false }, "system"],
  [{}, "system"],
  [{ motionPreference: "invalid", reduceMotion: true }, "reduced"],
  [{ motionPreference: null, reduceMotion: false }, "system"],
  [{ reduceMotion: "true" }, "system"],
] as const)("configuration %j resolves to %s", (config, expected) => {
  expect(getMotionPreference(config)).toBe(expected);
});

const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  document.body.removeAttribute("data-motion");
  document.body.classList.remove("reduce-motion");
  if (mediaDescriptor)
    Object.defineProperty(window, "matchMedia", mediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

test.each([
  ["full", true, true, false],
  ["full", false, false, false],
  ["reduced", false, false, true],
  ["reduced", false, true, true],
  ["system", false, false, false],
  ["system", false, true, true],
  ["system", true, false, true],
  [undefined, false, false, false],
  [undefined, false, true, true],
  [undefined, true, false, true],
  ["invalid", false, true, true],
] as const)(
  "DOM mode=%s legacy class=%s OS reduction=%s resolves to %s",
  (mode, legacyClass, systemReduced, expected) => {
    if (mode !== undefined) document.body.dataset.motion = mode;
    document.body.classList.toggle("reduce-motion", legacyClass);
    const matchMedia = jest.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && systemReduced,
    }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });
    expect(prefersReducedMotion()).toBe(expected);
    if (mode === "full" || mode === "reduced")
      expect(matchMedia).not.toHaveBeenCalled();
  },
);

test("a browser without matchMedia retains legacy class support", () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: undefined,
  });
  document.body.dataset.motion = "system";
  expect(prefersReducedMotion()).toBe(false);
  document.body.classList.add("reduce-motion");
  expect(prefersReducedMotion()).toBe(true);
});
