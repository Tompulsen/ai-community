"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useNavigate } from "react-router-dom";
import Locale from "../locales";
import { Path } from "../constant";
import { useChatStore } from "../store";
import { useMaskStore } from "../store/mask";
import {
  getLocalScope,
  isLocalWorkspaceActive,
} from "../utils/local-workspace";
import { IconButton } from "./button";
import { ListItem, Modal, showConfirm, useModalClose } from "./ui-lib";
import ReloadIcon from "../icons/reload.svg";
import CopyIcon from "../icons/copy.svg";

const MaskConfig = dynamic(
  async () => (await import("./mask-config")).MaskConfig,
  { ssr: false, loading: () => null },
);

export function SessionConfigModel(props: {
  sessionId?: string;
  onClose: () => void;
}) {
  const [target] = useState(() => {
    const state = useChatStore.getState();
    return {
      id: props.sessionId ?? state.sessions[state.currentSessionIndex]?.id,
      owner: getLocalScope(),
    };
  });
  const session = useChatStore((state) =>
    state.sessions.find((item) => item.id === target.id),
  );
  const navigate = useNavigate();
  const mounted = useRef(true);
  const closing = useRef(false);
  const { maskRef, requestClose } = useModalClose(props.onClose);
  const close = useCallback(
    (afterClose?: () => void) => {
      if (closing.current) return;
      closing.current = true;
      requestClose(afterClose);
    },
    [requestClose],
  );
  const isWorkspaceCurrent = () =>
    isLocalWorkspaceActive() && getLocalScope() === target.owner;
  const readTarget = () => {
    if (!mounted.current || closing.current || !isWorkspaceCurrent()) return;
    return useChatStore
      .getState()
      .sessions.find((item) => item.id === target.id);
  };

  useEffect(() => {
    mounted.current = true;
    const invalidate = () => close();
    window.addEventListener("local-workspace-switch", invalidate);
    window.addEventListener("local-data-maintenance", invalidate);
    return () => {
      mounted.current = false;
      window.removeEventListener("local-workspace-switch", invalidate);
      window.removeEventListener("local-data-maintenance", invalidate);
    };
  }, [close]);
  useEffect(() => {
    if (
      !session ||
      !isLocalWorkspaceActive() ||
      getLocalScope() !== target.owner
    )
      close();
  }, [session, target, close]);

  if (!session) return null;

  return createPortal(
    <div
      className="modal-mask"
      ref={maskRef}
      data-session-config-id={target.id}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <Modal
        title={
          props.sessionId
            ? `${session.topic} · ${Locale.Chat.InputActions.ChatSettings}`
            : Locale.Context.Edit
        }
        onClose={() => close()}
        actions={[
          <IconButton
            key="reset"
            icon={<ReloadIcon />}
            bordered
            text={Locale.Chat.Config.Reset}
            onClick={async () => {
              if (!readTarget()) return;
              if (!(await showConfirm(Locale.Memory.ResetConfirm))) return;
              const current = readTarget();
              if (current)
                useChatStore.getState().updateTargetSession(current, (item) => {
                  item.memoryPrompt = "";
                });
            }}
          />,
          <IconButton
            key="copy"
            icon={<CopyIcon />}
            bordered
            text={Locale.Chat.Config.SaveAs}
            onClick={() => {
              const current = readTarget();
              if (!current) return;
              useMaskStore.getState().create(structuredClone(current.mask));
              close(() => {
                if (mounted.current && isWorkspaceCurrent())
                  navigate(Path.Masks);
              });
            }}
          />,
        ]}
      >
        <MaskConfig
          mask={session.mask}
          hideReasoningEffort
          updateMask={(updater) => {
            const current = readTarget();
            if (!current) return;
            useChatStore.getState().updateTargetSession(current, (item) => {
              const mask = { ...item.mask };
              updater(mask);
              item.mask = mask;
            });
          }}
          shouldSyncFromGlobal
          extraListItems={
            <ListItem
              title={`${Locale.Memory.Title} · 已处理 ${session.lastSummarizeIndex} 条消息`}
            ></ListItem>
          }
        ></MaskConfig>
      </Modal>
    </div>,
    document.body,
  );
}
