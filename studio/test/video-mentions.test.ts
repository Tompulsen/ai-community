/** @jest-environment node */
import {
  insertVideoMention,
  removeVideoMention,
  videoMentionQuery,
} from "../app/utils/video-mentions";

test.each(["@", "让@", "使用 @1", "使用 @图片10"])(
  "finds an image mention at the caret: %s",
  (text) => {
    expect(videoMentionQuery(text, text.length)).toBeDefined();
  },
);
test.each(["mail@example.com", "abc@", "@图片3 完成", "@图片123", "nothing"])(
  "does not open unrelated or finished mentions: %s",
  (text) => {
    expect(videoMentionQuery(text, text.length)).toBeUndefined();
  },
);
test("inserts at the caret and preserves following descriptions", () => {
  const prompt = "将 @2 放到海边";
  const range = videoMentionQuery(prompt, 4)!;
  expect(insertVideoMention(prompt, range, 10)).toEqual({
    prompt: "将 @图片10  放到海边",
    cursor: 8,
  });
});
test("deleting an image remaps all later references including image ten", () => {
  expect(removeVideoMention("@图片1 人物，@图片2 背景，@图片10 光线", 2)).toBe(
    "@图片1 人物，[已移除图片] 背景，@图片9 光线",
  );
  expect(removeVideoMention("@图片10 和 @图片1", 1)).toBe(
    "@图片9 和 [已移除图片]",
  );
});

test("moving the caret inside a completed image number cannot leave a broken suffix", () => {
  const prompt = "使用 @图片10 的背景";
  expect(videoMentionQuery(prompt, prompt.indexOf("0"))).toBeUndefined();
  expect(videoMentionQuery(prompt, prompt.indexOf("图"))).toBeUndefined();
  expect(videoMentionQuery(prompt, prompt.indexOf("0") + 1)).toEqual({
    start: 3,
    end: 8,
    number: "10",
  });
});
