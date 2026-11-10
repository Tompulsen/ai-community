const fs = require("fs");
const path = require("path");

const DATA_DIR =
  process.env.ATTEMPT_DATA_DIR ||
  (process.env.NODE_ENV === "production"
    ? "/tmp"
    : path.join(process.cwd(), ".data"));

const STORE_FILE = path.join(DATA_DIR, "password-attempts.json");

type AttemptRecord = { count: number; resetTime: number };
type AttemptMap = Record<string, AttemptRecord>;

let memoryCache: AttemptMap = {};
let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf8");
      memoryCache = JSON.parse(raw) as AttemptMap;
      const now = Date.now();
      for (const key of Object.keys(memoryCache)) {
        if (now > memoryCache[key].resetTime) {
          delete memoryCache[key];
        }
      }
    }
  } catch {
    memoryCache = {};
  }
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushToDisk();
  }, 2000);
}

function flushToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(memoryCache), "utf8");
  } catch {}
}

export function getAttempt(ip: string): AttemptRecord | null {
  loadFromDisk();
  const record = memoryCache[ip];
  if (!record) return null;
  if (Date.now() > record.resetTime) {
    delete memoryCache[ip];
    scheduleWrite();
    return null;
  }
  return record;
}

export function setAttempt(ip: string, record: AttemptRecord): void {
  loadFromDisk();
  memoryCache[ip] = record;
  scheduleWrite();
}

export function deleteAttempt(ip: string): void {
  loadFromDisk();
  delete memoryCache[ip];
  scheduleWrite();
}

export function cleanupExpired(): void {
  loadFromDisk();
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(memoryCache)) {
    if (now > memoryCache[key].resetTime) {
      delete memoryCache[key];
      changed = true;
    }
  }
  if (changed) scheduleWrite();
}

if (typeof setInterval !== "undefined") {
  setInterval(cleanupExpired, 5 * 60 * 1000);
}
