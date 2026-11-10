import { IconButton } from "./button";
import { ErrorBoundary } from "./error";
import { createPortal } from "react-dom";
import styles from "./mask.module.scss";
import DownloadIcon from "../icons/download.svg";
import UploadIcon from "../icons/upload.svg";
import { SquarePen as EditIcon } from "lucide-react";
import AddIcon from "../icons/add.svg";
import CloseIcon from "../icons/close.svg";
import DeleteIcon from "../icons/delete.svg";
import EyeIcon from "../icons/eye.svg";
import CopyIcon from "../icons/copy.svg";
import { useMaskStore } from "../store/mask";
import { useChatStore } from "../store";
import { Modal, Select, showConfirm } from "./ui-lib";
import Locale, { AllLangs, ALL_LANG_OPTIONS, Lang, getLang } from "../locales";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { downloadAs, readFromFile } from "../utils";
import { FileName, Path } from "../constant";
import { BUILTIN_MASK_STORE, useBuiltinMasksLoaded } from "../masks";
import { TextField } from "./form-controls";
import { getMaskDescription } from "./mask-description";
import { MaskAvatar } from "./mask-avatar";
import { MaskConfig } from "./mask-config";

export { MaskAvatar } from "./mask-avatar";
export { MaskConfig, ContextPrompts } from "./mask-config";

export function MaskPage() {
  const navigate = useNavigate();
  useBuiltinMasksLoaded();

  const maskStore = useMaskStore();
  const chatStore = useChatStore();

  const [filterLang, setFilterLang] = useState<Lang | "all">(getLang);

  const allMasks = maskStore.getAll(filterLang);

  const [searchText, setSearchText] = useState("");
  const masks = allMasks.filter((m) =>
    m.name.toLowerCase().includes(searchText.toLowerCase()),
  );

  // refactored already, now it accurate
  const onSearch = (text: string) => {
    setSearchText(text);
  };

  const [editingMaskId, setEditingMaskId] = useState<string | undefined>();
  const editingMask =
    maskStore.get(editingMaskId) ?? BUILTIN_MASK_STORE.get(editingMaskId);
  const closeMaskModal = () => setEditingMaskId(undefined);

  const downloadAll = () => {
    downloadAs(JSON.stringify(masks.filter((v) => !v.builtin)), FileName.Masks);
  };

  const importFromFile = () => {
    readFromFile().then((content) => {
      try {
        const importMasks = JSON.parse(content);
        if (Array.isArray(importMasks)) {
          for (const mask of importMasks) {
            if (mask.name) {
              maskStore.create(mask);
            }
          }
          return;
        }
        //if the content is a single mask.
        if (importMasks.name) {
          maskStore.create(importMasks);
        }
      } catch {}
    });
  };

  return (
    <ErrorBoundary>
      <div className={styles["mask-page"]}>
        <div className="window-header">
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.Mask.Page.Title}
            </div>
            <div className="window-header-submai-title">
              {Locale.Mask.Page.SubTitle(allMasks.length)}
            </div>
          </div>

          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<DownloadIcon />}
                bordered
                onClick={downloadAll}
                text={Locale.UI.Export}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                icon={<UploadIcon />}
                text={Locale.UI.Import}
                bordered
                onClick={() => importFromFile()}
              />
            </div>
            <div className="window-action-button">
              <IconButton
                icon={<CloseIcon />}
                bordered
                onClick={() => navigate(-1)}
              />
            </div>
          </div>
        </div>

        <div className={styles["mask-page-body"]}>
          <div className={styles["mask-filter"]}>
            <TextField
              fullWidth
              type="text"
              className={styles["search-bar"]}
              placeholder={Locale.Mask.Page.Search}
              aria-label={Locale.Mask.Page.Search}
              autoFocus
              onInput={(e) => onSearch(e.currentTarget.value)}
            />
            <Select
              className={styles["mask-filter-lang"]}
              aria-label={Locale.Settings.Lang.Name}
              value={filterLang}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setFilterLang(value as Lang | "all");
              }}
            >
              <option key="all" value="all">
                {Locale.Settings.Lang.All}
              </option>
              {AllLangs.map((lang) => (
                <option value={lang} key={lang}>
                  {ALL_LANG_OPTIONS[lang]}
                </option>
              ))}
            </Select>

            <IconButton
              className={styles["mask-create"]}
              icon={<AddIcon />}
              text={Locale.Mask.Page.Create}
              bordered
              onClick={() => {
                const createdMask = maskStore.create();
                setEditingMaskId(createdMask.id);
              }}
            />
          </div>

          <div className={styles["mask-list"]} role="list">
            {masks.map((m) => (
              <div className={styles["mask-item"]} role="listitem" key={m.id}>
                <div className={styles["mask-header"]}>
                  <div className={styles["mask-icon"]}>
                    <MaskAvatar avatar={m.avatar} model={m.modelConfig.model} />
                  </div>
                  <div className={styles["mask-title"]}>
                    <div className={styles["mask-name"]} title={m.name}>
                      {m.name}
                    </div>
                    <div className={styles["mask-info"]}>
                      {getMaskDescription(m, getLang()) ??
                        `${Locale.Mask.Item.Info(m.context.length)} / ${
                          ALL_LANG_OPTIONS[m.lang]
                        }`}
                    </div>
                  </div>
                </div>
                <div className={styles["mask-actions"]}>
                  <IconButton
                    className={styles["mask-chat"]}
                    icon={<AddIcon />}
                    text={Locale.Account.StartChat}
                    aria={`${Locale.Account.StartChat} · ${m.name}`}
                    onClick={() => {
                      chatStore.newSession(m);
                      navigate(Path.Chat);
                    }}
                  />
                  {m.builtin ? (
                    <IconButton
                      icon={<EyeIcon />}
                      text={Locale.Mask.Item.View}
                      aria={`${Locale.Mask.Item.View} · ${m.name}`}
                      onClick={() => setEditingMaskId(m.id)}
                    />
                  ) : (
                    <IconButton
                      icon={<EditIcon size={16} strokeWidth={1.8} />}
                      text={Locale.Mask.Item.Edit}
                      aria={`${Locale.Mask.Item.Edit} · ${m.name}`}
                      onClick={() => setEditingMaskId(m.id)}
                    />
                  )}
                  {!m.builtin && (
                    <IconButton
                      icon={<DeleteIcon />}
                      text={Locale.Mask.Item.Delete}
                      aria={`${Locale.Mask.Item.Delete} · ${m.name}`}
                      onClick={async () => {
                        if (await showConfirm(Locale.Mask.Item.DeleteConfirm)) {
                          maskStore.delete(m.id);
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingMask &&
        createPortal(
          <div className="modal-mask">
            <Modal
              title={
                editingMask.builtin
                  ? editingMask.name
                  : Locale.Mask.EditModal.Title(editingMask.builtin)
              }
              onClose={closeMaskModal}
              actions={[
                <IconButton
                  icon={<DownloadIcon />}
                  text={Locale.Mask.EditModal.Download}
                  key="export"
                  bordered
                  onClick={() =>
                    downloadAs(
                      JSON.stringify(editingMask),
                      `${editingMask.name}.json`,
                    )
                  }
                />,
                <IconButton
                  key="copy"
                  icon={<CopyIcon />}
                  bordered
                  text={Locale.Mask.EditModal.Clone}
                  onClick={() => {
                    navigate(Path.Masks);
                    maskStore.create(editingMask);
                    setEditingMaskId(undefined);
                  }}
                />,
              ]}
            >
              {editingMask.builtin && (
                <div className={styles["mask-preview-summary"]}>
                  {getMaskDescription(editingMask, getLang()) && (
                    <p>{getMaskDescription(editingMask, getLang())}</p>
                  )}
                  <div>
                    {`${Locale.Mask.Item.Info(editingMask.context.length)} / ${
                      ALL_LANG_OPTIONS[editingMask.lang]
                    }`}
                  </div>
                </div>
              )}
              <MaskConfig
                mask={editingMask}
                updateMask={(updater) =>
                  maskStore.updateMask(editingMaskId!, updater)
                }
                readonly={editingMask.builtin}
              />
            </Modal>
          </div>,
          document.body,
        )}
    </ErrorBoundary>
  );
}
