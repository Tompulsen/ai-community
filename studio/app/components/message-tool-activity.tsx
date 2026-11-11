"use client";

import { useRef } from "react";
import { executeMcpAction, getAllTools } from "../mcp/actions";
import { ChatControllerPool } from "../client/controller";
import { useChatStore, type ChatMessageTool } from "../store/chat";
import {
  getLocalScope,
  getLocalTokenId,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import {
  formatToolValue,
  getToolResult,
  isToolRecord,
  waitForToolResult,
} from "../utils/tool-result";
import { ToolActivity, type ToolRerun } from "./tool-activity";

const pendingRuns = new Set<string>();

export function MessageToolActivity({
  sessionId,
  messageId,
  tool,
  disabled = false,
}: {
  sessionId: string;
  messageId: string;
  tool: ChatMessageTool;
  disabled?: boolean;
}) {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const canRerun =
    tool.type === "mcp" && !!tool.clientId && !!tool.function?.name;

  const rerun: ToolRerun = async (original, args) => {
    const owner = getLocalScope();
    const token = getLocalTokenId();
    const key = JSON.stringify([owner, sessionId, messageId, tool.id]);
    const name = tool.function?.name;
    const clientId = tool.clientId;
    const currentOwner = () =>
      isLocalWorkspaceActive() &&
      getLocalScope() === owner &&
      getLocalTokenId() === token;
    const target = () => {
      const state = useChatStore.getState();
      const session = state.sessions.find((item) => item.id === sessionId);
      const message = [
        ...(session?.messages ?? []),
        ...(session?.messageBranches ?? []),
      ].find((item) => item.id === messageId);
      const call = message?.tools?.find(
        (item) =>
          item.id === tool.id &&
          item.type === "mcp" &&
          item.clientId === clientId &&
          item.function?.name === name,
      );
      return { state, session, call };
    };
    const ready = () => {
      const { state, session, call } = target();
      return (
        currentOwner() &&
        state.currentSession().id === sessionId &&
        !!session &&
        !session.messages.some((message) => message.streaming) &&
        !!call &&
        call.isError !== undefined
      );
    };
    const update = (patch: Partial<ChatMessageTool>) => {
      if (!currentOwner()) return;
      const { state, session, call } = target();
      if (!session || !call) return;
      state.updateTargetSession(session, (next) => {
        const updateMessage = (message: (typeof next.messages)[number]) =>
          message.id !== messageId
            ? message
            : {
                ...message,
                tools: message.tools?.map((entry) =>
                  entry.id === tool.id ? { ...entry, ...patch } : entry,
                ),
              };
        next.messages = next.messages.map(updateMessage);
        if (next.messageBranches)
          next.messageBranches = next.messageBranches.map(updateMessage);
        next.lastUpdate = Date.now();
      });
    };
    if (
      !canRerun ||
      !name ||
      !clientId ||
      original.id !== tool.id ||
      disabledRef.current ||
      ChatControllerPool.hasPending(sessionId) ||
      !ready()
    )
      throw new Error("当前无法重新执行，请返回原会话后重试。");
    if (pendingRuns.has(key)) throw new Error("该工具正在执行，请稍候。");
    pendingRuns.add(key);
    let started = false;
    const controller = new AbortController();
    controller.signal.addEventListener(
      "abort",
      () => {
        if (started)
          update({
            isError: true,
            errorMsg: "已停止等待，工具可能仍在运行。",
          });
      },
      { once: true },
    );
    ChatControllerPool.addController(sessionId, tool.id, controller);
    try {
      const clients = await waitForToolResult(getAllTools(), controller.signal);
      if (controller.signal.aborted) throw new Error("操作已取消。");
      if (!ready()) throw new Error("会话或账号已变化，请重新确认后执行。");
      const client = clients.find((entry) => entry.clientId === clientId);
      const registered = client?.tools?.tools;
      if (
        !Array.isArray(registered) ||
        !registered.some(
          (entry: unknown) => isToolRecord(entry) && entry.name === name,
        )
      )
        throw new Error("该工具当前不可用，请检查 MCP 连接后重试。");
      const serialized = JSON.stringify(args);
      update({
        function: { name, arguments: serialized },
        isError: undefined,
        errorMsg: undefined,
        content: undefined,
      });
      started = true;
      const response = await waitForToolResult(
        executeMcpAction(clientId, {
          method: "tools/call",
          params: { name, arguments: args },
        }),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const content = formatToolValue(response);
      const failed =
        isToolRecord(response) &&
        (response.isError === true || !!response.error);
      const responseError =
        isToolRecord(response) && isToolRecord(response.error)
          ? response.error.message
          : undefined;
      update({
        content,
        isError: failed,
        errorMsg: failed
          ? typeof responseError === "string"
            ? responseError
            : formatToolValue(getToolResult(content))
          : undefined,
      });
    } catch (failure) {
      if (controller.signal.aborted)
        throw new Error(
          started ? "已停止等待，工具可能仍在运行。" : "操作已取消。",
        );
      if (started && !controller.signal.aborted)
        update({
          isError: true,
          errorMsg:
            failure instanceof Error
              ? failure.message
              : "工具执行失败，请重试。",
        });
      throw failure;
    } finally {
      pendingRuns.delete(key);
      if (
        ChatControllerPool.controllers[
          ChatControllerPool.key(sessionId, tool.id)
        ] === controller
      )
        ChatControllerPool.remove(sessionId, tool.id);
    }
  };

  return (
    <ToolActivity
      tool={tool}
      disabled={disabled || tool.isError === undefined}
      onRerun={canRerun ? rerun : undefined}
    />
  );
}
