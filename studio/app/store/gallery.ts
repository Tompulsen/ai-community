import {
  initializeLocalWorkspace,
  isLocalWorkspaceActive,
  trackLocalWrite,
  type LocalScope,
} from "../utils/local-workspace";
import type { ImageGenerationConfig } from "../utils/image-params";

const STORE = "images";
const ASSETS = "originals";

export interface GalleryImage {
  id: string;
  prompt: string;
  references?: string[];
  sourceWorkId?: string;
  config?: ImageGenerationConfig;
  model: string;
  width: number;
  height: number;
  createdAt: number;
  imageData: string;
  status: "success" | "failed";
}

interface StoredImage extends GalleryImage {
  thumbnail?: Blob;
}

export interface GallerySettings {
  autoSave: boolean;
  maxCount: number;
}

async function openDB(owner?: LocalScope): Promise<IDBDatabase> {
  owner ??= await initializeLocalWorkspace();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      owner === "legacy" ? "octopus-gallery" : `octopus-gallery-${owner}`,
      3,
    );
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("model", "model", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
      const images = request.transaction!.objectStore(STORE);
      if (!images.indexNames.contains("createdAtId"))
        images.createIndex("createdAtId", ["createdAt", "id"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("作品库正在其他页面使用，请关闭后重试"));
  });
}

function completed(tx: IDBTransaction, db: IDBDatabase) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("作品保存失败"));
    };
  });
}

export function dataURLtoBlob(value: string): Blob {
  const comma = value.indexOf(",");
  if (!value.startsWith("data:image/") || comma < 0)
    throw new Error("图片数据无效");
  const header = value.slice(0, comma);
  const text = value.slice(comma + 1);
  const bytes = header.includes(";base64")
    ? Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(text));
  return new Blob([bytes], { type: header.slice(5).split(";")[0] });
}

async function thumbnail(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ratio = Math.min(
      1,
      384 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) =>
      canvas.toBlob((result) => resolve(result || blob), "image/webp", 0.8),
    );
  } catch {
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function addImage(
  img: GalleryImage,
  owner?: LocalScope,
  original?: Blob,
  importing = false,
) {
  owner ??= await initializeLocalWorkspace();
  const blob =
    original ||
    (img.imageData.startsWith("data:")
      ? dataURLtoBlob(img.imageData)
      : undefined);
  const record: StoredImage = blob
    ? { ...img, imageData: "", thumbnail: await thumbnail(blob) }
    : img;
  if (!importing && !isLocalWorkspaceActive())
    throw new Error("本地数据空间已暂停");
  const db = await openDB(owner);
  if (!importing && !isLocalWorkspaceActive()) {
    db.close();
    throw new Error("本地数据空间已暂停");
  }
  const tx = db.transaction([STORE, ASSETS], "readwrite");
  tx.objectStore(STORE).put(record);
  if (blob) tx.objectStore(ASSETS).put(blob, img.id);
  await trackLocalWrite(completed(tx, db));
  window.dispatchEvent(new Event("gallery-changed"));
}

export async function getImageDimensions(id: string) {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(id);
  const dimensions = new Promise<{ width: number; height: number } | undefined>(
    (resolve, reject) => {
      request.onsuccess = () => {
        const image = request.result as GalleryImage | undefined;
        resolve(
          image &&
            Number.isFinite(image.width) &&
            Number.isFinite(image.height) &&
            image.width > 0 &&
            image.height > 0
            ? { width: image.width, height: image.height }
            : undefined,
        );
      };
      request.onerror = () => reject(request.error);
    },
  );
  const [size] = await Promise.all([dimensions, completed(tx, db)]);
  return size;
}

export async function getImageMetadata(
  id: string,
  owner?: LocalScope,
): Promise<Omit<GalleryImage, "imageData"> | undefined> {
  const db = await openDB(owner);
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(id);
  const metadata = new Promise<Omit<GalleryImage, "imageData"> | undefined>(
    (resolve, reject) => {
      request.onsuccess = () => {
        const image = request.result as StoredImage | undefined;
        if (!image) {
          resolve(undefined);
          return;
        }
        const {
          imageData: _imageData,
          thumbnail: _thumbnail,
          ...value
        } = image;
        resolve(value);
      };
      request.onerror = () => reject(request.error);
    },
  );
  const [value] = await Promise.all([metadata, completed(tx, db)]);
  return value;
}

export async function getImageBlob(
  id: string,
  owner?: LocalScope,
): Promise<Blob> {
  const db = await openDB(owner);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, ASSETS], "readonly");
    const asset = tx.objectStore(ASSETS).get(id);
    asset.onsuccess = () => {
      if (asset.result) {
        resolve(asset.result);
        return;
      }
      const image = tx.objectStore(STORE).get(id);
      image.onsuccess = () => {
        try {
          resolve(dataURLtoBlob(image.result?.imageData || ""));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(image.error);
    };
    asset.onerror = () => reject(asset.error);
    tx.oncomplete = () => db.close();
  });
}

export interface GalleryQuery {
  query?: string;
  model?: string;
  since?: number;
  failedOnly?: boolean;
}

function matches(img: GalleryImage, options: GalleryQuery) {
  const query = options.query?.toLowerCase().trim();
  return (
    (!query || `${img.prompt} ${img.model}`.toLowerCase().includes(query)) &&
    (!options.model || img.model === options.model) &&
    (!options.since || img.createdAt >= options.since) &&
    (!options.failedOnly || img.status === "failed")
  );
}

export async function getImagePage(
  options: GalleryQuery & { after?: IDBValidKey; limit?: number } = {},
  owner?: LocalScope,
) {
  const db = await openDB(owner);
  return new Promise<{ images: GalleryImage[]; after?: IDBValidKey }>(
    (resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const range =
        options.after !== undefined
          ? options.since
            ? IDBKeyRange.bound([options.since, ""], options.after, false, true)
            : IDBKeyRange.upperBound(options.after, true)
          : options.since
          ? IDBKeyRange.lowerBound([options.since, ""])
          : undefined;
      const request = tx
        .objectStore(STORE)
        .index("createdAtId")
        .openCursor(range, "prev");
      const images: GalleryImage[] = [];
      let lastKey: IDBValidKey | undefined;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve({ images });
          return;
        }
        const item = cursor.value as StoredImage;
        if (matches(item, options)) {
          if (images.length >= (options.limit ?? 60)) {
            resolve({ images, after: lastKey });
            return;
          }
          const { thumbnail: preview, ...metadata } = item;
          images.push({
            ...metadata,
            imageData: preview ? URL.createObjectURL(preview) : item.imageData,
          });
          lastKey = cursor.key;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    },
  );
}

export function releaseGalleryImages(images: GalleryImage[]) {
  images.forEach((image) => {
    if (image.imageData.startsWith("blob:"))
      URL.revokeObjectURL(image.imageData);
  });
}

export async function getAllImages(owner?: LocalScope) {
  return (await getImagePage({ limit: Number.MAX_SAFE_INTEGER }, owner)).images;
}

export async function getGallerySummary(
  options: GalleryQuery = {},
  owner?: LocalScope,
) {
  const db = await openDB(owner);
  return new Promise<{ count: number; models: string[] }>((resolve, reject) => {
    const request = db
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .openCursor();
    let count = 0;
    const models = new Set<string>();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        db.close();
        resolve({ count, models: [...models] });
        return;
      }
      const item = cursor.value as GalleryImage;
      if (item.model) models.add(item.model);
      if (matches(item, options)) count++;
      cursor.continue();
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function deleteImages(ids: string[], owner?: LocalScope) {
  const db = await openDB(owner);
  const tx = db.transaction([STORE, ASSETS], "readwrite");
  for (const id of ids) {
    tx.objectStore(STORE).delete(id);
    tx.objectStore(ASSETS).delete(id);
  }
  await completed(tx, db);
}

export const deleteImage = (id: string, owner?: LocalScope) =>
  deleteImages([id], owner);

export async function clearAllImages(owner?: LocalScope) {
  const db = await openDB(owner);
  const tx = db.transaction([STORE, ASSETS], "readwrite");
  tx.objectStore(STORE).clear();
  tx.objectStore(ASSETS).clear();
  await completed(tx, db);
}

export async function getImageCount(owner?: LocalScope) {
  return (await getGallerySummary({}, owner)).count;
}

export async function trimToMaxCount(maxCount: number, owner?: LocalScope) {
  if (!isLocalWorkspaceActive()) return;
  const db = await openDB(owner);
  if (!isLocalWorkspaceActive()) {
    db.close();
    return;
  }
  const tx = db.transaction([STORE, ASSETS], "readwrite");
  const request = tx
    .objectStore(STORE)
    .index("createdAt")
    .openCursor(null, "prev");
  let count = 0;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (++count > maxCount) {
      tx.objectStore(ASSETS).delete(cursor.primaryKey);
      cursor.delete();
    }
    cursor.continue();
  };
  await trackLocalWrite(completed(tx, db));
}

export async function getStorageSize() {
  const used = (await navigator.storage?.estimate())?.usage ?? 0;
  return used >= 1024 ** 3
    ? `${(used / 1024 ** 3).toFixed(1)} GB`
    : used >= 1024 ** 2
    ? `${(used / 1024 ** 2).toFixed(1)} MB`
    : `${Math.round(used / 1024)} KB`;
}

export async function getGallerySettings(
  owner?: LocalScope,
): Promise<GallerySettings> {
  const db = await openDB(owner);
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("settings", "readonly")
      .objectStore("settings")
      .get("gallery");
    request.onsuccess = () => {
      db.close();
      resolve(request.result?.value ?? { autoSave: true, maxCount: 500 });
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function saveGallerySettings(
  value: GallerySettings,
  owner?: LocalScope,
) {
  const db = await openDB(owner);
  const tx = db.transaction("settings", "readwrite");
  tx.objectStore("settings").put({ key: "gallery", value });
  await completed(tx, db);
}
