import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";

const prepareShare = jest.fn(async () => ({}));
const shareToCommunity = jest.fn(async (provider: () => Promise<unknown>) => {
  await provider();
  return "published";
});
jest.unstable_mockModule("@/app/utils/community-share", () => ({
  prepareShare,
  shareToCommunity,
  subscribeShare: () => () => {},
  shareState: () => "ready",
}));
jest.unstable_mockModule("@/app/locales", () => ({ getLang: () => "cn" }));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
const { CommunityShareButton } = await import(
  "../app/components/community-share-button"
);

test("video offers community publication without a source-comment action", async () => {
  render(
    <CommunityShareButton
      kind="video"
      sourceWorkId="source1"
      resultId="video1"
      source={() => ({ kind: "video", prompt: "test", model: "model" })}
    />,
  );
  expect(screen.queryByTestId("send-to-source-comment")).toBeNull();
  fireEvent.click(screen.getByTestId("publish-to-community"));
  await waitFor(() =>
    expect(shareToCommunity).toHaveBeenCalledWith(expect.any(Function), {
      destination: "community",
      sourceWorkId: "source1",
      resultId: "video1",
    }),
  );
});

test.each(["image", "resource"] as const)(
  "%s retains both publication and source-comment actions",
  (kind) => {
    render(
      <CommunityShareButton
        kind={kind}
        sourceWorkId="source1"
        resultId="result1"
        source={() => ({ kind, prompt: "test", model: "model" })}
      />,
    );
    expect(screen.getByTestId("publish-to-community")).toBeTruthy();
    expect(screen.getByTestId("send-to-source-comment")).toBeTruthy();
  },
);
