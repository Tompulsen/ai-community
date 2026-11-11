"use client";

import React, {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import styles from "./choice-select.module.scss";

export type ChoiceSelectProps =
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    align?: "left" | "center";
    label?: string;
  };

type Choice = {
  key: string;
  value: string;
  label: string;
  disabled: boolean;
  hidden: boolean;
  selected?: boolean;
};

type ChoiceGroup = {
  key: string;
  label: string;
  choices: Choice[];
};

function textContent(node: React.ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      return isValidElement<{ children?: React.ReactNode }>(child)
        ? textContent(child.props.children)
        : "";
    })
    .join("");
}

function readChoices(children: React.ReactNode): (Choice | ChoiceGroup)[] {
  const choices: (Choice | ChoiceGroup)[] = [];
  function visit(
    nodes: React.ReactNode,
    path: string,
    disabled = false,
    hidden = false,
    group?: ChoiceGroup,
  ) {
    Children.forEach(nodes, (child, index) => {
      if (!isValidElement(child)) return;
      const key = `${path}-${child.key ?? index}`;
      if (child.type === Fragment) {
        visit(
          (child.props as { children?: React.ReactNode }).children,
          key,
          disabled,
          hidden,
          group,
        );
      } else if (child.type === "optgroup") {
        const props =
          child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>;
        const nextGroup: ChoiceGroup = {
          key,
          label: props.label ?? "",
          choices: [],
        };
        choices.push(nextGroup);
        visit(
          props.children,
          key,
          disabled || !!props.disabled,
          hidden || !!props.hidden,
          nextGroup,
        );
      } else if (child.type === "option") {
        const props =
          child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
        const text = textContent(props.children).replace(/\s+/g, " ").trim();
        const choice: Choice = {
          key,
          value: props.value === undefined ? text : String(props.value),
          label: props.label ?? text,
          disabled: disabled || !!props.disabled,
          hidden: hidden || !!props.hidden,
          selected: props.selected,
        };
        (group?.choices ?? choices).push(choice);
      }
    });
  }
  visit(children, "choice");
  return choices;
}

// Inline sizing keeps caller rules for visible selects from exposing the form bridge.
const hiddenStyle: React.CSSProperties = {
  position: "absolute",
  width: 1,
  minWidth: 0,
  maxWidth: 1,
  height: 1,
  minHeight: 0,
  maxHeight: 1,
  padding: 0,
  margin: -1,
  border: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  opacity: 0,
  pointerEvents: "none",
};

const SingleChoiceSelect = forwardRef<HTMLSelectElement, ChoiceSelectProps>(
  function SingleChoiceSelect(props, forwardedRef) {
    const {
      children,
      className,
      align = "center",
      label,
      id,
      style,
      autoFocus,
      tabIndex,
      onChange,
      onInvalid,
      value,
      defaultValue,
      disabled,
      required,
      ...nativeProps
    } = props;
    const generatedId = useId();
    const triggerId = id || `choice-select-${generatedId}`;
    const emptyValue = `choice-select-empty-${generatedId}`;
    const nativeRef = useRef<HTMLSelectElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const resettingRef = useRef(false);
    const valueRef = useRef(value);
    valueRef.current = value;
    const groups = readChoices(children);
    const choices = groups.flatMap((item) =>
      "choices" in item ? item.choices : item,
    );
    const initialChoice =
      choices.find((item) => item.selected) ??
      choices.find((item) => !item.disabled);
    const [selectedValue, setSelectedValue] = useState(
      String(value ?? defaultValue ?? initialChoice?.value ?? ""),
    );
    const [invalid, setInvalid] = useState(false);
    const [open, setOpen] = useState(false);
    const [pointerFocus, setPointerFocus] = useState(false);
    const [portalContainer, setPortalContainer] = useState<HTMLElement>();
    const [ownerId, setOwnerId] = useState<string>();
    const selectedChoice = choices.find((item) => item.value === selectedValue);

    const setNativeRef = useCallback(
      (element: HTMLSelectElement | null) => {
        nativeRef.current = element;
        if (typeof forwardedRef === "function") {
          forwardedRef(element);
        } else if (forwardedRef) {
          forwardedRef.current = element;
        }
      },
      [forwardedRef],
    );

    const syncNativeValue = useCallback(() => {
      const select = nativeRef.current;
      if (select) setSelectedValue(select.value);
    }, []);

    // Read after React restores controlled select values, including rejected changes.
    useLayoutEffect(syncNativeValue);

    useEffect(() => {
      const select = nativeRef.current;
      const form = select?.form;
      if (!select || !form) return;
      const handleReset = (event: Event) => {
        resettingRef.current = true;
        queueMicrotask(() => {
          resettingRef.current = false;
          if (!select.isConnected || event.defaultPrevented) return;
          if (valueRef.current !== undefined) {
            select.value = String(valueRef.current);
          }
          setInvalid(false);
          syncNativeValue();
        });
      };
      // Capture precedes Radix's form-reset listener and the browser's default reset.
      form.addEventListener("reset", handleReset, true);
      return () => form.removeEventListener("reset", handleReset, true);
    }, [nativeProps.form, syncNativeValue]);

    useEffect(() => {
      if (disabled) setOpen(false);
    }, [disabled]);

    const handleValueChange = (nextValue: string) => {
      const select = nativeRef.current;
      if (!select || disabled || resettingRef.current) return;
      const next = nextValue === emptyValue ? "" : nextValue;
      if (next === select.value) return;
      const choice = choices.find((item) => item.value === next);
      if (!choice || choice.disabled) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(select, next);
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncNativeValue();
    };

    const handleOpenChange = (nextOpen: boolean) => {
      if (nextOpen) {
        const trigger = triggerRef.current;
        setPortalContainer(
          trigger?.closest<HTMLElement>("dialog, .modal-mask") ?? undefined,
        );
        setOwnerId(
          trigger?.closest('[role="dialog"], dialog')?.id || undefined,
        );
      }
      setOpen(nextOpen);
    };

    const renderChoice = (choice: Choice) =>
      !choice.hidden && (
        <SelectPrimitive.Item
          key={choice.key}
          value={choice.value === "" ? emptyValue : choice.value}
          disabled={choice.disabled}
          textValue={choice.label}
          className={styles.item}
        >
          <SelectPrimitive.ItemText>{choice.label}</SelectPrimitive.ItemText>
          <SelectPrimitive.ItemIndicator className={styles.check}>
            <Check size={14} strokeWidth={2} aria-hidden="true" />
          </SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
      );

    return (
      <div
        className={clsx(styles.root, className)}
        data-select-root=""
        data-align={align}
        onChangeCapture={(event) => {
          if (
            event.target instanceof HTMLSelectElement &&
            event.target !== nativeRef.current
          ) {
            event.stopPropagation();
          }
        }}
      >
        <SelectPrimitive.Root
          value={selectedChoice ? selectedValue || emptyValue : ""}
          onValueChange={handleValueChange}
          open={open}
          onOpenChange={handleOpenChange}
          disabled={disabled}
          dir={nativeProps.dir === "rtl" ? "rtl" : "ltr"}
        >
          <SelectPrimitive.Trigger
            ref={triggerRef}
            id={triggerId}
            data-select-trigger=""
            data-pointer-focus={pointerFocus || undefined}
            className={styles.trigger}
            onPointerDownCapture={() => setPointerFocus(true)}
            onKeyDownCapture={() => setPointerFocus(false)}
            onBlur={() => setPointerFocus(false)}
            style={style}
            autoFocus={autoFocus}
            tabIndex={tabIndex}
            title={nativeProps.title}
            aria-label={nativeProps["aria-label"] ?? label}
            aria-labelledby={nativeProps["aria-labelledby"]}
            aria-describedby={nativeProps["aria-describedby"]}
            aria-required={required || undefined}
            aria-invalid={nativeProps["aria-invalid"] ?? (invalid || undefined)}
          >
            <SelectPrimitive.Value className={styles.value}>
              {selectedChoice?.label ?? ""}
            </SelectPrimitive.Value>
            <SelectPrimitive.Icon className={styles.chevron}>
              <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal container={portalContainer}>
            <SelectPrimitive.Content
              position="popper"
              align={align === "left" ? "start" : "center"}
              sideOffset={5}
              collisionPadding={12}
              className={styles.content}
              data-select-trigger-id={triggerId}
              data-select-owner={ownerId}
              onPointerDownCapture={() => setPointerFocus(true)}
              onPointerUpCapture={() => setPointerFocus(true)}
              onPointerDownOutside={() => setPointerFocus(true)}
              onKeyDownCapture={() => setPointerFocus(false)}
              onEscapeKeyDown={(event) => event.stopPropagation()}
            >
              <SelectPrimitive.ScrollUpButton className={styles.scroll}>
                <ChevronUp size={14} aria-hidden="true" />
              </SelectPrimitive.ScrollUpButton>
              <SelectPrimitive.Viewport className={styles.viewport}>
                {groups.map((item) =>
                  "choices" in item ? (
                    <SelectPrimitive.Group
                      key={item.key}
                      className={styles.group}
                    >
                      <SelectPrimitive.Label className={styles.label}>
                        {item.label}
                      </SelectPrimitive.Label>
                      {item.choices.map(renderChoice)}
                    </SelectPrimitive.Group>
                  ) : (
                    renderChoice(item)
                  ),
                )}
              </SelectPrimitive.Viewport>
              <SelectPrimitive.ScrollDownButton className={styles.scroll}>
                <ChevronDown size={14} aria-hidden="true" />
              </SelectPrimitive.ScrollDownButton>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
        <select
          {...nativeProps}
          id={`${triggerId}-native`}
          ref={setNativeRef}
          value={value}
          defaultValue={defaultValue}
          disabled={disabled}
          required={required}
          tabIndex={-1}
          aria-hidden="true"
          data-select-native=""
          style={hiddenStyle}
          onFocus={(event) => {
            nativeProps.onFocus?.(event);
            triggerRef.current?.focus({ preventScroll: true });
          }}
          onChange={(event) => {
            setInvalid(false);
            setSelectedValue(event.currentTarget.value);
            onChange?.(event);
          }}
          onInvalid={(event) => {
            onInvalid?.(event);
            if (!event.defaultPrevented) {
              event.preventDefault();
              setInvalid(true);
              triggerRef.current?.focus({ preventScroll: true });
            }
          }}
        >
          {children}
        </select>
      </div>
    );
  },
);

export const ChoiceSelect = forwardRef<HTMLSelectElement, ChoiceSelectProps>(
  function ChoiceSelect(props, ref) {
    if (props.multiple || (props.size && props.size > 1)) {
      const { align, label, className, ...nativeProps } = props;
      return (
        <div className={clsx(styles.root, className)} data-select-root="">
          <select
            {...nativeProps}
            ref={ref}
            aria-label={props["aria-label"] ?? label}
            className={styles.fallback}
            data-align={align}
          />
        </div>
      );
    }
    return <SingleChoiceSelect {...props} ref={ref} />;
  },
);
