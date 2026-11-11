/** @jest-environment node */
import { jest } from "@jest/globals";
import { GET, POST, DELETE } from "../app/api/signal/route";

const rooms: Map<string, any> = (globalThis as any).__signalRooms;
const post = (body: unknown) =>
  POST(
    new Request("https://chat.test/api/signal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const offer = { type: "offer", sdp: "v=0\r\n" };

beforeEach(() => rooms.clear());
afterEach(() => jest.restoreAllMocks());

test("invalid signal types never allocate rooms", async () => {
  expect((await post({ room: "ROOM01", type: "invalid" })).status).toBe(400);
  expect(rooms.size).toBe(0);
});

test("large signal bodies are rejected without allocating a room", async () => {
  const response = await post({
    room: "ROOM01",
    type: "offer",
    data: { ...offer, sdp: "x".repeat(70 * 1024) },
  });
  expect(response.status).toBe(413);
  expect(rooms.size).toBe(0);
});

test("room capacity rejects new allocations while preserving existing rooms", async () => {
  for (let i = 0; i < 128; i++)
    expect(
      (
        await post({
          room: `ROOM${String(i).padStart(3, "0")}`,
          type: "offer",
          data: offer,
        })
      ).status,
    ).toBe(200);
  expect(
    (await post({ room: "OVERFLOW", type: "offer", data: offer })).status,
  ).toBe(429);
  expect(rooms.size).toBe(128);
  expect(
    (
      await post({
        room: "ROOM000",
        type: "answer",
        data: { type: "answer", sdp: "v=0" },
      })
    ).status,
  ).toBe(200);
});

test("ICE candidate arrays have a fixed bound", async () => {
  for (let i = 0; i < 64; i++)
    expect(
      (
        await post({
          room: "ROOM01",
          type: "ice-caller",
          data: { candidate: `candidate:${i}` },
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await post({
        room: "ROOM01",
        type: "ice-caller",
        data: { candidate: "overflow" },
      })
    ).status,
  ).toBe(429);
  expect(rooms.get("ROOM01").callerICE).toHaveLength(64);
});

test("writes reclaim expired rooms before checking capacity", async () => {
  rooms.set("STALE1", {
    callerICE: [],
    calleeICE: [],
    createdAt: Date.now() - 300001,
    offer,
  });
  expect(
    (await post({ room: "ROOM01", type: "offer", data: offer })).status,
  ).toBe(200);
  expect(rooms.has("STALE1")).toBe(false);
});

test("normal offer, answer, ICE retrieval and deletion remain usable", async () => {
  const room = "ABC234";
  const answer = { type: "answer", sdp: "v=0\r\na=answer" };
  const ice = {
    candidate: "candidate:1 udp 123 8.8.8.8 12345 typ srflx",
    sdpMid: "0",
    sdpMLineIndex: 0,
    usernameFragment: "u123",
  };
  for (const [type, data] of [
    ["offer", offer],
    ["answer", answer],
    ["ice-caller", ice],
    ["ice-callee", ice],
  ])
    expect((await post({ room, type, data })).status).toBe(200);
  for (const [type, data] of [
    ["offer", offer],
    ["answer", answer],
    ["ice-caller", [ice]],
    ["ice-callee", [ice]],
  ]) {
    const result = await GET(
      new Request(`https://chat.test/api/signal?room=${room}&type=${type}`),
    );
    expect(await result.json()).toEqual({ data });
  }
  expect(
    (await DELETE(new Request(`https://chat.test/api/signal?room=${room}`)))
      .status,
  ).toBe(200);
  expect(rooms.size).toBe(0);
});

test.each([
  null,
  [],
  { room: { name: "ROOM01" }, type: "offer", data: offer },
  { room: "x".repeat(65), type: "offer", data: offer },
  { room: "ROOM01", type: "offer", data: { type: "answer", sdp: "v=0" } },
  {
    room: "ROOM01",
    type: "offer",
    data: { type: "offer", sdp: "x".repeat(33000) },
  },
  { room: "ROOM01", type: "ice-caller", data: { candidate: 123 } },
  {
    room: "ROOM01",
    type: "ice-callee",
    data: { candidate: "a", sdpMLineIndex: -1 },
  },
  { room: "ROOM01", type: "ice-caller", data: { candidate: "x".repeat(5000) } },
])("invalid signal data never allocates a room: %j", async (body) => {
  expect((await post(body)).status).toBe(400);
  expect(rooms.size).toBe(0);
});

test("only expected SDP and ICE fields are retained", async () => {
  await post({
    room: "ROOM01",
    type: "offer",
    data: { ...offer, extra: "discard" },
  });
  await post({
    room: "ROOM01",
    type: "ice-caller",
    data: { candidate: "c", extra: "discard" },
  });
  expect(rooms.get("ROOM01").offer).not.toHaveProperty("extra");
  expect(rooms.get("ROOM01").callerICE[0]).not.toHaveProperty("extra");
});

test("expired reads return no stale handshake and permit recreation", async () => {
  rooms.set("STALE1", {
    callerICE: [],
    calleeICE: [],
    createdAt: Date.now() - 300001,
    offer,
  });
  const result = await GET(
    new Request("https://chat.test/api/signal?room=STALE1&type=offer"),
  );
  expect(await result.json()).toEqual({ data: null, expired: true });
  expect(rooms.has("STALE1")).toBe(false);
  expect(
    (await post({ room: "STALE1", type: "offer", data: offer })).status,
  ).toBe(200);
});
