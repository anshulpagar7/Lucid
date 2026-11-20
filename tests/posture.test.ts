import { describe, expect, it } from "vitest";
import { PostureEngine, type PosePt } from "../src/engine/posture";

const W = 1280, H = 720;
function body({ sw = 0.25, neck = 0.22, hand = false, tilt = 0 } = {}): PosePt[] {
  const lm: PosePt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const shY = 0.8, cx = 0.5, noseY = shY - (neck * sw * W) / H;
  lm[11] = { x: cx + sw / 2, y: shY - tilt, z: 0, visibility: 0.99 };
  lm[12] = { x: cx - sw / 2, y: shY + tilt, z: 0, visibility: 0.99 };
  lm[0] = { x: cx, y: noseY, z: 0, visibility: 0.99 };
  lm[9] = { x: cx + 0.02, y: noseY + 0.05, z: 0, visibility: 0.99 };
  lm[10] = { x: cx - 0.02, y: noseY + 0.05, z: 0, visibility: 0.99 };
  if (hand) for (const i of [16, 18, 20, 22]) lm[i] = { x: cx - 0.01, y: noseY + 0.07, z: 0, visibility: 0.95 };
  return lm;
}

function session() {
  const e = new PostureEngine();
  let t = 0;
  const run = (frames: number, b: PosePt[] | null) => {
    let o = e.process(t, b, W, H);
    for (let i = 0; i < frames; i++) o = e.process((t += 66), b, W, H);
    return o;
  };
  run(30, body()); // calibrate upright
  return run;
}

describe("posture engine", () => {
  it("calibrates to upright", () => expect(session()(5, body()).state).toBe("upright"));
  it("detects leaning in", () => expect(session()(30, body({ sw: 0.3 })).state).toBe("leaning-in"));
  it("detects leaning back", () => expect(session()(30, body({ sw: 0.21 })).state).toBe("leaning-back"));
  it("detects slouching", () => expect(session()(30, body({ neck: 0.11 })).state).toBe("slouching"));
  it("waits 1.5 s before calling head-on-hand", () => {
    const run = session();
    expect(run(15, body({ hand: true })).state).not.toBe("head-on-hand");
    expect(run(15, body({ hand: true })).state).toBe("head-on-hand");
  });
  it("reports unknown when shoulders leave the frame", () => {
    const o = session()(3, null);
    expect(o.visible).toBe(false);
    expect(o.state).toBe("unknown");
  });
  it("is invariant to camera distance (same posture, closer camera, recalibrated)", () => {
    const e = new PostureEngine();
    let t = 0, o = e.process(t, body({ sw: 0.4 }), W, H);
    for (let i = 0; i < 40; i++) o = e.process((t += 66), body({ sw: 0.4 }), W, H);
    expect(o.state).toBe("upright");
    expect(Math.abs(o.lean)).toBeLessThan(0.05);
  });
});
