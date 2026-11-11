"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { Path } from "../constant";

const WorkspaceBack = createContext<(() => void) | null>(null);

export function WorkspaceHistory({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const target = location.pathname + location.search + location.hash;
  const paths = useRef([target]);
  const entries = useRef(new Map<string, string[]>());

  useLayoutEffect(() => {
    const history = paths.current;
    if (navigationType === "POP") {
      const saved = entries.current.get(location.key);
      paths.current = saved?.at(-1) === target ? [...saved] : [target];
    } else if (history.at(-1) !== target) {
      if (navigationType === "REPLACE") {
        history[history.length - 1] = target;
      } else {
        history.push(target);
      }
    }
    entries.current.set(location.key, [...paths.current]);
  }, [target, navigationType, location.key]);

  const back = () => {
    const history = paths.current;
    if (history.length > 1) history.pop();
    const previous =
      history.length > 0 && history.at(-1) !== target
        ? history.at(-1)!
        : Path.Chat;
    // An iframe shares browser history with its parent; only navigate inside this router.
    navigate(previous, { replace: true });
  };

  return (
    <WorkspaceBack.Provider value={back}>{children}</WorkspaceBack.Provider>
  );
}

export function useWorkspaceBack() {
  const back = useContext(WorkspaceBack);
  const navigate = useNavigate();
  return back ?? (() => navigate(Path.Chat, { replace: true }));
}
