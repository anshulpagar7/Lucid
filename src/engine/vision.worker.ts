/// <reference lib="webworker" />
// Vision worker: all inference + feature extraction happens here so the UI
// thread only ever renders. Frames arrive as transferred ImageBitmaps.
//
// Modalities:
//   face — every frame (gaze, eyes, expression drive fast signals)
//   pose — throttled to ~15 Hz (posture changes slowly; saves GPU time)
//   rPPG — skin colour from forehead + cheeks every face frame → RppgEngine

import { FaceLandmarker, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { FeatureEngine, type Blendshapes, type Pt } from "./features";
import { PostureEngine, type PosePt, type PostureMetrics } from "./posture";
import { RppgEngine } from "./rppg";
import { sampleSkin } from "./skin";
import type { Delegate, FromWorker, Modalities, ToWorker } from "./types";

declare const self: DedicatedWorkerGlobalScope;

import { fresh, type Fileset } from "./fileset";

const POSE_INTERVAL_MS = 66;

let face: FaceLandmarker | null = null;
let pose: PoseLandmarker | null = null;
const engine = new FeatureEngine();
const posture = new PostureEngine();
const rppg = new RppgEngine();

let lastFaceTs = 0;
let lastPoseTs = 0;
let lastPoseRun = -Infinity;
let lastPosture: PostureMetrics | null = null;
let lastPoseLm: Float32Array | null = null;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

async function fetchFirst(urls: string[], what: string): Promise<Uint8Array> {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      // A dev server answers a missing file with index.html (status 200), so check what came back.
      if ((res.headers.get("content-type") ?? "").includes("text/html")) throw new Error(`not found: ${url}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder().decode(buf.subarray(0, 64)).trimStart().toLowerCase();
      if (buf.byteLength < 100_000 || head.startsWith("<")) throw new Error(`not a model file: ${url}`);
      return buf;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn(`[lucid] ${what} model failed`, lastErr);
  throw new Error(
    `The ${what} model couldn't be loaded. In the terminal, stop the server (Ctrl+C), run "npm run fetch-models", then "npm run dev" and press Retry.`,
  );
}

// GPU in a worker needs an OffscreenCanvas; each task gets its own GL context.
const gpuCanvas = (d: Delegate) => (d === "GPU" ? new OffscreenCanvas(1, 1) : undefined);

function createFace(fs: Fileset, model: Uint8Array, delegate: Delegate) {
  return FaceLandmarker.createFromOptions(fresh(fs), {
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    canvas: gpuCanvas(delegate),
  });
}

function createPose(fs: Fileset, model: Uint8Array, delegate: Delegate) {
  return PoseLandmarker.createFromOptions(fresh(fs), {
    baseOptions: { modelAssetBuffer: model, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    canvas: gpuCanvas(delegate),
  });
}

async function withFallback<T>(make: (d: Delegate) => Promise<T>, preferred: Delegate): Promise<[T, Delegate]> {
  if (preferred === "GPU") {
    try {
      return [await make("GPU"), "GPU"];
    } catch (e) {
      console.warn("[lucid] GPU delegate unavailable, falling back to CPU", e);
      post({ type: "progress", stage: "GPU unavailable — using CPU" });
    }
  }
  return [await make("CPU"), "CPU"];
}

async function init(wasmBase: string, urls: { face: string[]; pose: string[] }) {
  const t0 = performance.now();
  post({ type: "progress", stage: "Loading WASM runtime" });
  // useModule=true → ES-module WASM loader, required inside module workers
  const fileset = await FilesetResolver.forVisionTasks(wasmBase, true);

  post({ type: "progress", stage: "Fetching models" });
  const [faceModel, poseModel] = await Promise.all([
    fetchFirst(urls.face, "face"),
    fetchFirst(urls.pose, "pose").catch((e) => {
      console.warn("[lucid] pose model unavailable — continuing face-only", e);
      return null;
    }),
  ]);

  post({ type: "progress", stage: "Compiling face model" });
  const [f, delegate] = await withFallback((d) => createFace(fileset, faceModel, d), "GPU");
  face = f;

  if (poseModel) {
    post({ type: "progress", stage: "Compiling pose model" });
    try {
      [pose] = await withFallback((d) => createPose(fileset, poseModel, d), delegate);
    } catch (e) {
      console.warn("[lucid] pose init failed — continuing face-only", e);
      pose = null;
    }
  }

  const modalities: Modalities = { face: true, pose: !!pose, rppg: true };
  post({ type: "ready", delegate, initMs: performance.now() - t0, modalities });
}


function runPose(bitmap: ImageBitmap, t: number) {
  if (!pose || t - lastPoseRun < POSE_INTERVAL_MS) return 0;
  lastPoseRun = t;
  const ts = Math.max(t, lastPoseTs + 1);
  lastPoseTs = ts;

  const s = performance.now();
  const res = pose.detectForVideo(bitmap, ts);
  const ms = performance.now() - s;

  const lm = res.landmarks[0] as PosePt[] | undefined;
  lastPosture = posture.process(t, lm ?? null, bitmap.width, bitmap.height);
  if (lm) {
    const arr = new Float32Array(lm.length * 4);
    for (let i = 0; i < lm.length; i++) {
      arr[i * 4] = lm[i].x;
      arr[i * 4 + 1] = lm[i].y;
      arr[i * 4 + 2] = lm[i].z;
      arr[i * 4 + 3] = lm[i].visibility ?? 0;
    }
    lastPoseLm = arr;
  } else {
    lastPoseLm = null;
  }
  return ms;
}

function onFrame(bitmap: ImageBitmap, t: number) {
  if (!face) {
    bitmap.close();
    return;
  }
  // MediaPipe requires strictly increasing timestamps (per task)
  const ts = Math.max(t, lastFaceTs + 1);
  lastFaceTs = ts;

  const s = performance.now();
  const res = face.detectForVideo(bitmap, ts);
  let inferMs = performance.now() - s;
  inferMs += runPose(bitmap, t);

  const fl = res.faceLandmarks[0];
  const rgb = fl ? sampleSkin(bitmap, fl) : null;
  bitmap.close();
  if (rgb) rppg.push(t, rgb[0], rgb[1], rgb[2]);
  else rppg.miss(t);
  const cardiac = rppg.update(t);
  const wave = rppg.takeWave();
  let landmarks: Float32Array | null = null;
  let blendshapes: Blendshapes | null = null;

  if (fl) {
    landmarks = new Float32Array(fl.length * 3);
    for (let i = 0; i < fl.length; i++) {
      landmarks[i * 3] = fl[i].x;
      landmarks[i * 3 + 1] = fl[i].y;
      landmarks[i * 3 + 2] = fl[i].z;
    }
    const cats = res.faceBlendshapes[0]?.categories ?? [];
    blendshapes = {};
    for (const c of cats) blendshapes[c.categoryName] = c.score;
  }

  const metrics = engine.process(
    {
      t,
      landmarks: (fl as Pt[] | undefined) ?? null,
      blendshapes,
      matrix: res.facialTransformationMatrixes[0]?.data ?? null,
    },
    lastPosture,
    cardiac,
  );

  // Copy pose landmarks so the cached array survives the transfer
  const poseLandmarks = lastPoseLm ? lastPoseLm.slice() : null;
  const transfer: Transferable[] = [];
  if (landmarks) transfer.push(landmarks.buffer);
  if (poseLandmarks) transfer.push(poseLandmarks.buffer);
  const pulse = wave ? { ...wave, samples: wave.samples.slice() } : null;
  if (pulse) transfer.push(pulse.samples.buffer);
  post({ type: "result", t, inferMs, metrics, landmarks, poseLandmarks, pulse }, transfer);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
        await init(msg.wasmBase, msg.modelUrls);
        break;
      case "frame":
        onFrame(msg.bitmap, msg.t);
        break;
      case "calibrate":
        engine.calibrate();
        posture.calibrate();
        rppg.calibrate();
        break;
      case "reset":
        engine.reset();
        posture.reset();
        rppg.reset();
        lastPosture = null;
        lastPoseLm = null;
        lastPoseRun = -Infinity;
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
