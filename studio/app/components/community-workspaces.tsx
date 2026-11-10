"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Video } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppConfig, useChatStore } from "../store";
import { getLang } from "../locales";
import { Path } from "../constant";
import { startCommunityChat, type CommunityEntry } from "../utils/community-entry";
import { getLocalScope, isLocalWorkspaceActive } from "../utils/local-workspace";
import { showToast } from "./ui-lib";
import styles from "./community-workspaces.module.scss";

const modules = [
  { kind: "text", zh: "文本", en: "Text", icon: FileText, model: "gpt-6.1-sol" },
  { kind: "image", zh: "图片", en: "Image", icon: ImageIcon, model: "gpt-image-2.6" },
  { kind: "video", zh: "视频", en: "Video", icon: Video, model: "" },
] as const;

export function CommunityWorkspaces({ entry, narrow }: { entry: CommunityEntry; narrow?: boolean }) {
  const english = getLang() === "en";
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const selected = useChatStore(state => state.sessions[state.currentSessionIndex]?.communityWorkspaceKind);
  const [busy, setBusy] = useState<CommunityEntry["kind"]>();
  const switching = useRef(false);
  const mounted = useRef(true);
  const owner = useRef(getLocalScope());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const open = async (item: typeof modules[number]) => {
    if (switching.current || !isLocalWorkspaceActive() || getLocalScope() !== owner.current) return;
    switching.current = true;
    setBusy(item.kind);
    try {
      await startCommunityChat({ ...entry, kind: item.kind, model: entry.defaultModels?.[item.kind] ?? (entry.kind === item.kind ? entry.model : item.model) }, useAppConfig.getState().models);
      if (mounted.current && isLocalWorkspaceActive() && getLocalScope() === owner.current) navigate(Path.Chat);
    } catch {
      if (mounted.current) showToast(english ? "Could not open this module. Please try again." : "暂时无法打开制作栏，请重试。");
    } finally {
      switching.current = false;
      if (mounted.current) setBusy(undefined);
    }
  };

  return (
    <nav className={styles.modules} data-narrow={narrow || undefined} aria-label={english ? "Creation modules" : "制作栏"} data-testid="creation-modules" aria-busy={!!busy}>
      {!narrow && <h2 className={styles.heading}>{english ? "Creation modules" : "制作栏"}</h2>}
      {modules.map(item => {
        const Icon = item.icon;
        const active = selected === item.kind && [Path.Chat, Path.Home].includes(pathname as Path);
        return <button key={item.kind} type="button" className={styles.module} data-creation-kind={item.kind} aria-current={active ? "page" : undefined} disabled={!!busy} title={english ? item.en : item.zh} aria-label={english ? item.en : item.zh} onClick={() => void open(item)}>
          <Icon size={18} aria-hidden="true"/>
          {!narrow && <span>{english ? item.en : item.zh}</span>}
          {!narrow && busy === item.kind && <span className={styles.loading}>{english ? "Opening…" : "打开中…"}</span>}
        </button>;
      })}
    </nav>
  );
}
