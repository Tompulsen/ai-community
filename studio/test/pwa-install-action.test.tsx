import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";

let mobile = false;
let ios = false;
let standalone = false;
jest.unstable_mockModule("@/app/utils", () => ({
  useMobileScreen: () => mobile,
  isIOS: () => ios,
}));
jest.unstable_mockModule("@/app/components/button", () => ({
  IconButton: () => null,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    UI: {
      DownloadApp: "Download app",
      InstallHint: "Add to your home screen",
    },
  },
}));

const { usePwaInstallAction, PwaInstallActionButton } = await import(
  "../app/components/pwa-install"
);

function Harness() {
  const { action, hint } = usePwaInstallAction();
  return (
    <>
      {action && (
        <button onClick={action.onClick}>
          {action.icon}
          {action.text}
        </button>
      )}
      {hint}
    </>
  );
}

const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const iosStandaloneDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "standalone",
);
const cachedPromptDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "_PWA_INSTALL_PROMPT",
);

beforeEach(() => {
  mobile = false;
  ios = false;
  standalone = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(display-mode: standalone)" && standalone,
    }),
  });
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: false,
  });
  Reflect.deleteProperty(window, "_PWA_INSTALL_PROMPT");
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  for (const [target, name, descriptor] of [
    [window, "matchMedia", mediaDescriptor],
    [window.navigator, "standalone", iosStandaloneDescriptor],
    [window, "_PWA_INSTALL_PROMPT", cachedPromptDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

function installPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = jest.fn<() => Promise<void>>(async () => {});
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  return { event, prompt };
}

test("an available browser install prompt is invoked once and consumed", async () => {
  render(<Harness />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  const { event, prompt } = installPrompt();
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download app" }));
  });
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("appinstalled hides an available action and clears its prompt", () => {
  render(<Harness />);
  const { event, prompt } = installPrompt();
  act(() => window.dispatchEvent(event));
  expect(
    screen.getByRole("button", { name: "Download app" }),
  ).toBeInTheDocument();
  act(() => window.dispatchEvent(new Event("appinstalled")));
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(prompt).not.toHaveBeenCalled();
});

test("iOS mobile guidance remains visible outside the trigger and expires", () => {
  jest.useFakeTimers();
  ios = true;
  mobile = true;
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Download app" }));
  const hint = screen.getByText("Add to your home screen");
  expect(hint).toHaveStyle({ position: "fixed", top: "60px" });
  act(() => jest.advanceTimersByTime(5000));
  expect(screen.queryByText("Add to your home screen")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Download app" }),
  ).toBeInTheDocument();
});

test.each(["display-mode", "ios"])(
  "an installed %s app has no action or guidance",
  (mode) => {
    ios = true;
    mobile = true;
    if (mode === "display-mode") standalone = true;
    else
      Object.defineProperty(window.navigator, "standalone", {
        configurable: true,
        value: true,
      });
    render(<Harness />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Add to your home screen"),
    ).not.toBeInTheDocument();
  },
);

test("the existing renderAction wrapper reuses a cached install prompt", async () => {
  const { event, prompt } = installPrompt("dismissed");
  Object.defineProperty(window, "_PWA_INSTALL_PROMPT", {
    configurable: true,
    value: event,
  });
  render(
    <PwaInstallActionButton
      renderAction={({ text, onClick }) => (
        <button onClick={onClick}>{text}</button>
      )}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download app" }));
  });
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
