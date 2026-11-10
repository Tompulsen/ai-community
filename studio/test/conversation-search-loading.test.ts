import { jest } from "@jest/globals";

const parserFactory = jest.fn<() => object>();
jest.unstable_mockModule("@/app/utils/conversation-search-parser", () =>
  parserFactory(),
);

beforeEach(() => {
  jest.resetModules();
  parserFactory.mockReset();
});

test("lightweight text and navigation helpers do not load the parser", async () => {
  const search = await import("../app/utils/conversation-search");
  expect(
    search.getConversationSearchText({
      id: "one",
      role: "assistant",
      content: [{ type: "text", text: "needle" }],
    }),
  ).toBe("needle");
  expect(search.navigateConversationMatch(-1, 2, 1)).toBe(0);
  expect(parserFactory).not.toHaveBeenCalled();
});

test("warmup and foreground requests share the same parser load", async () => {
  const parser = { searchConversation: jest.fn() };
  parserFactory.mockReturnValue(parser);
  const { loadConversationSearch } = await import(
    "../app/utils/conversation-search"
  );
  const first = loadConversationSearch();
  expect(loadConversationSearch()).toBe(first);
  const loaded = await first;
  expect(loaded.searchConversation).toBe(parser.searchConversation);
  expect(await loadConversationSearch()).toBe(loaded);
  expect(parserFactory).toHaveBeenCalledTimes(1);
});

test("a rejected parser load can be retried", async () => {
  const parser = { searchConversation: jest.fn() };
  parserFactory
    .mockImplementationOnce(() => {
      throw new Error("Chunk unavailable");
    })
    .mockReturnValue(parser);
  const { loadConversationSearch } = await import(
    "../app/utils/conversation-search"
  );
  await expect(loadConversationSearch()).rejects.toThrow("Chunk unavailable");
  expect((await loadConversationSearch()).searchConversation).toBe(
    parser.searchConversation,
  );
  expect(parserFactory).toHaveBeenCalledTimes(2);
});
