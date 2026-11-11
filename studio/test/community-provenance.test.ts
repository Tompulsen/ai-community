/** @jest-environment node */
import { prepareShare, videoReferenceSources, messageGeneration, videoGenerationMetadata } from "../app/utils/community-share";

const image = () => new Blob(["image fixture"], { type: "image/png" });
const limits = { image: 1024, video: 1024, document: 20000 };

test("old gallery records recover only the matching answer's input, preserving explicit empty references", () => {
  const messages = [
    { id: "u1", role: "user", content: [{ type: "text", text: "edit original" }, { type: "image_url", image_url: { url: "https://fixture/reference.png" } }] },
    { id: "u2", role: "user", content: "unrelated prompt" },
    { id: "a1", role: "assistant", parentId: "u1", model: "original-model", content: "result" },
  ] as Parameters<typeof messageGeneration>[0];
  expect(messageGeneration(messages, "a1")).toEqual({ prompt: "edit original", model: "original-model", references: ["https://fixture/reference.png"] });
  expect(messageGeneration(messages, "missing")).toBeUndefined();
  expect(messageGeneration(messages.slice(1), "a1")).toBeUndefined();
  messages[2].generation = { prompt: "final prompt", model: "original-model", references: [] };
  expect(messageGeneration(messages, "a1")?.references).toEqual([]);
});

test("sharing keeps full provenance and separates output from original inputs", async () => {
  const prompt = "完整提示词".repeat(1000);
  const result = await prepareShare({ kind: "image", prompt, model: "image-edit-model", sourceWorkId: "source1", media: [{ blob: async () => image() }], references: [{ blob: async () => image() }, { blob: async () => image() }] }, limits, new AbortController().signal);
  expect(result.generation).toEqual({ prompt, model: "image-edit-model", sourceWorkId: "source1" });
  expect(result.text).toHaveLength(2500);
  expect(await result.files[0].blob.text()).toBe(prompt);
  expect(result.files.filter(file => file.role === "reference")).toHaveLength(2);
  expect(result.files.filter(file => !file.role && file.blob.type === "image/png")).toHaveLength(1);
});

test("reference validation rejects non-images, oversized and excessive inputs", async () => {
  const source = { kind: "image" as const, prompt: "prompt", model: "model", media: [{ blob: async () => image() }] };
  await expect(prepareShare({ ...source, references: [{ blob: async () => new Blob(["text"], { type: "text/plain" }) }] }, limits, new AbortController().signal)).rejects.toThrow("media");
  await expect(prepareShare({ ...source, references: [{ blob: async () => new Blob(["x".repeat(1025)], { type: "image/png" }) }] }, limits, new AbortController().signal)).rejects.toThrow("tooLarge");
  await expect(prepareShare({ ...source, references: Array.from({ length: 17 }, () => ({ blob: async () => image() })) }, limits, new AbortController().signal)).rejects.toThrow("tooMany");
});

test("serialized references support URL, content, metadata and named keyframes without unrelated URLs", () => {
  const sources = videoReferenceSources(JSON.stringify({ input_reference: { image_url: "https://fixture/a.png" }, metadata: { content: [{ type: "image_url", image_url: { url: "https://fixture/b.png" } }, { type: "video_url", url: "https://fixture/private.mp4" }], keyframes: { frame0: { type: "image", url: "https://fixture/c.png" }, frame1: { type: "image", url: "https://fixture/a.png" } } }, callback_url: "https://fixture/private" }));
  expect(sources.map(source => source.url)).toEqual(["https://fixture/a.png", "https://fixture/b.png", "https://fixture/c.png"]);
});

test("multipart metadata and image uploads retain only submitted references", async () => {
  const body = new FormData();
  body.set("input_reference", image(), "input.png");
  body.set("metadata", JSON.stringify({ reference_images: ["https://fixture/ref.png"] }));
  const references = videoReferenceSources(body);
  expect(references).toHaveLength(2);
  expect(await references[0].blob!()).toBeInstanceOf(Blob);
  expect(references[1].url).toBe("https://fixture/ref.png");
  expect(videoReferenceSources(JSON.stringify({ input_reference: { file_id: "opaque-id" } }))).toEqual([]);
});

test("video provenance uses actual serialized model and prompt overrides", () => {
  const fallback = { prompt: "draft prompt", model: "draft-model" };
  const body = new FormData(); body.set("prompt", "submitted prompt"); body.set("model", "submitted-model");
  for (const payload of [body, JSON.stringify({ prompt: "submitted prompt", model: "submitted-model" })]) {
    expect(videoGenerationMetadata(payload, fallback)).toEqual({ prompt: "submitted prompt", model: "submitted-model", references: [] });
  }
});
