import { localKey, isLocalWorkspaceActive } from "./local-workspace";

/** Retain the same idempotency key until a task ID is safely recorded. */
export async function prepareAsyncSubmission(
  kind: "image" | "video",
  identity: string,
  body: string | FormData,
  signal?: AbortSignal,
) {
  const prefix = localKey(`async-submission:${kind}:`);
  const digest = async (value: BufferSource) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const encode = (value: string) => new TextEncoder().encode(value);
  const fields: unknown[] = [];
  if (typeof body !== "string") {
    for (const [name, value] of body.entries()) {
      fields.push([
        name,
        typeof value === "string"
          ? value
          : [value.name, value.type, await digest(await value.arrayBuffer())],
      ]);
    }
  }
  const fingerprint = await digest(
    encode(
      JSON.stringify([identity, typeof body === "string" ? body : fields]),
    ),
  );
  if (
    signal?.aborted ||
    !isLocalWorkspaceActive() ||
    prefix !== localKey(`async-submission:${kind}:`)
  )
    throw new DOMException("Cancelled", "AbortError");
  const key = `${prefix}${fingerprint}`;
  const existing = localStorage.getItem(key);
  const requestId =
    existing && /^[A-Za-z0-9_.:-]{8,128}$/.test(existing)
      ? existing
      : crypto.randomUUID();
  localStorage.setItem(key, requestId);
  return { requestId, accepted: () => localStorage.removeItem(key) };
}
