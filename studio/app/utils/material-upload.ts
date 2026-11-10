import type { ParsedFile } from "./file-upload";

export interface MaterialUploadItem {
  id: string;
  name: string;
  type: string;
  size: number;
  status: "processing" | "ready" | "failed";
  error?: string;
}

export interface PreparedMaterials {
  images: string[];
  files: ParsedFile[];
}

export interface MaterialUploadSnapshot {
  items: MaterialUploadItem[];
  images: { id: string; url: string }[];
  files: { id: string; file: ParsedFile }[];
  pending: number;
}

export interface MaterialPreparation {
  getSnapshot(): MaterialUploadSnapshot;
  subscribe(listener: () => void): () => void;
  wait(signal: AbortSignal): Promise<PreparedMaterials>;
  retry(): void;
  cancel(): void;
}

interface MaterialEntry {
  item: MaterialUploadItem;
  raw?: File;
  image: boolean;
  imageUrl?: string;
  file?: ParsedFile;
  attempt: number;
}

let nextMaterialId = 0;

export function createMaterialUpload(
  options: {
    loadImage: (file: File) => Promise<string>;
    loadFile: (file: File) => Promise<ParsedFile>;
    imageLimitError: string;
  },
  initial?: PreparedMaterials,
): MaterialPreparation & {
  add(files: File[]): Promise<void>;
  remove(id: string): void;
} {
  const entries = new Map<string, MaterialEntry>();
  const listeners = new Set<() => void>();
  const queue: { entry: MaterialEntry; attempt: number }[] = [];
  let running = false;
  let snapshot: MaterialUploadSnapshot = {
    items: [],
    images: [],
    files: [],
    pending: 0,
  };

  function publish() {
    const current = [...entries.values()];
    snapshot = {
      items: current.map(({ item }) => ({ ...item })),
      images: current.flatMap(({ item, imageUrl }) =>
        item.status === "ready" && imageUrl !== undefined
          ? [{ id: item.id, url: imageUrl }]
          : [],
      ),
      files: current.flatMap(({ item, file }) =>
        item.status === "ready" && file ? [{ id: item.id, file }] : [],
      ),
      pending: current.filter(({ item }) => item.status === "processing")
        .length,
    };
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function imageCount(exceptId: string) {
    return [...entries.values()].filter(
      ({ image, item }) =>
        image && item.id !== exceptId && item.status !== "failed",
    ).length;
  }

  function addEntry(
    metadata: Pick<MaterialUploadItem, "name" | "type" | "size">,
    image: boolean,
    raw?: File,
  ) {
    const id = `material-${++nextMaterialId}`;
    const entry: MaterialEntry = {
      item: {
        id,
        name: metadata.name,
        type: metadata.type,
        size: metadata.size,
        status: "processing",
      },
      raw,
      image,
      attempt: 0,
    };
    entries.set(id, entry);
    return entry;
  }

  function enqueue(entry: MaterialEntry) {
    entry.attempt++;
    if (entry.image && imageCount(entry.item.id) >= 5) {
      entry.item = {
        ...entry.item,
        status: "failed",
        error: options.imageLimitError,
      };
      return;
    }
    entry.item = { ...entry.item, status: "processing", error: undefined };
    queue.push({ entry, attempt: entry.attempt });
  }

  function isCurrent(entry: MaterialEntry, attempt: number) {
    return (
      entries.get(entry.item.id) === entry &&
      entry.attempt === attempt &&
      entry.item.status === "processing"
    );
  }

  async function processQueue() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const { entry, attempt } = queue.shift()!;
        if (!isCurrent(entry, attempt) || !entry.raw) continue;
        try {
          if (entry.image) {
            const url = await options.loadImage(entry.raw);
            if (!isCurrent(entry, attempt)) continue;
            entry.imageUrl = url;
          } else {
            const file = await options.loadFile(entry.raw);
            if (!isCurrent(entry, attempt)) continue;
            entry.file = file;
          }
          entry.item = { ...entry.item, status: "ready", error: undefined };
        } catch (error) {
          if (!isCurrent(entry, attempt)) continue;
          entry.item = {
            ...entry.item,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        }
        publish();
      }
    } finally {
      running = false;
    }
  }

  function abortError() {
    return new DOMException("Material preparation was aborted", "AbortError");
  }

  function cancel() {
    queue.length = 0;
    let changed = false;
    for (const entry of entries.values()) {
      if (entry.item.status !== "processing") continue;
      entry.attempt++;
      entry.item = {
        ...entry.item,
        status: "failed",
        error: abortError().message,
      };
      changed = true;
    }
    if (changed) publish();
  }

  function wait(signal: AbortSignal): Promise<PreparedMaterials> {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const cleanup = () => {
        unsubscribe();
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        cancel();
        reject(abortError());
      };
      const check = () => {
        if (snapshot.pending) return;
        cleanup();
        const failure = snapshot.items.find((item) => item.status === "failed");
        if (failure) {
          reject(new Error(failure.error || "Material preparation failed"));
        } else {
          resolve({
            images: snapshot.images.map(({ url }) => url),
            files: snapshot.files.map(({ file }) => file),
          });
        }
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      unsubscribe = subscribe(check);
      signal.addEventListener("abort", onAbort, { once: true });
      check();
    });
  }

  function add(files: File[]): Promise<void> {
    const added: MaterialEntry[] = [];
    for (const file of files) {
      const entry = addEntry(file, file.type.startsWith("image/"), file);
      enqueue(entry);
      added.push(entry);
    }
    if (!added.length) return Promise.resolve();
    publish();
    const settled = new Promise<void>((resolve) => {
      let unsubscribe = () => {};
      const check = () => {
        if (
          added.some(
            (entry) =>
              entries.get(entry.item.id) === entry &&
              entry.item.status === "processing",
          )
        )
          return;
        unsubscribe();
        resolve();
      };
      unsubscribe = subscribe(check);
      check();
    });
    void processQueue();
    return settled;
  }

  function remove(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    entry.attempt++;
    entries.delete(id);
    publish();
  }

  function retry() {
    let changed = false;
    for (const entry of entries.values()) {
      if (entry.item.status !== "failed" || !entry.raw) continue;
      enqueue(entry);
      changed = true;
    }
    if (changed) publish();
    void processQueue();
  }

  for (const [index, url] of (initial?.images ?? []).entries()) {
    const entry = addEntry(
      {
        name: `image-${index + 1}`,
        type: /^data:([^;,]+)/.exec(url)?.[1] ?? "image/*",
        size: 0,
      },
      true,
    );
    entry.imageUrl = url;
    entry.item =
      index < 5
        ? { ...entry.item, status: "ready" }
        : {
            ...entry.item,
            status: "failed",
            error: options.imageLimitError,
          };
  }
  for (const file of initial?.files ?? []) {
    const entry = addEntry(file, false);
    entry.file = { ...file };
    entry.item = { ...entry.item, status: "ready" };
  }
  if (entries.size) publish();

  return {
    getSnapshot: () => snapshot,
    subscribe,
    add,
    remove,
    wait,
    retry,
    cancel,
  };
}
