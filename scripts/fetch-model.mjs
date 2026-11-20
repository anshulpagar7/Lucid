// Downloads the MediaPipe models into /public/models so the app works fully
// offline (handy for demos / viva on college Wi-Fi).
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://storage.googleapis.com/mediapipe-models";
const MODELS = {
  "face_landmarker.task": `${BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  "pose_landmarker_lite.task": `${BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
};

mkdirSync("public/models", { recursive: true });
for (const [name, url] of Object.entries(MODELS)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${name}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(`public/models/${name}`, buf);
  console.log(`[lucid] ${name} saved (${(buf.length / 1e6).toFixed(1)} MB)`);
}
