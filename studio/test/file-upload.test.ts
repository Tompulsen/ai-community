import {
  parseFile,
  fileContentParts,
  formatFileContent,
  hasFileContent,
  messageFiles,
  isSupportedFile,
  formatMaterialSize,
} from "../app/utils/file-upload";

test("small files show their byte size instead of rounding to zero KB", async () => {
  const file = await parseFile(
    new File(["abcdefghijklmnopqrstuvwx"], "test.txt"),
  );
  expect(file.size).toBe(24);
  expect(formatFileContent([file])).toContain("(24 B)");
  expect(file.content.split(",")[1]).toBe(btoa("abcdefghijklmnopqrstuvwx"));
  expect(formatMaterialSize(1024)).toBe("1.0 KB");
  expect(formatMaterialSize(1024 * 1024)).toBe("1.0 MB");
  expect(formatMaterialSize(0)).toBe("0 B");
});

test.each(["a", "ab", "abc", "abcd", "abcdefghijklmnopqrstuvwx"])(
  "reused file without composer metadata recovers the byte size for %s",
  async (text) => {
    const file = await parseFile(new File([text], "test.txt"));
    const restored = messageFiles({
      role: "user",
      content: fileContentParts([file]),
    });
    expect(restored[0].size).toBe(text.length);
    expect(formatFileContent(restored)).toContain(`(${text.length} B)`);
  },
);

test.each(["sample.txt", "sample.ts", "sample.py"])(
  "%s is sent as an original file without expanding its text",
  async (name) => {
    const bytes = new Uint8Array([239, 187, 191, 65, 13, 10, 66]);
    const file = await parseFile(new File([bytes], name));
    expect(file.isText).toBe(false);
    expect(file.content.split(",")[1]).toBe("77u/QQ0KQg==");
    expect(fileContentParts([file])).toEqual([
      { type: "file", file: { filename: name, file_data: file.content } },
    ]);
    expect(formatFileContent([file])).not.toContain(file.content);
    expect(formatFileContent([file])).not.toContain("A\r\nB");
    expect(
      messageFiles({ role: "user", content: fileContentParts([file]) })[0]
        .content,
    ).toBe(file.content);
  },
);

test("video, audio and documents keep their original bytes in content parts", async () => {
  const files = await Promise.all(
    ["sample.pdf", "sample.docx", "sample.mp4", "sample.wav"].map((name) =>
      parseFile(new File(["original bytes"], name)),
    ),
  );
  const parts = fileContentParts(files);
  expect(parts.map((part) => part.type)).toEqual([
    "file",
    "file",
    "video_url",
    "input_audio",
  ]);
  expect(parts[2].video_url?.url).toBe(files[2].content);
  expect(parts[3].input_audio).toEqual({
    data: btoa("original bytes"),
    format: "wav",
  });
  expect(hasFileContent([{ role: "user", content: parts }])).toBe(true);
  expect(hasFileContent([{ role: "user", content: "Hello" }])).toBe(false);
  expect(
    messageFiles({ role: "user", content: parts, composerInput: { files } }),
  ).toBe(files);
  expect(
    fileContentParts(messageFiles({ role: "user", content: parts })),
  ).toEqual(parts);
});

test.each([
  ["sample.mp3", "audio/mpeg"],
  ["sample.m4a", "audio/mp4"],
  ["sample.opus", "audio/opus"],
])(
  "reusing %s restores its MIME type without changing the audio bytes",
  async (name, type) => {
    const file = await parseFile(new File(["original audio bytes"], name));
    const parts = fileContentParts([file]);
    const restored = messageFiles({ role: "user", content: parts });
    expect(restored[0].type).toBe(type);
    expect(restored[0].content).toBe(file.content);
    expect(restored[0].size).toBe(file.size);
    expect(fileContentParts(restored)).toEqual(parts);
  },
);

test.each([
  ["sample.custom", "audio/mpeg", "mp3"],
  ["sample.mp3", "audio/ogg", "ogg"],
  ["sample.unknown", "audio/mp4", "m4a"],
  ["sample.recording", "audio/x-wav", "wav"],
  ["sample.custom", "audio/custom-audio", "custom-audio"],
])(
  "audio %s uses its declared MIME %s instead of guessing from its name",
  async (name, type, format) => {
    const file = await parseFile(new File(["original bytes"], name, { type }));
    expect(fileContentParts([file])).toEqual([
      {
        type: "input_audio",
        input_audio: { data: btoa("original bytes"), format },
      },
    ]);
  },
);

test("legacy text attachments remain readable and are not converted to fake files", () => {
  const file = {
    name: "old.txt",
    type: "text/plain",
    size: 3,
    content: "old",
    isText: true,
  };
  expect(formatFileContent([file])).toContain("\nold\n");
  expect(fileContentParts([file])).toEqual([]);
});

test("reusing an imported video URL preserves the video content type", () => {
  const parts = [
    {
      type: "video_url" as const,
      video_url: { url: "https://example.test/clip.mp4" },
    },
  ];
  expect(
    fileContentParts(messageFiles({ role: "user", content: parts })),
  ).toEqual(parts);
});

test("retains the size limit and rejects unsupported files", async () => {
  await expect(
    parseFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf")),
  ).rejects.toThrow("10MB");
  await expect(parseFile(new File(["x"], "unknown.exe"))).rejects.toThrow(
    "不支持",
  );
  expect(
    isSupportedFile(new File(["x"], "clip.custom", { type: "video/mp4" })),
  ).toBe(true);
});

test("video files accept up to 20MB, including extension-based MIME detection", async () => {
  const bytes = new Uint8Array(20 * 1024 * 1024);
  const parsed = await parseFile(new File([bytes], "clip.mp4"));
  expect(parsed.size).toBe(bytes.length);
  expect(parsed.type).toBe("video/mp4");
  expect(fileContentParts([parsed])[0].type).toBe("video_url");
  await expect(
    parseFile(new File([new Uint8Array(bytes.length + 1)], "large.mp4")),
  ).rejects.toThrow("20MB");
});

test("video MIME types also receive the 20MB limit without a recognized extension", async () => {
  const bytes = new Uint8Array(11 * 1024 * 1024);
  const parsed = await parseFile(
    new File([bytes], "clip.custom", { type: "video/webm" }),
  );
  expect(parsed.size).toBe(bytes.length);
  expect(parsed.type).toBe("video/webm");
});
