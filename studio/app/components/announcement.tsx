"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import styles from "./announcement.module.scss";
import { SelectionDialog } from "./selection-dialog";
import { sanitizeHtml } from "../utils/html-sanitize";
import {
  loadDailyIndex,
  loadDailyReport,
  type DailyEntry,
  type DailyReport,
} from "../utils/ai-daily";

interface PlatformAnnouncement {
  id: string;
  title: string;
  content: string;
  type?: "info" | "warning" | "update";
}

let globalShowAnnouncement: (() => void) | null = null;

export function triggerAnnouncement() {
  globalShowAnnouncement?.();
}

function DailyContent({ entry }: { entry: DailyEntry }) {
  const [report, setReport] = useState<DailyReport>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    loadDailyReport(entry.date)
      .then((value) => {
        if (active) setReport(value);
      })
      .catch(() => {
        if (active) setError("日报详情暂时无法读取");
      });
    return () => {
      active = false;
    };
  }, [entry.date, attempt]);

  return (
    <div className={styles.detail}>
      <p className={styles.credit}>
        来源：
        <a href={entry.links.aihot} target="_blank" rel="noopener noreferrer">
          {entry.attribution?.name || "AIHOT"}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </p>
      {!report && !error && <p role="status">正在读取日报…</p>}
      {error && (
        <div className={styles.status} role="status">
          {error}
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={14} aria-hidden="true" />
            重试
          </button>
        </div>
      )}
      {report && (
        <>
          {report.lead?.title && <h3>{report.lead.title}</h3>}
          {report.lead?.leadParagraph && <p>{report.lead.leadParagraph}</p>}
          {[
            ...report.sections,
            ...(report.flashes?.length
              ? [{ label: "简讯", items: report.flashes }]
              : []),
          ].map((section, index) => (
            <section key={index} className={styles.section}>
              <h3>{section.label}</h3>
              {section.items.map((item, itemIndex) => (
                <article key={itemIndex} className={styles.newsItem}>
                  <h4>
                    <a
                      href={item.links.aihot}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.title}
                    </a>
                  </h4>
                  {item.summary && <p>{item.summary}</p>}
                  <div className={styles.credit}>
                    <span>{item.source.name}</span>
                    {item.publishedAt &&
                      !Number.isNaN(Date.parse(item.publishedAt)) && (
                        <time dateTime={item.publishedAt}>
                          {new Date(item.publishedAt).toLocaleString("zh-CN", {
                            timeZone: "Asia/Shanghai",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </time>
                      )}
                    {item.links.original && (
                      <a
                        href={item.links.original}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        原文
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function AnnouncementList() {
  const [announcement, setAnnouncement] = useState<PlatformAnnouncement | null>(
    null,
  );
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [platformError, setPlatformError] = useState(false);
  const [expanded, setExpanded] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadDailyIndex()
      .then((data) => {
        if (active) setEntries(data);
      })
      .catch(() => {
        if (active) setError("AI 日报暂时无法读取，请稍后重试");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    fetch("/studio/api/announcement", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("公告读取失败");
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const value = data?.announcement;
        if (
          value &&
          typeof value.id === "string" &&
          typeof value.title === "string" &&
          typeof value.content === "string"
        ) {
          setAnnouncement(value);
        }
      })
      .catch(() => {
        if (active) setPlatformError(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  const toggle = (id: string) =>
    setExpanded((current) => (current === id ? "" : id));

  return (
    <div className={styles.content}>
      {announcement && (
        <article className={styles.entry}>
          <button
            type="button"
            className={styles.summary}
            aria-expanded={expanded === "platform"}
            aria-controls="platform-announcement-content"
            onClick={() => toggle("platform")}
          >
            <span className={styles.title}>
              平台公告－
              {announcement.title.replace(/^平台公告[－\-—：:]\s*/, "")}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {expanded === "platform" && (
            <div
              id="platform-announcement-content"
              className={styles.detail}
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(announcement.content),
              }}
            />
          )}
        </article>
      )}
      {platformError && <p role="status">平台公告暂时无法读取</p>}
      {entries.map((entry) => (
        <article key={entry.date} className={styles.entry}>
          <button
            type="button"
            className={styles.summary}
            aria-expanded={expanded === entry.date}
            aria-controls={`ai-daily-${entry.date}`}
            onClick={() => toggle(entry.date)}
          >
            <span className={styles.summaryText}>
              <span className={styles.title}>AI 日报－{entry.date}</span>
              {entry.leadTitle && (
                <span className={styles.excerpt}>{entry.leadTitle}</span>
              )}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {expanded === entry.date && (
            <div id={`ai-daily-${entry.date}`}>
              <DailyContent entry={entry} />
            </div>
          )}
        </article>
      ))}
      {loading && <p role="status">正在读取 AI 日报…</p>}
      {error && (
        <div className={styles.status} role="status">
          {error}
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={14} aria-hidden="true" />
            重试
          </button>
        </div>
      )}
      {!loading && !error && entries.length === 0 && <p>暂无 AI 日报</p>}
    </div>
  );
}

export function Announcement() {
  const [visible, setVisible] = useState(false);
  const show = useCallback(() => setVisible(true), []);

  useEffect(() => {
    globalShowAnnouncement = show;
    return () => {
      globalShowAnnouncement = null;
    };
  }, [show]);

  if (!visible) return null;
  return (
    <SelectionDialog title="公告与日报" onClose={() => setVisible(false)}>
      <AnnouncementList />
    </SelectionDialog>
  );
}
