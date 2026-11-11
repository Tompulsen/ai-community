import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";

function TestEditor({ onBack }: { onBack: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div>
      <input
        aria-label="画布说明"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button onClick={onBack}>返回预览</button>
    </div>
  );
}

jest.unstable_mockModule("next/dynamic", () => ({ default: () => TestEditor }));
jest.unstable_mockModule("@/app/icons/close.svg", () => ({
  default: () => <svg />,
}));
jest.unstable_mockModule("@/app/icons/download.svg", () => ({
  default: () => <svg />,
}));
jest.unstable_mockModule("@/app/icons/copy.svg", () => ({
  default: () => <svg />,
}));
jest.unstable_mockModule("@/app/components/button", () => ({
  IconButton: ({
    aria,
    onClick,
    disabled,
  }: {
    aria: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button aria-label={aria} onClick={onClick} disabled={disabled}>
      {aria}
    </button>
  ),
}));
jest.unstable_mockModule("@/app/utils/image-download", () => ({
  downloadImage: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/image-clipboard", () => ({
  copyImageToClipboard: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/image-asset", () => ({
  fetchImageBlob: jest.fn(),
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: { Download: {} },
}));
const { Lightbox } = await import("../app/components/gallery/lightbox");

it("keeps editing focus on a parent update, uses the latest close callback and restores the opener", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const previousClose = jest.fn(),
    currentClose = jest.fn();
  const props = {
    src: "blob:canvas",
    startInCanvas: true,
    onCanvasEdit: jest.fn<() => void>(),
  };
  const view = render(<Lightbox {...props} onClose={previousClose} />);
  const input = screen.getByRole("textbox", { name: "画布说明" });
  input.focus();
  fireEvent.change(input, { target: { value: "保留正在输入的说明" } });
  view.rerender(<Lightbox {...props} onClose={currentClose} />);
  expect(input).toHaveFocus();
  expect(input).toHaveValue("保留正在输入的说明");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(currentClose).toHaveBeenCalledTimes(1);
  expect(previousClose).not.toHaveBeenCalled();
  view.unmount();
  expect(opener).toHaveFocus();
  opener.remove();
});

it("preserves the editor when switching to preview and back", () => {
  render(
    <Lightbox
      src="blob:canvas"
      startInCanvas
      onCanvasEdit={jest.fn<() => void>()}
      onClose={jest.fn()}
    />,
  );
  const input = screen.getByRole("textbox", { name: "画布说明" });
  fireEvent.change(input, { target: { value: "保留选区说明" } });
  fireEvent.click(screen.getByRole("button", { name: "返回预览" }));
  expect(input).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "画布编辑" }));
  expect(screen.getByRole("textbox", { name: "画布说明" })).toBe(input);
  expect(input).toHaveValue("保留选区说明");
});
