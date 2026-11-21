# Webcam Hand-Gesture AR

Pick up a 3D model with your hands in front of a laptop webcam: pinch to rotate,
grab to move, two hands to scale. The hand detection is MediaPipe's. What is
here is everything between a noisy stream of landmarks and an object that feels
like you are holding it.

Extracted from a private Electron application; this is the AR subsystem, 11
files, ~2,200 lines.

---

## What this is, and what it is not

**The hand tracking is not mine.** Landmark detection is Google's MediaPipe
`HandLandmarker` (Apache-2.0), running on the GPU in `VIDEO` mode, two hands,
21 landmarks each. That is stated here, at the top, because a repository called
"hand gesture AR" invites exactly the wrong assumption.

**What is mine is everything downstream of it:** per-hand One Euro filter banks
with identity tracking, a gesture engine with hysteresis, an interaction system
that separates recognising a gesture from doing something with it, and a
lifecycle state machine for the dozen ways a webcam session can fail.

**It is not a standalone demo.** There is no HTML entry point, no bundler
config, and the MediaPipe WASM and `.task` model are loaded from
`/assets/mediapipe/` — paths the host application served. See *Running it*.

---

## The problem

Raw landmarks from any hand tracker jitter. A still hand produces a position
that wanders by a few thousandths of normalised screen space every frame, and a
3D model bound directly to that landmark vibrates. The obvious fix — a moving
average — trades jitter for lag, and lag on a hand you are watching move is
worse than jitter, because the object visibly lags your fingers.

## The fix: One Euro, per hand, per axis

The [One Euro filter](http://cristal.univ-lille.fr/~casiez/1euro/) (Casiez,
Roussel & Vogel, CHI 2012 — their algorithm, implemented here and cited in the
source) is a low-pass filter whose cutoff frequency rises with the signal's own
speed. Slow movement is filtered hard, so a still hand is still; fast movement
is barely filtered, so a quick move does not drag.

`ARHandTracker` allocates **126 filters** — 2 hands × 21 landmarks × 3 axes —
split into two per-hand banks, and this is the part that takes care:

- a detected hand is matched to a **track**, so the same physical hand keeps the
  same filter bank between frames even as MediaPipe reorders its output;
- when a hand is lost, its bank is **reset**, so a new hand entering frame does
  not inherit the previous one's velocity estimate and slingshot across the
  scene.

Filtering per-landmark without stable identity is worse than not filtering at
all. That is the whole trick.

### Measured

A synthetic 60 fps signal — one second still, then a fast sweep — with
landmark-scale noise of ±0.004 normalised units, through the filter's own
default parameters (`minCutoff 1.0`, `beta 0.007`):

| | raw | filtered |
|---|---:|---:|
| Mean frame-to-frame movement, still hand | 0.00245 | **0.00021** (−91.4 %) |
| Frames to settle after a fast sweep | 24 | 48 |

That is the trade, stated honestly: a near-motionless hand reads as motionless,
and a fast movement settles in about 0.4 s instead of 0.2 s. For grabbing and
rotating a model, the first number is what you feel.

**This is a synthetic signal, not a webcam.** It characterises the filter, not
the end-to-end system.

---

## Gestures

```js
NEUTRAL · PINCH · GRAB · OPEN_PALM · POINT · TWO_HAND_SCALE · TWO_HAND_ROTATE
```

Recognised geometrically from landmark distances, with thresholds in normalised
units:

```js
PINCH_THRESHOLD     = 0.05   // thumb tip to index tip
GRAB_THRESHOLD      = 0.08   // fingertip to its own MCP joint
OPEN_PALM_THRESHOLD = 0.15   // fingertip to wrist
```

**A gesture needs three consecutive frames before it starts.** At 30 fps that is
100 ms, which is below the threshold at which the delay is noticeable and above
the rate at which a single bad frame can fire a pinch you did not make.

Each gesture emits `_START`, `_MOVE` and `_END`, so the interaction layer sees
continuous manipulations rather than per-frame states.

---

## Architecture

```
ARController.js              owns the session; wires everything together
  ├── ARStateMachine         12 lifecycle states (below)
  ├── camera/ARCameraPipeline getUserMedia, frame pump, teardown
  ├── tracking/ARHandTracker  MediaPipe → track identity → 126 One Euro filters
  │     └── tracking/OneEuroFilter
  ├── gestures/ARGestureEngine  landmarks → gestures, with hysteresis
  ├── interaction/ARInteractionSystem  gesture events → scene commands
  ├── scene/ARSceneManager     the three.js side
  └── ui/ARHUD + ar-hud.css    state, hands, the current gesture
```

The lifecycle states are the honest list of how this fails in a room:

```
INACTIVE · INITIALIZING · REQUESTING_PERMISSION · PERMISSION_DENIED
INIT_FAILED · CAMERA_STARTING · CAMERA_FAILED · CALIBRATING
WAITING_FOR_HANDS · TRACKING_ACTIVE · TRACKING_LOST · EXITING
```

Six of those twelve are failure or waiting states, which is the correct ratio
for anything that asks a stranger for camera permission at an event.

**Gesture recognition and scene manipulation are separate on purpose.**
`ARGestureEngine` knows about fingers and emits `GRAB_MOVE`; it knows nothing
about the model. `ARInteractionSystem` subscribes and decides that a grab-move
translates the car. Swapping what a pinch does is a change in one file, and the
gesture engine is testable without a scene.

---

## Running it

This subsystem expects a host page to provide:

| | |
|---|---|
| `@mediapipe/tasks-vision` | npm dependency |
| MediaPipe WASM | served at `/assets/mediapipe/wasm` |
| Hand landmarker model | `/assets/mediapipe/hand_landmarker.task` |
| `three` | the scene `ARSceneManager` manipulates |
| A model to manipulate | the original drove a car model |
| HTTPS or localhost | `getUserMedia` requires a secure context |

`ARController` is the entry point; construct it with a three.js scene and call
its start method. Paths to the MediaPipe assets are currently absolute
(`/assets/mediapipe/…`) and would need changing for a different layout.

---

## Status & verification

**Status:** extracted from a private application that ran at a real event.
Published as a subsystem to read and reuse, not as a runnable demo.

| Claim | How it was checked |
|---|---|
| Extracted faithfully | blob-level comparison against the source repository — **11 objects, byte-identical** |
| Every import resolves | **run** — all 12 relative imports checked against the filesystem, 0 unresolved |
| One Euro filter behaves as described | **run** — synthetic 60 fps signal, numbers in the table above |
| 126 filters, two banks, reset on loss | verified by reading `ARHandTracker`: allocation, per-track bank offset, and `reset()` on track expiry |
| Three-frame gesture hysteresis | verified by reading `ARGestureEngine` — `framesInCurrentGesture >= 3` |
| No secrets in the repository or its history | swept every commit touching these paths — none |

**Not verified:**

- **It has not been run from this repository.** No webcam session, no MediaPipe
  load, no frame processed. There is no entry point here to run, and that is
  stated rather than papered over.
- **No end-to-end latency figure.** The filter was measured; the pipeline was
  not.
- **No GIF of hands driving the model.** It is the one asset that would actually
  prove this works, it is recordable on a laptop, and it does not exist yet.
- **`ARStateMachine` does not enforce a transition graph.** It validates that a
  state name exists and ignores no-op transitions; the source carries a comment
  saying graph rules *could* be enforced there. So "state machine" here means a
  named, observable lifecycle with listeners — not a checked one. The
  three-frame confirmation that stops a half-recognised pinch lives in
  `ARGestureEngine`, not here.
- **Gesture release is not symmetric.** The source comment describes requiring
  three frames to start a gesture and five to end it; only the three-frame start
  is implemented, and the comment says "simplified here". A gesture therefore
  ends on the first frame it is not detected.

---

## Credits

Written by **Dhruva Goyal** for Team Anantam.

Hand landmark detection: **MediaPipe Tasks Vision**, Google, Apache-2.0.
The One Euro filter algorithm: **Géry Casiez, Nicolas Roussel and Daniel Vogel**,
*1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive
Systems*, CHI 2012. three.js is BSD-3-Clause.

---

## Licence

[MIT](LICENSE).
