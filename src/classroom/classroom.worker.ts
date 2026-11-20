/// <reference lib="webworker" />
// Classroom worker: multi-face landmarks → compact per-face observations.

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { gazeFromBlendshapes, headPoseFromMatrix } from "../engine/features";
import type { Delegate } from "../engine/types";
import { fresh } from "../engine/fileset";
import type { FaceObs, FromClassWorker, ToClassWorker } from "./types";

declare const self: DedicatedWorkerGlobalScope;

let lm: FaceLandmarker | null = null;
let lastTs = 0;
const post = (m: FromClassWorker) => self.postMessage(m);

async function fetchFirst(urls: string[]) {
  let err: unknown;
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${r.status} ${u}`);
      const b = new Uint8Array(await r.arrayBuffer());
      if (b.byteLength > 1024) return b;
    } catch (e) {
      err = e;
    }
  }
  throw new Error(`Could not load face model: ${String(err)}`);
}

async function init(wasmBase: string, urls: string[], numFaces: number) {
  post({ type: "progress", stage: "Loading WASM runtime" });
  const fs = await FilesetResolver.forVisionTasks(wasmBase, true);
  post({ type: "progress", stage: "Fetching face model" });
  const model = await fetchFirst(urls);
  const make = (delegate: Delegate) =>
    FaceLandmarker.createFromOptions(fresh(fs), {
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: "VIDEO",
      numFaces,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.45,
      minFacePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
      canvas: delegate === "GPU" ? new OffscreenCanvas(1, 1) : undefined,
    });
  post({ type: "progress", stage: "Compiling on GPU" });
  let delegate: Delegate = "GPU";
  try {
    lm = await make("GPU");
  } catch {
    delegate = "CPU";
    lm = await make("CPU");
  }
  post({ type: "ready", delegate });
}

function onFrame(bitmap: ImageBitmap, t: number) {
  if (!lm) return bitmap.close();
  const ts = Math.max(t, lastTs + 1);
  lastTs = ts;
  const s = performance.now();
  const res = lm.detectForVideo(bitmap, ts);
  const inferMs = performance.now() - s;
  bitmap.close();

  const faces: FaceObs[] = [];
  res.faceLandmarks.forEach((pts, i) => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    const b: Record<string, number> = {};
    for (const c of res.faceBlendshapes[i]?.categories ?? []) b[c.categoryName] = c.score;
    const m = res.facialTransformationMatrixes[i]?.data;
    const pose = m ? headPoseFromMatrix(m) : { yaw: 0, pitch: 0, roll: 0 };
    const g = gazeFromBlendshapes(b);
    faces.push({
      box: [x0, y0, x1 - x0, y1 - y0],
      nose: [pts[1].x, pts[1].y],
      center: [(x0 + x1) / 2, (y0 + y1) / 2],
      yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll,
      gazeX: g.x, gazeY: g.y,
      eyeClosure: ((b.eyeBlinkLeft ?? 0) + (b.eyeBlinkRight ?? 0)) / 2,
    });
  });
  post({ type: "result", t, inferMs, faces });
}

self.onmessage = async (e: MessageEvent<ToClassWorker>) => {
  const m = e.data;
  try {
    if (m.type === "init") await init(m.wasmBase, m.modelUrls, m.numFaces);
    else if (m.type === "frame") onFrame(m.bitmap, m.t);
    else if (m.type === "faces") await lm?.setOptions({ numFaces: m.numFaces });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
