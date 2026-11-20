import { ROIS, convexHull } from "./roi";

// rPPG skin sampler: mean RGB of the forehead + cheek ROIs for one frame.
// The ROI hulls are used as a canvas clip mask ("destination-in"), the face
// box is downscaled (which averages pixels for free), and only that small
// image is read back. Typically < 1 ms.
const SAMPLE_W = 96;
const skinCanvas = new OffscreenCanvas(SAMPLE_W, SAMPLE_W);
const skin = skinCanvas.getContext("2d", { willReadFrequently: true })!;

export function sampleSkin(bitmap: ImageBitmap, lm: { x: number; y: number }[]): [number, number, number] | null {
  const W = bitmap.width, H = bitmap.height;
  const hulls = ROIS.map((idx) => convexHull(idx.map((i) => ({ x: lm[i].x * W, y: lm[i].y * H }))));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const h of hulls) for (const p of h) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw < 16 || bh < 16) return null;

  const sc = Math.min(1, SAMPLE_W / bw);
  const cw = Math.max(1, Math.round(bw * sc)), ch = Math.max(1, Math.round(bh * sc));
  if (skinCanvas.width !== cw || skinCanvas.height !== ch) {
    skinCanvas.width = cw;
    skinCanvas.height = ch;
  }
  skin.globalCompositeOperation = "copy";
  skin.drawImage(bitmap, x0, y0, bw, bh, 0, 0, cw, ch);
  skin.globalCompositeOperation = "destination-in";
  skin.beginPath();
  for (const h of hulls) {
    h.forEach((p, k) => {
      const px = (p.x - x0) * sc, py = (p.y - y0) * sc;
      if (k) skin.lineTo(px, py);
      else skin.moveTo(px, py);
    });
    skin.closePath();
  }
  skin.fill();

  const d = skin.getImageData(0, 0, cw, ch).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 250) continue; // outside ROI / anti-aliased edge
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const lum = 0.299 * R + 0.587 * G + 0.114 * B;
    if (lum < 25 || R > 250 || G > 250) continue; // shadow / specular highlight
    r += R; g += G; b += B; n++;
  }
  return n >= 40 ? [r / n, g / n, b / n] : null;
}
