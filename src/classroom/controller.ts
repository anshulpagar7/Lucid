// Classroom controller: owns its media source + worker, the tracker and the
// class timeline. Same backpressure rule as Live: one frame in flight.

import { session } from "../engine/session";
import { aggregate, classMoments, type ClassPoint } from "./classMetrics";
import { useClass } from "./store";
import { Tracker, type Track } from "./tracker";
import type { FaceObs, FromClassWorker, SourceKind, ToClassWorker } from "./types";

const MODEL_URLS = [
  "/models/face_landmarker.task",
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
];
const UI_MS = 250;

class Classroom {
  /** media element frames are taken from (also drawn by the stage) */
  video: HTMLVideoElement | null = null;
  /** latest tracks for the stage canvas (read on rAF) */
  tracks: Track[] = [];
  /** 1 Hz class timeline */
  timeline: ClassPoint[] = [];
  timelineVersion = 0;

  private worker: Worker | null = null;
  private ready = false;
  private running = false;
  private inFlight = false;
  private stream: MediaStream | null = null;
  private objectUrl: string | null = null;
  private tracker = new Tracker();
  private t0 = 0;
  private lastUi = 0;
  private lastPoint = -1;
  private frames: number[] = [];
  private inferEma = 0;

  private media(): HTMLVideoElement {
    if (!this.video) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      Object.assign(v.style, { position: "fixed", width: "2px", height: "2px", opacity: "0", pointerEvents: "none", left: "0", top: "0" });
      document.body.appendChild(v);
      this.video = v;
    }
    return this.video;
  }

  async start(kind: SourceKind, file?: File) {
    const set = useClass.getState().set;
    if (this.running) this.stop();
    set({ status: "starting", stage: "Opening source", error: null, source: kind });
    const v = this.media();
    try {
      if (kind === "file") {
        if (!file) throw new Error("No video file selected");
        this.objectUrl = URL.createObjectURL(file);
        v.srcObject = null;
        v.src = this.objectUrl;
        set({ sourceLabel: file.name });
      } else {
        if (kind === "camera" && session.isRunning) session.stop(); // free the webcam
        this.stream =
          kind === "camera"
            ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false })
            : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
        this.stream.getVideoTracks()[0]?.addEventListener("ended", () => this.stop());
        v.removeAttribute("src");
        v.srcObject = this.stream;
        set({ sourceLabel: kind === "camera" ? "Webcam" : this.stream.getVideoTracks()[0]?.label || "Shared screen" });
      }
      await v.play();
    } catch (e) {
      const msg = e instanceof Error && e.name === "NotAllowedError" ? "Permission was denied." : e instanceof Error ? e.message : String(e);
      this.cleanupSource();
      set({ status: "error", error: msg });
      return;
    }

    if (!this.worker) {
      this.worker = new Worker(new URL("./classroom.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<FromClassWorker>) => this.onMessage(e.data);
      this.worker.onerror = (e) => this.onMessage({ type: "error", message: `Worker crashed: ${e.message}` });
      const abs = (u: string) => new URL(u, location.href).href;
      this.send({ type: "init", wasmBase: abs(`${import.meta.env.BASE_URL}mediapipe/wasm`), modelUrls: MODEL_URLS.map(abs), numFaces: useClass.getState().maxFaces });
    }
    this.reset();
    this.running = true;
    set({ startedAt: Date.now(), status: this.ready ? "running" : "starting" });
    this.loop();
  }

  stop() {
    this.running = false;
    this.inFlight = false;
    this.cleanupSource();
    useClass.getState().set({ status: "idle", fps: 0 });
  }

  setMaxFaces(n: number) {
    useClass.getState().set({ maxFaces: n });
    this.send({ type: "faces", numFaces: n });
  }

  /** Feed a result directly (used by the worker, and by tests/demos). */
  ingest(t: number, faces: FaceObs[], inferMs = 0) {
    this.inFlight = false;
    if (!this.running) return;
    const now = performance.now();
    this.tracks = this.tracker.update(t, faces);
    const snap = aggregate(this.tracks);

    const sec = Math.floor((t - this.t0) / 1000);
    if (sec > this.lastPoint) {
      this.lastPoint = sec;
      this.timeline.push({ t: sec, n: snap.n, attention: snap.attention, focused: snap.shares.focused, down: snap.shares.down, away: snap.shares.away });
      this.timelineVersion++;
    }

    this.frames.push(now);
    while (this.frames.length && this.frames[0] < now - 1000) this.frames.shift();
    this.inferEma += 0.1 * (inferMs - this.inferEma);
    if (now - this.lastUi > UI_MS) {
      this.lastUi = now;
      useClass.getState().set({ tracks: this.tracks.map((tr) => ({ ...tr, history: [...tr.history] })), snapshot: snap, fps: this.frames.length, inferMs: this.inferEma, moments: classMoments(this.timeline) });
    }
  }

  get elapsed() {
    return (performance.now() - this.t0) / 1000;
  }

  private reset() {
    this.tracker.reset();
    this.tracks = [];
    this.timeline = [];
    this.timelineVersion++;
    this.lastPoint = -1;
    this.t0 = performance.now();
    useClass.getState().set({ tracks: [], snapshot: null, moments: [] });
  }

  private cleanupSource() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video.removeAttribute("src");
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private send(m: ToClassWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(m, transfer);
  }

  private loop = () => {
    if (!this.running) return;
    const v = this.video!;
    const next = () => {
      void this.capture();
      this.loop();
    };
    if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  };

  private async capture() {
    const v = this.video;
    if (!this.ready || this.inFlight || !v || v.readyState < 2 || !v.videoWidth) return;
    this.inFlight = true;
    try {
      const bitmap = await createImageBitmap(v);
      this.send({ type: "frame", bitmap, t: performance.now() }, [bitmap]);
    } catch {
      this.inFlight = false;
    }
  }

  private onMessage(m: FromClassWorker) {
    const set = useClass.getState().set;
    if (m.type === "progress") set({ stage: m.stage });
    else if (m.type === "ready") {
      this.ready = true;
      set({ delegate: m.delegate, stage: "", status: this.running ? "running" : "idle" });
    } else if (m.type === "result") this.ingest(m.t, m.faces, m.inferMs);
    else if (m.type === "error") {
      if (!this.ready) {
        this.worker?.terminate();
        this.worker = null;
      }
      this.stop();
      set({ status: "error", error: m.message });
    }
  }
}

export const classroom = new Classroom();
