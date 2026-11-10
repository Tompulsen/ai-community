import React from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { jest } from "@jest/globals";
import { ConversationSearch } from "../app/components/conversation-search";
import type {
  ConversationSearchMessage,
  ConversationSearchParser,
} from "../app/utils/conversation-search";

const load = jest.fn<() => Promise<ConversationSearchParser>>();
jest.unstable_mockModule("@/app/utils/conversation-search", () => ({
  loadConversationSearch: load,
}));
const { useConversationSearch } = await import(
  "../app/utils/use-conversation-search"
);
type SearchRequest = Parameters<typeof useConversationSearch>[0];

const parser: ConversationSearchParser = {
  getConversationSearchPlainText: jest.fn<
    ConversationSearchParser["getConversationSearchPlainText"]
  >(() => ""),
  searchConversation: jest.fn<ConversationSearchParser["searchConversation"]>(
    (messages, query) =>
      query.trim()
        ? messages.flatMap((message, messageIndex) => {
            const start =
              typeof message.content === "string"
                ? message.content.indexOf(query)
                : -1;
            return start < 0
              ? []
              : [
                  {
                    messageId: message.id,
                    messageIndex,
                    start,
                    end: start + query.length,
                  },
                ];
          })
        : [],
  ),
};

function messages(
  id = "one",
  content = "needle",
): ConversationSearchMessage[] {
  return [{ id, role: "assistant", content }];
}

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    sessionId: "session-one",
    messages: messages(),
    revision: {},
    query: "needle",
    open: true,
    ...overrides,
  };
}

function delayedParser() {
  let resolve!: (value: ConversationSearchParser) => void;
  const promise = new Promise<ConversationSearchParser>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

beforeEach(() => {
  load.mockReset().mockResolvedValue(parser);
  jest.mocked(parser.searchConversation).mockClear();
});
afterEach(cleanup);

test("opening the toolbar focuses its input before the parser arrives", async () => {
  const pending = delayedParser();
  load.mockReturnValue(pending.promise);
  const initial = request({ open: false });
  function Fixture(props: SearchRequest) {
    const search = useConversationSearch(props);
    return (
      <ConversationSearch
        open={props.open}
        query={props.query}
        matches={search.matches}
        currentIndex={search.matches.length ? 0 : -1}
        onChange={() => {}}
        onNavigate={() => {}}
        onClose={() => {}}
        onFocus={search.refresh}
      />
    );
  }
  const { rerender } = render(<Fixture {...initial} />);
  expect(load).not.toHaveBeenCalled();
  rerender(<Fixture {...initial} open />);
  expect(screen.getByRole("searchbox")).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("0 / 0");
  await act(async () => pending.resolve(parser));
  expect(screen.getByRole("status")).toHaveTextContent("1 / 1");
});

test("a late load searches only the latest query", async () => {
  const pending = delayedParser();
  load.mockReturnValue(pending.promise);
  const initial = request({ messages: messages("one", "needle newest") });
  const { result, rerender } = renderHook(useConversationSearch, {
    initialProps: initial,
  });
  rerender({ ...initial, query: "newest" });
  expect(result.current.matches).toEqual([]);
  await act(async () => pending.resolve(parser));
  expect(parser.searchConversation).toHaveBeenCalledTimes(1);
  expect(parser.searchConversation).toHaveBeenCalledWith(
    initial.messages,
    "newest",
  );
  expect(result.current.matches[0]).toMatchObject({ start: 7, end: 13 });
});

test.each(["clear", "close"] as const)(
  "%s invalidates an outstanding search before its parser arrives",
  async (action) => {
    const pending = delayedParser();
    load.mockReturnValue(pending.promise);
    const initial = request();
    const { result, rerender } = renderHook(useConversationSearch, {
      initialProps: initial,
    });
    rerender({
      ...initial,
      ...(action === "clear" ? { query: "" } : { open: false }),
    });
    expect(result.current.matches).toEqual([]);
    await act(async () => pending.resolve(parser));
    expect(result.current.matches).toEqual([]);
    expect(parser.searchConversation).not.toHaveBeenCalledWith(
      initial.messages,
      "needle",
    );
  },
);

test("switching sessions while loading cannot publish the previous session's results", async () => {
  const pending = delayedParser();
  load.mockReturnValue(pending.promise);
  const initial = request();
  const next = request({
    sessionId: "session-two",
    messages: messages("two"),
  });
  const { result, rerender } = renderHook(useConversationSearch, {
    initialProps: initial,
  });
  rerender(next);
  await act(async () => pending.resolve(parser));
  expect(result.current.matches.map((match) => match.messageId)).toEqual([
    "two",
  ]);
  expect(parser.searchConversation).toHaveBeenCalledTimes(1);
});

test("branch changes discard old matches and a session revision refreshes in-place message edits", async () => {
  const initial = request();
  const { result, rerender } = renderHook(useConversationSearch, {
    initialProps: initial,
  });
  await waitFor(() => expect(result.current.ready).toBe(true));
  const next = request({ messages: messages("branch-two", "other") });
  rerender(next);
  expect(result.current.matches).toEqual([]);
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.matches).toEqual([]);
  next.messages[0].content = "needle";
  rerender({ ...next, revision: {} });
  expect(result.current.matches).toEqual([]);
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.matches[0]?.messageId).toBe("branch-two");
});

test("unmounting before loading finishes skips parsing and publication", async () => {
  const pending = delayedParser();
  load.mockReturnValue(pending.promise);
  const { unmount } = renderHook(useConversationSearch, {
    initialProps: request(),
  });
  unmount();
  await act(async () => pending.resolve(parser));
  expect(parser.searchConversation).not.toHaveBeenCalled();
});

test.each(["query", "focus", "reopen"] as const)(
  "failed loading can retry on %s",
  async (retry) => {
    load.mockRejectedValueOnce(new Error("Chunk unavailable"));
    const initial = request({ messages: messages("one", "needle next") });
    const { result, rerender } = renderHook(useConversationSearch, {
      initialProps: initial,
    });
    await act(async () => {});
    expect(result.current.ready).toBe(false);
    if (retry === "query") rerender({ ...initial, query: "next" });
    else if (retry === "focus") act(() => result.current.refresh());
    else {
      rerender({ ...initial, open: false });
      rerender(initial);
    }
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.matches).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  },
);
