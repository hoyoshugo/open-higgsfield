import { getModel } from "./catalog";
import type { GenerationPlane } from "./catalog/types";

type Mapped = { path: string; body: Record<string, unknown> };
type Mapper = (plane: GenerationPlane) => Mapped;

/* Aspect ratio → fal's named flux sizes. */
const FLUX_SIZE: Record<string, string> = {
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
};

/* Aspect ratio → pixel size for the keyless draft backend. */
const DRAFT_SIZE: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "16:9": [1024, 576],
  "9:16": [576, 1024],
};

const MAP: Record<string, Mapper> = {
  "lf-draft": (plane) => {
    const [width, height] = DRAFT_SIZE[String(plane.settings.aspectRatio)] ?? DRAFT_SIZE["16:9"];
    return { path: "pol/flux", body: { prompt: plane.prompt.text, width, height } };
  },
  "flux-schnell": (plane) => ({
    path: "fal/fal-ai/flux/schnell",
    body: {
      prompt: plane.prompt.text,
      image_size: FLUX_SIZE[String(plane.settings.aspectRatio)] ?? "landscape_16_9",
      num_images: 1,
    },
  }),
  "flux-pro": (plane) => ({
    path: "fal/fal-ai/flux-pro/v1.1",
    body: {
      prompt: plane.prompt.text,
      image_size: FLUX_SIZE[String(plane.settings.aspectRatio)] ?? "landscape_16_9",
      num_images: 1,
      safety_tolerance: "2",
    },
  }),
  "kling-25-pro": (plane) => {
    const start = (plane.media.start ?? [])[0]?.url;
    const body: Record<string, unknown> = {
      prompt: plane.prompt.text,
      duration: String(plane.settings.duration),
    };
    if (start) {
      return {
        path: "fal/fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
        body: { ...body, image_url: start },
      };
    }
    return {
      path: "fal/fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
      body: { ...body, aspect_ratio: plane.settings.aspectRatio },
    };
  },
  "veo3-fast": (plane) => ({
    path: "fal/fal-ai/veo3/fast",
    body: {
      prompt: plane.prompt.text,
      aspect_ratio: plane.settings.aspectRatio,
      duration: `${plane.settings.duration}s`,
      resolution: plane.settings.resolution,
      generate_audio: plane.settings.generateAudio,
    },
  }),
};

export function toPlatform(plane: GenerationPlane): Mapped {
  const model = getModel(plane.model);
  const map = MAP[model.id];
  if (!map) throw new Error(`No platform map for ${plane.model}`);
  return map(plane);
}