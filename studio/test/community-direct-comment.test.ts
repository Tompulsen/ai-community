/** @jest-environment node */
import { prepareShare, messageGeneration } from "../app/utils/community-share";

const limits = { image: 1024, video: 1024, document: 20000 };
const intent = { destination: "source-comment" as const, resultId: "answer-1", sourceWorkId: "source1" };

test.each(["image", "resource"] as const)("direct %s shares the selected result without fetching reference inputs", async (kind) => {
  const output = new Blob(["generated"], { type: "image/png" });
  const work = await prepareShare({ kind, prompt: "original prompt", model: "generation-model", text: "visible answer", sourceWorkId: "source1", media: kind === "resource" ? [] : [{ blob: async () => output }], references: [{ blob: async () => { throw Error("reference should not be read"); } }] }, limits, new AbortController().signal, intent);
  expect(work.destination).toBe("source-comment");
  expect(work.resultId).toBe("answer-1");
  expect(work.generation).toEqual({ prompt: "original prompt", model: "generation-model", sourceWorkId: "source1" });
  expect(work.files.every(file => !file.role)).toBe(true);
  if (kind === "resource") expect(work.text).toBe("visible answer");
  else expect(work.files[0].blob).toBe(output);
});

test("direct sending rejects missing or changed per-result provenance", async () => {
  const source = { kind: "resource" as const, prompt: "p", model: "m", text: "answer" };
  for (const sourceWorkId of [undefined, "different"]) {
    await expect(prepareShare({ ...source, sourceWorkId }, limits, new AbortController().signal, intent)).rejects.toThrow("invalid");
  }
  const messages = [{ id: "u", role: "user", content: "p" }, { id: "answer-1", role: "assistant", content: "answer", model: "m" }] as Parameters<typeof messageGeneration>[0];
  expect(messageGeneration(messages, "answer-1")?.sourceWorkId).toBeUndefined();
});

test("videos publish to community but cannot be sent to comments, even with provenance", async () => {
  let reads = 0;
  const source = { kind: "video" as const, prompt: "video prompt", model: "video-model", sourceWorkId: "source1", media: [{ blob: async () => { reads++; return new Blob(["video"], { type: "video/mp4" }); } }] };
  await expect(prepareShare(source, limits, new AbortController().signal, intent)).rejects.toThrow("videoComment");
  expect(reads).toBe(0);
  const work = await prepareShare(source, limits, new AbortController().signal, { destination: "community" });
  expect(work.category).toBe("video");
  expect(work.destination).toBe("community");
  expect(work.files[0].blob.type).toBe("video/mp4");
  expect(work.generation?.sourceWorkId).toBe("source1");
});
