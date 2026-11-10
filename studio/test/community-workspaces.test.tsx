import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";

const navigate = jest.fn();
const startCommunityChat = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const showToast = jest.fn();
let owner = "user-1";
const models = [{ name: "custom-text", available: true }];
jest.unstable_mockModule("react-router-dom", () => ({ useNavigate: () => navigate, useLocation: () => ({ pathname: "/chat" }) }));
jest.unstable_mockModule("@/app/store", () => ({ useAppConfig: { getState: () => ({ models }) }, useChatStore: (select: (state: unknown) => unknown) => select({ sessions: [{ communityWorkspaceKind: "image" }], currentSessionIndex: 0 }) }));
jest.unstable_mockModule("@/app/locales", () => ({ getLang: () => "cn" }));
jest.unstable_mockModule("@/app/utils/community-entry", () => ({ startCommunityChat }));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({ getLocalScope: () => owner, isLocalWorkspaceActive: () => true }));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({ showToast }));
const { CommunityWorkspaces } = await import("../app/components/community-workspaces");
const entry = { id: "one-verified-frame", kind: "text" as const, model: "custom-text", defaultModels: { text: "custom-text", image: "custom-image", video: "custom-video" } };
beforeEach(() => { jest.clearAllMocks(); owner = "user-1"; startCommunityChat.mockResolvedValue({}); });

test.each([['文本', 'text'], ['图片', 'image'], ['视频', 'video']])('opens %s in the existing workspace with its configured default', async (label, kind) => {
  render(<CommunityWorkspaces entry={entry}/>);
  expect(screen.getByRole('button', { name: '图片' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/chat'));
  expect(startCommunityChat).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, kind, model: 'custom-' + kind }), models);
});

test('rapid cross-type clicks cannot overlap session restoration; errors allow retry', async () => {
  let reject!: (error: Error) => void;
  startCommunityChat.mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
  render(<CommunityWorkspaces entry={entry}/>);
  fireEvent.click(screen.getByRole('button', { name: '视频' }));
  fireEvent.click(screen.getByRole('button', { name: '图片' }));
  expect(startCommunityChat).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '文本' }).hasAttribute('disabled')).toBe(true);
  await act(async () => { reject(Error('unavailable')); });
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '图片' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
});

test('account changes during restoration do not navigate into the old account', async () => {
  let finish!: () => void;
  startCommunityChat.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  render(<CommunityWorkspaces entry={entry} narrow/>);
  fireEvent.click(screen.getByRole('button', { name: '文本' }));
  owner = 'user-2';
  await act(async () => { finish(); });
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '视频' }));
  expect(startCommunityChat).toHaveBeenCalledTimes(1);
});
