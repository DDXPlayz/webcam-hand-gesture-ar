import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { OneEuroFilter } from './OneEuroFilter.js';

export class ARHandTracker {
    constructor() {
        this.handLandmarker = null;
        this.isInitialized = false;
        this.filters = [];
        this.lastVideoTime = -1;
        this.lostFramesCount = 0;

        // 2 hands * 21 landmarks * 3 axes = 126 filters, split into two "banks"
        // (63 each). A bank is bound to a tracked hand identity so smoothing
        // stays with the same physical hand frame-to-frame.
        for (let i = 0; i < 126; i++) {
            this.filters.push(new OneEuroFilter(1.0, 0.007, 1.0));
        }

        // ── Identity tracking / continuity state ──────────────────────────
        this._tracks = [];          // {id, bank, wrist:{x,y}, conf, handed, lostFrames, present, det}
        this._freeBanks = [0, 1];
        this._nextId = 1;
        this._primaryId = null;     // the "intended user" hand we stay locked to
        this._primaryLostFrames = 0;

        // Tuning
        this.MATCH_DIST = 0.22;          // max normalized wrist move to count as the same hand
        this.TRACK_MAX_LOST = 30;        // frames a lost hand is remembered (~0.5s) for graceful re-lock
        this.PRIMARY_SWITCH_LOST = 12;   // frames the primary must be gone before switching targets
        this.PRIMARY_MIN_CONF = 0.4;     // confidence floor to consider a hand as a primary candidate
    }

    async init() {
        if (this.isInitialized) return;

        try {
            // Loading WASM and model locally for offline support & performance
            const vision = await FilesetResolver.forVisionTasks('/assets/mediapipe/wasm');

            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: '/assets/mediapipe/hand_landmarker.task',
                    delegate: 'GPU',
                },
                runningMode: 'VIDEO',
                numHands: 2,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence: 0.6,
                minTrackingConfidence: 0.5,
            });

            this.isInitialized = true;
            console.log('[ARHandTracker] MediaPipe initialized');
        } catch (error) {
            console.error('[ARHandTracker] MediaPipe init failed:', error);
            throw error;
        }
    }

    /**
     * @param {HTMLVideoElement} videoElement
     * @param {number} timestamp
     * @returns {Object|null} { hands, handednesses, confidences }
     */
    detect(videoElement, timestamp) {
        if (!this.isInitialized || !this.handLandmarker) return null;
        if (!videoElement || videoElement.readyState < 2) return null;

        // Defensive: the render loop calls this ~60×/sec. If tracking state was
        // ever left in a bad shape, self-heal instead of throwing every frame.
        if (!Array.isArray(this._tracks)) this._tracks = [];
        if (!Array.isArray(this._freeBanks)) this._freeBanks = [0, 1];

        // Skip detection if the video frame hasn't updated
        if (videoElement.currentTime === this.lastVideoTime) {
            return null; // indicates "no new data this frame", caller should reuse previous
        }
        this.lastVideoTime = videoElement.currentTime;

        let results;
        try {
            results = this.handLandmarker.detectForVideo(videoElement, timestamp);
        } catch (e) {
            // A transient inference error must not crash the render loop.
            return { hands: [], handednesses: [], confidences: [] };
        }

        const raw = (results && results.landmarks) ? results.landmarks : [];

        if (raw.length === 0) {
            this.lostFramesCount++;
            this._ageTracks();
            this._updatePrimary();
            return { hands: [], handednesses: [], confidences: [] };
        }
        this.lostFramesCount = 0;

        // Build this frame's raw detections (wrist = landmark 0).
        const detections = [];
        for (let i = 0; i < raw.length && i < 2; i++) {
            const lm = raw[i];
            let conf = 1.0, handed = 'Unknown';
            if (results.handednesses && results.handednesses[i] && results.handednesses[i][0]) {
                conf = results.handednesses[i][0].score;
                handed = results.handednesses[i][0].categoryName;
            }
            detections.push({ lm, wrist: { x: lm[0].x, y: lm[0].y }, conf, handed, matched: false });
        }

        // 1) Match existing tracks to nearest unclaimed detection (continuity).
        for (const track of this._tracks) {
            let best = -1, bestD = this.MATCH_DIST;
            for (let d = 0; d < detections.length; d++) {
                if (detections[d].matched) continue;
                const dx = detections[d].wrist.x - track.wrist.x;
                const dy = detections[d].wrist.y - track.wrist.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestD) { bestD = dist; best = d; }
            }
            if (best >= 0) {
                const det = detections[best];
                det.matched = true;
                track.det = det;
                track.wrist = det.wrist;
                track.conf = det.conf;
                track.handed = det.handed;
                track.lostFrames = 0;
                track.present = true;
            } else {
                track.det = null;
                track.present = false;
                track.lostFrames++;
            }
        }

        // 2) Spawn new tracks for unmatched detections (max 2 hands).
        for (let d = 0; d < detections.length; d++) {
            if (detections[d].matched) continue;
            if (this._tracks.length >= 2) break;
            const bank = this._freeBanks.length ? this._freeBanks.shift() : this._tracks.length;
            this._resetBank(bank); // fresh smoothing for a newly-acquired hand (no snap)
            this._tracks.push({
                id: this._nextId++, bank,
                wrist: detections[d].wrist, conf: detections[d].conf, handed: detections[d].handed,
                lostFrames: 0, present: true, det: detections[d]
            });
        }

        // 3) Retire tracks that have been lost too long (frees their bank).
        this._dropStaleTracks();

        // 4) Choose the primary ("intended user") hand with hysteresis.
        this._updatePrimary();

        // 5) Emit smoothed hands, primary first, each via its own stable filter bank.
        const ordered = this._tracks
            .filter(t => t.present && t.det)
            .sort((a, b) => {
                if (a.id === this._primaryId) return -1;
                if (b.id === this._primaryId) return 1;
                return b.conf - a.conf;
            });

        const hands = [], handednesses = [], confidences = [];
        for (const t of ordered) {
            hands.push(this._smoothHand(t.det.lm, t.bank, timestamp));
            handednesses.push(t.handed);
            confidences.push(t.conf);
        }

        return { hands, handednesses, confidences };
    }

    _smoothHand(lm, bank, timestamp) {
        const offset = bank * 63;
        const out = [];
        for (let i = 0; i < lm.length; i++) {
            const b = offset + i * 3;
            out.push({
                x: this.filters[b].filter(lm[i].x, timestamp),
                y: this.filters[b + 1].filter(lm[i].y, timestamp),
                z: this.filters[b + 2].filter(lm[i].z, timestamp)
            });
        }
        return out;
    }

    _resetBank(bank) {
        const offset = bank * 63;
        for (let i = 0; i < 63; i++) this.filters[offset + i].reset();
    }

    _ageTracks() {
        if (!Array.isArray(this._tracks)) { this._tracks = []; return; }
        for (const t of this._tracks) { t.present = false; t.det = null; t.lostFrames++; }
        this._dropStaleTracks();
    }

    _dropStaleTracks() {
        if (!Array.isArray(this._tracks)) { this._tracks = []; return; }
        if (!Array.isArray(this._freeBanks)) this._freeBanks = [0, 1];
        this._tracks = this._tracks.filter(t => {
            if (t.lostFrames > this.TRACK_MAX_LOST) {
                this._freeBanks.push(t.bank);
                if (this._primaryId === t.id) this._primaryId = null;
                return false;
            }
            return true;
        });
    }

    _updatePrimary() {
        const primary = this._tracks.find(t => t.id === this._primaryId);

        // Keep the current primary as long as it's visible — continuity over reactivity.
        if (primary && primary.present) { this._primaryLostFrames = 0; return; }

        // Hold through a brief loss so a quick occlusion / re-entry doesn't switch targets.
        if (primary && !primary.present) {
            this._primaryLostFrames++;
            if (this._primaryLostFrames < this.PRIMARY_SWITCH_LOST) return;
        }

        // Pick a new primary: the most confident present candidate above the floor.
        let chosen = null;
        for (const t of this._tracks) {
            if (!t.present || t.conf < this.PRIMARY_MIN_CONF) continue;
            if (!chosen || t.conf > chosen.conf) chosen = t;
        }
        if (chosen) {
            this._primaryId = chosen.id;
            this._primaryLostFrames = 0;
        }
        // If nothing qualifies, keep _primaryId so the same hand can re-lock when it returns.
    }

    _resetFilters() {
        this.filters.forEach(filter => filter.reset());
    }

    /** Full per-session reset so every AR open starts from a clean slate. */
    reset() {
        this._resetFilters();
        this.lastVideoTime = -1;
        this.lostFramesCount = 0;
        this._tracks = [];           // MUST stay an array — the detect() loop iterates it
        this._freeBanks = [0, 1];
        this._primaryId = null;
        this._primaryLostFrames = 0;
        this._nextId = 1;
    }

    dispose() {
        if (this.handLandmarker) {
            this.handLandmarker.close();
            this.handLandmarker = null;
        }
        this.isInitialized = false;
    }
}
