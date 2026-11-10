import { jest } from "@jest/globals";
let tasks: any[] = [];
let streaming = false;
let video = false;
jest.unstable_mockModule("@/app/client/controller", () => ({
  ChatControllerPool: { hasPending: () => streaming },
}));
jest.unstable_mockModule("@/app/store/video", () => ({
  useVideoStore: { getState: () => ({ isGenerating: video }) },
}));
jest.unstable_mockModule("@/app/utils/local-tasks", () => ({
  pendingTasks: () => tasks,
}));
jest.unstable_mockModule("@/app/utils/local-workspace", () => ({
  getLocalTokenId: () => 100,
}));
const { hasPendingAccountTasks, hasPendingGeneration } = await import(
  "../app/utils/account-model-source"
);
beforeEach(() => {
  tasks = [];
  streaming = video = false;
});

test("both model picker and account page share live generation protection", () => {
  expect(hasPendingGeneration()).toBe(false);
  streaming = true;
  expect(hasPendingGeneration()).toBe(true);
  streaming = false;
  video = true;
  expect(hasPendingGeneration()).toBe(true);
});

test("running tasks block their own key, while retained failed records do not lock switching forever", () => {
  const task = { tokenId: 100, kind: "image", createdAt: Date.now() };
  tasks = [task];
  expect(hasPendingAccountTasks()).toBe(true);
  for (const patch of [
    { tokenId: 200 },
    { customApiBase: "https://example.test/v1" },
    { needsAttention: true },
    { createdAt: Date.now() - 31 * 60_000 },
  ]) {
    tasks = [{ ...task, ...patch }];
    expect(hasPendingAccountTasks()).toBe(false);
  }
});
