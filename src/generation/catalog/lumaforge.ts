import type { ModelEntry } from "./types";

const IMAGE_ASPECT = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;

/* Free tier: keyless, instant, draft quality — for ideation before spending
   premium credits. */
export const lfDraft: ModelEntry = {
  id: "lf-draft",
  surface: "image",
  label: "Draft (free)",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: IMAGE_ASPECT, default: "16:9" },
  },
};

export const fluxSchnell: ModelEntry = {
  id: "flux-schnell",
  surface: "image",
  label: "Flux Schnell",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: IMAGE_ASPECT, default: "16:9" },
  },
};

export const fluxPro: ModelEntry = {
  id: "flux-pro",
  surface: "image",
  label: "Flux Pro 1.1",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: IMAGE_ASPECT, default: "16:9" },
  },
};

export const kling25Pro: ModelEntry = {
  id: "kling-25-pro",
  surface: "video",
  label: "Kling 2.5 Turbo Pro",
  roles: { start: 1 },
  settings: {
    aspectRatio: { type: "enum", values: ["16:9", "9:16", "1:1"], default: "16:9" },
    duration: { type: "range", min: 5, max: 10, default: 5, step: 5 },
  },
};

export const veo3Fast: ModelEntry = {
  id: "veo3-fast",
  surface: "video",
  label: "Veo 3 Fast (with audio)",
  roles: {},
  settings: {
    aspectRatio: { type: "enum", values: ["16:9", "9:16"], default: "16:9" },
    resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
    duration: { type: "range", min: 4, max: 8, default: 8, step: 2 },
    generateAudio: { type: "boolean", default: true },
  },
};