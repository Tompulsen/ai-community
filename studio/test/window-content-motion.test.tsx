import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { Path, SlotID } from "../app/constant";

jest.unstable_mockModule("../app/components/home.module.scss", () => ({
  default: {
    sidebar: "sidebar",
    "window-content": "window-content",
    "settings-window-content": "settings-window-content",
  },
}));
const { default: styles } = await import("../app/components/home.module.scss");
const { WindowContent } = await import("../app/components/window-content");

const animateDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

type RecordedAnimation = {
  target: HTMLElement;
  options: KeyframeAnimationOptions;
  cancel: ReturnType<typeof jest.fn>;
  onfinish: null | (() => void);
  startTime: number | null;
  playState: string;
};

let animations: RecordedAnimation[];
let reducedMotion = false;
let mobile = false;
let animate: ReturnType<typeof jest.fn>;

beforeEach(() => {
  animations = [];
  reducedMotion = false;
  mobile = false;
  document.body.classList.remove("reduce-motion");
  document.body.removeAttribute("data-motion");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches:
        (query === "(prefers-reduced-motion: reduce)" && reducedMotion) ||
        (query === "(max-width: 600px)" && mobile),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
  animate = jest.fn(function (
    this: HTMLElement,
    _frames: Keyframe[] | PropertyIndexedKeyframes,
    options: KeyframeAnimationOptions,
  ): Animation {
    const animation: RecordedAnimation = {
      target: this,
      options,
      onfinish: null,
      startTime: 16,
      playState: "running",
      cancel: jest.fn(() => {
        animation.playState = "idle";
      }),
    };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
});

afterEach(() => {
  cleanup();
  document.body.classList.remove("reduce-motion");
  document.body.removeAttribute("data-motion");
  jest.restoreAllMocks();
  for (const [target, name, descriptor] of [
    [Element.prototype, "animate", animateDescriptor],
    [window, "matchMedia", mediaDescriptor],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

function Fixture({
  loading = false,
  revision = 0,
}: {
  loading?: boolean;
  revision?: number;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <nav>
        <button onClick={() => navigate(Path.Chat)}>Chat</button>
        <button onClick={() => navigate(Path.Settings)}>Settings</button>
        <button onClick={() => navigate(Path.Gallery)}>Gallery</button>
      </nav>
      <div>
        {location.pathname !== Path.Settings && (
          <aside
            className={styles.sidebar}
            data-testid="sidebar"
            style={{ width: 300, flexShrink: 0 }}
          />
        )}
        <WindowContent>
          {loading ? (
            <div role="status" aria-label="Loading" />
          ) : (
            <section>
              <input aria-label="Draft" defaultValue="Keep this draft" />
              <output>{location.pathname}</output>
              <span>{revision}</span>
            </section>
          )}
        </WindowContent>
      </div>
    </>
  );
}

function renderWindow(initialPath: Path = Path.Chat, initialLoading = false) {
  const view = (loading: boolean, revision = 0) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Fixture loading={loading} revision={revision} />
    </MemoryRouter>
  );
  const result = render(view(initialLoading));
  const content = document.getElementById(SlotID.AppBody)!;
  return {
    ...result,
    content,
    update(loading: boolean, revision = 0) {
      result.rerender(view(loading, revision));
    },
  };
}

function goTo(name: "Chat" | "Settings" | "Gallery") {
  fireEvent.click(screen.getByRole("button", { name }));
}

test.each([Path.Chat, Path.Settings, Path.Home])(
  "opening %s presents the initial layout without an entrance animation",
  (path) => {
    renderWindow(path);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "Keep this draft",
    );
  },
);

test("home and chat are the same screen for route motion", () => {
  renderWindow(Path.Home);
  goTo("Chat");
  expect(animate).not.toHaveBeenCalled();
});

test("returning from settings coordinates the sidebar and content without temporary sizing", () => {
  const { content } = renderWindow(Path.Settings);
  const contentWidth = content.style.width;
  const contentMaxWidth = content.style.maxWidth;
  goTo("Chat");

  const sidebar = screen.getByTestId("sidebar");
  const contentMotion = animations.find(
    (animation) => animation.target === content,
  );
  const sidebarMotion = animations.find(
    (animation) => animation.target === sidebar,
  );
  expect(contentMotion).toBeDefined();
  expect(sidebarMotion).toBeDefined();
  expect(animations).toHaveLength(2);
  expect(sidebarMotion!.options.duration).toBeGreaterThan(0);
  expect(sidebarMotion!.options.duration).toBe(contentMotion!.options.duration);
  expect(sidebarMotion!.options.easing).toBe(contentMotion!.options.easing);
  expect(content.style.width).toBe(contentWidth);
  expect(content.style.maxWidth).toBe(contentMaxWidth);
  expect(sidebar).toHaveStyle({ width: "300px", flexShrink: "0" });
});

test("ordinary route changes keep the existing sidebar still", () => {
  const { content } = renderWindow();
  const sidebar = screen.getByTestId("sidebar");
  goTo("Gallery");
  expect(animations).toHaveLength(1);
  expect(animations[0].target).toBe(content);
  expect(screen.getByTestId("sidebar")).toBe(sidebar);
});

test.each(["app", "system"])(
  "%s reduced motion presents the return layout immediately",
  (preference) => {
    if (preference === "app") document.body.classList.add("reduce-motion");
    else reducedMotion = true;

    renderWindow(Path.Settings);
    goTo("Chat");
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue(
      "Keep this draft",
    );
  },
);

test("full motion keeps the coordinated return animation when the system prefers reduced motion", () => {
  reducedMotion = true;
  document.body.dataset.motion = "full";
  const { content } = renderWindow(Path.Settings);
  goTo("Chat");

  expect(animations).toHaveLength(2);
  expect(animations.map((animation) => animation.target)).toEqual(
    expect.arrayContaining([content, screen.getByTestId("sidebar")]),
  );
  for (const animation of animations)
    expect(animation.options.duration).toBeGreaterThan(0);
});

test("mobile navigation preserves the content entrance and leaves the fixed sidebar still", () => {
  mobile = true;
  const { content } = renderWindow(Path.Settings);
  goTo("Chat");
  expect(animations).toHaveLength(1);
  expect(animations[0].target).toBe(content);
  expect(screen.getByTestId("sidebar")).toBeInTheDocument();
});

test("a lazy destination waits for real content before starting the coordinated entrance", async () => {
  const result = renderWindow(Path.Settings, true);
  goTo("Chat");
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  expect(animate).not.toHaveBeenCalled();

  result.update(false);
  await waitFor(() => expect(animations).toHaveLength(2));
  expect(animations.map((animation) => animation.target)).toEqual(
    expect.arrayContaining([result.content, screen.getByTestId("sidebar")]),
  );
});

test("a pending lazy entrance is abandoned on navigation and unmount", async () => {
  const disconnect = jest.spyOn(MutationObserver.prototype, "disconnect");
  const result = renderWindow(Path.Settings, true);
  goTo("Chat");
  goTo("Settings");
  result.unmount();

  await act(async () => {});
  expect(disconnect).toHaveBeenCalled();
  expect(animate).not.toHaveBeenCalled();
});

test("rapid reversal cancels the return motions and unmount cancels the new entrance", () => {
  const result = renderWindow(Path.Settings);
  goTo("Chat");
  const returnMotions = [...animations];
  expect(returnMotions).toHaveLength(2);

  goTo("Settings");
  for (const animation of returnMotions) {
    expect(animation.cancel).toHaveBeenCalledTimes(1);
  }
  const latest = animations.at(-1)!;
  expect(latest.target).toBe(result.content);
  expect(latest.cancel).not.toHaveBeenCalled();
  const animationCount = animations.length;
  act(() => returnMotions.forEach((animation) => animation.onfinish?.()));
  expect(animations).toHaveLength(animationCount);
  expect(latest.cancel).not.toHaveBeenCalled();

  result.unmount();
  expect(latest.cancel).toHaveBeenCalledTimes(1);
});

test("effect rerenders preserve the content node, controls and unfinished draft", () => {
  const result = renderWindow(Path.Settings);
  goTo("Chat");
  const draft = screen.getByRole("textbox", { name: "Draft" });
  fireEvent.change(draft, { target: { value: "An unfinished response" } });
  const animationCount = animations.length;

  result.update(false, 1);
  expect(document.getElementById(SlotID.AppBody)).toBe(result.content);
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft);
  expect(draft).toHaveValue("An unfinished response");
  expect(animations).toHaveLength(animationCount);
});
