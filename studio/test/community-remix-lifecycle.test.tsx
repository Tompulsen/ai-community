import React, { StrictMode, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { installCommunityRemix, useCommunityRemix, useCommunityRemixDraft, type RemixWork } from "../app/utils/community-remix";

const origin = "https://community.example";
const identity = { context: "context", attempt: "attempt", subject: "1", userId: "user1" };
const work: RemixWork = { requestId: "38f3e980-5a7a-4f8a-b65e-098ac9b2ac8e", sourceWorkId: "work1", kind: "image", prompt: "Original full prompt", model: "original-image-model", references: [] };
const images = ["data:image/png;base64,aGVsbG8="];
let dispose: () => void;
let acknowledgements: { status: string; prompt: string; session: string }[];

beforeEach(() => {
  acknowledgements = [];
  jest.spyOn(window.parent, "postMessage").mockImplementation((message: any) => {
    acknowledgements.push({ status: message.status, prompt: (document.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "", session: document.querySelector("textarea")?.getAttribute("data-session") ?? "" });
  });
  dispose = installCommunityRemix(origin, identity);
});
afterEach(() => { act(() => dispose()); cleanup(); jest.restoreAllMocks(); });

function receive(value = work) {
  act(() => window.dispatchEvent(new MessageEvent("message", { origin, source: window.parent, data: { type: "community-remix", ...identity, work: value } })));
}

function Harness({ reuse = false, readiness = "ready", prepare = async () => {} }: { reuse?: boolean; readiness?: "loading" | "ready" | "error"; prepare?: () => Promise<void> }) {
  const [sessionId, setSessionId] = useState("existing-session");
  const [model, setModel] = useState("previous-model");
  return <><output data-testid="model">{model}</output><Composer key={sessionId} sessionId={sessionId} readiness={readiness} prepare={prepare} create={(value) => { setModel(value.model); if (!reuse) setSessionId("new-session"); return reuse ? sessionId : "new-session"; }}/></>;
}
function Composer({ sessionId, readiness, prepare, create }: { sessionId: string; readiness: "loading" | "ready" | "error"; prepare: () => Promise<void>; create: (value: RemixWork) => string }) {
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<string[]>([]);
  useCommunityRemix("chat", readiness, async (value, check) => {
    await prepare(); check();
    return { sessionId: create(value), images };
  });
  useCommunityRemixDraft(sessionId, prompt, references, (value, inputs) => { setPrompt(value.prompt); setReferences(inputs); });
  return <><textarea aria-label="prompt" data-session={sessionId} value={prompt} readOnly/><output data-testid="references">{references.join(",")}</output></>;
}

test("keyed session remount receives prompt and references before success acknowledgement", async () => {
  render(<StrictMode><Harness/></StrictMode>);
  receive();
  await waitFor(() => expect(acknowledgements).toEqual([{ status: "remix-applied", prompt: work.prompt, session: "new-session" }]));
  expect(screen.getByTestId("references").textContent).toBe(images[0]);
  expect(screen.getByTestId("model").textContent).toBe(work.model);
  receive();
  expect(acknowledgements).toHaveLength(2);
  expect(screen.getByRole("textbox").getAttribute("data-session")).toBe("new-session");
});

test("reusing an untouched session also waits for the composer state commit", async () => {
  render(<Harness reuse/>);
  receive();
  await waitFor(() => expect(acknowledgements).toEqual([{ status: "remix-applied", prompt: work.prompt, session: "existing-session" }]));
});

test("a queued request imports on model discovery failure and retains the original model", async () => {
  const view = render(<Harness readiness="loading"/>);
  receive();
  expect(acknowledgements).toHaveLength(0);
  view.rerender(<Harness readiness="error"/>);
  await waitFor(() => expect(acknowledgements[0]?.status).toBe("remix-applied"));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(work.prompt);
  expect(screen.getByTestId("model").textContent).toBe(work.model);
});

test("a request received before the chat module mounts is consumed after mounting", async () => {
  receive();
  render(<Harness/>);
  await waitFor(() => expect(acknowledgements[0]?.prompt).toBe(work.prompt));
});

test("account disposal during preparation cannot write or acknowledge the old request", async () => {
  let resolve!: () => void;
  const preparation = new Promise<void>(done => { resolve = done; });
  render(<Harness prepare={() => preparation}/>);
  receive();
  await act(async () => { dispose(); resolve(); await preparation; });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  expect(screen.getByTestId("model").textContent).toBe("previous-model");
  expect(acknowledgements).toHaveLength(0);
});
