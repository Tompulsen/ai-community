import React from "react";
import { render } from "@testing-library/react";
import { EmojiAvatar } from "../app/components/emoji";

test.each([
  ["1f600", "😀"],
  ["1f469-200d-1f4bb", "👩‍💻"],
  ["1f44d-1f3fd", "👍🏽"],
  ["2764-fe0f", "❤️"],
])("preserves native avatar %s and its stable dimensions", (avatar, text) => {
  const view = render(<EmojiAvatar avatar={avatar} size={30} />);
  const node = view.container.querySelector(".epr-emoji-native")!;
  expect(node.textContent).toBe(text);
  expect(node).toHaveStyle({ width: "30px", height: "30px", fontSize: "30px" });
});

test.each(["", "invalid", "110000", "d800", "1f600-"])(
  "ignores malformed avatar %s",
  (avatar) => {
    const view = render(<EmojiAvatar avatar={avatar} />);
    expect(view.container).toBeEmptyDOMElement();
  },
);
