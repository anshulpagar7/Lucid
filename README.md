# Lucid

**Multi-modal Student Attention, Engagement & Cognitive Load Analysis using Computer Vision**

| | |
|---|---|
| **Home** | landing page: what Lucid is, the four modes, how it works |
| **Live** | one learner: attention, engagement, cognitive load from face, posture and heart rate, with a *Why?* for every score |
| **Study** | n-back + NASA-TLX protocol that produces labelled training data |
| **Replay** | re-enacted avatar, auto-detected moments, gaze heatmap, PDF report |
| **Classroom** | many students (screen share, video, webcam), anonymous tracking, class-level trends |
| **Lab** | evaluation, live self-check, benchmarks, pooled study stats, ethics |

Lucid runs entirely in the browser. Webcam frames are processed on-device inside a Web Worker (MediaPipe Face Landmarker on the GPU), so the UI thread only renders and video never leaves the machine.

## Run it

```bash
npm install          # also copies the MediaPipe WASM runtime into public/
npm run dev          # http://localhost:5173
npm test             # 71 tests incl. Python↔TypeScript parity
npm run test:ml      # 7 Python tests (feature math, leakage, export fidelity)
```

Training needs Python 3.10+: `pip install -r ml/requirements.txt` (on Windows, use `python` instead of `python3` in the npm scripts).

Use Chrome or Edge, and open `http://localhost:5173`. The camera only works on `localhost` or HTTPS, not on the Network address. The face and pose models ship in `public/models` and the fonts are bundled, so the app works offline. `npm run fetch-models` re-downloads the models if they ever go missing.

### If the camera doesn't start
The app says what went wrong and how to fix it. The usual causes:
- another app (Zoom, Teams, the Windows Camera app) is holding the camera, so close it and press Retry;
- Windows picked a virtual camera (OBS, Snap, Teams), so choose your real webcam in the **Camera** menu under the video;
- camera permission was denied, so click the camera icon in the address bar and allow it.

### Themes
Pick a theme from the menu at the top right: Paper, Nightwatch, Crimson, Storm, Ember or Speedway. The whole interface changes, including charts and canvases, and the choice is remembered. Each theme also has its own animations: an intro when you switch to it, an effect wherever you click, and the occasional surprise (bats, webs, lightning, meteors, a race car). Turn them off with **Animations** in the same menu. They also switch off on the Study page, so they never disturb an experiment, and when your system is set to reduce motion. Colours live in `src/theme.ts`; the animations live in `src/components/ThemeFX.tsx`.

## Architecture

```
Webcam ─▶ createImageBitmap ─▶ Web Worker (module)
                                ├─ MediaPipe Face Landmarker (GPU → CPU fallback), every frame
                                │    478 landmarks · 52 blendshapes · 4×4 head transform
                                ├─ MediaPipe Pose Landmarker lite, ~15 Hz (optional — app runs face-only without it)
                                │    33 body landmarks → PostureEngine (src/engine/posture.ts)
                                ├─ Skin sampler (src/engine/skin.ts): forehead + cheek ROIs → mean RGB
                                │    → RppgEngine (src/engine/rppg.ts): POS → HR, SNR, HRV
                                └─ FeatureEngine (src/engine/features.ts)
                                     head pose · gaze · EAR · blinks · PERCLOS
                                     brow AU4 · jaw · motion → scores + "why"
        ◀── postMessage (transferred Float32Array) ──┘
UI thread: React (15 Hz state) · Canvas overlay + uPlot timeline (rAF, no React)
```

- **Backpressure:** at most one frame is in flight, so the worker always processes the freshest frame and latency never accumulates.
- **Frame-rate independent smoothing:** EMAs use time constants, not per-frame alphas.
- **Auto-calibration:** the neutral head pose is learned in the first ~1.5 s with a face visible. Use **Recalibrate** to redo it.

## Signals (v0)

| Signal | Source | Used for |
|---|---|---|
| Yaw / pitch / roll | Facial transformation matrix | Attention |
| Gaze X / Y | Iris look blendshapes | Attention, fixation (load) |
| EAR | Soukupová & Čech eye aspect ratio | Telemetry |
| Blink rate | Hysteresis detector, 50–500 ms closures | Blink inhibition (load) |
| PERCLOS | % time eyes ≥70% closed, 60 s window | Drowsiness (engagement) |
| Brow lowering | `browDown` blendshapes (AU4 proxy) | Load |
| Jaw open | `jawOpen` blendshape | Yawn / drowsiness |
| Motion | Nose displacement / inter-ocular distance | Micro-movement (engagement) |
| Lean | Shoulder width vs calibrated neutral | Posture (engagement) |
| Slouch | Nose-above-shoulders height / shoulder width vs neutral | Posture (engagement) |
| Shoulder tilt | Shoulder line angle | Telemetry |
| Head on hand | Hand landmarks within reach of the mouth for >1.5 s | Posture (engagement) |
| Body motion | Shoulder + wrist displacement / shoulder width | Fidget penalty (posture) |
| Heart rate | rPPG (POS) | Cardiac arousal above resting baseline (load) |
| Signal quality | SNR × estimate consistency | Gates the heart rate |
| HRV (RMSSD) | Inter-beat intervals | Telemetry only (experimental) |

Posture distances are computed in pixel space and normalised by shoulder width, so they're invariant to camera distance and aspect ratio. When the shoulders aren't in frame, the posture weight is redistributed to the face signals so face-only framing isn't penalised.

## Cardiac modality (rPPG)

Heart rate is recovered from tiny skin-colour changes using **POS** (Wang et al., 2017, *Algorithmic Principles of Remote PPG*):

1. Mean RGB of three skin ROIs (forehead, both cheeks), using a canvas-composited mask and excluding shadows and specular highlights (~0.5 ms/frame).
2. Uniform resampling at 30 Hz, then POS projection with a 1.6 s overlap-add window.
3. Hann-windowed, zero-padded FFT; peak in 45–180 bpm with parabolic refinement and a sub-harmonic check (PPG has a strong 2nd harmonic).
4. **Quality gate:** SNR (de Haan & Jeanne, 2013) × temporal consistency of estimates. A reading is published only after a 1 s lock, and dropped after 3 s without a valid estimate.
5. Heart rate above the person's own resting baseline (learned in the first ~12 s of good signal) feeds **cognitive load** (weight 0.2).

**Validation (`npm test`, synthetic signals):** 50–150 bpm within ±3.6 bpm at realistic noise; 0/10 false locks on pure noise; weak signals refuse to lock instead of guessing.

**HRV (RMSSD) is experimental and never scored.** At 30 fps, beat timing is noise-limited: simulations show RMSSD is accurate on strong signals but inflated as noise rises, so it's only shown when SNR ≥ 3 dB. The panel's **Validate vs watch** field logs live error and MAE against a reference device for your evaluation table.

## Study mode (data collection)

The **Study** tab turns Lucid into a research instrument that produces labelled training data.

**Protocol** (≈12 min full, ≈4 min quick demo):
1. Consent + pseudonymous participant ID, then a setup check (face required, body and pulse optional).
2. Practice: 1-back with feedback (recorded as `practice`, never used as data).
3. Resting baseline: fixation cross. Neutral pose and resting heart rate are re-learned here.
4. Four blocks of **0/1/2/3-back** (letters, 500 ms stimulus, 2.5 s SOA, 30% targets) in a **balanced Latin-square order** set by the participant number, so practice and fatigue effects cancel across participants.
5. **NASA-TLX** (raw, six 0–100 scales) after every block. Every scale must be touched, because an untouched default would bias the label.
6. A summary with **manipulation checks**: does TLX rise with n, does accuracy fall with n, and does Lucid's load track TLX?

**What's recorded:** about 87 features at 10 Hz (head pose, gaze, eyes, posture, heart rate, heuristic scores and all 52 face blendshapes), tagged with phase / block / n-level / trial. Stimulus onsets are stamped on the painted frame; RTs use the key event's high-res timestamp. Behaviour is scored with hits, false alarms, accuracy and **d′** (log-linear corrected). **No video or images are ever stored**, only numbers, in IndexedDB on the device, saved after every block.

**Exports:**
- *Training CSV*: every 10 Hz row plus labels `load_class` (rest / low / medium / high), `tlx_raw`, `tlx_mental`, and block accuracy and d′. This is the input for the week 5 model.
- *Block summary CSV*: one row per block, ready for stats.
- *Raw JSON*: the complete record, including every trial and response.
- *All · training / All · blocks*: pooled exports across participants.

## Recording, Replay & reports

**Record (Live tab).** **● Record** saves the session at an exact 10 Hz: the same feature rows as Study mode, plus learned-model load and calibrated screen gaze. **No video or images are ever stored.** Recordings stay in IndexedDB on the device.

**Gaze calibration.** You follow 9 dots, then 4 held-out validation dots measure the accuracy, which is reported as mean error in % of screen width (good < 10%). The mapping is ridge regression on iris-blendshape gaze plus head pose. Webcam gaze is coarse, so the heatmap is read **by screen region (3×3), not by pixel**. After calibrating, a live amber dot lets you test the result.

**Replay tab.** It replays every Live recording and completed Study session:
- **Re-enacted avatar.** A wireframe face driven by the recorded head pose, gaze and blendshapes (blinks, brows, mouth) shows *how* the person looked without any footage.
- **Scrubbable timeline.** Play at 1×/4×/16×; Space plays and pauses, ←/→ jump 5 s. Study blocks are shown as labelled bands.
- **Auto-detected moments**, each clickable to jump to it:

  | Moment | Rule |
  |---|---|
  | Attention lapse | attention < 35 for ≥ 4 s (face visible) |
  | Face not visible | ≥ 3 s |
  | Eyes closed | closure ≥ 0.7 for ≥ 1.5 s |
  | Drowsiness | PERCLOS ≥ 15% for ≥ 10 s |
  | Head on hand | ≥ 5 s |
  | High cognitive load | load ≥ 66 for ≥ 8 s (learned model when available) |
  | Heart rate up | ≥ +12 bpm over resting for ≥ 10 s |

  Short interruptions (blinks, jitter) are bridged. In Study sessions, detection runs only inside blocks and the baseline, never during questionnaires.
- **Summary**: focused time, mean load, time in each load band, heart rate, data coverage, and the **gaze heatmap**.

**Session report.** A print-ready A4 report (light theme) with KPIs, timeline, moments, load distribution, heatmap, method and thresholds, plus an interpretation and privacy statement. Use **Print → Save as PDF**.

**Sampling fix (found while testing this week).** The old "≥ 100 ms since the last row" gate drifted to about 8.5 Hz under 30 fps camera jitter. All recorders and the live model now share `engine/sampler.ts`, a grid-locked sampler that holds exactly 10 Hz. Training and inference were always consistent with each other; now "10 Hz" is literally true. **Data collected with v0.4–0.5 is still valid, but retrain on a single version's data.**

## Classroom mode

The **Classroom** tab analyses many students at once, on-device like everything else.

**Sources:**
- **Share a screen** (an online-class gallery in Meet, Zoom or Teams)
- **Video file** (a recorded classroom clip)
- **Webcam** (a small group facing the camera)

**Pipeline.** A dedicated worker runs MediaPipe Face Landmarker on up to 4–16 faces per frame (selectable). Each face becomes a box, head pose, gaze and eye closure. The tracker (`classroom/tracker.ts`) then:
- associates faces with greedy IoU, falling back to centre distance;
- confirms a face after 3 hits, so detection flicker never gets an ID;
- keeps a 2.5 s grace period, so a student who turns away or is briefly occluded keeps their ID;
- assigns **anonymous IDs in seat (reading) order**, S1, S2, ….

**Per-student state.** Each student is shown as focused, drifting, looking down, looking away or eyes closed, using smoothed head direction, gaze and eye closure. There is no per-person calibration; the camera is assumed to sit near the board or screen. Head direction outweighs gaze, because at classroom distance the eyes are only a few pixels.

**Class level:**
- live class attention and state distribution;
- a 1 Hz class timeline;
- **class moments**: attention dip (< 50% focused for ≥ 10 s), many looking down (≥ 40% for ≥ 10 s, which might be note-taking), and many looking away (≥ 30% for ≥ 8 s).

**Privacy:**
- an *aggregate-only* switch (dots, no IDs or tiles), recommended when the screen is projected;
- an on-screen face blur;
- IDs that reset every session, with no recognition of who anyone is;
- CSV exports (class timeline, per-student summary) that contain only anonymous numbers.

**Limits, stated plainly:**
- MediaPipe's face detector is short-range. It works for up to ~16 faces at 1–3 m or an online gallery, but back rows in large lecture halls are missed. A server-side person detector (e.g. RF-DETR + ByteTrack) would be the extension for that case.
- Cognitive load and heart rate are **not** estimated per student in this mode: faces are too small for rPPG, and there is no personal baseline.
- If "Looking down" fires when students look *up* on your camera, flip `PITCH_DOWN_SIGN` in `classroom/score.ts`.

**Validated by** 10 unit tests (ID stability, no flicker IDs, occlusion recovery, no swaps between neighbours, reading-order IDs, state scoring, class moments). There's also a scripted 10-student, 3-minute end-to-end simulation in which every student's stats and all 4 class moments matched the script exactly.

## Lab (evidence page)

- **Model card.** LOPO macro-F1 with 95% CI, balanced accuracy, per-person F1, ρ with NASA-TLX, comparison against 5 baselines, the confusion matrix and the modality ablation (alone / change when removed / learned weight). It is read from the model JSON, so it updates when you retrain.
- **Live self-check.** One click re-runs 6 core validations *in the browser*:
  - rPPG accuracy 50–150 bpm
  - no false heart rate on noise
  - exact 10 Hz sampling
  - classroom ID stability through occlusion
  - gaze calibration fit
  - model-runtime validity and speed

  These use the same generators as `npm test` (`src/lab/synth.ts`).
- **Performance.** Live FPS, inference and latency, plus micro-benchmarks of rPPG, the load model, the tracker and replay analysis on the current machine.
- **Study dataset.** Pooled TLX, accuracy, d′ and RT by n-level across all completed participants, ρ(n, TLX), and the share of participants whose TLX ordered correctly.
- **Ethics & limitations.**

Lab charts use darker steps of the brand hues (`#0891b2 / #8b5cf6 / #d97706`). These pass a palette validator on the dark surface: lightness band, chroma, colour-blind separation and contrast. The Classroom timeline uses a single axis.

## Viva demo script (≈ 5 min)

1. **Home (20 s).** "Everything runs in the browser; no video is ever stored." Point at the pipeline strip.
2. **Live (90 s).** Start, sit still for ~6 s until the pulse locks. Look away and watch Attention drop; open *Why?*. Slouch and prop your chin to show posture. Show the heart waveform and, if you have a smartwatch, type its BPM into *Validate vs watch*.
3. **Replay (60 s).** Open a pre-recorded session. Scrub to an auto-detected moment, let the avatar re-enact it, show the heatmap and click **Session report** to show the PDF.
4. **Classroom (45 s).** Share a Meet/Zoom gallery tab. Show the anonymous IDs and class attention, then toggle *aggregate only* ("this is how it should be projected").
5. **Lab (60 s).** Click **Run all checks** in front of the examiners and get 6/6 green. Walk through baselines → shipped model → ablation. Say plainly: *"The current numbers are from synthetic data; here's the pipeline that retrains on our N participants in one command."*

Before the viva: record one good Replay session, and run the real-data training if you collected participants.

## Learned cognitive-load model

```bash
# 1. collect data: Study tab → run participants → "All · training" CSV
# 2. train + evaluate (writes public/models/load_model.json and a report)
npm run train -- ~/Downloads/lucid_training_2026-10-20_n20.csv
# no data yet? train the pipeline demo on synthetic participants
npm run train:demo   # → public/models/load_model.demo.json (badged DEMO in the app)
```

**Windows and features.** Windows are 10 s long with a 2 s hop, inside n-back blocks, and skip the first 3 s of each block. Each window yields 27 features across 6 modalities: eyes and blinks, gaze dynamics, head movement, facial expression (blendshapes), posture, and heart rate. Every feature is expressed **relative to the person's own resting baseline**: the study's baseline phase in training, and the first 30 s of a live session.

**Model: boosted late fusion.** Each modality gets a small gradient-boosted classifier. A logistic meta-model combines their outputs and is trained on out-of-fold predictions. The output is low / medium / high load (0-1 / 2 / 3-back), and the gauge shows the expected load. The *Why?* panel shows how much each modality is pushing the current prediction up or down, along with its learned weight.

**Evaluation: leave-one-participant-out.** Every reported number comes from people the model never saw. The trainer compares the shipped model against majority class, the calibrated heuristic v0, early-fusion logistic, early-fusion boosted trees and linear late fusion. It reports macro-F1 with a participant-bootstrap 95% CI, balanced accuracy, per-person F1, block-level Spearman ρ with NASA-TLX, a confusion matrix, and a per-modality ablation.

**Why this model ships.** On the synthetic benchmark, linear late fusion did *no better than the heuristic*. Making the per-modality learners boosted lifted it to the top while keeping per-modality explanations, and it degrades gracefully when the body or pulse is missing. See `ml/reports/demo-synthetic/report.md`.

**Correctness guarantees:**
- The export is re-verified against scikit-learn: any probability difference above 1e-9 aborts the write.
- A **Python↔TypeScript parity test** checks features, baseline, inputs and predictions against Python-generated fixtures (`npm run fixtures`).
- `ml/schema.json` is generated from the TypeScript schema, and a test fails if they drift.
- The app refuses a model trained on a different feature spec.
- A synthetic model can't overwrite the real-model slot.

**Honest scope.** Only *cognitive load* is learned, because n-back provides load labels. Attention (geometry) and engagement stay heuristic until a dataset with engagement labels (e.g. DAiSEE) is added. Synthetic-demo results demonstrate the pipeline; they are not evidence about real students.

## Project structure

```
src/
  engine/
    types.ts          worker ⇄ UI contract
    features.ts       pure feature + scoring engine (no DOM, unit-testable)
    vision.worker.ts  MediaPipe inference
    session.ts        camera, worker lifecycle, metrics fan-out
    series.ts         ring buffer for the live timeline
    posture.ts        pure body-posture engine
    rppg.ts           pure rPPG engine (POS, spectrum, SNR, beats, HRV)
    skin.ts           ROI skin-colour sampler (OffscreenCanvas)
    roi.ts            shared ROI landmark sets + convex hull
    dsp.ts            radix-2 FFT and stats helpers
  study/
    protocol.ts       n-back generation, Latin square, d′, NASA-TLX (pure, tested)
    schema.ts         10 Hz recording schema (87 columns)
    recorder.ts       tags live metrics with protocol context
    db.ts             IndexedDB persistence
    export.ts         training / summary CSV + JSON
    StudyView.tsx     protocol state machine + screens
    NBackTask.tsx · TlxForm.tsx · Fixation.tsx · Summary.tsx
  model/
    features.ts       window features (mirror of ml/lucid_ml/features.py)
    fusion.ts         model runtime (mirror of ml/lucid_ml/runtime.py)
    live.ts           10 Hz rows → personal baseline → prediction every 2 s
  replay/
    events.ts · stats.ts · gaze.ts · heatmap.ts   pure logic (tested)
    liveRecorder.ts   10 Hz recording of Live sessions
    ReplayView.tsx · Avatar.tsx · ReplayTimeline.tsx · GazeCalibration.tsx · Report.tsx
  classroom/
    score.ts · tracker.ts · classMetrics.ts   pure logic (tested)
    classroom.worker.ts · controller.ts · store.ts · ClassroomView.tsx
  lab/
    selfcheck.ts · bench.ts · pooled.ts · synth.ts · LabView.tsx
  home/
    Landing.tsx · HeroMesh.tsx (procedural face mesh, not a real person)
  components/         TopBar, VideoStage, Gauges, WhyPanel, Telemetry, Timeline, PosturePanel, CardiacPanel, MiniMonitor
  styles.css          "Neural Observatory" design tokens
ml/
  train.py            LOPO evaluation, ablations, export, report
  make_fixtures.py    parity fixtures for the TypeScript tests
  lucid_ml/           features · dataset · models · runtime · simulate · schema
  tests/              pytest suite
tests/                vitest suites + fixtures/parity.json
```

## Roadmap

- [x] Week 1: design system, worker pipeline, face features, live dashboard
- [x] Week 2: pose modality (lean, slouch, tilt, head-on-hand, body motion), skeleton overlay, posture panel
- [x] Week 3: rPPG heart rate (POS), quality gating, HRV (experimental), cardiac panel, watch validation
- [x] Week 4: Study mode with n-back + NASA-TLX, counterbalancing, d′, 10 Hz feature recording, labelled exports
- [x] Week 5: boosted late-fusion load model, LOPO evaluation + ablations, in-browser inference, Python↔TS parity tests
- [x] Week 6: Live recording, Replay (re-enacted avatar, scrubbable timeline, auto-detected moments), gaze calibration + heatmap, PDF session report, exact 10 Hz sampler
- [x] Week 7: Classroom mode — multi-face worker, anonymous tracker, class timeline + moments, privacy modes, CSV export
- [x] Week 8: Lab page (model card, live self-check, benchmarks, pooled study stats, ethics), landing page, mobile nav, error boundary, v1.0
