// Python ↔ TypeScript parity: the browser must compute exactly what the model was trained on.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLUMNS, BLENDSHAPES, type Row } from "../src/study/schema";
import { LABEL_COLUMNS } from "../src/study/export";
import { FEATURES, baselineVector, relative, segmentWindows } from "../src/model/features";
import { predict, type ModelJson } from "../src/model/fusion";

const fx = JSON.parse(readFileSync(new URL("./fixtures/parity.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../ml/schema.json", import.meta.url), "utf8"));

const close = (a: number | null, b: number | null) => {
  const na = a == null || Number.isNaN(a), nb = b == null || Number.isNaN(b);
  if (na || nb) return na && nb;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
};

describe("schema", () => {
  it("ml/schema.json matches the TypeScript schema (run `npm run schema` if this fails)", () => {
    expect(schema.columns).toEqual([...COLUMNS]);
    expect(schema.label_columns).toEqual(LABEL_COLUMNS);
    expect(schema.blendshapes).toEqual([...BLENDSHAPES]);
  });
  it("fixture was generated with the current schema", () => expect(fx.columns).toEqual([...COLUMNS]));
});

describe("feature parity with Python", () => {
  for (const seg of ["baseline", "block"] as const) {
    it(`${seg}: same windows and identical features`, () => {
      const rows: Row[] = fx.segments[seg].rows;
      const ts = segmentWindows(rows);
      const py = fx.segments[seg].windows;
      expect(ts.length).toBe(py.length);
      expect(ts.length).toBeGreaterThan(0);
      ts.forEach((w, i) => {
        for (const k of [...FEATURES, "_face_frac", "_t0"]) {
          if (!close(w[k], py[i][k])) throw new Error(`window ${i} feature ${k}: ts=${w[k]} py=${py[i][k]}`);
        }
      });
    });
  }

  it("baseline vector and baseline-relative inputs match", () => {
    const base = baselineVector(segmentWindows(fx.segments.baseline.rows));
    for (const k of FEATURES) expect(close(base[k], fx.baseline_vector[k])).toBe(true);
    const rel = segmentWindows(fx.segments.block.rows).map((w) => relative(w, base));
    rel.forEach((r, i) => r.forEach((v, j) => expect(close(v, fx.relative[i][j])).toBe(true)));
  });
});

describe("model runtime parity with Python", () => {
  it("same probabilities, load and modality contributions", () => {
    const model = fx.model as ModelJson;
    expect(model.features).toEqual(FEATURES);
    (fx.relative as number[][]).forEach((r, i) => {
      const ts = predict(model, r), py = fx.predictions[i];
      ts.proba.forEach((p, k) => expect(close(p, py.proba[k])).toBe(true));
      expect(close(ts.load, py.load)).toBe(true);
      for (const m of Object.keys(py.contributions)) expect(close(ts.contributions[m], py.contributions[m])).toBe(true);
    });
  });
});
