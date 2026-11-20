// Minimal DSP toolkit: in-place radix-2 FFT and helpers. No dependencies.

/** In-place iterative radix-2 FFT. re/im length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

export function mean(a: ArrayLike<number>, from = 0, to = a.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i];
  return s / Math.max(1, to - from);
}

export function std(a: ArrayLike<number>, from = 0, to = a.length) {
  const m = mean(a, from, to);
  let s = 0;
  for (let i = from; i < to; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
}

export function median(a: number[]) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
