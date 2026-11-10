import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";

const copy = jest.fn<() => Promise<void>>();
const modal = jest.fn();
const toast = jest.fn();
const readImage =
  jest.fn<(url: string, signal?: AbortSignal) => Promise<string>>();
let immediate = false;
let connectError: Error | undefined;
let sharers: MockSharer[] = [];
class MockSharer {
  private connected?: () => void;
  constructor(_room: string) {
    sharers.push(this);
  }
  connect = jest.fn(async () => {
    if (connectError) throw connectError;
    if (immediate) return;
    await new Promise<void>((resolve) => {
      this.connected = resolve;
    });
  });
  sendPayload = jest.fn(async () => {});
  cancel = jest.fn(() => this.connected?.());
}

jest.unstable_mockModule("@/app/store", () => ({
  useAppConfig: () => ({}),
  useChatStore: () => ({}),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Export: { Copy: "Copy", Download: "Download" } },
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  List: () => null,
  ListItem: () => null,
  Modal: () => null,
  Select: () => null,
  showImageModal: () => {},
  showModal: modal,
  showToast: toast,
  useModalClose: (onClose: () => void) => ({
    maskRef: { current: null },
    requestClose: (onConfirm?: () => void) => {
      onConfirm?.();
      onClose();
    },
    onBackdropClick: (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
  }),
}));
jest.unstable_mockModule("@/app/utils", () => ({
  copyToClipboard: copy,
  downloadAs: () => {},
  getMessageImages: (message: { images?: string[] }) => message.images || [],
  getMessageTextContent: (message: { content: string }) => message.content,
  useMobileScreen: () => false,
}));
jest.unstable_mockModule("@/app/components/form-controls", () => ({
  Checkbox: () => null,
}));
jest.unstable_mockModule("@/app/components/message-selector", () => ({
  MessageSelector: () => null,
  useMessageSelector: () => ({}),
}));
jest.unstable_mockModule("@/app/components/emoji", () => ({
  Avatar: () => null,
}));
jest.unstable_mockModule("@/app/components/mask-avatar", () => ({
  MaskAvatar: () => null,
}));
jest.unstable_mockModule("@/app/client/api", () => ({
  getClientApi: () => ({}),
}));
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({}),
}));
jest.unstable_mockModule("html-to-image", () => ({
  toBlob: jest.fn(),
  toPng: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/webrtc-share", () => ({
  WebRTCSharer: MockSharer,
  generateRoomCode: () => "ROOMAA",
  buildShareLink: () => "https://fixture/#/share?p=ROOMAA",
  fetchImageAsBase64: readImage,
}));
for (const name of ["copy", "three-dots", "share", "download"])
  jest.unstable_mockModule(`@/app/icons/${name}.svg`, () => ({
    default: () => <svg aria-hidden="true" />,
  }));
const { PreviewActions } = await import("../app/components/exporter");
const messages = [
  { id: "one", role: "user", content: "Hello", date: "" },
] as any;
const view = (items = messages) =>
  render(
    <PreviewActions
      messages={items}
      topic="Example"
      copy={() => {}}
      download={() => {}}
    />,
  );

beforeEach(() => {
  immediate = false;
  connectError = undefined;
  sharers = [];
  copy.mockReset().mockResolvedValue(undefined);
  readImage.mockReset().mockResolvedValue("data:image/png;base64,AAAA");
  modal.mockClear();
  toast.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("synchronous double clicks share one operation and show the busy button", async () => {
  const rendered = view();
  const button = rendered.getByRole("button", { name: "临时链接" });
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(sharers).toHaveLength(1);
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  await waitFor(() => expect(sharers[0].connect).toHaveBeenCalledTimes(1));
  expect(copy).toHaveBeenCalledTimes(1);
});

test("retrying a completed share releases its previous connection", async () => {
  immediate = true;
  const add = jest.spyOn(window, "addEventListener");
  const remove = jest.spyOn(window, "removeEventListener");
  const rendered = view();
  const button = rendered.getByRole("button", { name: "临时链接" });
  fireEvent.click(button);
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(sharers).toHaveLength(2));
  expect(sharers[0].cancel).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(button).not.toBeDisabled());
  const handlers = add.mock.calls.filter(([type]) => type === "beforeunload");
  expect(handlers).toHaveLength(1);
  rendered.unmount();
  expect(sharers[1].cancel).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith("beforeunload", handlers[0][1]);
});

test("beforeunload cancels a pending connection without a failure toast", async () => {
  const rendered = view();
  const button = rendered.getByRole("button", { name: "临时链接" });
  fireEvent.click(button);
  await waitFor(() => expect(sharers[0].connect).toHaveBeenCalled());
  fireEvent(window, new Event("beforeunload"));
  await waitFor(() => expect(button).not.toBeDisabled());
  expect(sharers[0].cancel).toHaveBeenCalledTimes(1);
  expect(sharers[0].sendPayload).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});

test("unmount aborts image preparation and never creates a share afterwards", async () => {
  let signal: AbortSignal | undefined;
  readImage.mockImplementation(
    async (_url, currentSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal = currentSignal;
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      }),
  );
  const rendered = view([
    { ...messages[0], images: ["https://fixture/image.png"] },
  ]);
  fireEvent.click(rendered.getByRole("button", { name: "临时链接" }));
  await waitFor(() => expect(readImage).toHaveBeenCalledTimes(1));
  rendered.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(signal?.aborted).toBe(true);
  expect(sharers).toHaveLength(0);
  expect(modal).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});

test("a real connection failure releases the operation so the user can retry", async () => {
  connectError = new Error("Connection failed");
  const rendered = view();
  const button = rendered.getByRole("button", { name: "临时链接" });
  fireEvent.click(button);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  expect(sharers[0].cancel).toHaveBeenCalledTimes(1);
  expect(button).not.toBeDisabled();
  connectError = undefined;
  immediate = true;
  fireEvent.click(button);
  await waitFor(() => expect(sharers).toHaveLength(2));
  await waitFor(() => expect(sharers[1].sendPayload).toHaveBeenCalled());
});
