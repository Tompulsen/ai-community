"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  Code2,
  FilePenLine,
  Globe,
  Languages,
  Lightbulb,
  Palette,
} from "lucide-react";
import { getHeaders } from "../client/api";
import type { SkillDefinition } from "../skills/catalog";

type Capabilities = { web: boolean; papers: boolean };

export function useSkillCapabilities(enabled = true) {
  const [capabilities, setCapabilities] = useState<Capabilities>();
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/studio/api/skills/capabilities", {
      headers: getHeaders(),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取检索服务状态");
        const result = await response.json();
        if (!controller.signal.aborted) {
          setCapabilities({
            web: result.web === true,
            papers: result.papers === true,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCapabilities({ web: false, papers: false });
        }
      });
    return () => controller.abort();
  }, [enabled]);
  return capabilities;
}

export function unavailableReason(
  skill: SkillDefinition,
  capabilities: Capabilities | undefined,
) {
  if (skill.kind !== "web" && skill.kind !== "papers") return "";
  if (!capabilities) return "正在检查检索服务";
  if (skill.kind === "web" && !capabilities.web) {
    return "联网搜索暂未开放";
  }
  if (skill.kind === "papers" && !capabilities.papers) {
    return "论文检索服务暂不可用，请刷新重试";
  }
  return "";
}

export function SkillIcon({
  kind,
  category,
}: Pick<SkillDefinition, "kind" | "category">) {
  const Icon =
    kind === "image-style"
      ? Palette
      : kind === "papers"
      ? BookOpen
      : kind === "web"
      ? Globe
      : category === "writing"
      ? FilePenLine
      : category === "coding"
      ? Code2
      : category === "productivity"
      ? Lightbulb
      : Languages;
  return <Icon size={18} aria-hidden="true" />;
}
