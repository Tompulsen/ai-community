import { jest } from "@jest/globals";

jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showToast: jest.fn(),
}));
jest.unstable_mockModule("@/app/store", () => ({
  useAccessStore: { getState: () => ({}) },
}));
jest.unstable_mockModule("@/app/utils/model-capabilities", () => ({
  getModelCapabilities: jest.fn(),
}));
jest.unstable_mockModule("@/app/locales", () => ({ default: {} }));

const { autoGrowTextArea } = await import("../app/utils");

describe("textarea row measurement", () => {
  let input: HTMLTextAreaElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    const stylesheet = document.createElement("style");
    stylesheet.textContent = `
      textarea {
        font-family: Arial;
        font-size: 17px;
        line-height: 25.5px;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        letter-spacing: 0.2px;
        padding: 8px;
      }
    `;
    document.body.appendChild(stylesheet);
    input = document.createElement("textarea");
    Object.defineProperty(input, "clientWidth", {
      configurable: true,
      value: 256,
    });
    document.body.appendChild(input);

    // JSDOM has no layout engine; supply line-box heights for its real styles.
    const getComputedStyle = window.getComputedStyle.bind(window);
    jest.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = getComputedStyle(element);
      if (!["__measure", "__single_measure"].includes(element.id)) return style;
      const node = element as HTMLElement;
      const text = node.textContent || node.innerText || "";
      const lines = text.split("\n");
      if (text.endsWith("\n")) lines.pop();
      const rows = Math.max(1, lines.length);
      const lineHeight =
        parseFloat(style.lineHeight) || parseFloat(style.fontSize) || 16;
      Object.defineProperty(style, "height", {
        configurable: true,
        value: `${rows * lineHeight}px`,
      });
      return style;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("uses CSS-defined font metrics for multiline input", () => {
    input.value = "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta";
    expect(autoGrowTextArea(input)).toBe(6);

    const measure = document.getElementById("__measure")!;
    const style = window.getComputedStyle(measure);
    expect(style.fontSize).toBe("17px");
    expect(style.lineHeight).toBe("25.5px");
    expect(style.fontFamily).toBe("Arial");
    expect(style.letterSpacing).toBe("0.2px");
  });

  it("fully prepares empty input without reading its computed styles twice", () => {
    expect(autoGrowTextArea(input)).toBe(1);

    const measure = document.getElementById("__measure")!;
    const singleLine = document.getElementById("__single_measure")!;
    expect(measure.textContent).toBe("\u200b");
    expect(measure.style.width).toBe("240px");
    expect(measure.style.fontFamily).toBe("Arial");
    expect(singleLine.textContent).toBe("M");
    expect(singleLine.style.lineHeight).toBe("25.5px");
    expect(
      jest
        .mocked(window.getComputedStyle)
        .mock.calls.filter(([element]) => element === input),
    ).toHaveLength(1);
  });

  it("prepares empty input from an observed width without a synchronous width read", () => {
    Object.defineProperty(input, "clientWidth", {
      get: () => {
        throw new Error("The observed width should avoid a geometry read");
      },
    });
    expect(autoGrowTextArea(input, 240)).toBe(1);
    expect(document.getElementById("__measure")!.style.width).toBe("240px");
    expect(document.getElementById("__single_measure")!.textContent).toBe("M");
    input.value = "first\nsecond\n";
    expect(autoGrowTextArea(input, 240)).toBe(3);
  });

  it("rounds an observed content width with padding like clientWidth", () => {
    input.style.padding = "8.25px";
    expect(autoGrowTextArea(input)).toBe(1);
    const expectedWidth = document.getElementById("__measure")!.style.width;

    expect(autoGrowTextArea(input, 239.25)).toBe(1);
    expect(document.getElementById("__measure")!.style.width).toBe(
      expectedWidth,
    );
    expect(expectedWidth).toBe("239.5px");
  });

  it("does not rewrite prepared nodes when text and styles are unchanged", () => {
    input.value = "first\nsecond";
    expect(autoGrowTextArea(input)).toBe(2);

    const observer = new MutationObserver(() => {});
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    try {
      expect(autoGrowTextArea(input)).toBe(2);
      expect(observer.takeRecords()).toHaveLength(0);
    } finally {
      observer.disconnect();
    }
  });

  it.each([
    ["", 1],
    ["\n", 2],
    ["\n\n", 3],
    ["hello\n", 2],
    ["hello\n\n", 3],
    ["first\n\nlast", 3],
  ])("preserves blank and trailing lines in %j", (value, rows) => {
    input.value = value;
    expect(autoGrowTextArea(input)).toBe(rows);
  });

  it("preserves CJK text, repeated spaces, and tabs with textarea wrapping", () => {
    const value = "\u4e2d\u6587  text\t\twith     spaces\n\nlast";
    input.value = value;
    expect(autoGrowTextArea(input)).toBe(3);
    const measure = document.getElementById("__measure")!;
    expect(measure.textContent).toBe(value);
    const style = window.getComputedStyle(measure);
    expect(style.whiteSpace).toBe("pre-wrap");
    expect(style.overflowWrap).toBe("break-word");
    expect(style.width).toBe("240px");
  });

  it("refreshes font metrics when the input changes size", () => {
    input.value = "first\nsecond";
    expect(autoGrowTextArea(input)).toBe(2);
    input.style.fontSize = "24px";
    input.style.lineHeight = "36px";
    input.style.fontFamily = "Georgia";
    expect(autoGrowTextArea(input)).toBe(2);
    expect(
      window.getComputedStyle(document.getElementById("__single_measure")!)
        .lineHeight,
    ).toBe("36px");
  });

  it("updates the measurement width when textarea padding changes", () => {
    input.value = "first\nsecond";
    expect(autoGrowTextArea(input)).toBe(2);
    input.style.padding = "12px";
    expect(autoGrowTextArea(input)).toBe(2);
    for (const id of ["__measure", "__single_measure"]) {
      expect(document.getElementById(id)!.style.width).toBe("232px");
    }
  });

  it("keeps an unlaid-out or hidden input at one row", () => {
    const hiddenInput = document.createElement("textarea");
    hiddenInput.value = "first\nsecond";
    expect(autoGrowTextArea(hiddenInput)).toBe(1);
  });
});
