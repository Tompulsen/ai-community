import React from "react";
import { jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import {
  WorkspaceHistory,
  useWorkspaceBack,
} from "../app/components/workspace-history";

function Screen() {
  const location = useLocation();
  const navigate = useNavigate();
  const back = useWorkspaceBack();
  return (
    <>
      <output>{location.pathname + location.search + location.hash}</output>
      <span data-testid="state">{JSON.stringify(location.state)}</span>
      <button onClick={back}>back</button>
      <button
        onClick={() =>
          navigate("/gallery", { state: { reuseGalleryWork: true } })
        }
      >
        gallery
      </button>
      <button onClick={() => navigate("/pricing?model=one#details")}>
        pricing
      </button>
      <button onClick={() => navigate("/settings")}>settings</button>
      <button onClick={() => navigate("/pricing?model=two", { replace: true })}>
        replace
      </button>
      <button onClick={() => navigate(-1)}>browser back</button>
      <button onClick={() => navigate(1)}>browser forward</button>
    </>
  );
}

function setup(initialEntries = ["/chat"]) {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <WorkspaceHistory>
        <Screen />
      </WorkspaceHistory>
    </MemoryRouter>,
  );
}
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const route = () => screen.getByRole("status").textContent;

test("returns through visited workspace routes without consuming browser history or replaying state", () => {
  const browserBack = jest.spyOn(window.history, "back");
  const browserGo = jest.spyOn(window.history, "go");
  setup();
  click("gallery");
  click("pricing");
  click("settings");
  click("back");
  expect(route()).toBe("/pricing?model=one#details");
  click("back");
  expect(route()).toBe("/gallery");
  expect(screen.getByTestId("state").textContent).toBe("null");
  click("back");
  expect(route()).toBe("/chat");
  expect(browserBack).not.toHaveBeenCalled();
  expect(browserGo).not.toHaveBeenCalled();
  browserBack.mockRestore();
  browserGo.mockRestore();
});

test("direct entry and unknown browser history fall back to chat", () => {
  setup(["/unknown", "/gallery"]);
  click("browser back");
  expect(route()).toBe("/unknown");
  click("back");
  expect(route()).toBe("/chat");
  click("back");
  expect(route()).toBe("/chat");
});

test("replacement and native POP do not create return loops", () => {
  setup();
  click("gallery");
  click("pricing");
  click("replace");
  click("browser back");
  expect(route()).toBe("/gallery");
  click("settings");
  click("back");
  expect(route()).toBe("/gallery");
  click("back");
  expect(route()).toBe("/chat");
});

test("a newly opened subpage has a working return", () => {
  setup(["/pricing"]);
  click("back");
  expect(route()).toBe("/chat");
});

test("browser forward restores the visited workspace return path", () => {
  setup();
  click("gallery");
  click("pricing");
  click("browser back");
  expect(route()).toBe("/gallery");
  click("browser forward");
  expect(route()).toBe("/pricing?model=one#details");
  click("back");
  expect(route()).toBe("/gallery");
  expect(screen.getByTestId("state").textContent).toBe("null");
  click("back");
  expect(route()).toBe("/chat");
});
