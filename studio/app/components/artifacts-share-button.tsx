import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./button";
import ExportIcon from "../icons/share.svg";
import CopyIcon from "../icons/copy.svg";
import DownloadIcon from "../icons/download.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import Locale from "../locales";
import { Modal, showToast } from "./ui-lib";
import { copyToClipboard, downloadAs } from "../utils";
import { Path, ApiPath } from "@/app/constant";

export function ArtifactsShareButton({
  getCode,
  id,
  style,
  fileName,
}: {
  getCode: () => string;
  id?: string;
  style?: any;
  fileName?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(id);
  const [show, setShow] = useState(false);
  const shareUrl = useMemo(
    () => [location.origin, "/studio/#", Path.Artifacts, "/", name].join(""),
    [name],
  );
  const upload = (code: string) =>
    id
      ? Promise.resolve({ id })
      : fetch(ApiPath.Artifacts, {
          method: "POST",
          body: code,
        })
          .then((res) => res.json())
          .then(({ id }) => {
            if (id) {
              return { id };
            }
            throw Error();
          })
          .catch(() => {
            showToast(Locale.Export.Artifacts.Error);
          });
  return (
    <>
      <IconButton
        icon={loading ? <LoadingButtonIcon /> : <ExportIcon />}
        bordered
        title={Locale.Export.Artifacts.Title}
        style={style}
        onClick={() => {
          if (loading) return;
          setLoading(true);
          upload(getCode())
            .then((res) => {
              if (res?.id) {
                setShow(true);
                setName(res?.id);
              }
            })
            .finally(() => setLoading(false));
        }}
      />
      {show &&
        createPortal(
          <div className="modal-mask">
            <Modal
              title={Locale.Export.Artifacts.Title}
              onClose={() => setShow(false)}
              actions={[
                <IconButton
                  key="download"
                  icon={<DownloadIcon />}
                  bordered
                  text={Locale.Export.Download}
                  onClick={() => {
                    downloadAs(getCode(), `${fileName || name}.html`).then(() =>
                      setShow(false),
                    );
                  }}
                />,
                <IconButton
                  key="copy"
                  icon={<CopyIcon />}
                  bordered
                  text={Locale.Chat.Actions.Copy}
                  onClick={() => {
                    copyToClipboard(shareUrl).then(() => setShow(false));
                  }}
                />,
              ]}
            >
              <div>
                <a target="_blank" href={shareUrl}>
                  {shareUrl}
                </a>
              </div>
            </Modal>
          </div>,
          document.body,
        )}
    </>
  );
}
