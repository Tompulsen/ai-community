"use client";

import { useEffect, useState } from "react";
import { Globe, Search, X, Zap } from "lucide-react";
import { useChatStore } from "../store/chat";
import { useSkillStore } from "../store/skills";
import { getWebSearchMode, type WebSearchMode } from "../utils/web-search";
import { ChatAction } from "./chat-action";
import { SelectionDialog } from "./selection-dialog";
import { useSkillCapabilities } from "./skill-ui";
import styles from "./skills-market.module.scss";

const options = [
  { mode: "off", label: "关闭联网", Icon: X },
  { mode: "quick", label: "快速搜索", Icon: Zap },
  { mode: "deep", label: "深度搜索", Icon: Search },
] as const;

export function WebSearchAction({
  sessionId,
  onOpen,
}: {
  sessionId: string;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const session = useChatStore((state) =>
    state.sessions.find((entry) => entry.id === sessionId),
  );
  const legacySkill = useSkillStore((state) =>
    session?.activeSkillId ? state.installed[session.activeSkillId] : undefined,
  );
  const mode = getWebSearchMode(session ?? {}, legacySkill);
  const capabilities = useSkillCapabilities(open);
  useEffect(() => setOpen(false), [sessionId]);

  function select(next: WebSearchMode) {
    if (!session) return;
    useChatStore.getState().updateTargetSession(session, (target) => {
      target.webSearchMode = next;
      if (legacySkill?.kind === "web") target.activeSkillId = undefined;
    });
    setOpen(false);
  }

  return (
    <div className={styles.skillPicker}>
      <ChatAction
        text={mode === "deep" ? "深度联网" : "联网"}
        title={`联网搜索：${options.find((option) => option.mode === mode)
          ?.label}`}
        icon={<Globe size={16} />}
        showLabel
        selected={mode !== "off"}
        expanded={open}
        controls="composer-web-search"
        disabled={!session}
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      />
      {open && (
        <SelectionDialog
          id="composer-web-search"
          title="联网搜索"
          compact
          onClose={() => setOpen(false)}
        >
          <div className={styles.pickerList}>
            {options.map(({ mode: next, label, Icon }) => (
              <button
                key={next}
                type="button"
                className={styles.pickerOption}
                aria-pressed={mode === next}
                data-autofocus={mode === next ? "" : undefined}
                disabled={next !== "off" && !capabilities?.web}
                onClick={() => select(next)}
              >
                <Icon size={18} aria-hidden="true" />
                <span className={styles.pickerName}>{label}</span>
              </button>
            ))}
            {!capabilities ? (
              <div className={styles.pickerEmpty} role="status">
                正在检查联网服务
              </div>
            ) : !capabilities.web ? (
              <div className={styles.pickerEmpty} role="status">
                联网搜索暂不可用，请检查登录状态或联系管理员
              </div>
            ) : null}
          </div>
        </SelectionDialog>
      )}
    </div>
  );
}
