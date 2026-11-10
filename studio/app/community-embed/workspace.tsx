"use client";

import { ComponentType, useEffect, useState } from "react";
import { installCommunityRemix } from "../utils/community-remix";
import { installCommunityShare } from "../utils/community-share";
import type { CommunityEntry } from "../utils/community-entry";

// This module deliberately does not import Home, stores or account clients.
// They are evaluated only after an independent request verifies the partitioned cookie.
export function CommunityEmbed({
  communityOrigin,
}: {
  communityOrigin: string;
}) {
  const [Workspace, setWorkspace] = useState<ComponentType<{ embedded?: boolean; communityEntry?: CommunityEntry }> | null>(null);
  const [entry, setEntry] = useState<CommunityEntry>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const context = query.get("context") || "",
      attempt = query.get("attempt") || "",
      kind = query.get("kind") || "";
    const valid =
      /^[A-Za-z0-9_-]{43}$/.test(context) &&
      /^[a-zA-Z0-9-]{36}$/.test(attempt) &&
      ["text", "image", "video"].includes(kind) &&
      communityOrigin &&
      window.parent !== window;
    if (!valid) {
      setError(true);
      return;
    }
    let stopped = false,
      started = false,
      expectedSubject = "",
      expectedUserId = "",
      active = false;
    let changingWorkspace = false;
    let queuedEntry: CommunityEntry | undefined;
    const selectWorkspace = (next: CommunityEntry) => {
      if (changingWorkspace) { queuedEntry = next; return; }
      changingWorkspace = true;
      setEntry(next);
      window.location.hash = "/chat";
    };
    let disposeShare: (() => void) | undefined;
    let disposeRemix: (() => void) | undefined;
    const abort = new AbortController();
    const nativeFetch = window.fetch.bind(window);
    const send = (data: object) => {
      if (!stopped)
        window.parent.postMessage(
          { type: "community-studio", context, attempt, ...data },
          communityOrigin,
        );
    };
    const fail = (code: string) => {
      disposeShare?.();
      disposeRemix?.();
      active = false;
      abort.abort();
      setWorkspace(null);
      setError(true);
      send({ status: "error", code });
    };
    const api = async (path: string, body?: object) => {
      const response = await nativeFetch(
        `/studio/api/new-api/community/embedded/${path}`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: abort.signal,
          headers: {
            "Content-Type": "application/json",
            "x-community-embed": context,
          },
          body: JSON.stringify(body || {}),
        },
      );
      const data = await response.json();
      if (!response.ok || data.status === "error")
        throw new Error(data.code || "COMMUNITY_CONNECTION_FAILED");
      return data;
    };
    const adaptedFetch: typeof fetch = async (input, init) => {
      const target = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      if (
        target.origin !== window.location.origin ||
        !target.pathname.startsWith("/studio/api/")
      )
        return nativeFetch(input, init);
      if (!active) throw new Error("Community session is not ready");
      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined),
      );
      headers.set("x-community-embed", context);
      if (!headers.has("x-new-api-user"))
        headers.set("x-new-api-user", expectedSubject);
      const originalSignal =
        init?.signal || (input instanceof Request ? input.signal : undefined);
      const signal = originalSignal
        ? (AbortSignal as typeof AbortSignal & { any(signals: AbortSignal[]): AbortSignal }).any([abort.signal, originalSignal])
        : abort.signal;
      const response = await nativeFetch(input, {
        ...init,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (response.status === 401) fail("COMMUNITY_ACCOUNT_CHANGED");
      return response;
    };
    const receive = async (event: MessageEvent) => {
      const data = event.data;
      if (active && event.origin === communityOrigin && event.source === window.parent && data?.type === "community-workspace" && data.context === context && data.attempt === attempt && data.subject === expectedSubject && data.userId === expectedUserId && /^[a-zA-Z0-9-]{36}$/.test(data.requestId || "") && ["text", "image", "video"].includes(data.kind)) {
        const model = typeof data.defaultModel === "string" && data.defaultModel.length <= 100 && !/\s/.test(data.defaultModel) ? data.defaultModel : "";
        const defaultModels: CommunityEntry["defaultModels"] = {};
        for (const kind of ["text", "image", "video"] as const) {
          const value = data.defaultModels?.[kind];
          if (typeof value === "string" && value.length <= 100 && !/\s/.test(value)) defaultModels[kind] = value;
        }
        selectWorkspace({ id: data.requestId, kind: data.kind, model, defaultModels });
        return;
      }
      if (
        started ||
        event.origin !== communityOrigin ||
        event.source !== window.parent ||
        !data ||
        data.type !== "community-launch" ||
        data.context !== context ||
        data.attempt !== attempt ||
        typeof data.code !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(data.code)
      )
        return;
      started = true;
      try {
        const initialized = await api("init", { code: data.code });
        if (stopped) return;
        if (
          initialized.subject !== data.subject ||
          initialized.userId !== data.userId ||
          initialized.kind !== kind
        )
          throw new Error("COMMUNITY_ACCOUNT_CHANGED");
        if (initialized.status === "authorize") {
          send(initialized);
          return;
        }
        if (initialized.status !== "verify")
          throw new Error("COMMUNITY_CONNECTION_FAILED");
        let verified;
        try {
          verified = await api("verify");
        } catch {
          throw new Error("COMMUNITY_STORAGE_BLOCKED");
        }
        if (stopped) return;
        if (
          verified.context !== context ||
          verified.subject !== data.subject ||
          verified.userId !== data.userId
        )
          throw new Error("COMMUNITY_ACCOUNT_CHANGED");
        expectedSubject = verified.subject;
        expectedUserId = verified.userId;
        active = true;
        window.fetch = adaptedFetch;
        disposeShare = installCommunityShare(communityOrigin, { context, attempt, subject: verified.subject, userId: verified.userId });
        disposeRemix = installCommunityRemix(communityOrigin, { context, attempt, subject: verified.subject, userId: verified.userId });
        send({
          status: "loading", phase: "workspace",
          subject: verified.subject, userId: verified.userId,
        });
        window.location.hash = "/chat";
        const defaults = { text: "gpt-6.1-sol", image: "gpt-image-2.6", video: "" };
        const model = typeof data.defaultModel === "string" && data.defaultModel.length <= 100 && !/\s/.test(data.defaultModel) ? data.defaultModel : defaults[kind as keyof typeof defaults];
        const defaultModels = { ...defaults };
        for (const type of ["text", "image", "video"] as const) {
          const value = data.defaultModels?.[type];
          if (typeof value === "string" && value.length <= 100 && !/\s/.test(value)) defaultModels[type] = value;
        }
        defaultModels[kind as keyof typeof defaults] = model;
        selectWorkspace({ id: attempt, kind: kind as CommunityEntry["kind"], model, defaultModels });
        const { Home } = await import("../components/home");
        if (stopped || !active) return;
        setWorkspace(() => Home);
        send(verified);
      } catch (error) {
        if (!stopped)
          fail(
            error instanceof Error
              ? error.message
              : "COMMUNITY_CONNECTION_FAILED",
          );
      }
    };
    const workspaceReady = (event: Event) => {
      const entry = (event as CustomEvent<CommunityEntry>).detail;
      if (!active) return;
      send({ status: "workspace-ready", kind: entry.kind, requestId: entry.id, subject: expectedSubject, userId: expectedUserId });
      changingWorkspace = false;
      if (queuedEntry) { const next = queuedEntry; queuedEntry = undefined; selectWorkspace(next); }
    };
    window.addEventListener("community-workspace-ready", workspaceReady);
    window.addEventListener("message", receive);
    send({ status: "hello" });
    return () => {
      stopped = true;
      disposeShare?.();
      disposeRemix?.();
      active = false;
      abort.abort();
      if (window.fetch === adaptedFetch) window.fetch = nativeFetch;
      window.removeEventListener("message", receive);
      window.removeEventListener("community-workspace-ready", workspaceReady);
    };
  }, [communityOrigin]);
  if (Workspace) return <Workspace embedded communityEntry={entry} />;
  return (
    <main
      role={error ? "alert" : "status"}
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeContent: "center",
        padding: 24,
        fontFamily: "system-ui",
      }}
    >
      {error
        ? "请在社区重新连接制作空间 · Reconnect from the community"
        : "正在确认创作账号… · Connecting your account…"}
    </main>
  );
}
