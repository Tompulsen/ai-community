/**
 * IndexedDB 图片缓存
 * 基于 idb-keyval 持久化存储图片，刷新页面后不丢失
 */
import { get, set, del } from "./studio-keyval";

const IMAGE_CACHE_PREFIX = "img_";

/** 从 IndexedDB 获取缓存图片 */
export async function getCachedImage(key: string): Promise<string | null> {
  try {
    return (await get(IMAGE_CACHE_PREFIX + key)) || null;
  } catch {
    return null;
  }
}

/** 将图片存入 IndexedDB */
export async function setCachedImage(key: string, dataUrl: string): Promise<void> {
  try {
    await set(IMAGE_CACHE_PREFIX + key, dataUrl);
  } catch (e) {
    console.warn("[ImageCache] Failed to store:", e);
  }
}

/** 从 IndexedDB 删除缓存图片 */
export async function removeCachedImage(key: string): Promise<void> {
  try {
    await del(IMAGE_CACHE_PREFIX + key);
  } catch {}
}

/** 基于内容 hash 的缓存：将图片存入 IndexedDB，返回 hash key */
export async function cacheImage(dataUrl: string): Promise<string> {
  const hash = await sha256(dataUrl);
  await setCachedImage(hash, dataUrl);
  return hash;
}

/** 通过 hash key 获取图片 */
export async function getImage(hash: string): Promise<string | null> {
  return getCachedImage(hash);
}

/** 计算 SHA-256 hash */
async function sha256(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
