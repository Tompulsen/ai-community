import type { VideoGenMode } from "../store/video";

type ParameterLimits = {
  resolutions: string[];
  durations: number[] | { min: number; max: number };
};
type VideoModelProfile = ParameterLimits & {
  models: string[];
  modes?: Partial<Record<VideoGenMode, Partial<ParameterLimits>>>;
};

// Add verified model IDs here when onboarding any video model. UI and request
// validation both consume this registry; never infer limits from its API format.
export const VIDEO_MODEL_PROFILES: VideoModelProfile[] = [
  {
    models: ["sd2.0-mini-720p"],
    resolutions: ["720p"],
    durations: { min: 4, max: 15 },
  },
  {
    models: ["wan3.0"],
    resolutions: ["720p", "1080p"],
    durations: { min: 5, max: 30 },
  },
  {
    models: ["grok-imagine-video"],
    resolutions: ["480p", "720p"],
    durations: { min: 1, max: 15 },
    modes: { "reference-to-video": { durations: { min: 1, max: 10 } } },
  },
  {
    models: ["grok-imagine-video-1.5", "grok-imagine-video-1.5-lite"],
    resolutions: ["480p", "720p", "1080p"],
    durations: { min: 1, max: 15 },
    modes: {
      "reference-to-video": { resolutions: ["480p", "720p"] },
      "first-last-frame": { resolutions: ["480p", "720p"] },
    },
  },
  {
    models: ["sora-2"],
    resolutions: ["720p"],
    durations: [4, 8, 12],
  },
  {
    models: ["sora-2-pro"],
    resolutions: ["720p", "1024p"],
    durations: [4, 8, 12],
  },
  {
    models: [
      "doubao-seedance-1-0",
      "doubao-seedance-1-0-pro",
      "doubao-seedance-1-0-pro-250528",
      "doubao-seedance-1-0-pro-fast-251015",
      "doubao-seedance-1-0-lite-t2v-250428",
      "doubao-seedance-1-0-lite-i2v-250428",
    ],
    resolutions: ["480p", "720p", "1080p"],
    durations: { min: 2, max: 12 },
  },
  {
    models: ["doubao-seedance-2-0", "seedance-2-0"],
    resolutions: ["480p", "720p", "1080p", "4k"],
    durations: { min: 4, max: 15 },
  },
  {
    models: [
      "doubao-seedance-2-0-fast",
      "doubao-seedance-2-0-mini",
      "seedance-2-0-fast",
      "seedance-2-0-mini",
    ],
    resolutions: ["480p", "720p"],
    durations: { min: 4, max: 15 },
  },
  {
    models: ["doubao-seedance-2-5", "doubao-seedance-2-5-pro", "seedance-2-5"],
    resolutions: ["480p", "720p", "1080p"],
    durations: { min: 4, max: 30 },
  },
  {
    models: ["veo-2", "veo-2.0", "veo-2.0-generate-001"],
    resolutions: ["720p"],
    durations: { min: 5, max: 8 },
  },
  {
    models: [
      "veo-3",
      "veo-3.0",
      "veo-3.0-generate-001",
      "veo-3.0-fast-generate-001",
      "veo-3.1-fast-generate-preview",
      "veo-3.1-fast-generate-001",
      "veo-3.1-fast",
    ],
    resolutions: ["720p", "1080p"],
    durations: [4, 6, 8],
    modes: { "reference-to-video": { durations: [8] } },
  },
  {
    models: ["veo-3.1", "veo-3.1-generate-preview", "veo-3.1-generate-001"],
    resolutions: ["720p", "1080p", "4k"],
    durations: [4, 6, 8],
    modes: { "reference-to-video": { durations: [8] } },
  },
];
