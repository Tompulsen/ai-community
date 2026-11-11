import { cleanup, render, screen } from "@testing-library/react";
import { ImageRequestTime } from "../app/components/image-request-time";

afterEach(cleanup);

test.each([undefined, -1, NaN, Infinity])(
  "does not render an unavailable or invalid duration: %s",
  (durationMs) => {
    const { container } = render(<ImageRequestTime durationMs={durationMs} />);
    expect(container).toBeEmptyDOMElement();
  },
);

test.each([
  [0, "00:00"],
  [1850, "00:01"],
  [266000, "04:26"],
])("formats a completed request duration: %s", (durationMs, expected) => {
  render(<ImageRequestTime durationMs={Number(durationMs)} />);
  expect(screen.getByText(`请求耗时 ${expected}`)).toBeInTheDocument();
});
