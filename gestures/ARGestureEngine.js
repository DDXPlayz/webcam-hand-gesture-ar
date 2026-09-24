export const AR_GESTURES = {
    NEUTRAL: 'NEUTRAL',
    PINCH: 'PINCH',
    GRAB: 'GRAB',
    OPEN_PALM: 'OPEN_PALM',
    POINT: 'POINT',
    TWO_HAND_SCALE: 'TWO_HAND_SCALE',
    TWO_HAND_ROTATE: 'TWO_HAND_ROTATE'
};

export const AR_GESTURE_EVENTS = {
    PINCH_START: 'PINCH_START',
    PINCH_MOVE: 'PINCH_MOVE',
    PINCH_END: 'PINCH_END',
    GRAB_START: 'GRAB_START',
    GRAB_MOVE: 'GRAB_MOVE',
    GRAB_END: 'GRAB_END',
    SCALE_START: 'SCALE_START',
    SCALE_MOVE: 'SCALE_MOVE',
    SCALE_END: 'SCALE_END',
    TWO_HAND_ROTATE_START: 'TWO_HAND_ROTATE_START',
    TWO_HAND_ROTATE_MOVE: 'TWO_HAND_ROTATE_MOVE',
    TWO_HAND_ROTATE_END: 'TWO_HAND_ROTATE_END',
    OPEN_PALM_HOLD: 'OPEN_PALM_HOLD'
};

export class ARGestureEngine {
    constructor() {
        this.currentGesture = AR_GESTURES.NEUTRAL;
        
        // State tracking
        this.framesInCurrentGesture = 0;
        this.activeGestureEventState = null; // PINCH, GRAB, SCALE, etc.
        
        this.pinchOrigin = null;
        this.grabOrigin = null;
        this.scaleOriginDist = null;
        this.rotateOriginAngle = null;
        
        this.openPalmFrames = 0;
        
        // Thresholds
        this.PINCH_THRESHOLD = 0.05;
        this.GRAB_THRESHOLD = 0.08;
        this.OPEN_PALM_THRESHOLD = 0.15;
        
        this.listeners = [];
    }

    /**
     * @param {Array} hands Array of smoothed landmarks for each hand
     */
    process(hands) {
        if (!hands || hands.length === 0) {
            this._handleNoHands();
            return;
        }

        const candidateGestures = this._detectCandidateGestures(hands);
        const resolvedGesture = this._resolveConflicts(candidateGestures);
        
        this._updateStateAndEmit(resolvedGesture, hands);
    }

    _handleNoHands() {
        // Increment lost frames, maybe force end current gesture if > threshold
        if (this.activeGestureEventState) {
            this._endActiveGesture();
        }
        this.currentGesture = AR_GESTURES.NEUTRAL;
        this.openPalmFrames = 0;
    }

    _endActiveGesture() {
        switch (this.activeGestureEventState) {
            case AR_GESTURES.PINCH:
                this._emit(AR_GESTURE_EVENTS.PINCH_END);
                break;
            case AR_GESTURES.GRAB:
                this._emit(AR_GESTURE_EVENTS.GRAB_END);
                break;
            case AR_GESTURES.TWO_HAND_SCALE:
                this._emit(AR_GESTURE_EVENTS.SCALE_END);
                break;
            case AR_GESTURES.TWO_HAND_ROTATE:
                this._emit(AR_GESTURE_EVENTS.TWO_HAND_ROTATE_END);
                break;
        }
        this.activeGestureEventState = null;
    }

    _detectCandidateGestures(hands) {
        const gestures = [];

        // Two-hand detection
        if (hands.length >= 2) {
            const h1Pinch = this._isPinching(hands[0]);
            const h2Pinch = this._isPinching(hands[1]);
            
            if (h1Pinch && h2Pinch) {
                // If both are pinching, we favor SCALE or ROTATE.
                // Let's output TWO_HAND_SCALE as candidate for now.
                // The resolution logic could decide if it's more of a scale or rotate.
                gestures.push(AR_GESTURES.TWO_HAND_SCALE);
            }
        }

        // Single hand detection
        const primaryHand = hands[0];
        
        if (this._isGrabbing(primaryHand)) {
            gestures.push(AR_GESTURES.GRAB);
        } else if (this._isPinching(primaryHand)) {
            gestures.push(AR_GESTURES.PINCH);
        } else if (this._isOpenPalm(primaryHand)) {
            gestures.push(AR_GESTURES.OPEN_PALM);
        }

        if (gestures.length === 0) {
            gestures.push(AR_GESTURES.NEUTRAL);
        }

        return gestures;
    }

    _resolveConflicts(candidateGestures) {
        // Priority: TWO_HAND_SCALE > GRAB > PINCH > OPEN_PALM > NEUTRAL
        if (candidateGestures.includes(AR_GESTURES.TWO_HAND_SCALE)) return AR_GESTURES.TWO_HAND_SCALE;
        if (candidateGestures.includes(AR_GESTURES.GRAB)) return AR_GESTURES.GRAB;
        if (candidateGestures.includes(AR_GESTURES.PINCH)) return AR_GESTURES.PINCH;
        if (candidateGestures.includes(AR_GESTURES.OPEN_PALM)) return AR_GESTURES.OPEN_PALM;
        return AR_GESTURES.NEUTRAL;
    }

    _updateStateAndEmit(detectedGesture, hands) {
        // Hysteresis: require 3 frames of the same gesture to start it, 
        // 5 frames of different to end it, simplified here.
        if (detectedGesture === this.currentGesture) {
            this.framesInCurrentGesture++;
        } else {
            this.currentGesture = detectedGesture;
            this.framesInCurrentGesture = 1;
        }

        // Handle specific logic based on active state vs detected
        if (this.activeGestureEventState !== detectedGesture) {
            // Need a few frames to transition
            if (this.framesInCurrentGesture >= 3) {
                this._endActiveGesture();
                this._startGesture(detectedGesture, hands);
            } else if (this.activeGestureEventState) {
                // Continue emitting move for active gesture during grace period
                this._emitMove(this.activeGestureEventState, hands);
            }
        } else {
            // Actively in the gesture
            this._emitMove(this.activeGestureEventState, hands);
        }
        
        // Open palm hold logic (special case, not a standard start/move/end)
        if (detectedGesture === AR_GESTURES.OPEN_PALM) {
            this.openPalmFrames++;
            if (this.openPalmFrames === 60) { // ~1 second hold
                this._emit(AR_GESTURE_EVENTS.OPEN_PALM_HOLD);
            }
        } else {
            this.openPalmFrames = 0;
        }
    }

    _startGesture(gesture, hands) {
        this.activeGestureEventState = gesture;
        const primaryHand = hands[0];

        switch (gesture) {
            case AR_GESTURES.PINCH:
                this.pinchOrigin = this._getMidpoint(primaryHand[4], primaryHand[8]);
                this.initialPinchDist = this._getDistance(primaryHand[4], primaryHand[8]);
                this._emit(AR_GESTURE_EVENTS.PINCH_START);
                break;
            case AR_GESTURES.GRAB:
                this.grabOrigin = primaryHand[0]; // Wrist
                this._emit(AR_GESTURE_EVENTS.GRAB_START);
                break;
            case AR_GESTURES.TWO_HAND_SCALE:
                const p1Start = this._getMidpoint(hands[0][4], hands[0][8]);
                const p2Start = this._getMidpoint(hands[1][4], hands[1][8]);
                this.scaleOriginDist = this._getDistance(p1Start, p2Start);
                this._emit(AR_GESTURE_EVENTS.SCALE_START);
                break;
        }
    }

    _emitMove(gesture, hands) {
        if (!hands || !hands[0]) return;
        const primaryHand = hands[0];

        switch (gesture) {
            case AR_GESTURES.PINCH:
                const pinchMid = this._getMidpoint(primaryHand[4], primaryHand[8]);
                const pinchDelta = {
                    x: pinchMid.x - this.pinchOrigin.x,
                    y: pinchMid.y - this.pinchOrigin.y
                };
                
                this._emit(AR_GESTURE_EVENTS.PINCH_MOVE, pinchDelta);
                this.pinchOrigin = pinchMid; // relative updates
                break;
            case AR_GESTURES.GRAB:
                const wrist = primaryHand[0];
                const grabDelta = {
                    x: wrist.x - this.grabOrigin.x,
                    y: wrist.y - this.grabOrigin.y,
                    z: wrist.z - this.grabOrigin.z
                };
                this._emit(AR_GESTURE_EVENTS.GRAB_MOVE, grabDelta);
                this.grabOrigin = wrist;
                break;
            case AR_GESTURES.TWO_HAND_SCALE:
                if (hands.length >= 2) {
                    const p1 = this._getMidpoint(hands[0][4], hands[0][8]);
                    const p2 = this._getMidpoint(hands[1][4], hands[1][8]);
                    const currentDist = this._getDistance(p1, p2);
                    const ratio = currentDist / this.scaleOriginDist;
                    this._emit(AR_GESTURE_EVENTS.SCALE_MOVE, { scaleFactor: ratio });
                }
                break;
        }
    }

    // --- Helpers ---

    _isPinching(hand) {
        if (!hand) return false;
        const thumbTip = hand[4];
        const indexTip = hand[8];
        const isThumbIndexClose = this._getDistance(thumbTip, indexTip) < this.PINCH_THRESHOLD;
        
        // Ensure other fingers are extended to prevent confusing grab with pinch
        // 12 is Middle tip, 9 is Middle MCP. 16 is Ring tip, 13 is Ring MCP.
        const middleExtended = this._getDistance(hand[12], hand[9]) > this.GRAB_THRESHOLD;
        const ringExtended = this._getDistance(hand[16], hand[13]) > this.GRAB_THRESHOLD;
        
        return isThumbIndexClose && middleExtended && ringExtended;
    }

    _isGrabbing(hand) {
        if (!hand) return false;
        const mcp = hand[9]; // Middle MCP is good proxy for palm center
        const tips = [8, 12, 16, 20].map(i => hand[i]);
        
        let curled = 0;
        tips.forEach(tip => {
            if (this._getDistance(tip, mcp) < this.GRAB_THRESHOLD) {
                curled++;
            }
        });
        
        // Require a fully closed fist (all 4 main fingers curled)
        return curled === 4; 
    }

    _isOpenPalm(hand) {
        if (!hand) return false;
        const wrist = hand[0];
        const tips = [8, 12, 16, 20].map(i => hand[i]);
        
        let extended = 0;
        tips.forEach(tip => {
            if (this._getDistance(tip, wrist) > this.OPEN_PALM_THRESHOLD) {
                extended++;
            }
        });
        // We also want to ensure fingers are somewhat spread, but distance to wrist is a simple heuristic
        return extended >= 3;
    }

    _getDistance(p1, p2) {
        return Math.sqrt(
            Math.pow(p1.x - p2.x, 2) +
            Math.pow(p1.y - p2.y, 2) +
            Math.pow(p1.z - p2.z, 2)
        );
    }

    _getMidpoint(p1, p2) {
        return {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2,
            z: (p1.z + p2.z) / 2
        };
    }

    /** Clear all in-progress gesture state (called on AR teardown). */
    reset() {
        if (this.activeGestureEventState) {
            // End any active gesture cleanly so downstream state is consistent.
            this._endActiveGesture();
        }
        this.currentGesture = AR_GESTURES.NEUTRAL;
        this.framesInCurrentGesture = 0;
        this.activeGestureEventState = null;
        this.pinchOrigin = null;
        this.grabOrigin = null;
        this.scaleOriginDist = null;
        this.rotateOriginAngle = null;
        this.initialPinchDist = null;
        this.openPalmFrames = 0;
    }

    addEventListener(callback) {
        if (!this.listeners.includes(callback)) {
            this.listeners.push(callback);
        }
    }

    _emit(event, data = null) {
        this.listeners.forEach(cb => cb(event, data));
    }
}
