import { useState, useEffect, useRef, useCallback } from "react";
import { ErrorBoundary } from "./error";
import styles from "./mask.module.scss";
import { useNavigate } from "react-router-dom";
import { IconButton } from "./button";
import BackIcon from "../icons/left.svg";
import { useWorkspaceBack } from "./workspace-history";
import EyeIcon from "../icons/eye.svg";
import Locale from "../locales";
import { Path } from "../constant";

import { useChatStore } from "../store";
import { Select } from "./ui-lib";
import {
  getConversationSearchPlainText,
  searchConversation,
} from "../utils/conversation-search-parser";

type Item = {
  id: number;
  sessionId: string;
  messageId: string;
  name: string;
  content: string;
  highlightContent: string;
  timestamp?: number;
};

/** 转义 HTML 特殊字符，防止 XSS */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightText(text: string, query: string): string {
  // 先转义 HTML，再插入 <mark> 标签，防止 XSS
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return escaped.replace(regex, "<mark>$1</mark>");
}

export function SearchChatPage() {
  const navigate = useNavigate();
  const back = useWorkspaceBack();

  const chatStore = useChatStore();

  const sessions = chatStore.sessions;
  const selectSession = chatStore.selectSession;

  const [searchResults, setSearchResults] = useState<Item[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTime, setFilterTime] = useState("");
  const [filterSession, setFilterSession] = useState("");

  const previousValueRef = useRef<string>("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(
    (text: string, timeFilter: string = "", sessionFilter: string = "") => {
      const results: Item[] = [];

      const now = Date.now();
      const timeRanges: Record<string, number> = {
        today: 86400000,
        week: 604800000,
        month: 2592000000,
        year: 31536000000,
      };

      sessions.forEach((session, index) => {
        // Time filter
        if (timeFilter && timeRanges[timeFilter]) {
          const sessionTime = new Date(session.lastUpdate).getTime();
          if (now - sessionTime > timeRanges[timeFilter]) return;
        }

        // Session filter
        if (sessionFilter && session.topic !== sessionFilter) return;

        const fullTextContents: string[] = [];

        const matches = searchConversation(session.messages, text);
        matches.forEach((match) => {
          const content = getConversationSearchPlainText(
            session.messages[match.messageIndex],
          );
          const start = Math.max(0, match.start - 35);
          const end = Math.min(content.length, match.end + 35);
          fullTextContents.push(content.substring(start, end));
        });

        if (fullTextContents.length > 0) {
          const joinedContent = fullTextContents.join("... ");
          results.push({
            id: index,
            sessionId: session.id,
            messageId: matches[0].messageId,
            name: session.topic,
            content: joinedContent,
            highlightContent: highlightText(joinedContent.slice(0, 100), text),
            timestamp: session.lastUpdate,
          });
        }
      });

      // sort by timestamp (newest first)
      results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      return results;
    },
    [sessions],
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (searchInputRef.current) {
        const currentValue = searchInputRef.current.value;
        if (currentValue !== previousValueRef.current) {
          setSearchQuery(currentValue);
          if (currentValue.length > 0) {
            const result = doSearch(currentValue, filterTime, filterSession);
            setSearchResults(result);
          } else {
            setSearchResults([]);
          }
          previousValueRef.current = currentValue;
        }
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [doSearch, filterTime, filterSession]);

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (text.length > 0) {
      const result = doSearch(text, filterTime, filterSession);
      setSearchResults(result);
    } else {
      setSearchResults([]);
    }
  };

  const uniqueTopics = [...new Set(sessions.map((s) => s.topic))];

  return (
    <ErrorBoundary>
      <div className={styles["mask-page"]}>
        {/* header */}
        <div className="window-header">
          <IconButton
            icon={<BackIcon />}
            title="返回上一页"
            aria="返回上一页"
            onClick={back}
          />
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.SearchChat.Page.Title}
            </div>
            <div className="window-header-submai-title">
              {Locale.SearchChat.Page.SubTitle(searchResults.length)}
            </div>
          </div>

          <div className="window-actions"></div>
        </div>

        <div className={styles["mask-page-body"]}>
          <div className={styles["mask-filter"]}>
            <input
              type="text"
              className={styles["search-bar"]}
              placeholder={Locale.SearchChat.Page.Search}
              autoFocus
              ref={searchInputRef}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch(e.currentTarget.value);
                }
              }}
            />
            <Select
              className={styles["filter-select"]}
              aria-label={Locale.Gallery.TimeFilter.All}
              value={filterTime}
              onChange={(e) => {
                setFilterTime(e.target.value);
                if (searchQuery) {
                  const result = doSearch(
                    searchQuery,
                    e.target.value,
                    filterSession,
                  );
                  setSearchResults(result);
                }
              }}
            >
              <option value="">{Locale.Gallery.TimeFilter.All}</option>
              <option value="today">{Locale.Gallery.TimeFilter.Today}</option>
              <option value="week">{Locale.Gallery.TimeFilter.Week}</option>
              <option value="month">{Locale.Gallery.TimeFilter.Month}</option>
              <option value="year">{Locale.Gallery.TimeFilter.Year}</option>
            </Select>
            <Select
              className={styles["filter-select"]}
              aria-label={Locale.SearchChat.Page.AllSessions || "全部会话"}
              value={filterSession}
              onChange={(e) => {
                setFilterSession(e.target.value);
                if (searchQuery) {
                  const result = doSearch(
                    searchQuery,
                    filterTime,
                    e.target.value,
                  );
                  setSearchResults(result);
                }
              }}
            >
              <option value="">
                {Locale.SearchChat.Page.AllSessions || "全部会话"}
              </option>
              {uniqueTopics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </Select>
          </div>

          <div>
            {searchQuery && searchResults.length === 0 ? (
              <div className={styles["search-empty"]}>
                <div className={styles["search-empty-icon"]}>🔍</div>
                <div className={styles["search-empty-text"]}>
                  {Locale.SearchChat.Page.NoResult}
                </div>
              </div>
            ) : (
              searchResults.map((item) => (
                <div
                  className={styles["mask-item"]}
                  key={item.id}
                  onClick={() => {
                    const index = useChatStore
                      .getState()
                      .sessions.findIndex(
                        (session) => session.id === item.sessionId,
                      );
                    if (index < 0) return;
                    selectSession(index);
                    navigate(Path.Chat, {
                      state: {
                        searchSessionId: item.sessionId,
                        searchMessageId: item.messageId,
                        searchQuery,
                      },
                    });
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <div className={styles["mask-header"]}>
                    <div className={styles["mask-title"]}>
                      <div className={styles["mask-name"]}>{item.name}</div>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: item.highlightContent,
                        }}
                      />
                    </div>
                  </div>
                  <div className={styles["mask-actions"]}>
                    <IconButton
                      icon={<EyeIcon />}
                      text={Locale.SearchChat.Item.View}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
