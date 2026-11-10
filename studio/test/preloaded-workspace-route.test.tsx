import React, { Suspense, lazy, useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { Path } from "../app/constant";
import type { ComponentType } from "react";

const preloaded = new Map<Path, ComponentType>();
const getPreloadedWorkspaceRoute = jest.fn((path: Path) => preloaded.get(path));
jest.unstable_mockModule("@/app/utils/preload-workspace-routes", () => ({
  getPreloadedWorkspaceRoute,
}));
const { PreloadedWorkspaceRoute } = await import(
  "../app/components/preloaded-workspace-route"
);

beforeEach(() => {
  preloaded.clear();
  getPreloadedWorkspaceRoute.mockClear();
});
afterEach(cleanup);

test("an already preloaded page bypasses the dynamic fallback and mounts once", () => {
  const mount = jest.fn();
  const unmount = jest.fn<() => void>();
  function ReadyAccount() {
    useEffect(() => {
      mount();
      return unmount;
    }, []);
    return <p>Ready account</p>;
  }
  const fallback = jest.fn(() => <p>Dynamic fallback</p>);
  preloaded.set(Path.Account, ReadyAccount);
  const view = render(
    <PreloadedWorkspaceRoute path={Path.Account} fallback={fallback} />,
  );
  expect(screen.getByText("Ready account")).toBeInTheDocument();
  expect(fallback).not.toHaveBeenCalled();
  expect(mount).toHaveBeenCalledTimes(1);
  view.rerender(
    <PreloadedWorkspaceRoute path={Path.Account} fallback={fallback} />,
  );
  expect(getPreloadedWorkspaceRoute).toHaveBeenCalledTimes(1);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
  view.unmount();
  expect(unmount).toHaveBeenCalledTimes(1);
});

test("a pending first visit keeps its fallback after prewarming and parent rerenders", async () => {
  const accountReads = jest.fn();
  const unmount = jest.fn<() => void>();
  function Account() {
    useEffect(() => {
      accountReads();
      return unmount;
    }, []);
    return <p>Current account</p>;
  }
  let finish!: (module: { default: ComponentType }) => void;
  const foreground = new Promise<{ default: ComponentType }>(
    (resolve) => (finish = resolve),
  );
  const LazyAccount = lazy(() => foreground);
  const fallback = jest.fn(() => (
    <Suspense fallback={<p>Pending account</p>}>
      <LazyAccount />
    </Suspense>
  ));
  const view = render(
    <PreloadedWorkspaceRoute path={Path.Account} fallback={fallback} />,
  );
  expect(screen.getByText("Pending account")).toBeInTheDocument();
  preloaded.set(Path.Account, Account);
  await act(async () => {
    finish({ default: Account });
    await foreground;
  });
  view.rerender(
    <PreloadedWorkspaceRoute path={Path.Account} fallback={fallback} />,
  );
  expect(screen.getByText("Current account")).toBeInTheDocument();
  expect(fallback).toHaveBeenCalledTimes(2);
  expect(getPreloadedWorkspaceRoute).toHaveBeenCalledTimes(1);
  expect(accountReads).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
});

test("route keys select the correct page for each new visit", () => {
  const settingsMount = jest.fn();
  const accountMount = jest.fn();
  const settingsUnmount = jest.fn<() => void>();
  const accountUnmount = jest.fn<() => void>();
  function Settings() {
    useEffect(() => {
      settingsMount();
      return settingsUnmount;
    }, []);
    return <p>Settings body</p>;
  }
  function Account() {
    useEffect(() => {
      accountMount();
      return accountUnmount;
    }, []);
    return <p>Account body</p>;
  }
  const fallback = jest.fn(() => <p>Unexpected fallback</p>);
  preloaded.set(Path.Settings, Settings);
  preloaded.set(Path.Account, Account);
  function Navigation() {
    const navigate = useNavigate();
    return (
      <>
        <button onClick={() => navigate(Path.Settings)}>Settings</button>
        <button onClick={() => navigate(Path.Account)}>Account</button>
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={[Path.Settings]}>
      <Navigation />
      <Routes>
        <Route
          path={Path.Settings}
          element={
            <PreloadedWorkspaceRoute
              key={Path.Settings}
              path={Path.Settings}
              fallback={fallback}
            />
          }
        />
        <Route
          path={Path.Account}
          element={
            <PreloadedWorkspaceRoute
              key={Path.Account}
              path={Path.Account}
              fallback={fallback}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText("Settings body")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
  expect(screen.getByText("Account body")).toBeInTheDocument();
  expect(screen.queryByText("Settings body")).toBeNull();
  expect(settingsUnmount).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByText("Settings body")).toBeInTheDocument();
  expect(accountUnmount).toHaveBeenCalledTimes(1);
  expect(settingsMount).toHaveBeenCalledTimes(2);
  expect(accountMount).toHaveBeenCalledTimes(1);
  expect(fallback).not.toHaveBeenCalled();
  expect(getPreloadedWorkspaceRoute.mock.calls).toEqual([
    [Path.Settings], [Path.Account], [Path.Settings],
  ]);
});
