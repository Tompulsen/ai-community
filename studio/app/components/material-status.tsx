import {
  CircleAlert,
  File,
  Image,
  LoaderCircle,
  Music,
  RotateCw,
  Square,
  Video,
  X,
} from "lucide-react";
import Locale from "../locales";
import { formatMaterialSize } from "../utils/file-upload";
import type { MaterialUploadItem } from "../utils/material-upload";
import { FileName } from "./file-name";
import styles from "./material-status.module.scss";

export function MaterialStatus(props: {
  items: MaterialUploadItem[];
  state?: "processing" | "failed";
  onRetry?: () => void;
  onCancel?: () => void;
  onRemove?: (id: string) => void;
}) {
  if (props.items.length === 0 && !props.state) return null;
  const labels = Locale.Chat.InputActions;
  const failed =
    props.state === "failed" ||
    props.items.some((item) => item.status === "failed");
  const processing = props.state === "processing";

  return (
    <div
      className={styles["materials"]}
      data-material-status={props.state ?? "ready"}
      role="status"
      aria-live="polite"
      aria-busy={processing}
    >
      <div className={styles["summary"]}>
        <span>
          {processing
            ? labels.PreparingMaterials
            : failed
            ? labels.MaterialsFailed
            : labels.MaterialsReady}
        </span>
        {processing && props.onCancel && (
          <button
            type="button"
            className={styles["icon-button"]}
            onClick={props.onCancel}
            aria-label={labels.CancelMaterials}
            title={labels.CancelMaterials}
          >
            <Square size={14} aria-hidden="true" />
          </button>
        )}
        {!processing && failed && props.onRetry && (
          <button
            type="button"
            className={styles["retry"]}
            onClick={props.onRetry}
          >
            <RotateCw size={14} aria-hidden="true" />
            {labels.RetryMaterials}
          </button>
        )}
      </div>
      <div className={styles["items"]}>
        {props.items.map((item) => {
          const Icon = item.type.startsWith("image/")
            ? Image
            : item.type.startsWith("video/")
            ? Video
            : item.type.startsWith("audio/")
            ? Music
            : File;
          return (
            <div key={item.id} data-file-status={item.status}>
              <div className={styles["item"]}>
                <Icon size={15} aria-hidden="true" />
                <span className={styles["name"]}>
                  <FileName name={item.name} />
                </span>
                <span className={styles["size"]}>
                  {formatMaterialSize(item.size)}
                </span>
                <span className={styles["state"]}>
                  {item.status === "processing" ? (
                    <LoaderCircle
                      size={13}
                      className={styles["spinner"]}
                      aria-hidden="true"
                    />
                  ) : item.status === "failed" ? (
                    <CircleAlert size={13} aria-hidden="true" />
                  ) : null}
                  {item.status === "processing"
                    ? labels.MaterialProcessing
                    : item.status === "failed"
                    ? labels.MaterialFailed
                    : labels.MaterialReady}
                </span>
                {props.onRemove && (
                  <button
                    type="button"
                    className={styles["icon-button"]}
                    onClick={() => props.onRemove?.(item.id)}
                    aria-label={labels.RemoveMaterial(item.name)}
                    title={labels.RemoveMaterial(item.name)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {item.status === "failed" && item.error && (
                <div className={styles["error"]}>{item.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
