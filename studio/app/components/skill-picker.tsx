"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { Path } from "../constant";
import { useSkillStore } from "../store/skills";
import { useChatStore } from "../store/chat";
import { ChatAction } from "./chat-action";
import { SelectionDialog } from "./selection-dialog";
import { SkillIcon, unavailableReason, useSkillCapabilities } from "./skill-ui";
import styles from "./skills-market.module.scss";

export function SkillPicker({
  sessionId,
  isImage,
  onOpen,
}: {
  sessionId: string;
  isImage: boolean;
  onOpen: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const installed = useSkillStore((state) => state.installed);
  const hydrated = useSkillStore((state) => state._hasHydrated);
  const session = useChatStore((state) =>
    state.sessions.find((entry) => entry.id === sessionId),
  );
  const skills = Object.values(installed).filter(
    (skill) =>
      skill.enabled &&
      skill.kind !== "web" &&
      (isImage
        ? skill.kind === "image-style"
        : skill.kind !== "image-style" && skill.kind !== "client"),
  );
  const capabilities = useSkillCapabilities(
    open && skills.some((skill) => skill.kind === "papers"),
  );
  const selected = skills.find((skill) => skill.id === session?.activeSkillId);

  function close() {
    setOpen(false);
  }

  useEffect(() => setOpen(false), [sessionId, isImage]);

  return (
    <div className={styles.skillPicker}>
      <ChatAction
        text={selected?.name || "技能"}
        title={selected ? `技能：${selected.name}` : "技能"}
        icon={<Sparkles size={16} />}
        showLabel
        selected={!!selected}
        expanded={open}
        controls="composer-skills"
        onClick={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      />
      {open && (
        <SelectionDialog
          id="composer-skills"
          title="已启用技能"
          compact
          onClose={close}
        >
          <div
            className={styles.pickerList}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              if (!buttons.length) return;
              event.preventDefault();
              event.stopPropagation();
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                  buttons.length
              ]?.focus();
            }}
          >
            <button
              type="button"
              className={styles.pickerOption}
              aria-pressed={!selected}
              data-autofocus={!selected ? "" : undefined}
              disabled={!session}
              onClick={() => {
                if (!session) return;
                useChatStore
                  .getState()
                  .updateTargetSession(session, (target) => {
                    target.activeSkillId = undefined;
                  });
                close();
              }}
            >
              <X size={18} />
              <span className={styles.pickerInfo}>
                <span className={styles.pickerName}>不使用技能</span>
                <span className={styles.pickerDescription}>直接与模型对话</span>
              </span>
            </button>
            {!hydrated || !skills.length ? (
              <div className={styles.pickerEmpty}>
                <span>{hydrated ? "暂无已启用技能" : "正在读取技能"}</span>
                {hydrated && (
                  <button
                    type="button"
                    className={styles.pickerBrowse}
                    onClick={() => {
                      close();
                      navigate(Path.Skills);
                    }}
                  >
                    前往技能广场挑选
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : (
              skills.map((skill) => {
                const active = selected?.id === skill.id;
                const reason = unavailableReason(skill, capabilities);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    className={styles.pickerOption}
                    aria-label={skill.name}
                    aria-pressed={active}
                    data-autofocus={active ? "" : undefined}
                    disabled={!session || (!!reason && !active)}
                    title={reason || skill.description}
                    onClick={() => {
                      if (!session) return;
                      useChatStore
                        .getState()
                        .updateTargetSession(session, (target) => {
                          target.activeSkillId = skill.id;
                        });
                      close();
                    }}
                  >
                    <SkillIcon kind={skill.kind} category={skill.category} />
                    <span className={styles.pickerInfo}>
                      <span className={styles.pickerName}>{skill.name}</span>
                      <span className={styles.pickerDescription}>
                        {reason || skill.description}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </SelectionDialog>
      )}
    </div>
  );
}
