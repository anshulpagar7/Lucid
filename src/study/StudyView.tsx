import { useCallback, useEffect, useRef, useState } from "react";
import { session } from "../engine/session";
import { useLucid } from "../store";
import { MiniMonitor } from "../components/MiniMonitor";
import { NBackTask } from "./NBackTask";
import { TlxForm } from "./TlxForm";
import { Fixation } from "./Fixation";
import { Summary } from "./Summary";
import { Recorder } from "./recorder";
import { COLUMNS } from "./schema";
import { deleteStudy, listStudies, saveStudy } from "./db";
import { download, summaryCsv, trainingCsv } from "./export";
import { PROTOCOLS, blockOrder, generateSequence, hash, rawTlx, scoreBlock, type NLevel, type Response, type Trial } from "./protocol";
import type { StudyRecord, TrialEvent } from "./types";

type ProtocolKey = keyof typeof PROTOCOLS;

type Step =
  | { k: "home" }
  | { k: "check" }
  | { k: "practice-intro" }
  | { k: "practice"; seq: Trial[] }
  | { k: "baseline" }
  | { k: "block-intro"; b: number }
  | { k: "block"; b: number; seq: Trial[]; startMs: number }
  | { k: "tlx"; b: number }
  | { k: "rest"; b: number }
  | { k: "summary" };

const FOCUS = new Set(["practice-intro", "practice", "baseline", "block-intro", "block", "tlx", "rest"]);

export function StudyView() {
  const [step, setStep] = useState<Step>({ k: "home" });
  const [studies, setStudies] = useState<StudyRecord[]>([]);
  const [abortAsk, setAbortAsk] = useState(false);
  const rec = useRef<Recorder | null>(null);
  const study = useRef<StudyRecord | null>(null);
  const cfg = useRef(PROTOCOLS.full);

  const refresh = useCallback(() => void listStudies().then(setStudies).catch(() => setStudies([])), []);
  useEffect(refresh, [refresh]);

  const persist = () => study.current && saveStudy(study.current).catch((e) => console.error("[lucid] save failed", e));

  const begin = (pid: string, key: ProtocolKey) => {
    cfg.current = PROTOCOLS[key];
    const { delegate, modalities } = useLucid.getState();
    study.current = {
      id: crypto.randomUUID(),
      participantId: pid,
      protocol: key,
      startedAt: Date.now(),
      finishedAt: null,
      order: blockOrder(pid),
      baseline: null,
      blocks: [],
      rows: [],
      columns: [...COLUMNS],
      env: { delegate, pose: !!modalities?.pose, rppg: !!modalities?.rppg, userAgent: navigator.userAgent },
      complete: false,
    };
    setStep({ k: "check" });
  };

  const startRecording = () => {
    rec.current?.stop();
    rec.current = new Recorder();
    study.current!.rows = rec.current.rows; // same array — rows stream straight in
  };

  const finish = (complete: boolean) => {
    rec.current?.stop();
    const s = study.current;
    if (s) {
      s.complete = complete;
      s.finishedAt = Date.now();
      persist()?.then(refresh);
    }
    setStep(s && (s.blocks.length || complete) ? { k: "summary" } : { k: "home" });
  };

  // ESC → abort confirmation during focus mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && FOCUS.has(step.k) && setAbortAsk(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step.k]);

  const s = study.current;
  const c = cfg.current;
  const nOf = (b: number): NLevel => s!.order[b];

  let focus: React.ReactNode = null;
  switch (step.k) {
    case "practice-intro":
      focus = (
        <Intro
          kicker="Practice · not recorded as data"
          title="Let's practise the 1-back"
          body="A letter appears every few seconds. Press Space when it is the same as the letter one step before. You'll see green for a hit and red for a miss — feedback is only shown in practice."
          cta="Start practice"
          onGo={() => {
            startRecording();
            rec.current!.set({ phase: "practice" });
            setStep({ k: "practice", seq: generateSequence(1, c.practiceTrials, 0.35, hash(s!.participantId) + 1) });
          }}
        />
      );
      break;
    case "practice":
      focus = (
        <NBackTask key="practice" n={1} trials={step.seq} stimMs={c.stimMs} soaMs={c.soaMs} feedback clock={() => rec.current!.now()}
          onTrial={(i) => rec.current!.set({ trial: i })}
          onDone={() => {
            rec.current!.set({ phase: "baseline", trial: -1 });
            session.calibrate(); // re-learn neutral pose + resting heart rate during baseline
            s!.baseline = { startMs: rec.current!.now(), endMs: 0 };
            setStep({ k: "baseline" });
          }}
        />
      );
      break;
    case "baseline":
      focus = (
        <Fixation key="baseline" seconds={c.baselineS} title="Resting baseline" note="Sit comfortably, relax and look at the cross. This measures your resting heart rate and neutral posture."
          onDone={() => {
            s!.baseline!.endMs = rec.current!.now();
            rec.current!.set({ phase: "other" });
            persist();
            setStep({ k: "block-intro", b: 0 });
          }}
        />
      );
      break;
    case "block-intro": {
      const n = nOf(step.b);
      focus = (
        <Intro
          kicker={`Block ${step.b + 1} of ${s!.order.length}`}
          title={`${n}-back`}
          body={n === 0 ? "Press Space whenever you see the letter X." : `Press Space when the letter matches the one ${n} step${n > 1 ? "s" : ""} back. No feedback this time — just do your best.`}
          cta="Start block"
          big
          onGo={() => {
            const seq = generateSequence(n, c.trials, c.targetRate, hash(s!.participantId) + 7919 * (step.b + 1) + n);
            rec.current!.set({ phase: "block", block: step.b, n, trial: -1 });
            setStep({ k: "block", b: step.b, seq, startMs: rec.current!.now() });
          }}
        />
      );
      break;
    }
    case "block": {
      const n = nOf(step.b);
      focus = (
        <NBackTask key={`b${step.b}`} n={n} trials={step.seq} stimMs={c.stimMs} soaMs={c.soaMs} clock={() => rec.current!.now()}
          onTrial={(i) => rec.current!.set({ trial: i })}
          onDone={(responses: Response[], events: TrialEvent[]) => {
            s!.blocks.push({
              index: step.b, n, startMs: step.startMs, endMs: rec.current!.now(),
              trials: step.seq, events, responses, score: scoreBlock(step.seq, responses, n), tlx: null, rawTlx: null,
            });
            rec.current!.set({ phase: "tlx", trial: -1 });
            persist();
            setStep({ k: "tlx", b: step.b });
          }}
        />
      );
      break;
    }
    case "tlx":
      focus = (
        <TlxForm key={`t${step.b}`} title={`How was the ${nOf(step.b)}-back?`}
          onSubmit={(r) => {
            const blk = s!.blocks.find((x) => x.index === step.b)!;
            blk.tlx = r;
            blk.rawTlx = rawTlx(r);
            persist();
            if (step.b + 1 >= s!.order.length) finish(true);
            else {
              rec.current!.set({ phase: "rest", block: -1, n: -1 });
              setStep({ k: "rest", b: step.b });
            }
          }}
        />
      );
      break;
    case "rest":
      focus = (
        <Fixation key={`r${step.b}`} seconds={c.restS} title="Short break" note="Relax your eyes and breathe. The next block starts automatically."
          onDone={() => {
            rec.current!.set({ phase: "other" });
            setStep({ k: "block-intro", b: step.b + 1 });
          }}
        />
      );
      break;
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
        {step.k === "summary" && s ? (
          <Summary study={s} onDone={() => setStep({ k: "home" })} />
        ) : step.k === "check" ? (
          <SetupCheck onBack={() => setStep({ k: "home" })} onGo={() => setStep({ k: "practice-intro" })} />
        ) : (
          <Home studies={studies} onBegin={begin} />
        )}
      </div>
      <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4">
        <MiniMonitor />
        <Sessions studies={studies} onChange={refresh} />
      </aside>

      {focus && (
        <div className="fixed inset-0 z-[45] flex flex-col bg-bg/[0.97] backdrop-blur-sm">
          <div className="flex items-center justify-between px-6 py-4">
            <span className="label">
              Lucid study · {s?.participantId} · {c.name}
            </span>
            <FocusStatus />
            <button className="text-[12px] text-faint hover:text-muted" onClick={() => setAbortAsk(true)}>
              Esc · end study
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 pb-10">{focus}</div>
          {abortAsk && (
            <div className="absolute inset-0 flex items-center justify-center bg-fg/30 backdrop-blur-[2px]">
              <div className="panel w-[380px] p-5">
                <h3 className="text-[15px] font-semibold">End the study now?</h3>
                <p className="mt-1.5 text-[13px] text-muted">Everything recorded so far is kept and saved as a partial session.</p>
                <div className="mt-5 flex justify-end gap-2">
                  <button className="btn" onClick={() => setAbortAsk(false)}>Keep going</button>
                  <button className="btn btn-primary" onClick={() => { setAbortAsk(false); finish(false); }}>End & save</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Tiny signal indicator so the experimenter can see data quality during the task. */
function FocusStatus() {
  const m = useLucid((s) => s.metrics);
  const running = useLucid((s) => s.status === "running");
  const dot = (ok: boolean) => <span className={`h-1.5 w-1.5 rounded-full ${!running ? "bg-bad" : ok ? "bg-ok" : "bg-load"}`} />;
  return (
    <span className="flex items-center gap-4 text-[12px] text-faint">
      <span className="flex items-center gap-1.5">{dot(!!m?.facePresent)} face</span>
      <span className="flex items-center gap-1.5">{dot(!!m?.posture?.visible)} body</span>
      <span className="flex items-center gap-1.5">{dot(!!m?.rppg?.valid)} pulse</span>
      <span className="flex items-center gap-1.5"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-bad" /> rec</span>
    </span>
  );
}

function Intro({ kicker, title, body, cta, onGo, big = false }: { kicker: string; title: string; body: string; cta: string; onGo: () => void; big?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        onGo();
      }
    };
    // small delay so the key that ended the previous screen doesn't skip this one
    const id = setTimeout(() => window.addEventListener("keydown", onKey), 400);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [onGo]);
  return (
    <div className="fade-in max-w-[520px] text-center">
      <div className="label mb-3">{kicker}</div>
      <h2 className={`${big ? "num text-[64px]" : "text-[28px]"} font-semibold leading-none tracking-tight`}>{title}</h2>
      <p className="mx-auto mt-5 max-w-md text-[14px] leading-relaxed text-muted">{body}</p>
      <button className="btn btn-primary mt-8" onClick={onGo}>
        {cta} <kbd className="ml-1 rounded border border-white/25 px-1.5 py-0.5 text-[11px] font-normal">Space</kbd>
      </button>
    </div>
  );
}

function Home({ studies, onBegin }: { studies: StudyRecord[]; onBegin: (pid: string, p: ProtocolKey) => void }) {
  const next = studies.reduce((m, s) => Math.max(m, parseInt(s.participantId.replace(/\D/g, ""), 10) || 0), 0) + 1;
  const [pid, setPid] = useState("");
  const [proto, setProto] = useState<ProtocolKey>("full");
  const [consent, setConsent] = useState(false);
  const id = (pid || `P${String(next).padStart(2, "0")}`).trim().toUpperCase();
  const order = blockOrder(id);
  const p = PROTOCOLS[proto];
  const totalMin = Math.round((p.baselineS + order.length * ((p.trials * p.soaMs) / 1000 + 45) + (order.length - 1) * p.restS + p.practiceTrials * (p.soaMs / 1000)) / 60);

  return (
    <div className="fade-in space-y-4">
      <div>
        <h1 className="text-[34px] leading-tight tracking-[-0.02em]">Study mode</h1>
        <p className="text-[13px] text-muted">Induce cognitive load with the n-back task, label it with NASA-TLX, and record every signal as training data.</p>
      </div>

      <div className="panel p-5">
        <div className="label mb-4">{p.name}, about {totalMin} minutes</div>
        <Timeline order={order} cfg={p} />
      </div>

      <div className="panel grid gap-5 p-5 md:grid-cols-2">
        <div className="space-y-4">
          <label className="block">
            <span className="text-[12px] text-muted">Participant ID</span>
            <input
              value={pid}
              placeholder={`P${String(next).padStart(2, "0")}`}
              onChange={(e) => setPid(e.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12))}
              className="num mt-1.5 block w-full rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[14px] outline-none placeholder:text-faint focus:border-att/60"
            />
            <span className="mt-1 block text-[11px] text-faint">Pseudonymous — never use real names. The number sets the counterbalanced block order.</span>
          </label>
          <div>
            <span className="text-[12px] text-muted">Protocol</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(Object.keys(PROTOCOLS) as ProtocolKey[]).map((k) => (
                <button key={k} onClick={() => setProto(k)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${proto === k ? "border-att/60 bg-att/10" : "border-line-2 bg-panel-2 hover:border-line-2"}`}>
                  <div className="text-[13px] font-medium">{PROTOCOLS[k].name}</div>
                  <div className="num text-[11px] text-faint">{PROTOCOLS[k].trials} trials / block</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <div className="rounded-lg border border-line bg-panel-2 p-4 text-[12.5px] leading-relaxed text-muted">
            <div className="mb-2 font-medium text-fg">Participant consent</div>
            Lucid analyses the camera in this browser. <span className="text-fg">No video or images are stored or sent anywhere</span> — only numeric features
            (head pose, eye and face measurements, posture, estimated heart rate) and task performance, saved on this device. You can stop at any time with Esc.
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--color-att)]" />
            <span>The participant has read this and agrees to take part.</span>
          </label>
          <button className="btn btn-primary mt-auto self-start" style={{ opacity: consent ? 1 : 0.4 }} disabled={!consent} onClick={() => onBegin(id, proto)}>
            Begin study as {id}
          </button>
        </div>
      </div>
    </div>
  );
}

function Timeline({ order, cfg }: { order: NLevel[]; cfg: (typeof PROTOCOLS)["full"] }) {
  const blockS = (cfg.trials * cfg.soaMs) / 1000;
  const segs: { label: string; sub: string; w: number; tone: string }[] = [
    { label: "Practice", sub: "1-back", w: (cfg.practiceTrials * cfg.soaMs) / 1000, tone: "var(--color-line-2)" },
    { label: "Baseline", sub: `${cfg.baselineS}s rest`, w: cfg.baselineS, tone: "var(--color-att)" },
  ];
  order.forEach((n, i) => {
    segs.push({ label: `${n}-back`, sub: `${blockS}s`, w: blockS, tone: ["#c9a35c", "#b5730a", "#8f5a08", "#6a4206"][n] });
    segs.push({ label: "TLX", sub: "", w: 30, tone: "var(--color-line)" });
    if (i < order.length - 1) segs.push({ label: "", sub: "", w: cfg.restS, tone: "transparent" });
  });
  const total = segs.reduce((a, s) => a + s.w, 0);
  return (
    <div>
      <div className="flex h-9 w-full gap-[3px]">
        {segs.map((s, i) => (
          <div key={i} className="flex items-center justify-center overflow-hidden rounded-md border border-line text-[10.5px] font-medium"
            style={{ flexGrow: s.w / total, background: s.tone === "transparent" ? undefined : `color-mix(in srgb, ${s.tone} 22%, transparent)`, borderColor: s.tone === "transparent" ? "var(--color-line)" : `color-mix(in srgb, ${s.tone} 45%, transparent)`, borderStyle: s.tone === "transparent" ? "dashed" : "solid" }}>
            <span className="truncate px-1">{s.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-faint">
        Block order is a balanced Latin square ({order.map((n) => `${n}-back`).join(" → ")}), so fatigue and practice effects cancel across participants.
      </p>
    </div>
  );
}

function SetupCheck({ onBack, onGo }: { onBack: () => void; onGo: () => void }) {
  const status = useLucid((s) => s.status);
  const m = useLucid((s) => s.metrics);
  const mods = useLucid((s) => s.modalities);
  const running = status === "running";
  const items = [
    { k: "Camera running", ok: running, req: true, tip: "Enable the camera in the monitor →" },
    { k: "Face locked", ok: !!m?.facePresent, req: true, tip: "Sit centred, face the screen" },
    { k: "Shoulders in frame", ok: !!m?.posture?.visible, req: false, tip: mods?.pose === false ? "Pose model unavailable" : "Sit back a little" },
    { k: "Pulse acquiring", ok: !!m?.rppg && m.rppg.warmup > 0.3, req: false, tip: "Face a light source, keep your forehead clear" },
  ];
  const ready = items.every((i) => !i.req || i.ok);
  return (
    <div className="fade-in space-y-4">
      <div>
        <h1 className="text-[34px] leading-tight tracking-[-0.02em]">Setup check</h1>
        <p className="text-[13px] text-muted">Get the signals green before starting. Optional items improve data quality but won't block you.</p>
      </div>
      <div className="panel divide-y divide-line">
        {items.map((i) => (
          <div key={i.k} className="flex items-center justify-between px-4 py-3.5">
            <span className="flex items-center gap-3">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${i.ok ? "border-ok bg-ok/15 text-ok" : "border-line-2 text-faint"}`}>
                {i.ok ? "✓" : ""}
              </span>
              <span className="text-[13.5px]">{i.k}</span>
              {!i.req && <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] text-faint">optional</span>}
            </span>
            <span className="text-[12px] text-faint">{i.ok ? "" : i.tip}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={onBack}>Back</button>
        <button className="btn btn-primary" disabled={!ready} style={{ opacity: ready ? 1 : 0.4 }} onClick={onGo}>Continue to practice</button>
      </div>
    </div>
  );
}

function Sessions({ studies, onChange }: { studies: StudyRecord[]; onChange: () => void }) {
  const complete = studies.filter((s) => s.complete);
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Saved sessions ({studies.length})</span>
        <span className="text-[12px] text-faint">on this device</span>
      </div>
      {studies.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-faint">No sessions yet. Run your first participant.</p>
      ) : (
        <>
          <div className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
            {studies.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.complete ? "bg-ok" : "bg-load"}`} title={s.complete ? "Complete" : "Partial"} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{s.participantId}</div>
                  <div className="num truncate text-[10.5px] text-faint">
                    {new Date(s.startedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · {s.blocks.length}/4 · {s.rows.length.toLocaleString()} rows
                  </div>
                </div>
                <button className="text-[11px] text-muted hover:text-fg" onClick={() => download(`lucid_${s.participantId}_training.csv`, trainingCsv([s]))}>CSV</button>
                <button className="text-[11px] text-faint hover:text-bad"
                  onClick={() => confirm(`Delete ${s.participantId}'s session permanently?`) && deleteStudy(s.id).then(onChange)}>✕</button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn justify-center" disabled={!complete.length} onClick={() => download(`lucid_training_${stamp}_n${complete.length}.csv`, trainingCsv(complete))}>
              All · training
            </button>
            <button className="btn justify-center" disabled={!complete.length} onClick={() => download(`lucid_blocks_${stamp}_n${complete.length}.csv`, summaryCsv(complete))}>
              All · blocks
            </button>
          </div>
          <p className="mt-2 text-[10.5px] text-faint">Pooled exports include complete sessions only ({complete.length}).</p>
        </>
      )}
    </div>
  );
}
