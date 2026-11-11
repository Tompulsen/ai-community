import { Selector } from "./ui-lib";
import styles from "./chat.module.scss";

export function ImageParameterSelector({
  value,
  options,
  onChange,
  onClose,
  labels,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  onClose: () => void;
  labels?: Record<string, string>;
}) {
  return (
    <Selector
      className={styles["image-param-selector"]}
      mobilePlacement="center"
      defaultSelectedValue={value}
      items={options.map((option) => ({
        title:
          labels?.[option] ??
          (option === "auto"
            ? "自动（推荐）"
            : /^[124]k$/.test(option)
            ? option.toUpperCase()
            : option),
        value: option,
      }))}
      onClose={onClose}
      onSelection={(selected) => {
        if (selected.length) onChange(selected[0]);
      }}
    />
  );
}
