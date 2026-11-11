import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronUp,
  Maximize2,
} from "lucide-react";
import clsx from "clsx";
import Locale from "../locales";
import { IconButton } from "./button";
import { Input, Modal } from "./ui-lib";
import styles from "./prompt-content.module.scss";

export function PromptPreview(props: {
  title: string;
  content: string;
  onClose: () => void;
  onChange?: (value: string) => void;
  onInsert?: () => void;
}) {
  const previousFocus = useRef(document.activeElement as HTMLElement);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousElement = previousFocus.current;
    overlayRef.current?.querySelector("textarea")?.focus();
    return () => previousElement?.focus();
  }, []);

  return createPortal(
    <div
      ref={overlayRef}
      className={clsx("modal-mask", styles.overlay)}
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        } else if (event.key === "Tab") {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <Modal
        title={props.title}
        onClose={props.onClose}
        actions={
          props.onInsert
            ? [
                <IconButton
                  key="insert"
                  icon={<ArrowDownToLine size={16} />}
                  text={Locale.Context.Insert}
                  bordered
                  onClick={props.onInsert}
                />,
              ]
            : undefined
        }
      >
        <Input
          autoFocus
          aria-label={props.title}
          className={styles.editor}
          value={props.content}
          readOnly={!props.onChange}
          onChange={(event) => props.onChange?.(event.currentTarget.value)}
        />
      </Modal>
    </div>,
    document.body,
  );
}

export function PromptContent(props: {
  value: string;
  label: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const bodyRef = useRef<HTMLElement | null>(null);
  const previewButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = bodyRef.current;
    if (!element || expanded) return;
    const measure = () =>
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value, expanded]);

  const bodyClass = clsx(styles.body, { [styles.expanded]: expanded });
  return (
    <div className={styles.content}>
      {props.readOnly ? (
        <div
          ref={(element) => {
            bodyRef.current = element;
          }}
          className={bodyClass}
          aria-label={props.label}
        >
          {props.value || Locale.Context.Empty}
        </div>
      ) : (
        <textarea
          ref={(element) => {
            bodyRef.current = element;
          }}
          aria-label={props.label}
          className={bodyClass}
          rows={3}
          value={props.value}
          onChange={(event) => props.onChange?.(event.currentTarget.value)}
        />
      )}
      <div className={styles.actions}>
        {(canExpand || expanded) && (
          <button
            type="button"
            className={styles.expand}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {expanded ? Locale.Context.Collapse : Locale.Context.Expand}
          </button>
        )}
        <button
          ref={previewButton}
          type="button"
          className={styles.preview}
          title={Locale.Context.OpenEditor}
          aria-label={Locale.Context.OpenEditor}
          onClick={() => setShowEditor(true)}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      </div>
      {showEditor && (
        <PromptPreview
          title={props.label}
          content={props.value}
          onChange={props.readOnly ? undefined : props.onChange}
          onClose={() => {
            setShowEditor(false);
            previewButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}
