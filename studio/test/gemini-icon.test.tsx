import React from "react";
import { render } from "@testing-library/react";
import { GeminiIcon } from "../app/components/gemini-icon";

test("each Gemini icon references its own gradient across hidden and replaced groups", () => {
  const view = render(
    <>
      <div hidden>
        <GeminiIcon />
      </div>
      <GeminiIcon key="first" />
      <GeminiIcon key="second" />
    </>,
  );
  const check = () => {
    const icons = [...view.container.querySelectorAll("svg")];
    const ids = icons.map((icon) => icon.querySelector("linearGradient")!.id);
    expect(new Set(ids).size).toBe(icons.length);
    icons.forEach((icon, i) =>
      expect(icon.querySelector("path")!.getAttribute("fill")).toBe(
        `url(#${ids[i]})`,
      ),
    );
  };
  check();
  view.rerender(
    <>
      <GeminiIcon key="third" />
      <GeminiIcon key="fourth" />
    </>,
  );
  check();
});
