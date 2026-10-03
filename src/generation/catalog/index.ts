import { fluxPro, fluxSchnell, kling25Pro, lfDraft, veo3Fast } from "./lumaforge";
import { parseSettings } from "./parse-settings";
import type { ModelEntry } from "./types";

export const MODELS: readonly ModelEntry[] = [
  kling25Pro,
  veo3Fast,
  fluxPro,
  fluxSchnell,
  lfDraft,
];

export function getModel(id: string): ModelEntry {
  const model = MODELS.find((entry) => entry.id === id);
  if (!model) throw new Error(`Unknown model: ${id}`);
  return model;
}

export type { GenerationPlane, MediaItem, MediaRole, ModelEntry, PlatformPaths, Surface } from "./types";
export { parseSettings };