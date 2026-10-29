// The scenes the director knows: every `scenes/<scene id>.json`, read strictly. A file that does not read stays in the
// list with the reason, so `#/director` shows it and the test fails on it, instead of the scene silently being absent.

import type { Read } from "../intake/strict";
import { parseScene, type Scene } from "./script";
import manifest from "./sources.json";
import type { Sources } from "./sources";

const files = import.meta.glob("./scenes/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

export interface SceneFile {
  /** The file's name without `.json`: what the address calls it. */
  id: string;
  read: Read<Scene>;
}

const idOf = (path: string): string => path.replace(/^.*\//, "").replace(/\.json$/, "");

export const SCENE_FILES: SceneFile[] = Object.entries(files)
  .map(([path, raw]) => ({ id: idOf(path), read: parseScene(raw) }))
  .sort((a, b) => a.id.localeCompare(b.id));

export const sceneFile = (id: string): SceneFile | null => SCENE_FILES.find((file) => file.id === id) ?? null;

/** The runs the scenes play unless the address says otherwise; filled in when the final pair is recorded. */
export const SOURCES: Partial<Sources> = manifest;
