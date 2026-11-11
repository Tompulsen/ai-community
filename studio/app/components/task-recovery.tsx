import { useEffect, useState } from "react";
import { apiFetch, apiPath } from "../client/api";
import { useChatStore } from "../store/chat";
import { useAccessStore } from "../store/access";
import { imageResultUrls } from "../utils/image-response";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import {
  pendingTasks,
  pollLocalTask,
  forgetTask,
  createTaskQueryQueue,
} from "../utils/local-tasks";
import { ChatControllerPool } from "../client/controller";
import { CUSTOM_MODEL_PROVIDER } from "../utils/custom-provider";
import { Toast } from "./ui-lib";

export function TaskRecovery() {
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const resume = () => setRetry((value) => value + 1);
    window.addEventListener("resume-local-tasks", resume);
    return () => {
      window.removeEventListener("resume-local-tasks", resume);
    };
  }, []);
  const source = useAccessStore((state) =>
    JSON.stringify([
      state.useCustomConfig,
      state.openaiUrl,
      state.openaiApiKey,
    ]),
  );
  useEffect(() => {
    const controller = new AbortController();
    const pause = () => controller.abort();
    window.addEventListener("local-data-maintenance", pause);
    window.addEventListener("model-source-changing", pause);
    window.addEventListener("local-workspace-switch", pause);
    const recover = async () => {
      const owner = getLocalScope();
      const active = () =>
        !controller.signal.aborted &&
        isLocalWorkspaceActive() &&
        getLocalScope() === owner;
      await useAccessStore.getState().fetch();
      if (!active()) return;
      const tasks = pendingTasks();
      if (!tasks.length) return;
      const query = createTaskQueryQueue();
      const issues: string[] = [];
      const reportIssue = (message: string) => {
        issues.push(message);
        if (!controller.signal.aborted) setNotice(issues[0]);
      };
      setNotice("正在恢复未完成任务");
      await Promise.all(
        tasks.map(async (task) => {
          if (!active()) return;
          const providerName = task.customApiBase
            ? CUSTOM_MODEL_PROVIDER
            : undefined;
          if (
            task.customApiBase &&
            !useAccessStore.getState().useCustomConfig
          ) {
            reportIssue("有未完成的自定义接口任务，请启用对应配置后恢复查询。");
            return;
          }
          const taskSource = apiPath("", providerName);
          if (task.customApiBase && task.customApiBase !== taskSource) {
            reportIssue(
              "有未完成任务，请切回提交任务时使用的接口配置后恢复查询。",
            );
            return;
          }
          if (Date.now() - task.createdAt > 86400000) {
            reportIssue("有超过一天的任务未完成，可在账号页清理本地任务记录。");
            return;
          }
          if (task.kind === "video") {
            if (!task.paused) {
              try {
                const { resumeVideoRequest } = await import(
                  "../utils/video-generation"
                );
                if (!active()) return;
                await resumeVideoRequest(task.id, controller.signal);
              } catch (error) {
                if (!controller.signal.aborted)
                  reportIssue(
                    error instanceof Error ? error.message : "视频查询中断",
                  );
              }
            }
            return;
          }
          if (
            task.sessionId &&
            task.messageId &&
            ChatControllerPool.controllers[
              ChatControllerPool.key(task.sessionId, task.messageId)
            ]
          )
            return;
          try {
            const result = await pollLocalTask(
              task,
              (path) =>
                query(() => {
                  if (!active() || apiPath("", providerName) !== taskSource)
                    throw new DOMException("Cancelled", "AbortError");
                  return apiFetch(
                    path,
                    {
                      signal: controller.signal,
                      headers:
                        task.tokenId === null || task.customApiBase
                          ? {}
                          : { "X-New-Api-Token": String(task.tokenId) },
                    },
                    providerName,
                  );
                }),
              controller.signal,
            );
            if (!active()) return;
            const requestDuration =
              typeof task.requestStartedAt === "number" &&
              Number.isFinite(task.requestStartedAt) &&
              task.requestStartedAt > 0
                ? Math.max(0, Date.now() - task.requestStartedAt)
                : undefined;
            if (task.kind === "image") {
              const urls = imageResultUrls(result);
              const store = useChatStore.getState();
              const session = store.sessions.find(
                (session) => session.id === task.sessionId,
              );
              if (session)
                store.updateTargetSession(session, (session) => {
                  session.messages = session.messages.map((message) =>
                    message.id === task.messageId
                      ? {
                          ...message,
                          streaming: false,
                          interrupted: false,
                          isError: false,
                          content: urls
                            .map((image) => `![Generated Image](${image})`)
                            .join("\n\n"),
                          ...(requestDuration !== undefined && {
                            imageRequestDurationMs: requestDuration,
                          }),
                        }
                      : message,
                  );
                });
              if (session && task.messageId) {
                await store.saveGeneratedImage(
                  session.id,
                  task.messageId,
                  urls,
                  task.prompt,
                  task.model,
                );
                const current = useChatStore
                  .getState()
                  .sessions.find((item) => item.id === session.id)
                  ?.messages.find((message) => message.id === task.messageId);
                if (current?.gallerySave === "failed")
                  throw new Error(
                    "图片已生成，保存作品失败，可重新进入页面重试保存",
                  );
              }
            }
            forgetTask(task.id);
          } catch (error) {
            if (!controller.signal.aborted)
              reportIssue(
                error instanceof Error
                  ? error.message
                  : "任务查询中断，记录已保留",
              );
          }
        }),
      );
      if (!controller.signal.aborted) setNotice(issues[0] || "");
    };
    void recover().catch(() => {
      if (!controller.signal.aborted)
        setNotice("无法恢复任务，请确认登录状态后重试");
    });
    return () => {
      controller.abort();
      window.removeEventListener("local-data-maintenance", pause);
      window.removeEventListener("model-source-changing", pause);
      window.removeEventListener("local-workspace-switch", pause);
    };
  }, [source, retry]);
  return notice ? (
    <Toast
      content={notice}
      placement="top"
      action={{ text: "关闭", onClick: () => setNotice("") }}
    />
  ) : null;
}
