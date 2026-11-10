/**
 * 极简无存储 WebRTC 信令接口
 *
 * 仅用于交换 SDP Offer/Answer 和 ICE Candidate，
 * 全部数据保存在进程内存中，不写入任何数据库/KV/文件。
 * 房间数据在连接完成或超时(5分钟)后自动销毁。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_TTL = 5 * 60 * 1000; // 5 分钟
const MAX_ROOMS = 128;
const MAX_ICE_CANDIDATES = 64;
const MAX_BODY_BYTES = 64 * 1024;
const SIGNAL_TYPES = new Set(["offer", "answer", "ice-caller", "ice-callee"]);

class SignalError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function validRoom(room: unknown): room is string {
  return typeof room === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(room);
}

async function readBody(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES)
    throw new SignalError("signal body too large", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new SignalError("missing signal body");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new SignalError("signal body too large", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function signalPayload(type: string, payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new SignalError("invalid signal payload");
  if (type === "offer" || type === "answer") {
    if (
      payload.type !== type ||
      typeof payload.sdp !== "string" ||
      Buffer.byteLength(payload.sdp, "utf8") > 32 * 1024
    )
      throw new SignalError("invalid session description");
    return { type, sdp: payload.sdp } as RTCSessionDescriptionInit;
  }
  if (
    typeof payload.candidate !== "string" ||
    Buffer.byteLength(JSON.stringify(payload), "utf8") > 4096 ||
    (payload.sdpMid != null && typeof payload.sdpMid !== "string") ||
    (payload.sdpMLineIndex != null &&
      (!Number.isSafeInteger(payload.sdpMLineIndex) ||
        payload.sdpMLineIndex < 0 ||
        payload.sdpMLineIndex > 65535)) ||
    (payload.usernameFragment != null &&
      typeof payload.usernameFragment !== "string")
  )
    throw new SignalError("invalid ICE candidate");
  return {
    candidate: payload.candidate,
    sdpMid: payload.sdpMid,
    sdpMLineIndex: payload.sdpMLineIndex,
    usernameFragment: payload.usernameFragment,
  } as RTCIceCandidateInit;
}

type RoomData = {
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  callerICE: RTCIceCandidateInit[];
  calleeICE: RTCIceCandidateInit[];
  createdAt: number;
};

// 全局内存存储 —— 进程重启即丢失
const globalForSignal = globalThis as unknown as {
  __signalRooms?: Map<string, RoomData>;
};

const rooms: Map<string, RoomData> =
  globalForSignal.__signalRooms ?? new Map<string, RoomData>();

if (!globalForSignal.__signalRooms) {
  globalForSignal.__signalRooms = rooms;
}

function cleanupExpiredRooms() {
  const now = Date.now();
  for (const [key, val] of rooms) {
    if (now - val.createdAt >= ROOM_TTL) rooms.delete(key);
  }
}

// 定时清理过期房间
if (
  !(globalThis as unknown as { __signalCleanup?: NodeJS.Timeout })
    .__signalCleanup
) {
  (
    globalThis as unknown as { __signalCleanup?: NodeJS.Timeout }
  ).__signalCleanup = setInterval(cleanupExpiredRooms, 60 * 1000);
  (
    globalThis as unknown as { __signalCleanup: NodeJS.Timeout }
  ).__signalCleanup.unref?.();
}

function ensureRoom(room: string): RoomData {
  let data = rooms.get(room);
  if (!data) {
    if (rooms.size >= MAX_ROOMS)
      throw new SignalError("signal room capacity reached", 429);
    data = {
      callerICE: [],
      calleeICE: [],
      createdAt: Date.now(),
    };
    rooms.set(room, data);
  }
  return data;
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new SignalError("invalid signal body");
    const { room, type, data: payload } = body;

    if (!validRoom(room) || !SIGNAL_TYPES.has(type))
      throw new SignalError("invalid room or signal type");
    const data = signalPayload(type, payload);
    cleanupExpiredRooms();
    const roomData = ensureRoom(room);

    switch (type) {
      case "offer":
        roomData.offer = data as RTCSessionDescriptionInit;
        break;
      case "answer":
        roomData.answer = data as RTCSessionDescriptionInit;
        break;
      case "ice-caller":
        if (roomData.callerICE.length >= MAX_ICE_CANDIDATES)
          throw new SignalError("too many ICE candidates", 429);
        roomData.callerICE.push(data as RTCIceCandidateInit);
        break;
      case "ice-callee":
        if (roomData.calleeICE.length >= MAX_ICE_CANDIDATES)
          throw new SignalError("too many ICE candidates", 429);
        roomData.calleeICE.push(data as RTCIceCandidateInit);
        break;
      default:
        return Response.json({ error: "unknown type" }, { status: 400 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof SignalError ? error.message : "bad request" },
      { status: error instanceof SignalError ? error.status : 400 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const room = url.searchParams.get("room");
    const type = url.searchParams.get("type");

    if (!validRoom(room) || !type || !SIGNAL_TYPES.has(type)) {
      return Response.json(
        { error: "invalid room or signal type" },
        { status: 400 },
      );
    }

    const roomData = rooms.get(room);

    if (!roomData) {
      return Response.json({ data: null }, { status: 200 });
    }

    // 检查是否过期
    if (Date.now() - roomData.createdAt >= ROOM_TTL) {
      rooms.delete(room);
      return Response.json({ data: null, expired: true }, { status: 200 });
    }

    switch (type) {
      case "offer":
        return Response.json({ data: roomData.offer ?? null });
      case "answer":
        return Response.json({ data: roomData.answer ?? null });
      case "ice-caller":
        return Response.json({ data: roomData.callerICE });
      case "ice-callee":
        return Response.json({ data: roomData.calleeICE });
      default:
        return Response.json({ error: "unknown type" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const room = url.searchParams.get("room");

    if (!validRoom(room))
      return Response.json({ error: "invalid room" }, { status: 400 });
    rooms.delete(room);

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "server error" }, { status: 500 });
  }
}
