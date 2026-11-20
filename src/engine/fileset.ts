// MediaPipe's ES-module WASM loader registers a global `ModuleFactory` once and
// deletes it after the first task is created. Because `import()` caches the
// loader module, a second task (pose after face, or a CPU retry after a failed
// GPU attempt) then fails with "ModuleFactory not set". Giving every task
// creation its own loader URL makes the browser evaluate a fresh module
// instance, which re-registers the factory.

import type { FilesetResolver } from "@mediapipe/tasks-vision";

export type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let n = 0;

export function fresh(fs: Fileset): Fileset {
  const sep = fs.wasmLoaderPath.includes("?") ? "&" : "?";
  return { ...fs, wasmLoaderPath: `${fs.wasmLoaderPath}${sep}instance=${++n}` };
}
