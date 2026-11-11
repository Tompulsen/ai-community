import { create } from "zustand";
import { safeLocalStorage } from "@/app/utils";
import {
  localKey,
  isLocalWorkspaceActive,
  getLocalScope,
  persistLocalWrite,
  type LocalScope,
} from "../utils/local-workspace";
import {
  MAX_VIDEO_REFERENCES,
  videoDraftForFormat,
  type VideoApiFormat,
} from "../utils/video-api";
import {
  readChatSnapshot,
  writeChatSnapshot,
  removeChatSnapshot,
} from "../utils/chat-persistence";
import { forgetTask } from "../utils/local-tasks";
import { normalizeVideoParameters } from "../utils/video-capabilities";
import { selectedVideoSize } from "../utils/video-size";
import { removeVideoMention } from "../utils/video-mentions";

// ─── Types ────────────────────────────────────────────────────────

export type VideoGenMode =
  | "text-to-video"
  | "image-to-video"
  | "first-last-frame"
  | "reference-to-video";

export type VideoAspectRatio = string;

export type VideoResolution = string;

export type ReferenceMode = "all-reference" | "image-only" | "fusion";

export interface MaterialItem {
  id: string;
  type: "image" | "video" | "audio";
  url: string; // base64 data URL
  name: string;
}

export interface VideoResult {
  id: string;
  url: string;
  coverUrl?: string;
  prompt: string;
  model: string;
  mode?: VideoGenMode;
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  duration?: number;
  status: "pending" | "success" | "failed";
  error?: string;
  createdAt: number;
  size?: string;
  mediaPath?: string;
  tokenId?: number | null;
  customApiBase?: string;
  request?: VideoDraft;
  phase?: "submitting" | "queued" | "generating" | "preparing" | "paused";
  progress?: number;
  completedAt?: number;
  galleryHidden?: boolean;
  upstreamId?: string;
}

export interface VideoDraft {
  sourceWorkId?: string;
  apiFormat: VideoApiFormat;
  legacyCustomFormat?: Exclude<VideoApiFormat, "openai">;
  protocolOptions?: Partial<
    Record<
      VideoApiFormat,
      {
        seed?: string;
        generateAudio?: boolean;
        personGeneration?: string;
      }
    >
  >;
  customParams?: Partial<Record<VideoApiFormat, string>>;
  openaiReferenceSource?: "upload" | "image_url" | "file_id";
  openaiImageUrl?: string;
  openaiFileId?: string;
  openaiLastImageUrl?: string;
  size: string;
  model: string;
  mode: VideoGenMode;
  prompt: string;
  negativePrompt: string;
  aspectRatio: VideoAspectRatio;
  resolution: VideoResolution;
  duration: number;
  count: number;
  seed: string; // 空字符串 = 随机
  promptAdherence: number; // 0.1 ~ 2.0
  cameraMotion: number; // 0 ~ 100
  materials: MaterialItem[];
  referenceMode: ReferenceMode; // 参考生效模式
  autoPlay: boolean;
  autoSaveGallery: boolean;
  confirmBeforeGenerate: boolean;
  draftAutoSave: boolean;
}

interface VideoStore {
  // 草稿（用户正在编辑的参数）
  draft: VideoDraft;
  draftRevision: number;
  hasHydrated: boolean;

  // 生成状态
  isGenerating: boolean;
  generateProgress: number | undefined;
  generateStatus: string;

  // 生成结果列表
  results: VideoResult[];
  selectedResultId: string | null;

  // Actions
  updateDraft: (patch: Partial<VideoDraft>) => void;
  addMaterial: (item: MaterialItem) => void;
  removeMaterial: (id: string) => void;
  clearMaterials: () => void;
  setGenerating: (v: boolean) => void;
  setGenerateProgress: (v: number | undefined, status?: string) => void;
  addResult: (r: VideoResult) => Promise<void>;
  updateResult: (
    id: string,
    patch: Omit<Partial<VideoResult>, "id" | "request" | "createdAt">,
  ) => Promise<void>;
  removeResult: (id: string) => Promise<void>;
  selectResult: (id: string | null) => void;
  clearResults: () => Promise<void>;
  loadDraft: () => Promise<void>;
  saveDraft: () => Promise<void>;
}

// ─── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_DRAFT: VideoDraft = {
  apiFormat: "openai",
  customParams: {},
  openaiReferenceSource: "upload",
  openaiImageUrl: "",
  openaiFileId: "",
  size: "1920x1080",
  model: "",
  mode: "text-to-video",
  prompt: "",
  negativePrompt: "",
  aspectRatio: "16:9",
  resolution: "1080p",
  duration: 8,
  count: 1,
  seed: "",
  promptAdherence: 1.0,
  cameraMotion: 50,
  materials: [],
  referenceMode: "all-reference",
  autoPlay: true,
  autoSaveGallery: true,
  confirmBeforeGenerate: false,
  draftAutoSave: true,
};

const STORAGE_KEY = "video-workspace-draft";
const RESULTS_KEY = "video-workspace-results";
let loading: Promise<void> | undefined;
let resultRevision = 0;
let pendingDraftChanges: Partial<VideoDraft> = {};

export function snapshotVideoDraft(draft: VideoDraft): VideoDraft {
  const snapshot = JSON.parse(JSON.stringify(draft)) as VideoDraft;
  const freeze = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  };
  freeze(snapshot);
  return snapshot;
}

export async function readVideoResults(owner = getLocalScope()) {
  const stored = await readChatSnapshot(localKey(RESULTS_KEY, owner));
  const results = stored?.state?.results ?? stored;
  return Array.isArray(results) ? (results as VideoResult[]) : [];
}

export async function writeVideoResults(
  results: VideoResult[],
  owner = getLocalScope(),
) {
  await writeChatSnapshot(localKey(RESULTS_KEY, owner), {
    version: 1,
    state: { results, _hasHydrated: true },
  });
  // The compatibility mirror omits attachments and rebuildable thumbnails.
  safeLocalStorage().setItem(
    localKey(RESULTS_KEY, owner),
    JSON.stringify(
      results.map(
        ({ request: _request, coverUrl: _coverUrl, ...result }) => result,
      ),
    ),
  );
}

export async function removeVideoWorkspaceData(
  owner: LocalScope = getLocalScope(),
) {
  await removeChatSnapshot(localKey(STORAGE_KEY, owner));
  await removeChatSnapshot(localKey(RESULTS_KEY, owner));
}

function saveResults(results: VideoResult[]) {
  const owner = getLocalScope();
  return persistLocalWrite(() => writeVideoResults(results, owner));
}

function autoSaveDraft() {
  const { draft, hasHydrated } = useVideoStore.getState();
  if (hasHydrated && draft.draftAutoSave)
    void useVideoStore
      .getState()
      .saveDraft()
      .catch(() => {
        // Sending still awaits a durable request snapshot and reports storage errors.
      });
}

// ─── Store ────────────────────────────────────────────────────────

export const useVideoStore = create<VideoStore>((set, get) => ({
  draft: { ...DEFAULT_DRAFT },
  draftRevision: 0,
  hasHydrated: false,

  isGenerating: false,
  generateProgress: undefined,
  generateStatus: "",

  results: [],
  selectedResultId: null,

  updateDraft: (patch) => {
    if (!get().hasHydrated)
      pendingDraftChanges = { ...pendingDraftChanges, ...patch };
    set((s) => {
      const draft = { ...s.draft, ...patch };
      if (
        patch.size === undefined &&
        (patch.resolution !== undefined || patch.aspectRatio !== undefined)
      )
        draft.size = selectedVideoSize(draft);
      return {
        draftRevision: s.draftRevision + 1,
        draft: normalizeVideoParameters(
          patch.apiFormat || patch.model || patch.mode || patch.resolution
            ? { ...draft, ...videoDraftForFormat(draft) }
            : draft,
        ),
      };
    });
    autoSaveDraft();
  },

  addMaterial: (item) => {
    const { draft } = get();
    if (draft.materials.length >= MAX_VIDEO_REFERENCES) return;
    get().updateDraft({ materials: [...draft.materials, item] });
  },

  removeMaterial: (id) => {
    const { draft } = get();
    const index = draft.materials.findIndex((material) => material.id === id);
    if (index < 0) return;
    get().updateDraft({
      materials: draft.materials.filter((m) => m.id !== id),
      prompt: removeVideoMention(draft.prompt, index + 1),
    });
  },

  clearMaterials: () => {
    get().updateDraft({
      materials: [],
      prompt: get().draft.prompt.replace(/@图片\d+/g, "[已移除图片]"),
    });
  },

  setGenerating: (v) => set({ isGenerating: v }),
  setGenerateProgress: (v, status) =>
    set({ generateProgress: v, generateStatus: status || "" }),

  addResult: async (r) => {
    if (!isLocalWorkspaceActive()) return;
    resultRevision++;
    set((s) => {
      const existing = s.results.find((result) => result.id === r.id);
      const result = {
        ...r,
        ...(existing?.request
          ? { request: existing.request }
          : r.request
          ? { request: snapshotVideoDraft(r.request) }
          : {}),
      };
      return {
        results: existing
          ? s.results.map((item) => (item.id === r.id ? result : item))
          : [...s.results, result],
        selectedResultId: existing ? s.selectedResultId : r.id,
      };
    });
    await saveResults(get().results);
  },

  updateResult: async (id, patch) => {
    if (!isLocalWorkspaceActive() || !get().results.some((r) => r.id === id))
      return;
    resultRevision++;
    set((s) => ({
      results: s.results.map((result) =>
        result.id === id ? { ...result, ...patch } : result,
      ),
    }));
    await saveResults(get().results);
  },

  removeResult: async (id) => {
    if (!isLocalWorkspaceActive()) return;
    window.dispatchEvent(new CustomEvent("stop-video-waiting", { detail: id }));
    resultRevision++;
    set((s) => ({
      results: s.results.filter((r) => r.id !== id),
      selectedResultId: s.selectedResultId === id ? null : s.selectedResultId,
    }));
    await saveResults(get().results);
    forgetTask(id);
  },

  selectResult: (id) => set({ selectedResultId: id }),

  clearResults: async () => {
    if (!isLocalWorkspaceActive()) return;
    for (const result of get().results) {
      window.dispatchEvent(
        new CustomEvent("stop-video-waiting", { detail: result.id }),
      );
      forgetTask(result.id);
    }
    resultRevision++;
    set({ results: [], selectedResultId: null });
    const owner = getLocalScope();
    await persistLocalWrite(() =>
      removeChatSnapshot(localKey(RESULTS_KEY, owner)),
    );
  },

  loadDraft: async () => {
    if (get().hasHydrated) return;
    if (loading) return loading;
    const owner = getLocalScope();
    const initialResultRevision = resultRevision;
    loading = (async () => {
      const [stored, results] = await Promise.all([
        readChatSnapshot(localKey(STORAGE_KEY, owner)),
        readVideoResults(owner),
      ]);
      if (!isLocalWorkspaceActive() || getLocalScope() !== owner) return;
      set((s) => {
        const saved = stored?.state?.draft ?? stored;
        const draft =
          saved && !Array.isArray(saved)
            ? { ...s.draft, ...saved, ...pendingDraftChanges }
            : s.draft;
        if (
          pendingDraftChanges.size === undefined &&
          (pendingDraftChanges.resolution !== undefined ||
            pendingDraftChanges.aspectRatio !== undefined)
        )
          draft.size = selectedVideoSize(draft);
        const restored = results.map((result) => ({
          ...result,
          ...(result.status === "pending" ? { phase: "paused" as const } : {}),
          ...(result.request
            ? { request: snapshotVideoDraft(result.request) }
            : {}),
        }));
        return {
          draft: normalizeVideoParameters({
            ...draft,
            ...videoDraftForFormat(draft),
          }),
          results:
            initialResultRevision === resultRevision
              ? restored
              : [
                  ...restored.filter(
                    (result) =>
                      !s.results.some((item) => item.id === result.id),
                  ),
                  ...s.results,
                ],
          hasHydrated: true,
        };
      });
      const edited = Object.keys(pendingDraftChanges).length > 0;
      pendingDraftChanges = {};
      if (edited) autoSaveDraft();
    })().finally(() => {
      loading = undefined;
    });
    return loading;
  },

  saveDraft: async () => {
    if (!isLocalWorkspaceActive() || !get().hasHydrated) return;
    const owner = getLocalScope();
    const draft = get().draft;
    await persistLocalWrite(async () => {
      await writeChatSnapshot(localKey(STORAGE_KEY, owner), {
        version: 1,
        state: { draft, _hasHydrated: true },
      });
      safeLocalStorage().setItem(
        localKey(STORAGE_KEY, owner),
        JSON.stringify({ ...draft, materials: [] }),
      );
    });
  },
}));
