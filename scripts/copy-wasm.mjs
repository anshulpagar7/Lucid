// Copies MediaPipe's WASM runtime into /public so the app never depends on a CDN for it.
import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/@mediapipe/tasks-vision/wasm";
const dst = "public/mediapipe/wasm";
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log("[lucid] MediaPipe wasm copied to", dst);
}
