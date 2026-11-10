"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadConversationSearch,
  type ConversationSearchMatch,
  type ConversationSearchMessage,
} from "./conversation-search";

type SearchRequest = {
  sessionId: string;
  messages: readonly ConversationSearchMessage[];
  revision: object;
  query: string;
  open: boolean;
};

const noMatches: readonly ConversationSearchMatch[] = [];

export function useConversationSearch(request: SearchRequest) {
  const { sessionId, messages, revision, query, open } = request;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    (SearchRequest & { matches: ConversationSearchMatch[] }) | undefined
  >();
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!open) {
      setResult(undefined);
      return;
    }
    let active = true;
    void loadConversationSearch()
      .then((parser) => {
        if (!active) return;
        setResult({
          sessionId,
          messages,
          revision,
          query,
          open,
          matches: parser.searchConversation(messages, query),
        });
      })
      .catch(() => {
        if (active) setResult(undefined);
      });
    return () => {
      active = false;
    };
  }, [sessionId, messages, revision, query, open, attempt]);

  const ready =
    open &&
    result?.open === open &&
    result.sessionId === sessionId &&
    result.messages === messages &&
    result.revision === revision &&
    result.query === query;

  return { matches: ready ? result.matches : noMatches, ready, refresh };
}
