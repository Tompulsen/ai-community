import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { createRequire } from "node:module";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const nextImage = createRequire(import.meta.url)("next/image").default;
jest.unstable_mockModule("next/image", () => ({ default: nextImage }));
for (const icon of ["share", "copy", "download", "loading", "reload"]) {
  jest.unstable_mockModule(`@/app/icons/${icon}.svg`, () => ({
    default: () => <svg />,
  }));
}
jest.unstable_mockModule("@/app/components/home", () => ({
  Loading: () => <div role="status">Loading</div>,
}));
jest.unstable_mockModule("@/app/components/button", () => ({
  IconButton: () => <button type="button" />,
}));
jest.unstable_mockModule("@/app/utils", () => ({
  copyToClipboard: jest.fn(),
  downloadAs: jest.fn(),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  Modal: () => null,
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Export: { Artifacts: { Error: "Load failed" } },
  },
}));
const { Artifacts, HTMLPreview } = await import("../app/components/artifacts");

test("preview ignores malformed and unrelated frame messages", () => {
  const { container } = render(
    <HTMLPreview code="<p>Preview</p>" autoHeight />,
  );
  const frame = container.querySelector("iframe")!;
  const id = frame.srcdoc.match(/id: '([^']+)'/)![1];
  fireEvent(
    window,
    new MessageEvent("message", {
      source: frame.contentWindow,
      data: { id, height: 120 },
    }),
  );
  expect(frame.style.height).toBe("160px");
  for (const data of [
    null,
    "invalid",
    { id, height: Infinity },
    { id, height: -1 },
  ]) {
    fireEvent(
      window,
      new MessageEvent("message", { source: frame.contentWindow, data }),
    );
    expect(frame.style.height).toBe("160px");
  }
  fireEvent(window, new MessageEvent("message", { data: { id, height: 300 } }));
  expect(frame.style.height).toBe("160px");
});

test("failed artifact loads stop showing the loading indicator", async () => {
  jest.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 404,
  } as Response);
  const { container } = render(
    <MemoryRouter initialEntries={["/artifacts/missing"]}>
      <Routes>
        <Route path="/artifacts/:id" element={<Artifacts />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await waitFor(() =>
    expect(container.querySelector('[role="status"]')).toBeNull(),
  );
  expect(container.querySelector("iframe")).toBeNull();
});
