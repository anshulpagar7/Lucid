import { useEffect, useRef, useState } from "react";
import { session } from "../engine/session";
import { useLucid } from "../store";
import { INK, rgb } from "../theme";

const SPAN_MS = 6000;
// Draw slightly behind real time so the newest samples are always on screen.
const DELAY_MS = 450;

export function CardiacPanel() {
  const r = useLucid((s) => s.metrics?.rppg ?? null);
  const running = useLucid((s) => s.status === "running");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heartRef = useRef<SVGSVGElement>(null);

  const [ref, setRef] = useState("");
  const errs = useRef<number[]>([]);
  const [mae, setMae] = useState<number | null>(null);

  const bpm = running && r?.bpm != null ? r.bpm : null;
  const refBpm = Number(ref);
  const hasRef = ref.trim() !== "" && refBpm >= 30 && refBpm <= 220;

  // Validation against a reference device: running mean absolute error (1 Hz)
  useEffect(() => {
    errs.current = [];
    setMae(null);
    if (!hasRef) return;
    const id = setInterval(() => {
      const cur = useLucid.getState().metrics?.rppg;
      if (cur?.valid && cur.bpm != null) {
        errs.current.push(Math.abs(cur.bpm - refBpm));
        setMae(errs.current.reduce((a, b) => a + b, 0) / errs.current.length);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [hasRef, refBpm]);

  // Waveform + beat-synced heart, drawn on rAF straight from the session
  useEffect(() => {
    let raf = 0;
    let lastBeat = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      if (!c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // grid
      ctx.strokeStyle = INK.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= w; gx += w / 6) { ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, h); }
      ctx.moveTo(0, h / 2 + 0.5); ctx.lineTo(w, h / 2 + 0.5);
      ctx.stroke();

      const wave = session.pulse;
      const m = useLucid.getState().metrics?.rppg;
      if (!wave || !m || useLucid.getState().status !== "running") return;

      const right = performance.now() - DELAY_MS;
      const left = right - SPAN_MS;
      const X = (t: number) => ((t - left) / SPAN_MS) * w;
      const amp = h * 0.36;
      const alpha = m.valid ? 1 : 0.35;

      // trace with glow
      ctx.save();
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < wave.samples.length; i++) {
        const t = wave.t0 + i * wave.dt;
        if (t < left - wave.dt || t > right + wave.dt) continue;
        const v = Math.max(-2.6, Math.min(2.6, wave.samples[i]));
        const x = X(t), y = h / 2 - (v / 2.6) * amp * 1.3;
        if (started) ctx.lineTo(x, y);
        else { ctx.moveTo(x, y); started = true; }
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = INK.pulse;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();

      // fade the left edge
      const fade = ctx.createLinearGradient(0, 0, w * 0.18, 0);
      fade.addColorStop(0, `rgba(${rgb(INK.card)},1)`);
      fade.addColorStop(1, `rgba(${rgb(INK.card)},0)`);
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w * 0.18, h);

      if (!m.valid) return;
      // beat markers
      ctx.fillStyle = INK.pulse;
      for (const b of wave.beats) {
        if (b < left || b > right) continue;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(X(b) - 0.5, h - 7, 1, 5);
      }
      ctx.globalAlpha = 1;

      // pop the heart when a detected beat crosses the "now" edge
      const crossed = wave.beats.filter((b) => b <= right && b > right - 400).pop();
      if (crossed && crossed - lastBeat > 250) {
        lastBeat = crossed;
        const el = heartRef.current;
        if (el) {
          el.classList.remove("beat");
          void el.getBoundingClientRect();
          el.classList.add("beat");
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const status = !running
    ? { text: "Starts with the session", tone: "text-faint" }
    : !r || r.warmup < 1
      ? { text: `Finding your pulse, hold still (${Math.round((r?.warmup ?? 0) * 100)}%)`, tone: "text-muted" }
      : r.valid
        ? { text: r.baselineBpm ? "Locked on, resting baseline set" : "Locked on, learning your resting rate", tone: "text-ok" }
        : { text: "Signal weak — face the light, hold still", tone: "text-load" };

  const delta = bpm != null && r?.baselineBpm != null ? bpm - r.baselineBpm : null;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Heart rate from skin colour</span>
        <span className="text-[12px] text-faint">rPPG, on this device</span>
      </div>

      <div className="flex items-end gap-4">
        <div className="flex items-center gap-3">
          <svg ref={heartRef} width="30" height="30" viewBox="0 0 24 24" className="shrink-0 origin-center" style={{}}>
            <path
              d="M12 21s-7.5-4.6-9.6-9.2C.9 8.6 2.9 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.5.8-1.3 2.3-2.5 4.4-2.5 3.7 0 5.7 4.1 4.2 7.3C19.5 16.4 12 21 12 21Z"
              fill={bpm ? INK.pulse : "none"}
              stroke={bpm ? INK.pulse : "var(--color-line-2)"}
              strokeWidth="1.6"
            />
          </svg>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="num font-serif text-[44px] font-medium leading-none tracking-tight">{bpm != null ? Math.round(bpm) : "--"}</span>
              <span className="text-[13px] text-muted">bpm</span>
            </div>
            <div className={`mt-1.5 text-[11.5px] ${status.tone}`}>{status.text}</div>
          </div>
        </div>
      </div>

      {running && r && r.warmup < 1 && (
        <div className="mt-3 h-[2px] rounded-full bg-line">
          <div className="h-full rounded-full bg-pulse transition-[width] duration-300" style={{ width: `${r.warmup * 100}%` }} />
        </div>
      )}

      <canvas ref={canvasRef} className="mt-3 h-[72px] w-full rounded-lg border border-line bg-panel" />

      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
        <Stat
          label="Signal quality"
          value={running && r && r.warmup >= 1 ? `${Math.round(r.quality * 100)}` : "—"}
          unit="%"
          sub={running && r && Number.isFinite(r.snr) ? `SNR ${r.snr.toFixed(1)} dB` : "SNR —"}
          bar={running && r ? r.quality : 0}
        />
        <Stat
          label="vs resting"
          value={delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}` : "—"}
          unit="bpm"
          sub={r?.baselineBpm != null ? `baseline ${Math.round(r.baselineBpm)}` : "learning…"}
        />
        <Stat
          label="HRV · RMSSD"
          value={running && r?.rmssd != null ? r.rmssd.toFixed(0) : "—"}
          unit="ms"
          sub="experimental"
        />
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-lg border border-dashed border-line-2 px-3 py-2">
        <span className="text-[11.5px] text-muted">Validate vs watch</span>
        <input
          inputMode="numeric"
          placeholder="ref bpm"
          value={ref}
          onChange={(e) => setRef(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          className="num w-[68px] rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-[12px] text-fg outline-none placeholder:text-faint focus:border-pulse/60"
        />
        <span className="num ml-auto text-[11.5px] text-muted">
          {hasRef && bpm != null ? (
            <>
              err <span className="text-fg">{Math.abs(bpm - refBpm).toFixed(1)}</span>
              {mae != null && <span className="ml-2">MAE <span className="text-fg">{mae.toFixed(1)}</span> · n={errs.current.length}</span>}
            </>
          ) : (
            "—"
          )}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, sub, bar }: { label: string; value: string; unit?: string; sub: string; bar?: number }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <div className="text-[10.5px] text-faint">{label}</div>
      <div className="num mt-0.5 text-[15px]">
        {value}
        {unit && value !== "—" && <span className="ml-0.5 text-[10.5px] text-muted">{unit}</span>}
      </div>
      <div className="mt-0.5 text-[10px] text-faint">{sub}</div>
      {bar !== undefined && (
        <div className="mt-1.5 h-[2px] rounded-full bg-line">
          <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${bar * 100}%`, background: INK.pulse }} />
        </div>
      )}
    </div>
  );
}
