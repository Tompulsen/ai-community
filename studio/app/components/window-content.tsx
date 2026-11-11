import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import clsx from "clsx";

import { Path, SlotID } from "../constant";
import { prefersReducedMotion } from "../utils/motion";
import styles from "./home.module.scss";

export function WindowContent(props: { children: React.ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const screen = pathname === Path.Home ? Path.Chat : pathname;
  const previousScreen = useRef(screen);

  useLayoutEffect(() => {
    if (previousScreen.current === screen) return;
    const returningFromSettings = previousScreen.current === Path.Settings;
    previousScreen.current = screen;
    const element = content.current;
    if (!element?.animate || prefersReducedMotion()) {
      return;
    }

    const sidebar =
      returningFromSettings && !window.matchMedia("(max-width: 600px)").matches
        ? element.parentElement?.querySelector<HTMLElement>(
            `:scope > .${styles.sidebar}`,
          )
        : null;
    const animations: Animation[] = [];
    const timing = {
      duration: 280,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    };
    const enter = () => {
      if (
        element.querySelector(':scope > [role="status"][aria-label="Loading"]')
      ) {
        return;
      }
      observer.disconnect();
      // Both panes enter at their final widths, so text never gets squeezed.
      if (sidebar?.animate) {
        animations.push(
          sidebar.animate(
            [
              { opacity: 0, transform: "translateX(-20px)" },
              { opacity: 1, transform: "translateX(0)" },
            ],
            timing,
          ),
        );
      }
      animations.push(
        element.animate(
          [
            {
              opacity: sidebar ? 0 : 0.65,
              transform: `translateX(${screen === Path.Chat ? -12 : 16}px)`,
            },
            { opacity: 1, transform: "translateX(0)" },
          ],
          timing,
        ),
      );
    };
    const observer = new MutationObserver(enter);
    observer.observe(element, { childList: true });
    enter();
    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
  }, [screen]);

  return (
    <div
      ref={content}
      className={clsx(styles["window-content"], {
        [styles["settings-window-content"]]: screen === Path.Settings,
      })}
      id={SlotID.AppBody}
    >
      {props.children}
    </div>
  );
}
