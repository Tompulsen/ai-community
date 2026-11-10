import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { jest } from "@jest/globals";

let mobile = false;
const navigate = jest.fn();
const triggerAnnouncement = jest.fn();
const config = { tightBorder: false, update: jest.fn() };
config.update.mockImplementation((updater: unknown) => {
  (updater as (state: typeof config) => void)(config);
});

jest.unstable_mockModule("react-router-dom", () => ({
  useNavigate: () => navigate,
}));
jest.unstable_mockModule("@/app/utils", () => ({
  useMobileScreen: () => mobile,
}));
jest.unstable_mockModule("@/app/components/chat-action", () => ({
  ChatAction: ({
    text,
    icon,
    onClick,
  }: {
    text: string;
    icon: React.ReactNode;
    onClick: () => void;
  }) => (
    <button type="button" aria-label={text} onClick={onClick}>
      {icon}
      {text}
    </button>
  ),
}));
jest.unstable_mockModule("@/app/components/announcement", () => ({
  triggerAnnouncement,
}));
jest.unstable_mockModule("@/app/store/config", () => ({
  useAppConfig: () => config,
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    NewChat: { Return: "Return" },
    UI: { Close: "Close", Loading: "Loading" },
    Chat: {
      Actions: {
        Announcement: "Announcements",
        FullScreen: "Full screen",
        ExitFullScreen: "Exit full screen",
      },
    },
  },
}));

const { PageHeader, EmptyState } = await import(
  "../app/components/page-header"
);

let slot: HTMLDivElement | null = null;
beforeEach(() => {
  mobile = false;
  config.tightBorder = false;
  navigate.mockClear();
  triggerAnnouncement.mockClear();
  config.update.mockClear();
});
afterEach(() => {
  cleanup();
  slot?.remove();
  slot = null;
});

function addTopbarSlot() {
  slot = document.createElement("div");
  slot.setAttribute("data-workspace-chat-actions", "");
  document.body.append(slot);
  return slot;
}

test("desktop actions use the existing topbar slot while the title stays local", () => {
  const target = addTopbarSlot();
  const customAction = jest.fn();
  const { container, unmount } = render(
    <PageHeader
      title="Image gallery"
      actions={<button onClick={customAction}>Export images</button>}
    />,
  );
  const localHeader = container.querySelector<HTMLElement>(".window-header")!;
  expect(within(localHeader).getByText("Image gallery")).toBeInTheDocument();
  expect(
    within(localHeader).queryByRole("button", { name: "Announcements" }),
  ).not.toBeInTheDocument();
  expect(
    within(localHeader).queryByRole("button", { name: "Export images" }),
  ).not.toBeInTheDocument();
  expect(
    within(target)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Export images", "Announcements", "Full screen"]);
  fireEvent.click(
    within(target).getByRole("button", { name: "Export images" }),
  );
  fireEvent.click(
    within(target).getByRole("button", { name: "Announcements" }),
  );
  fireEvent.click(within(target).getByRole("button", { name: "Full screen" }));
  expect(customAction).toHaveBeenCalledTimes(1);
  expect(triggerAnnouncement).toHaveBeenCalledTimes(1);
  expect(config.update).toHaveBeenCalledTimes(1);
  expect(config.tightBorder).toBe(true);
  unmount();
  expect(target).toBeEmptyDOMElement();
});

test("mobile keeps its return button and custom actions local even with a topbar slot", () => {
  mobile = true;
  const target = addTopbarSlot();
  const { container } = render(
    <PageHeader
      title="Video workspace"
      backPath="/chat"
      actions={<button>Video action</button>}
    />,
  );
  const localHeader = container.querySelector<HTMLElement>(".window-header")!;
  expect(
    within(localHeader).getByRole("button", { name: "Return" }),
  ).toBeInTheDocument();
  expect(
    within(localHeader).getByRole("button", { name: "Video action" }),
  ).toBeInTheDocument();
  expect(
    within(localHeader).getByRole("button", { name: "Announcements" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  expect(target).toBeEmptyDOMElement();
  fireEvent.click(within(localHeader).getByRole("button", { name: "Return" }));
  expect(navigate).toHaveBeenCalledWith("/chat");
});

test("desktop without a topbar slot falls back to local actions", () => {
  const { container } = render(
    <PageHeader
      title="Standalone page"
      actions={<button>Page action</button>}
    />,
  );
  const localHeader = container.querySelector<HTMLElement>(".window-header")!;
  expect(within(localHeader).getByText("Standalone page")).toBeInTheDocument();
  expect(
    within(localHeader)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Page action", "Announcements", "Full screen"]);
});

test("plain empty states group a working action while the default text-only API remains valid", () => {
  const start = jest.fn();
  const { rerender } = render(
    <EmptyState
      variant="plain"
      icon={<svg aria-hidden="true" />}
      text="No images"
      action={<button onClick={start}>Start creating</button>}
    />,
  );
  expect(screen.getByText("No images")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start creating" }));
  expect(start).toHaveBeenCalledTimes(1);

  rerender(<EmptyState text="Account not configured" />);
  expect(screen.getByText("Account not configured")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
