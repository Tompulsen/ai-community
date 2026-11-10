import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";
import { IconButton } from "../app/components/button";

jest.unstable_mockModule("@/app/utils/use-anchored-panel", () => ({
  useAnchoredPanel: () => ({ visibility: "visible" }),
}));
const { WorkspaceMenu } = await import("../app/components/workspace-menu");

afterEach(cleanup);

const menuProps = () => ({
  id: "preload-menu",
  label: "Workspace",
  open: true,
  trigger: { current: document.createElement("button") },
  keyboard: { current: null },
});

test("icon buttons forward intent events without intercepting the click", () => {
  const onPointerEnter = jest.fn();
  const onPointerDown = jest.fn();
  const onFocus = jest.fn();
  const onClick = jest.fn();
  render(
    <IconButton
      aria="Settings"
      onPointerEnter={onPointerEnter}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onClick={onClick}
    />,
  );
  const button = screen.getByRole("button", { name: "Settings" });
  fireEvent.pointerEnter(button);
  fireEvent.focus(button);
  fireEvent.pointerDown(button);
  fireEvent.click(button);
  expect(onPointerEnter).toHaveBeenCalledTimes(1);
  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(onPointerDown).toHaveBeenCalledTimes(1);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("route menu intent keeps close, focus restoration and deferred selection order", async () => {
  const calls: string[] = [];
  render(
    <WorkspaceMenu
      {...menuProps()}
      onClose={(restore) => calls.push(`close:${restore}`)}
      items={[
        {
          id: "account",
          label: "Account",
          icon: null,
          onIntent: (activation) =>
            calls.push(activation ? "activate" : "intent"),
          onSelect: () => calls.push("select"),
        },
      ]}
    />,
  );
  const button = screen.getByRole("menuitem", { name: "Account" });
  fireEvent.pointerEnter(button);
  fireEvent.focus(button);
  fireEvent.pointerDown(button);
  fireEvent.click(button);
  expect(calls).toEqual([
    "intent",
    "intent",
    "activate",
    "activate",
    "close:true",
  ]);
  await act(async () => {
    await Promise.resolve();
  });
  expect(calls.at(-1)).toBe("select");
});

test("shortcut menu sends activation for keyboard clicks and preserves mouse focus", () => {
  const calls: string[] = [];
  render(
    <WorkspaceMenu
      {...menuProps()}
      items={[]}
      shortcuts={[
        { id: "settings", label: "Settings", keys: ["Ctrl", ","], group: "app" },
      ]}
      onClose={(restore) => calls.push(`close:${restore}`)}
      onEdit={(action) => calls.push(`edit:${action}`)}
      onEditIntent={(action, activation) =>
        calls.push(`${action}:${activation ? "activate" : "intent"}`)
      }
    />,
  );
  const button = screen.getByRole("menuitem", { name: /Settings/ });
  fireEvent.focus(button);
  const mouseDown = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  fireEvent(button, mouseDown);
  expect(mouseDown.defaultPrevented).toBe(true);
  fireEvent.click(button);
  expect(calls).toEqual([
    "settings:intent",
    "settings:activate",
    "close:false",
    "edit:settings",
  ]);
});
