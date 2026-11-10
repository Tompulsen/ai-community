"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useVideoStore } from "../../store/video";
import { useAnchoredPanel } from "../../utils/use-anchored-panel";
import { useSubmitHandler } from "../../utils/use-submit-handler";
import {
  insertVideoMention,
  videoMentionQuery,
} from "../../utils/video-mentions";
import styles from "./video-workspace.module.scss";

export function VideoPromptInput({
  inputRef,
  onSubmit,
}: {
  inputRef: RefObject<HTMLTextAreaElement>;
  onSubmit: () => void;
}) {
  const { draft, updateDraft } = useVideoStore();
  const submit = useSubmitHandler();
  const [query, setQuery] = useState<ReturnType<typeof videoMentionQuery>>();
  const [selected, setSelected] = useState(0);
  const [composing, setComposing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const nextCursor = useRef<number>();
  const id = useId();
  const items = query
    ? draft.materials
        .map((material, index) => ({ material, index }))
        .filter(({ index }) => String(index + 1).startsWith(query.number))
    : [];
  const open = !composing && items.length > 0;
  const active = Math.min(selected, Math.max(0, items.length - 1));
  const position = useAnchoredPanel(open, inputRef, panelRef, 280, {
    placement: "above",
    maxHeight: 240,
  });
  const syncQuery = (input: HTMLTextAreaElement) => {
    const next =
      input.selectionStart === input.selectionEnd
        ? videoMentionQuery(input.value, input.selectionStart)
        : undefined;
    setQuery((current) =>
      current?.start === next?.start &&
      current?.end === next?.end &&
      current?.number === next?.number
        ? current
        : next,
    );
  };
  useEffect(() => setSelected(0), [query]);
  const select = (index: number) => {
    if (!query) return;
    const inserted = insertVideoMention(draft.prompt, query, index + 1);
    nextCursor.current = inserted.cursor;
    setQuery(undefined);
    updateDraft({ prompt: inserted.prompt });
  };
  useLayoutEffect(() => {
    if (nextCursor.current === undefined) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.setSelectionRange(nextCursor.current, nextCursor.current);
    nextCursor.current = undefined;
  }, [draft.prompt, inputRef]);
  useEffect(() => {
    if (open)
      panelRef.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <>
      <textarea
        ref={inputRef}
        className={styles["prompt-input"]}
        aria-label="视频提示词"
        placeholder="描述你想创作的视频…"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open ? `${id}-${items[active].material.id}` : undefined
        }
        value={draft.prompt}
        rows={2}
        onChange={(event) => {
          updateDraft({ prompt: event.target.value });
          syncQuery(event.currentTarget);
        }}
        onSelect={(event) => syncQuery(event.currentTarget)}
        onBlur={() => setQuery(undefined)}
        onCompositionStart={() => {
          submit.onCompositionStart();
          setComposing(true);
        }}
        onCompositionEnd={(event) => {
          submit.onCompositionEnd();
          setComposing(false);
          syncQuery(event.currentTarget);
        }}
        onKeyUp={submit.onKeyUp}
        onKeyDown={(event) => {
          if (submit.isImeKey(event)) return;
          if (open && !event.ctrlKey && !event.metaKey) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setSelected(
                (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length,
              );
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              select(items[active].index);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setQuery(undefined);
              return;
            }
          }
          if (submit.shouldSubmit(event)) {
            event.preventDefault();
            setQuery(undefined);
            onSubmit();
          }
        }}
      />
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="listbox"
            aria-label="选择参考图片"
            className={styles["mention-menu"]}
            style={position}
            onMouseDown={(event) => event.preventDefault()}
          >
            {items.map(({ material, index }, option) => (
              <button
                key={material.id}
                id={`${id}-${material.id}`}
                role="option"
                aria-selected={active === option}
                type="button"
                tabIndex={-1}
                onClick={() => select(index)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={material.url} alt="" />
                <span>
                  <strong>图片{index + 1}</strong>
                  <small>{material.name}</small>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
