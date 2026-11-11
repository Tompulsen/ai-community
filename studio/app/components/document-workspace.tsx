"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, Upload, X } from "lucide-react";
import { useChatStore } from "../store/chat";
import { useSkillStore } from "../store/skills";
import { documentSkill } from "../skills/document-skill";
import {
  captureDocumentAccount,
  documentFetch,
  downloadDocument,
  sourceFromJob,
  uploadDocument,
  waitDocumentJob,
} from "../utils/document-client";
import {
  DOCUMENT_WORKSPACE_EVENT,
  type DocumentSource,
} from "../utils/document-chat";
import type { DocumentAsset } from "../utils/document-workspace";
import { DocumentContentPreview } from "./document-content-preview";
import { ChatAction } from "./chat-action";
import { IconButton } from "./button";
import { SelectionDialog } from "./selection-dialog";
import styles from "./document-workspace.module.scss";

export function DocumentWorkspace({
  sessionId,
  enabled,
}: {
  sessionId: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [assets, setAssets] = useState<DocumentAsset[]>([]);
  const [selected, setSelected] = useState<DocumentSource>(),
    [versions, setVersions] = useState<DocumentAsset[]>([]);
  const [structure, setStructure] = useState<unknown>(),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const controller = useRef<AbortController>(),
    upload = useRef<HTMLInputElement>(null),
    epoch = useRef(0);
  const cancelUpload = useRef<() => void>();
  const source = useChatStore(
    (state) =>
      state.sessions.find((item) => item.id === sessionId)?.documentSource,
  );
  const read = async (item: DocumentSource) => {
    const revision = ++epoch.current;
    setSelected(item);
    setStructure(undefined);
    setLoading(true);
    setError("");
    try {
      const account = captureDocumentAccount();
      const [content, history] = await Promise.all([
        documentFetch(
          account,
          `assets/${item.assetId}/${item.version}/structure`,
        ),
        documentFetch(account, `assets/${item.assetId}/versions`),
      ]);
      if (epoch.current === revision) {
        setStructure(content);
        setVersions(history.versions);
      }
    } catch (e) {
      if (epoch.current === revision)
        setError(e instanceof Error ? e.message : "读取文件失败");
    } finally {
      if (epoch.current === revision) setLoading(false);
    }
  };
  useEffect(() => {
    const show = (event: Event) => {
      setOpen(true);
      const item = (event as CustomEvent<DocumentSource>).detail;
      if (item) void read(item);
    };
    window.addEventListener(DOCUMENT_WORKSPACE_EVENT, show);
    return () => window.removeEventListener(DOCUMENT_WORKSPACE_EVENT, show);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  useEffect(() => {
    setOpen(false);
    setSelected(undefined);
    setAssets([]);
    epoch.current++;
    controller.current?.abort();
    cancelUpload.current?.();
  }, [sessionId]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void documentFetch(
      captureDocumentAccount(),
      `assets?sessionId=${encodeURIComponent(sessionId)}`,
      { signal: abort.signal },
    )
      .then((data) => {
        if (!abort.signal.aborted) setAssets(data.assets);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "文件列表读取失败");
      });
    return () => {
      abort.abort();
      epoch.current++;
      controller.current?.abort();
      cancelUpload.current?.();
    };
  }, [open, sessionId]);
  const choose = async (item?: DocumentSource, prompt?: string) => {
    const account = captureDocumentAccount();
    account.assertCurrent();
    const skills = useSkillStore.getState();
    if (!skills.installed[documentSkill.id])
      await skills.install(documentSkill);
    account.assertCurrent();
    useSkillStore.getState().setEnabled(documentSkill.id, true);
    const store = useChatStore.getState(),
      session = store.sessions.find((value) => value.id === sessionId);
    if (!session) return;
    store.updateTargetSession(session, (current) => {
      current.activeSkillId = documentSkill.id;
      current.documentSource = item;
    });
    setOpen(false);
    window.dispatchEvent(
      new CustomEvent("community:document-compose", {
        detail: { sessionId, prompt: prompt || `请修改${item?.fileName}：` },
      }),
    );
  };
  const action = async (run: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {enabled && (
        <ChatAction
          icon={<FileText size={16} />}
          text="文件"
          title="文件、预览与历史版本"
          showLabel
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        />
      )}
      {enabled && source && (
        <span className={styles.source}>
          <span title={source.fileName}>编辑：{source.fileName}</span>
          <button
            type="button"
            aria-label="取消选择文档"
            onClick={() => {
              const store = useChatStore.getState();
              const session = store.sessions.find(
                (item) => item.id === sessionId,
              );
              if (session)
                store.updateTargetSession(session, (item) => {
                  item.documentSource = undefined;
                });
            }}
          >
            <X size={14} />
          </button>
        </span>
      )}
      {open && (
        <SelectionDialog
          title="文档工作区"
          id="document-workspace"
          onClose={() => setOpen(false)}
        >
          <div className={styles.workspace}>
            <p className={styles.meta}>
              生成和修改 Word、Excel 文件，原件与历史版本保留。
            </p>
            <div className={styles.actions}>
              <IconButton
                text="新建 Word"
                onClick={() =>
                  void action(() => choose(undefined, "请生成一个 Word 文档："))
                }
                disabled={busy}
                bordered
              />
              <IconButton
                text="新建 Excel"
                onClick={() =>
                  void action(() =>
                    choose(undefined, "请生成一个 Excel 表格："),
                  )
                }
                disabled={busy}
                bordered
              />
              <IconButton
                icon={<Upload size={16} />}
                text="上传文件"
                busy={busy}
                onClick={() => upload.current?.click()}
                bordered
              />
              <input
                ref={upload}
                type="file"
                accept=".docx,.xlsx"
                hidden
                aria-label="上传 Word 或 Excel 文件"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  void action(async () => {
                    const account = captureDocumentAccount();
                    const abort = new AbortController();
                    controller.current = abort;
                    const key = crypto.randomUUID();
                    cancelUpload.current = () => {
                      void documentFetch(account, `jobs/${key}`, {
                        method: "DELETE",
                      }).catch(() => {});
                    };
                    let ready;
                    try {
                      const job = await uploadDocument(
                        account,
                        file,
                        sessionId,
                        key,
                        abort.signal,
                      );
                      ready = await waitDocumentJob(account, job, abort.signal);
                    } finally {
                      cancelUpload.current = undefined;
                    }
                    abort.signal.throwIfAborted();
                    const item = sourceFromJob(
                      ready,
                      file.name.toLowerCase().endsWith(".xlsx")
                        ? "xlsx"
                        : "docx",
                    );
                    const list = await documentFetch(
                      account,
                      `assets?sessionId=${encodeURIComponent(sessionId)}`,
                      { signal: abort.signal },
                    );
                    if (!abort.signal.aborted) {
                      setAssets(list.assets);
                      await read(item);
                    }
                  });
                }}
              />
            </div>
            <p className={styles.meta}>
              支持 DOCX / XLSX，单文件最大 20 MiB。预览展示内容与公式结果。
            </p>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.files} aria-label="当前聊天的文档">
              {assets.length === 0 && !selected ? (
                <p>此聊天暂无文件。上传文件或新建文档后即可继续编辑。</p>
              ) : (
                assets.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={selected?.assetId === item.id}
                    onClick={() =>
                      void read({
                        assetId: item.id,
                        version: item.version,
                        fileName: item.fileName,
                        format: item.format,
                        sessionId,
                      })
                    }
                  >
                    <FileText size={16} aria-hidden="true" />
                    <span>{item.fileName}</span>
                    <small>版本 {item.version}</small>
                  </button>
                ))
              )}
            </div>
            {selected && (
              <section className={styles.detail}>
                <h3>{selected.fileName}</h3>
                <div className={styles.actions}>
                  <label>
                    版本{" "}
                    <select
                      aria-label="文档历史版本"
                      value={selected.version}
                      onChange={(event) =>
                        void read({
                          ...selected,
                          version: Number(event.target.value),
                        })
                      }
                    >
                      {versions.length ? (
                        versions.map((item) => (
                          <option key={item.version} value={item.version}>
                            {item.version}
                          </option>
                        ))
                      ) : (
                        <option>{selected.version}</option>
                      )}
                    </select>
                  </label>
                  <IconButton
                    icon={<Download size={16} />}
                    text="下载此版本"
                    busy={busy}
                    onClick={() =>
                      void action(() => downloadDocument(selected))
                    }
                    bordered
                  />
                  <IconButton
                    text="继续修改"
                    disabled={
                      busy ||
                      (!!versions.length &&
                        selected.version !== versions[0].version)
                    }
                    onClick={() => void action(() => choose(selected))}
                    bordered
                  />
                </div>
                {loading ? (
                  <p role="status">正在读取内容…</p>
                ) : structure ? (
                  <DocumentContentPreview structure={structure} />
                ) : null}
              </section>
            )}
          </div>
        </SelectionDialog>
      )}
    </>
  );
}
