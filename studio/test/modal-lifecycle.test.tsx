import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";

for (const icon of [
  "three-dots",
  "close",
  "eye",
  "eye-off",
  "down",
  "confirm",
  "cancel",
  "max",
  "min",
]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg />,
  }));
}
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    UI: { Confirm: "Confirm", Cancel: "Cancel", Close: "Close" },
    Chat: {
      Actions: {
        FullScreen: "Full Screen",
        ExitFullScreen: "Exit Full Screen",
      },
    },
    Export: { Image: { Modal: "Image" } },
  },
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => null,
}));
const {
  Modal,
  showModal,
  showConfirm,
  showPrompt,
  showImageModal,
  useModalClose,
} = await import("../app/components/ui-lib");

beforeEach(() => document.body.classList.add("reduce-motion"));
afterEach(() => {
  document.body.classList.remove("reduce-motion");
  jest.restoreAllMocks();
});

function mockVisibleLayout() {
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 40, height: 40 }] as unknown as DOMRectList);
}

test("a modal receives initial focus and restores its trigger after closing", async () => {
  render(<button>Open preview</button>);
  const trigger = screen.getByRole("button", { name: "Open preview" });
  trigger.focus();
  const view = render(<Modal title="Preview">Details</Modal>);

  expect(screen.getByRole("dialog", { name: "Preview" })).toHaveFocus();
  view.unmount();

  await waitFor(() => expect(trigger).toHaveFocus());
});

test.each(["confirmation", "prompt"])(
  "%s preserves autofocus and restores the original trigger",
  async (kind) => {
    render(<button>Open dialog</button>);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    act(() => {
      if (kind === "confirmation") void showConfirm("Proceed?");
      else void showPrompt("Edit", "original");
    });

    expect(
      kind === "confirmation"
        ? screen.getByRole("button", { name: "Confirm" })
        : screen.getByRole("textbox", { name: "Edit" }),
    ).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(trigger).toHaveFocus());
  },
);

test("a formatted prompt title is not stringified into the input label", () => {
  act(() => {
    void showPrompt(<strong>Formatted title</strong>, "original");
  });
  expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-label");
  fireEvent.keyDown(window, { key: "Escape" });
});

test("Tab cycles through available controls and returns outside focus to the modal", () => {
  mockVisibleLayout();
  render(
    <>
      <button>Outside</button>
      <Modal
        title="Edit"
        actions={[
          <button key="save">Save</button>,
          <button key="disabled" disabled>
            Disabled
          </button>,
          <button key="hidden" hidden>
            Hidden
          </button>,
          <div key="hidden-parent" hidden>
            <button>Hidden descendant</button>
          </div>,
          <button key="invisible" style={{ visibility: "hidden" }}>
            Invisible
          </button>,
          <button key="negative" tabIndex={-1}>
            Programmatic only
          </button>,
        ]}
      >
        <input aria-label="Name" />
      </Modal>
    </>,
  );
  const first = screen.getByRole("button", { name: "Full Screen" });
  const last = screen.getByRole("button", { name: "Save" });
  const outside = screen.getByRole("button", { name: "Outside" });

  last.focus();
  expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
  expect(first).toHaveFocus();
  expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
  expect(last).toHaveFocus();

  outside.focus();
  fireEvent.keyDown(outside, { key: "Tab" });
  expect(first).toHaveFocus();
  outside.focus();
  fireEvent.keyDown(outside, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();

  const input = screen.getByRole("textbox", { name: "Name" });
  input.focus();
  expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
});

test("only the top modal traps Tab and restores focus to its lower-modal trigger", async () => {
  mockVisibleLayout();
  function StackedModals() {
    const [showTop, setShowTop] = React.useState(false);
    return (
      <>
        <Modal title="Lower">
          <button onClick={() => setShowTop(true)}>Open top</button>
        </Modal>
        {showTop && (
          <Modal
            title="Top"
            onClose={() => setShowTop(false)}
            actions={[<button key="finish">Finish</button>]}
          />
        )}
      </>
    );
  }
  render(<StackedModals />);
  const trigger = screen.getByRole("button", { name: "Open top" });
  trigger.focus();
  fireEvent.click(trigger);
  const top = screen.getByRole("dialog", { name: "Top" });
  const first = within(top).getByRole("button", { name: "Full Screen" });
  const last = within(top).getByRole("button", { name: "Finish" });

  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Escape" });

  await waitFor(() => expect(trigger).toHaveFocus());
});

test("removing a lower modal does not move focus away from the top modal", async () => {
  const lower = render(<Modal title="Lower" />);
  const upper = render(
    <Modal title="Top">
      <input aria-label="Top input" autoFocus />
    </Modal>,
  );
  const input = screen.getByRole("textbox", { name: "Top input" });
  lower.unmount();

  await act(async () => {});
  expect(input).toHaveFocus();
  upper.unmount();
});

test("an open native dialog retains keyboard and focus control", async () => {
  const close = jest.fn();
  render(
    <dialog open aria-label="Native">
      <button autoFocus>Native action</button>
    </dialog>,
  );
  const action = screen.getByRole("button", { name: "Native action" });
  const custom = render(<Modal title="Custom" onClose={close} />);

  expect(action).toHaveFocus();
  expect(fireEvent.keyDown(action, { key: "Tab" })).toBe(true);
  fireEvent.keyDown(action, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  custom.unmount();
  await act(async () => {});
  expect(action).toHaveFocus();
});

test("closing does not override focus deliberately moved to another control", async () => {
  render(
    <>
      <button>Original trigger</button>
      <button>Next task</button>
    </>,
  );
  screen.getByRole("button", { name: "Original trigger" }).focus();
  const view = render(<Modal title="Preview" />);
  view.unmount();
  const next = screen.getByRole("button", { name: "Next task" });
  next.focus();

  await act(async () => {});
  expect(next).toHaveFocus();
});

test("Strict Mode replay keeps modal focus until its real unmount", async () => {
  render(<button>Open strict modal</button>);
  const trigger = screen.getByRole("button", { name: "Open strict modal" });
  trigger.focus();
  const view = render(
    <React.StrictMode>
      <Modal title="Strict" />
    </React.StrictMode>,
  );

  await act(async () => {});
  expect(screen.getByRole("dialog", { name: "Strict" })).toHaveFocus();
  view.unmount();
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("dismissing a confirmation resolves as cancelled", async () => {
  const result = jest.fn();
  act(() => {
    void showConfirm("Proceed?").then(result);
  });
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(result).toHaveBeenCalledWith(false));
});

test.each(["escape", "cancel"])(
  "prompt %s resolves without an edit",
  async (method) => {
    const result = jest.fn();
    act(() => {
      void showPrompt("Edit", "original").then(result);
    });
    if (method === "escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(result).toHaveBeenCalledWith(null));
  },
);

test("confirming an intentionally empty prompt still returns a string", async () => {
  const result = jest.fn();
  act(() => {
    void showPrompt("Edit", "").then(result);
  });
  fireEvent.click(screen.getByText("Confirm"));
  await waitFor(() => expect(result).toHaveBeenCalledWith(""));
});

test("closing an image modal releases its owned resource once", () => {
  const release = jest.fn();
  act(() => {
    showImageModal("blob:fixture", undefined, undefined, undefined, release);
  });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(release).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".modal-mask")).toBeNull();
});

test("Escape closes only the top modal", () => {
  const lowerClose = jest.fn();
  const topClose = jest.fn();
  render(
    <>
      <Modal title="Lower" onClose={lowerClose} />
      <Modal title="Top" onClose={topClose} />
    </>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(topClose).toHaveBeenCalledTimes(1);
  expect(lowerClose).not.toHaveBeenCalled();
});

test("Escape uses the latest close callback after a rerender", () => {
  const oldClose = jest.fn();
  const newClose = jest.fn();
  const view = render(<Modal title="Edit" onClose={oldClose} />);
  view.rerender(<Modal title="Edit" onClose={newClose} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(newClose).toHaveBeenCalledTimes(1);
  expect(oldClose).not.toHaveBeenCalled();
});

test("modal actions are named keyboard-accessible buttons", () => {
  const close = jest.fn();
  render(<Modal title="Preview" onClose={close} />);
  const maximize = screen.getByRole("button", { name: "Full Screen" });
  maximize.focus();
  expect(maximize).toHaveFocus();
  fireEvent.click(maximize);
  expect(
    screen.getByRole("button", { name: "Exit Full Screen" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledTimes(1);
});

test("a compact choice has no maximize control or empty footer", () => {
  const view = render(
    <Modal
      title="Appearance"
      compact
      defaultMax
      actions={[null, false, undefined]}
      footer={false}
    >
      <button>System</button>
    </Modal>,
  );
  const dialog = screen.getByRole("dialog", { name: "Appearance" });
  expect(
    within(dialog).queryByRole("button", { name: "Full Screen" }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "Exit Full Screen" }),
  ).not.toBeInTheDocument();
  expect(dialog.children).toHaveLength(2);

  view.rerender(
    <Modal
      title="Appearance"
      compact
      footer={<span>Current appearance</span>}
      actions={[<button key="save">Apply</button>]}
    />,
  );
  expect(dialog.children).toHaveLength(3);
  const footer = dialog.lastElementChild!;
  expect(footer).toHaveTextContent("Current appearance");
  expect(
    within(footer as HTMLElement).getByRole("button", { name: "Apply" }),
  ).toBeInTheDocument();
});

test("an explicitly expandable compact modal can enter and leave full screen", () => {
  render(<Modal title="Details" compact allowMaximize />);
  fireEvent.click(screen.getByRole("button", { name: "Full Screen" }));
  expect(
    screen.getByRole("button", { name: "Exit Full Screen" }),
  ).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Exit Full Screen" }));
  expect(screen.getByRole("button", { name: "Full Screen" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("closing a modal twice releases resources only once", () => {
  const release = jest.fn();
  act(() => {
    showModal({ title: "Preview", onClose: release });
  });
  const mask = document.querySelector<HTMLElement>(".modal-mask")!;
  act(() => {
    mask.click();
    mask.click();
  });
  expect(release).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".modal-mask")).toBeNull();
});

test("a failing close callback still removes the modal and runs only once", () => {
  const failure = new Error("Resource cleanup failed");
  const release = jest.fn(() => {
    throw failure;
  });
  act(() => {
    showModal({ title: "Preview", onClose: release });
  });
  const mask = document.querySelector<HTMLElement>(".modal-mask")!;
  const event = new MouseEvent("click");
  Object.defineProperty(event, "target", { value: mask });
  expect(() =>
    act(() => {
      mask.onclick?.call(mask, event);
    }),
  ).toThrow(failure);
  expect(document.querySelector(".modal-mask")).toBeNull();
  act(() => mask.click());
  expect(release).toHaveBeenCalledTimes(1);
});

describe("animated modal exits", () => {
  const mediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

  beforeEach(() => {
    document.body.classList.remove("reduce-motion");
    jest.useFakeTimers();
  });
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
    if (mediaDescriptor) {
      Object.defineProperty(window, "matchMedia", mediaDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  test("keeps focus constrained until the mask finishes, then releases once", () => {
    mockVisibleLayout();
    const release = jest.fn();
    render(<button>Open preview</button>);
    const trigger = screen.getByRole("button", { name: "Open preview" });
    trigger.focus();
    act(() => {
      showModal({ title: "Preview", onClose: release });
    });
    const mask = document.querySelector<HTMLElement>(".modal-mask")!;
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    mask.click();
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(mask).toHaveClass("modal-closing");
    expect(release).not.toHaveBeenCalled();
    const last = within(dialog).getByRole("button", { name: "Close" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(
      within(dialog).getByRole("button", { name: "Full Screen" }),
    ).toHaveFocus();

    fireEvent.animationEnd(dialog);
    expect(release).not.toHaveBeenCalled();
    fireEvent.animationEnd(mask);
    act(() => jest.runAllTicks());
    expect(release).toHaveBeenCalledTimes(1);
    expect(mask).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    act(() => jest.advanceTimersByTime(180));
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("a missing animation event falls back after a short delay", () => {
    const release = jest.fn();
    act(() => {
      showImageModal("blob:fixture", undefined, undefined, undefined, release);
    });
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => jest.advanceTimersByTime(179));
    expect(release).not.toHaveBeenCalled();
    expect(document.querySelector(".modal-mask")).toHaveClass("modal-closing");
    act(() => jest.advanceTimersByTime(1));
    expect(release).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".modal-mask")).toBeNull();
  });

  test.each(["Confirm", "Cancel"])(
    "a confirmation keeps its first %s choice while exiting",
    async (choice) => {
      let result!: Promise<boolean>;
      act(() => {
        result = showConfirm("Proceed?");
      });
      fireEvent.click(screen.getByRole("button", { name: choice }));
      fireEvent.click(
        screen.getByRole("button", {
          name: choice === "Confirm" ? "Cancel" : "Confirm",
        }),
      );
      fireEvent.keyDown(window, { key: "Escape" });
      act(() => jest.advanceTimersByTime(180));
      await expect(result).resolves.toBe(choice === "Confirm");
      expect(document.querySelector(".modal-mask")).toBeNull();
    },
  );

  test.each(["Confirm", "Cancel"])(
    "a prompt freezes its first %s choice and confirmed input",
    async (choice) => {
      let result!: Promise<string | null>;
      act(() => {
        result = showPrompt("Edit", "original");
      });
      const input = screen.getByRole("textbox");
      fireEvent.input(input, { target: { value: "chosen value" } });
      fireEvent.click(screen.getByRole("button", { name: choice }));
      fireEvent.input(input, { target: { value: "late edit" } });
      fireEvent.click(
        screen.getByRole("button", {
          name: choice === "Confirm" ? "Cancel" : "Confirm",
        }),
      );
      fireEvent.animationEnd(document.querySelector(".modal-mask")!);
      await expect(result).resolves.toBe(
        choice === "Confirm" ? "chosen value" : null,
      );
    },
  );

  test.each(["confirmation", "prompt"])(
    "%s keeps its original non-dismissable backdrop",
    async (kind) => {
      let result!: Promise<boolean | string | null>;
      act(() => {
        result =
          kind === "confirmation"
            ? showConfirm("Proceed?")
            : showPrompt("Edit", "original");
      });
      const mask = document.querySelector<HTMLElement>(".modal-mask")!;
      act(() => mask.click());
      expect(mask).not.toHaveClass("modal-closing");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      fireEvent.animationEnd(mask);
      await expect(result).resolves.toBe(
        kind === "confirmation" ? true : "original",
      );
    },
  );

  test("the system reduced-motion preference skips the exit wait", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      }),
    });
    const release = jest.fn();
    act(() => {
      showModal({ title: "Preview", onClose: release });
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(release).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".modal-mask")).toBeNull();
    act(() => jest.runAllTicks());
    expect(jest.getTimerCount()).toBe(0);
  });

  test("unmounting a closing hook cancels its completion and fallback", () => {
    const close = jest.fn();
    function HookModal() {
      const { maskRef, requestClose } = useModalClose(close);
      return (
        <div ref={maskRef} className="modal-mask">
          <Modal title="Hook" onClose={() => requestClose()} />
        </div>
      );
    }
    const view = render(<HookModal />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".modal-mask")).toHaveClass("modal-closing");
    view.unmount();
    act(() => jest.advanceTimersByTime(180));
    expect(close).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
