"use client";

import { useSyncExternalStore } from "react";
import { Send } from "lucide-react";
import { getLang } from "../locales";
import { prepareShare, shareState, shareToCommunity, subscribeShare, type ShareIntent, type ShareSource } from "../utils/community-share";
import { showToast } from "./ui-lib";
import styles from "./community-share-button.module.scss";

export function CommunityShareButton({ kind, source, sourceWorkId, resultId }: { kind: ShareSource["kind"]; source: () => ShareSource | Promise<ShareSource>; sourceWorkId?: string; resultId?: string }) {
  const state = useSyncExternalStore(subscribeShare, shareState, () => "unavailable");
  if (state === "unavailable") return null;
  const english = getLang() === "en";
  const label = english ? "Publish to community" : "发布到社区";
  const share = async (destination: ShareIntent["destination"] = "community") => {
    const intent = { destination, resultId, sourceWorkId };
    try {
      await shareToCommunity(async (limits, signal) => prepareShare(await source(), limits, signal, intent), intent);
    } catch (error) {
      const code = error instanceof Error ? error.message : "failed";
      showToast(code === "tooLarge"
        ? (english ? "This file exceeds the community upload limit. Try a smaller file." : "作品超过社区上传限制，请缩小文件后重试。")
        : code === "videoComment" ? (english ? "Videos can be published to the community, but cannot be sent to comments." : "视频可发布到社区，不能发送至评论区。")
        : code === "tooMany" ? (english ? "Share up to 16 attachments at a time." : "一次最多分享 16 个附件，请分批分享。")
        : (english ? "Could not prepare this work. Check that the original is still available, then retry." : "未能读取作品，请确认原作品仍可访问后重试。"));
    }
  };
  return <span className={styles.actions}><button type="button" className={styles.share} aria-label={label} title={label} disabled={state === "busy"} data-testid="publish-to-community" onClick={(event) => { event.stopPropagation(); void share(); }}><Send size={15} aria-hidden="true"/><span>{state === "busy" ? (english ? "Sharing…" : "分享中…") : label}</span></button>{kind !== "video" && sourceWorkId && resultId && <button type="button" className={styles.share} disabled={state === "busy"} data-testid="send-to-source-comment" onClick={(event) => { event.stopPropagation(); void share("source-comment"); }}><Send size={15} aria-hidden="true"/><span>{english ? "Send to original comments" : "发送到源作品评论区"}</span></button>}</span>;
}
