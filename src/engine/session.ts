// Session controller: owns the camera and the vision worker.
// Backpressure: at most one frame in flight, so latency never piles up —
// the worker always processes the freshest frame.
//
// Capture runs from a hidden <video> the session owns, so inference keeps
// going no matter which page is on screen. Visible <video> elements only
// mirror the stream (attachVideo / detachVideo).

import { useLucid } from "../store";
import { series } from "./series";
import { cameraError } from "./cameraError";
import type { PulseWave } from "./rppg";
import type { FrameMetrics, FromWorker, ToWorker } from "./types";

const MODEL_URLS = {
  face: [
    "/models/face_landmarker.task",
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  ],
  pose: [
    "/models/pose_landmarker_lite.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  ],
};

const UI_HZ = 15;

type MetricsListener = (m: FrameMetrics) => void;
type ResetListener = () => void;

class Session {
  /** Latest landmarks for the overlay (read on rAF, not via React). */
  landmarks: Float32Array | null = null;
  /** Latest pose landmarks (33 × x,y,z,visibility) for the overlay. */
  poseLandmarks: Float32Array | null = null;
  landmarksVersion = 0;
  /** Latest pulse waveform (main-thread clock), for the cardiac panel. */
  pulse: PulseWave | null = null;

  private cap: HTMLVideoElement | null = null;
  private displays = new Set<HTMLVideoElement>();
  private listeners = new Set<MetricsListener>();
  private resetListeners = new Set<ResetListener>();
  private stopListeners = new Set<ResetListener>();
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private inFlight = false;
  private running = false;
  private ready = false;
  private frameTimes: number[] = [];
  private lastUi = 0;
  private latencyEma = 0;
  private inferEma = 0;
  private t0 = 0;
  private lastResult = 0;
  private sentAt = 0;
  private watchdog = 0;

  /** The camera in use (remembered across visits). */
  get cameraId(): string | undefined {
    try {
      return localStorage.getItem("lucid.camera") ?? undefined;
    } catch {
      return undefined;
    }
  }
  set cameraId(id: string | undefined) {
    try {
      if (id) localStorage.setItem("lucid.camera", id);
      else localStorage.removeItem("lucid.camera");
    } catch {
      /* storage unavailable */
    }
  }

  /** Switch to another camera; restarts the stream if a session is running. */
  async useCamera(id: string) {
    this.cameraId = id;
    if (!this.running) return;
    this.stop();
    await this.start();
  }

  get isRunning() {
    return this.running;
  }

  /** Mirror the camera into a visible element. */
  attachVideo(el: HTMLVideoElement) {
    this.displays.add(el);
    if (this.stream) {
      el.srcObject = this.stream;
      void el.play().catch(() => {});
    }
  }

  detachVideo(el: HTMLVideoElement) {
    this.displays.delete(el);
  }

  /** Full-rate metrics feed (every processed frame). Returns an unsubscribe fn. */
  onMetrics(fn: MetricsListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Fired when a session starts and on every recalibration (baselines must restart). */
  onReset(fn: ResetListener) {
    this.resetListeners.add(fn);
    return () => {
      this.resetListeners.delete(fn);
    };
  }

  /** Fired just before the camera stops (e.g. to save a recording). */
  onStop(fn: ResetListener) {
    this.stopListeners.add(fn);
    return () => {
      this.stopListeners.delete(fn);
    };
  }

  private captureVideo(): HTMLVideoElement {
    if (!this.cap) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("aria-hidden", "true");
      // Kept in the DOM (some browsers stop decoding detached videos) but invisible.
      Object.assign(v.style, { position: "fixed", width: "2px", height: "2px", opacity: "0", pointerEvents: "none", left: "0", top: "0" });
      document.body.appendChild(v);
      this.cap = v;
    }
    return this.cap;
  }

  async start() {
    const set = useLucid.getState().set;
    if (this.running) return;
    set({ status: "starting", stage: "Requesting camera", error: null });

    const wasmBase = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, location.href).href;
    if (!this.worker && !(await looksLikeScript(`${wasmBase}/vision_wasm_module_internal.js`))) {
      set({
        status: "error",
        error: 'MediaPipe\'s runtime files are missing from public/mediapipe. In the terminal, stop the server (Ctrl+C), run "npm install", then "npm run dev" and press Retry.',
      });
      return;
    }

    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
      this.stream = await openCamera(this.cameraId);
      const id = this.stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (id) this.cameraId = id;
    } catch (e) {
      console.warn("[lucid] camera failed", e);
      set({ status: "error", error: cameraError(e) });
      return;
    }
    // if the camera is unplugged or taken by another app mid-session
    this.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (!this.running) return;
      this.halt();
      set({ status: "error", error: "The camera stopped — it may have been unplugged or taken by another app. Press Retry." });
    });
    const cap = this.captureVideo();
    cap.srcObject = this.stream;
    await cap.play().catch(() => {});
    for (const el of this.displays) {
      el.srcObject = this.stream;
      void el.play().catch(() => {});
    }

    if (!this.worker) {
      this.worker = new Worker(new URL("./vision.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
      this.worker.onerror = (e) => this.onMessage({ type: "error", message: `Worker crashed: ${e.message}` });
      const abs = (u: string) => new URL(u, location.href).href;
      const modelUrls = { face: MODEL_URLS.face.map(abs), pose: MODEL_URLS.pose.map(abs) };
      this.send({ type: "init", wasmBase, modelUrls });
    } else {
      this.send({ type: "reset" });
    }

    series.clear();
    this.t0 = performance.now();
    this.lastResult = performance.now();
    this.running = true;
    this.startWatchdog();
    set({ sessionStart: Date.now() });
    if (this.ready) set({ status: "running" });
    for (const fn of this.resetListeners) fn();
    this.loop();
  }

  stop() {
    for (const fn of this.stopListeners) fn();
    this.halt();
    useLucid.getState().set({ status: "idle", fps: 0, metrics: null });
  }

  /** Stop camera + loop without touching UI status. */
  private halt() {
    this.running = false;
    this.inFlight = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.cap) this.cap.srcObject = null;
    for (const el of this.displays) el.srcObject = null;
    this.landmarks = null;
    this.poseLandmarks = null;
    this.pulse = null;
    this.landmarksVersion++;
  }

  /** If frames stop arriving, nudge the capture video and then explain. */
  private startWatchdog() {
    clearInterval(this.watchdog);
    this.watchdog = window.setInterval(() => {
      if (!this.running) return clearInterval(this.watchdog);
      if (!this.ready) return; // still loading models
      const now = performance.now();
      const set = useLucid.getState().set;
      if (this.inFlight) {
        // a frame is being processed — the first one compiles GPU shaders and can be slow
        if (now - this.sentAt > 20_000) set({ error: "Analysis is running very slowly on this device. Close other heavy tabs or apps; if it stays slow, your browser may be using software graphics." });
        return;
      }
      const idle = now - this.lastResult;
      const v = this.cap;
      if (idle > 2500 && v) {
        // a paused / stalled capture element is the usual cause — kick it
        if (v.paused) void v.play().catch(() => {});
        this.loop();
      }
      if (idle > 8000 && (!v || v.readyState < 2 || !v.videoWidth)) {
        set({ stage: "", error: "No video frames are arriving from the camera. Make sure no other app is using it, then press End session and Start again." });
      }
    }, 1000);
  }

  calibrate() {
    this.send({ type: "calibrate" });
    for (const fn of this.resetListeners) fn();
  }

  private send(msg: ToWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(msg, transfer);
  }

  /** generation token: starting a new loop retires any previous one */
  private loopId = 0;

  private loop = (id = ++this.loopId) => {
    if (!this.running || id !== this.loopId) return;
    const v = this.cap;
    const next = () => {
      void this.capture();
      this.loop(id);
    };
    if (v && "requestVideoFrameCallback" in v) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  };

  private async capture() {
    const v = this.cap;
    if (!this.ready || this.inFlight || !v || v.readyState < 2 || !v.videoWidth) return;
    this.inFlight = true;
    try {
      const t = performance.now();
      const bitmap = await createImageBitmap(v);
      this.sentAt = performance.now();
      this.send({ type: "frame", bitmap, t }, [bitmap]);
    } catch {
      this.inFlight = false;
    }
  }

  private onMessage(msg: FromWorker) {
    const set = useLucid.getState().set;
    switch (msg.type) {
      case "progress":
        set({ stage: msg.stage });
        break;
      case "ready":
        this.ready = true;
        this.lastResult = performance.now();
        set({ delegate: msg.delegate, initMs: msg.initMs, modalities: msg.modalities, status: this.running ? "running" : "idle", stage: "" });
        break;
      case "error":
        this.halt();
        if (!this.ready) {
          // init failed — drop the worker so Retry starts from scratch
          this.worker?.terminate();
          this.worker = null;
        }
        set({ status: "error", error: msg.message, fps: 0 });
        break;
      case "result": {
        this.inFlight = false;
        if (!this.running) return;
        this.lastResult = performance.now();
        if (useLucid.getState().error) set({ error: null });
        const now = performance.now();
        const m = msg.metrics;

        this.landmarks = msg.landmarks;
        this.poseLandmarks = msg.poseLandmarks;
        if (msg.pulse) this.pulse = msg.pulse;
        this.landmarksVersion++;
        series.push((m.t - this.t0) / 1000, m.attention, m.engagement, series.overrideLoad ?? m.load);
        for (const fn of this.listeners) fn(m);

        this.frameTimes.push(now);
        while (this.frameTimes.length && this.frameTimes[0] < now - 1000) this.frameTimes.shift();
        this.latencyEma += 0.1 * (now - msg.t - this.latencyEma);
        this.inferEma += 0.1 * (msg.inferMs - this.inferEma);

        if (now - this.lastUi > 1000 / UI_HZ) {
          this.lastUi = now;
          set({ metrics: m, fps: this.frameTimes.length, latencyMs: this.latencyEma, inferMs: this.inferEma });
        }
        break;
      }
    }
  }
}

export const session = new Session();

/** True when the URL serves JavaScript (a dev server answers missing files with index.html). */
async function looksLikeScript(url: string) {
  try {
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    return r.ok && !(r.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

const errName = (e: unknown) => (e instanceof DOMException || e instanceof Error ? e.name : "");

/**
 * Open a webcam, stepping down when a camera rejects the preferred settings
 * (common on Windows laptop webcams), and trying the other cameras if the
 * chosen one is busy or missing. Permission refusals are not retried.
 */
async function openCamera(preferred?: string): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  const variants = (id?: string): MediaStreamConstraints[] => {
    const who: MediaTrackConstraints = id ? { deviceId: { exact: id } } : { facingMode: "user" };
    return [
      { video: { ...who, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } },
      { video: { ...who, width: { ideal: 640 }, height: { ideal: 480 } } },
      { video: id ? { deviceId: { exact: id } } : true },
    ];
  };
  let first: unknown = null;
  const attempt = async (id?: string) => {
    for (const c of variants(id)) {
      try {
        return await md.getUserMedia({ ...c, audio: false });
      } catch (e) {
        first ??= e;
        const n = errName(e);
        if (n === "NotAllowedError" || n === "SecurityError") throw e;
        // a missing remembered camera: stop trying it
        if (id && (n === "NotFoundError" || n === "OverconstrainedError")) break;
      }
    }
    return null;
  };

  const s = (await attempt(preferred)) ?? (preferred ? await attempt() : null);
  if (s) return s;
  // last resort: every other camera on the machine
  const cams = (await md.enumerateDevices().catch(() => [])).filter((d) => d.kind === "videoinput" && d.deviceId);
  for (const d of cams) {
    if (d.deviceId === preferred) continue;
    const t = await attempt(d.deviceId);
    if (t) return t;
  }
  throw first ?? new DOMException("No camera", "NotFoundError");
}
