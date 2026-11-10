import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { DragDropContext, Droppable } from "@hello-pangea/dnd";

jest.unstable_mockModule("@/app/store", () => ({
  useChatStore: jest.fn(),
}));
jest.unstable_mockModule("@/app/components/mask-avatar", () => ({
  MaskAvatar: () => null,
}));
jest.unstable_mockModule("@/app/components/ui-lib", () => ({
  showConfirm: jest.fn(),
}));
jest.unstable_mockModule("@/app/utils/use-anchored-panel", () => ({
  useAnchoredPanel: () => ({
    position: "fixed",
    left: 120,
    top: 40,
    width: 216,
    visibility: "visible",
  }),
}));
jest.unstable_mockModule("@/app/locales", () => ({
  default: {
    Chat: {
      InputActions: { More: "More", ChatSettings: "Chat settings" },
      Rename: "Rename chat",
    },
    ChatItem: {
      ChatItemCount: (count: number) => `${count} messages`,
      SelectChat: (title: string) => `Select ${title}`,
      Favorite: "Favorite",
      Unfavorite: "Unfavorite",
    },
    Home: { DeleteChat: "Delete chat" },
  },
}));
jest.unstable_mockModule("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/chat" }),
  useNavigate: () => jest.fn(),
}));

const { ChatItem } = await import("../app/components/chat-list");

beforeEach(() => {
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
});
afterEach(() => jest.restoreAllMocks());

function setup(selecting = false, projectId?: string, narrow = false) {
  const onClick = jest.fn();
  const onToggle = jest.fn();
  const onDelete = jest.fn();
  const onRename = jest.fn();
  const onSettings = jest.fn();
  const onMoveToProject = jest.fn();
  const onRemoveFromProject = jest.fn();
  const onDragStart = jest.fn();
  const { container } = render(
    <DragDropContext onDragEnd={jest.fn()} onDragStart={onDragStart}>
      <Droppable droppableId="chat-list">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ChatItem
              id="session-1"
              index={0}
              title="Keyboard chat"
              count={2}
              time={0}
              selected={false}
              selecting={selecting}
              checked={false}
              avatar="avatar"
              model="model"
              onClick={onClick}
              onToggle={onToggle}
              onDelete={onDelete}
              onRename={onRename}
              onSettings={onSettings}
              onMoveToProject={onMoveToProject}
              onRemoveFromProject={onRemoveFromProject}
              projectId={projectId}
              narrow={narrow}
            />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>,
  );
  const row = container.querySelector<HTMLElement>(
    '[data-rfd-draggable-id="session-1"]',
  )!;
  return {
    row,
    onClick,
    onToggle,
    onDelete,
    onRename,
    onSettings,
    onMoveToProject,
    onRemoveFromProject,
    onDragStart,
  };
}

test("Enter opens a focused conversation row once", () => {
  const { row, onClick, onToggle } = setup();
  row.focus();
  expect(row).toHaveFocus();
  fireEvent.keyDown(row, { key: "Enter", keyCode: 13 });
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onToggle).not.toHaveBeenCalled();
});

test("More opens conversation actions without activating or dragging the row", () => {
  const { onClick, onToggle, onDelete, onDragStart } = setup();
  const moreButton = screen.getByRole("button", {
    name: "More\uFF1AKeyboard chat",
  });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Delete chat" }),
  ).not.toBeInTheDocument();
  expect(moreButton).toHaveAttribute("aria-haspopup", "menu");
  fireEvent.keyDown(moreButton, { key: "Enter", keyCode: 13 });
  fireEvent.keyDown(moreButton, { key: " ", keyCode: 32 });
  expect(onClick).not.toHaveBeenCalled();
  expect(onToggle).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
  expect(onDragStart).not.toHaveBeenCalled();
  fireEvent.click(moreButton);
  expect(moreButton).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menu")).toHaveAttribute(
    "id",
    moreButton.getAttribute("aria-controls"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onToggle).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
});

test("menu selection and deletion execute after closing without activating the row", async () => {
  const { row, onClick, onToggle, onDelete } = setup();
  onToggle.mockImplementation(() => {
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  onDelete.mockImplementation(() => {
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  const moreButton = screen.getByRole("button", {
    name: "More\uFF1AKeyboard chat",
  });
  fireEvent.click(moreButton);
  expect(row).not.toContainElement(screen.getByRole("menu"));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Select Keyboard chat" }),
  );
  await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(1));
  expect(onToggle).toHaveBeenCalledWith("session-1");
  expect(row).toHaveFocus();
  expect(onDelete).not.toHaveBeenCalled();
  expect(moreButton).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(moreButton);
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete chat" }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  expect(onDelete).toHaveBeenCalledWith("session-1");
  expect(onClick).not.toHaveBeenCalled();
});

test("move and rename target the menu's conversation after it closes", async () => {
  const { onClick, onRename, onMoveToProject } = setup();
  for (const action of [onRename, onMoveToProject])
    action.mockImplementation(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  const more = screen.getByRole("button", {
    name: "More\uFF1AKeyboard chat",
  });
  fireEvent.click(more);
  expect(
    screen.queryByRole("menuitem", { name: "Favorite" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "移至项目" }));
  await waitFor(() =>
    expect(onMoveToProject).toHaveBeenCalledWith("session-1"),
  );
  fireEvent.click(more);
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename chat" }));
  await waitFor(() => expect(onRename).toHaveBeenCalledWith("session-1"));
  expect(onClick).not.toHaveBeenCalled();
});

test("a project conversation can be moved back to the unassigned list", async () => {
  const { onRemoveFromProject } = setup(false, "project-1");
  fireEvent.click(
    screen.getByRole("button", { name: "More\uFF1AKeyboard chat" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "移出项目" }));
  await waitFor(() =>
    expect(onRemoveFromProject).toHaveBeenCalledWith("session-1"),
  );
});

test.each([
  [undefined, false],
  ["project-1", false],
  [undefined, true],
] as const)(
  "settings targets its conversation after the menu closes (project: %s, narrow: %s)",
  async (projectId, narrow) => {
    const { onSettings, onClick } = setup(false, projectId, narrow);
    onSettings.mockImplementation(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "More\uFF1AKeyboard chat" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Chat settings" }));
    await waitFor(() => expect(onSettings).toHaveBeenCalledTimes(1));
    expect(onSettings).toHaveBeenCalledWith("session-1");
    expect(onClick).not.toHaveBeenCalled();
  },
);

test("More toggles its anchored menu and outside clicks close it", () => {
  const { onClick } = setup();
  const more = screen.getByRole("button", {
    name: "More\uFF1AKeyboard chat",
  });
  fireEvent.click(more);
  expect(screen.getByRole("menu")).toHaveStyle({ position: "fixed" });
  fireEvent.click(more);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  fireEvent.click(more);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(onClick).not.toHaveBeenCalled();
});

test("arrow keys enter the menu and Escape returns focus to the originating More button", () => {
  const { onClick, onDragStart } = setup();
  const more = screen.getByRole("button", {
    name: "More\uFF1AKeyboard chat",
  });
  more.focus();
  fireEvent.keyDown(more, { key: "ArrowDown", keyCode: 40 });
  expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape", keyCode: 27 });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(more).toHaveFocus();
  fireEvent.keyDown(more, { key: "ArrowUp", keyCode: 38 });
  expect(screen.getAllByRole("menuitem").at(-1)).toHaveFocus();
  expect(onClick).not.toHaveBeenCalled();
  expect(onDragStart).not.toHaveBeenCalled();
});

test.each([false, true])(
  "Tab closes the menu and continues native navigation (shift: %s)",
  (shiftKey) => {
    const { onClick, onDragStart } = setup();
    const more = screen.getByRole("button", {
      name: "More\uFF1AKeyboard chat",
    });
    more.focus();
    fireEvent.keyDown(more, { key: "ArrowUp", keyCode: 38 });
    const lastItem = screen.getAllByRole("menuitem").at(-1)!;
    expect(lastItem).toHaveFocus();
    expect(
      fireEvent.keyDown(lastItem, { key: "Tab", keyCode: 9, shiftKey }),
    ).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    expect(onClick).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
  },
);

test("Space keeps the existing keyboard drag behavior", async () => {
  const { row, onClick, onToggle, onDragStart } = setup();
  row.focus();
  fireEvent.keyDown(row, { key: " ", keyCode: 32 });
  await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1));
  expect(onClick).not.toHaveBeenCalled();
  expect(onToggle).not.toHaveBeenCalled();
  fireEvent.keyDown(row, { key: "Escape", keyCode: 27 });
});

test("Enter in selection mode toggles selection without opening the chat", () => {
  const { row, onClick, onToggle } = setup(true);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "More\uFF1AKeyboard chat" }),
  ).not.toBeInTheDocument();
  expect(row).toHaveAttribute("aria-pressed", "false");
  row.focus();
  expect(row).toHaveFocus();
  fireEvent.keyDown(row, { key: "Enter", keyCode: 13 });
  expect(onToggle).toHaveBeenCalledTimes(1);
  expect(onClick).not.toHaveBeenCalled();
});
