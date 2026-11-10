import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router";
import { IconButton } from "./button";
import ReloadButtonIcon from "../icons/reload.svg";
import Locale from "../locales";
import { showToast } from "./ui-lib";
import { ApiPath } from "@/app/constant";
import { Loading } from "./home";
import OctopusIcon from "../icons/octopus-icon";
import styles from "./artifacts.module.scss";
import { HTMLPreview, type HTMLPreviewHandler } from "./html-preview";
import { ArtifactsShareButton } from "./artifacts-share-button";

export { HTMLPreview, type HTMLPreviewHandler } from "./html-preview";
export { ArtifactsShareButton } from "./artifacts-share-button";

export function Artifacts() {
  const { id } = useParams();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [fileName, setFileName] = useState("");
  const previewRef = useRef<HTMLPreviewHandler>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCode("");
    setFileName("");
    setLoading(!!id);
    if (id) {
      fetch(`${ApiPath.Artifacts}?id=${encodeURIComponent(id)}`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) {
            throw Error("can not get content");
          }
          return res;
        })
        .then((res) => res.text())
        .then((content) => {
          if (!controller.signal.aborted) setCode(content);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            showToast(Locale.Export.Artifacts.Error);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }
    return () => controller.abort();
  }, [id]);

  return (
    <div className={styles["artifacts"]}>
      <div className={styles["artifacts-header"]}>
        <div className={styles["artifacts-brand"]}>
          <OctopusIcon width={28} height={28} />
          <span className={styles["artifacts-title"]}>
            章鱼公益平台 · Artifacts
          </span>
        </div>
        <div className={styles["artifacts-actions"]}>
          <IconButton
            bordered
            icon={<ReloadButtonIcon />}
            onClick={() => previewRef.current?.reload()}
          />
          <ArtifactsShareButton
            id={id}
            getCode={() => code}
            fileName={fileName}
          />
        </div>
      </div>
      <div className={styles["artifacts-content"]}>
        {loading && <Loading />}
        {code && (
          <HTMLPreview
            code={code}
            ref={previewRef}
            autoHeight={false}
            height={"100%"}
            onLoad={(title) => {
              setFileName(title as string);
              setLoading(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
