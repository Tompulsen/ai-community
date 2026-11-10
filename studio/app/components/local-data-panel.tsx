import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  Download,
  Upload,
  FolderInput,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { IconButton } from "./button";
import { List, ListItem, showConfirm, showToast } from "./ui-lib";
import { ChatControllerPool } from "../client/controller";
import {
  createLocalBackup,
  importLocalBackup,
  parseLocalBackup,
  readLocalState,
  type LocalBackup,
} from "../utils/local-backup";
import {
  getLocalScope,
  localKey,
  beginLocalMaintenance,
  endLocalMaintenance,
} from "../utils/local-workspace";
import { pendingTasks, forgetTask } from "../utils/local-tasks";
import { getImageCount } from "../store/gallery";
import { StoreKey } from "../constant";
import { useVideoStore } from "../store/video";
import styles from "./local-data-panel.module.scss";

function BackupSwitch(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={props.label}
      aria-checked={props.checked}
      disabled={props.disabled}
      className={styles.option}
      onClick={() => props.onChange(!props.checked)}
    >
      <span>{props.label}</span>
      <span className={styles.switch} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export function LocalDataPanel(props: { className?: string }) {
  const [sections, setSections] = useState({
    chats: true,
    images: true,
    settings: true,
    videos: true,
  });
  const [preview, setPreview] = useState<{
    backup: LocalBackup;
    fileName: string;
    legacy: boolean;
  }>();
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [taskCount, setTaskCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    if (
      getLocalScope().startsWith("user-") &&
      !localStorage.getItem(localKey("legacy-imported"))
    ) {
      void Promise.all([
        readLocalState(StoreKey.Chat, "legacy"),
        getImageCount("legacy"),
      ])
        .then(([chat, count]) => {
          if (active)
            setLegacy(
              count > 0 ||
                !!chat?.state?.sessions?.some(
                  (session: { messages?: unknown[] }) =>
                    session.messages?.length,
                ),
            );
        })
        .catch(() => {});
    }
    setTaskCount(pendingTasks().length);
    return () => {
      active = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本地数据操作失败");
    } finally {
      setBusy(false);
    }
  };
  const exportData = () =>
    run(async () => {
      const backup = await createLocalBackup(sections);
      const blob = new Blob([JSON.stringify(backup)], {
        type: "application/json",
      });
      if (blob.size > 512 * 1024 * 1024)
        throw new Error("备份超过 512 MB，请分开导出聊天与作品");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `octopus-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("备份已生成，文件包含私人聊天内容，请妥善保管。");
    });
  const importData = () =>
    run(async () => {
      if (!preview) return;
      if (
        ChatControllerPool.hasPending() ||
        useVideoStore.getState().isGenerating
      )
        throw new Error("请等待当前生成结束后再导入");
      if (
        !(await showConfirm(
          "将备份合并到当前账号的本地数据，现有记录会保留。确认导入？",
        ))
      )
        return;
      await importLocalBackup(preview.backup, copy);
      showToast("导入完成");
      location.reload();
    });
  return (
    <section
      className={clsx(styles.panel, props.className)}
      aria-label="本地数据与备份"
    >
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="选择备份文件"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) {
            setPreview(undefined);
            setCopy(false);
            void run(async () => {
              if (file.size > 512 * 1024 * 1024)
                throw new Error("备份超过 512 MB，请分开导出聊天与作品");
              let data: unknown;
              try {
                data = JSON.parse(await file.text());
              } catch {
                throw new Error(
                  "无法读取 JSON 备份，请重新选择完整的备份文件。",
                );
              }
              const backup = parseLocalBackup(data);
              setPreview({
                backup,
                fileName: file.name,
                legacy: !Object.prototype.hasOwnProperty.call(data, "format"),
              });
            });
          }
        }}
      />
      <List>
        <ListItem
          title="本地数据与备份"
          subTitle="数据仅保存在此浏览器。备份不包含密钥和登录凭证。"
          className={`${styles.row} ${styles["scope-row"]}`}
          vertical
        >
          <div className={styles.options} aria-label="备份内容">
            {(["chats", "images", "settings", "videos"] as const).map((key) => (
              <BackupSwitch
                key={key}
                label={
                  {
                    chats: "聊天记录",
                    images: "图片作品原图",
                    settings: "设置与已安装技能",
                    videos: "视频记录（链接）",
                  }[key]
                }
                checked={sections[key]}
                disabled={busy}
                onChange={(checked) =>
                  setSections((value) => ({ ...value, [key]: checked }))
                }
              />
            ))}
          </div>
        </ListItem>
        <ListItem
          title="导出数据"
          subTitle="按上方范围生成备份文件，图片原图会增加文件大小。"
          className={styles.row}
        >
          <div className={styles.actions}>
            <IconButton
              icon={<Download size={16} />}
              text="导出备份"
              onClick={exportData}
              disabled={busy || !Object.values(sections).some(Boolean)}
              bordered
            />
          </div>
        </ListItem>
        <ListItem
          title="导入备份"
          subTitle="兼容本地数据备份与旧版配置文件。导入后保留已有记录，默认跳过重复项。"
          className={styles.row}
        >
          <div className={styles.actions}>
            <IconButton
              icon={<Upload size={16} />}
              text="选择备份文件"
              onClick={() => input.current?.click()}
              disabled={busy}
              bordered
            />
          </div>
        </ListItem>
        {preview && (
          <div className={styles.preview}>
            <p className={styles.hint}>
              {preview.fileName} ·{" "}
              {preview.legacy ? "旧版配置备份" : "本地数据备份"}
            </p>
            <p className={styles.hint} role="status">
              待导入：{preview.backup.chats?.length ?? 0} 个会话，
              {preview.backup.images?.length ?? 0} 张图片，
              {preview.backup.videos?.length ?? 0} 个视频链接，
              {Object.keys(preview.backup.skills ?? {}).length} 个技能，
              {preview.backup.settings ? "包含设置" : "不包含设置"}。
            </p>
            <div className={styles["preview-row"]}>
              <BackupSwitch
                label="相同记录也作为新副本导入"
                checked={copy}
                disabled={busy}
                onChange={setCopy}
              />
              <div className={styles.actions}>
                <IconButton
                  icon={<FolderInput size={16} />}
                  text="确认导入"
                  disabled={busy}
                  onClick={importData}
                  bordered
                />
              </div>
            </div>
          </div>
        )}
        {legacy && (
          <ListItem
            title="旧版历史"
            subTitle="升级前的本地历史尚未认领。确认属于你后，可复制到当前账号；原数据会保留。"
            className={styles.row}
          >
            <div className={styles.actions}>
              <IconButton
                icon={<FolderInput size={16} />}
                text="认领旧版本地历史"
                disabled={busy}
                bordered
                onClick={() =>
                  run(async () => {
                    if (
                      ChatControllerPool.hasPending() ||
                      useVideoStore.getState().isGenerating
                    )
                      throw new Error("请等待当前生成结束");
                    if (
                      !(await showConfirm(
                        "确认这些旧版聊天和作品属于当前账号，并复制到当前账号？",
                      ))
                    )
                      return;
                    const backup = await createLocalBackup(
                      { chats: true, images: true, settings: false },
                      "legacy",
                    );
                    await importLocalBackup(backup);
                    localStorage.setItem(localKey("legacy-imported"), "1");
                    location.reload();
                  })
                }
              />
              <IconButton
                icon={<X size={16} />}
                text="暂不认领"
                bordered
                disabled={busy}
                onClick={() => {
                  localStorage.setItem(
                    localKey("legacy-imported"),
                    "dismissed",
                  );
                  setLegacy(false);
                }}
              />
            </div>
          </ListItem>
        )}
        {taskCount > 0 && (
          <ListItem
            title="未完成任务"
            subTitle={
              <span>
                本地有 {taskCount}{" "}
                个未完成任务。恢复只查询原任务，不会重新提交生成请求。
              </span>
            }
            className={styles.row}
          >
            <div className={styles.actions}>
              <IconButton
                icon={<RefreshCw size={16} />}
                text="重新查询任务"
                disabled={busy}
                bordered
                onClick={() => location.reload()}
              />
              <IconButton
                icon={<Trash2 size={16} />}
                text="清理任务记录"
                disabled={busy}
                bordered
                onClick={() =>
                  run(async () => {
                    if (
                      !(await showConfirm(
                        "只清理此浏览器的任务记录，不会取消上游生成或退还费用。确认清理？",
                      ))
                    )
                      return;
                    await beginLocalMaintenance();
                    ChatControllerPool.stopAll();
                    try {
                      pendingTasks().forEach((task) => forgetTask(task.id));
                      endLocalMaintenance(true);
                      location.reload();
                    } catch (error) {
                      endLocalMaintenance();
                      throw error;
                    }
                  })
                }
              />
            </div>
          </ListItem>
        )}
        {busy && (
          <p className={styles.feedback} role="status">
            正在处理本地数据…
          </p>
        )}
        {message && (
          <p className={styles.feedback} role="status">
            {message}
          </p>
        )}
      </List>
    </section>
  );
}
