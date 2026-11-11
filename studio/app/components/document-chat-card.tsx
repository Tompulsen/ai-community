"use client";
import { useEffect, useState } from "react";
import { Download, FileText, FolderOpen, RotateCw, Square } from "lucide-react";
import { useChatStore, type ChatMessage } from "../store/chat";
import {
  captureDocumentAccount,
  documentFetch,
  downloadDocument,
  sourceFromJob,
  retryDocumentFile,
  waitDocumentJob,
} from "../utils/document-client";
import { documentPhases, openDocumentWorkspace } from "../utils/document-chat";
import { formatMaterialSize } from "../utils/file-upload";
import { IconButton } from "./button";
import styles from "./document-workspace.module.scss";

export function DocumentChatCard({
  message,
  sessionId,
}: {
  message: ChatMessage;
  sessionId: string;
}) {
  const task = message.documentTask!;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const job = task.job;
  const pending =
    !!job &&
    !["ready", "failed", "cancelled", "needs_input"].includes(job.status);
  const update = (next: typeof job) => {
    const store = useChatStore.getState(),
      session = store.sessions.find((item) => item.id === sessionId);
    if (!session || !next) return;
    store.updateTargetSession(session, (current) => {
      const item = current.messages.find((item) => item.id === message.id);
      if (!item?.documentTask || item.documentTask.key !== task.key) return;
      item.documentTask = {
        ...item.documentTask,
        job: next,
        preparing: false,
        error: undefined,
      };
      item.content =
        next.status === "ready"
          ? "文件已生成，可预览、下载或继续修改。"
          : next.error || "正在制作文件。";
      if (next.status === "ready") {
        const source = sourceFromJob(next, task.request.format);
        if (
          !current.documentSource ||
          current.documentSource.assetId === source.assetId
        )
          current.documentSource = source;
      }
      current.messages = [...current.messages];
    });
  };
  useEffect(() => {
    if (message.streaming || (!pending && job) || (!job && !task.plan)) return;
    const controller = new AbortController(),
      account = captureDocumentAccount();
    void (async () => {
      const current = await documentFetch(
        account,
        `jobs/${job?.id || task.key}`,
        { signal: controller.signal },
      );
      await waitDocumentJob(account, current, controller.signal, update);
    })().catch((e) => {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "任务状态读取失败，请重试。");
    });
    return () => controller.abort();
    // A task keeps the same identity while its persisted status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.key, job?.id, pending, !!task.plan, message.streaming, refresh]);
  const action = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : "文档操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const source =
    job?.status === "ready"
      ? sourceFromJob(job, task.request.format)
      : undefined;
  return (
    <section className={styles.fileCard} aria-label="文档任务">
      <div className={styles.fileTitle}>
        <FileText size={20} aria-hidden="true" />
        <strong>
          {job?.fileName ||
            (task.request.format === "xlsx" ? "Excel 表格" : "Word 文档")}
        </strong>
      </div>
      <div className={styles.meta} role="status">
        {source
          ? `版本 ${source.version} · ${formatMaterialSize(job?.size || 0)}`
          : task.clarification ||
            task.error ||
            job?.error ||
            (message.streaming
              ? "正在整理文档内容"
              : task.preparing
              ? "内容生成已中断，请重新发送请求。"
              : documentPhases[job?.status || "planning"])}
      </div>
      <div className={styles.actions}>
        {error && pending && (
          <IconButton
            icon={<RotateCw size={16} />}
            text="重查任务状态"
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
            bordered
          />
        )}
        {source && (
          <>
            <IconButton
              icon={<Download size={16} />}
              text="下载文件"
              busy={busy}
              onClick={() => void action(() => downloadDocument(source))}
              bordered
            />
            <IconButton
              icon={<FolderOpen size={16} />}
              text="预览与修改"
              onClick={() => openDocumentWorkspace(source)}
              bordered
            />
          </>
        )}
        {pending && (
          <IconButton
            icon={<Square size={14} />}
            text="停止制作"
            busy={busy}
            onClick={() =>
              void action(() =>
                documentFetch(captureDocumentAccount(), `jobs/${job.id}`, {
                  method: "DELETE",
                }),
              )
            }
            bordered
          />
        )}
        {!pending && !message.streaming && !source && task.plan && (
          <IconButton
            icon={<RotateCw size={16} />}
            text="重试制作文件"
            busy={busy}
            onClick={() =>
              void action(() => retryDocumentFile(sessionId, message.id))
            }
            bordered
          />
        )}
        {task.candidates?.map((item) => (
          <IconButton
            key={item.assetId}
            text={item.fileName}
            onClick={() => openDocumentWorkspace(item)}
            bordered
          />
        ))}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
