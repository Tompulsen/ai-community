import styles from "./file-name.module.scss";

export function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < name.length - 1;
  return (
    <span className={styles.name} title={name} aria-label={name}>
      <span className={styles.stem}>
        {hasExtension ? name.slice(0, dot) : name}
      </span>
      {hasExtension && (
        <span className={styles.extension}>{name.slice(dot)}</span>
      )}
    </span>
  );
}
