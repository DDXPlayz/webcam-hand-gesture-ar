import { ARStateMachine, AR_STATES } from './ARStateMachine.js';
import { ARCameraPipeline } from './camera/ARCameraPipeline.js';
import { ARHandTracker } from './tracking/ARHandTracker.js';
import { ARGestureEngine, AR_GESTURE_EVENTS, AR_GESTURES } from './gestures/ARGestureEngine.js';
import { ARInteractionSystem } from './interaction/ARInteractionSystem.js';
import { ARSceneManager } from './scene/ARSceneManager.js';
import { ARHUD } from './ui/ARHUD.js';

export class ARController {
    constructor(carRenderer, stateManager) {
        this.renderer = carRenderer;
        this.globalStateManager = stateManager;
        
        this.stateMachine = new ARStateMachine();
        this.camera = new ARCameraPipeline();
        this.tracker = new ARHandTracker();
        this.gestureEngine = new ARGestureEngine();
        this.interaction = new ARInteractionSystem(this.renderer, this.globalStateManager);
        this.sceneManager = new ARSceneManager(this.renderer.scene, this.renderer.camera, this.renderer.renderer);
        this.hud = new ARHUD();
        
        this.animationId = null;
        this._isTransitioning = false;
        
        this._initWiring();
    }

    _initWiring() {
        // Wiring UI Callbacks
        this.hud.setCallbacks(
            () => this.exitAR(), 
            () => this.interaction.resetTransform()
        );

        // Wiring State Machine
        this.stateMachine.subscribe((newState, oldState, payload) => {
            this.hud.updateState(newState);
            this._handleStateChange(newState, oldState, payload);
        });

        // Wiring Camera
        this.camera.addEventListener('onStart', () => {
            this.sceneManager.setVideoElement(this.camera.getVideoElement());
            this.stateMachine.transition(AR_STATES.CALIBRATING);
        });
        
        this.camera.addEventListener('onError', (err) => {
            if (err.type === 'PERMISSION_DENIED') {
                this.stateMachine.transition(AR_STATES.PERMISSION_DENIED);
            } else {
                this.stateMachine.transition(AR_STATES.CAMERA_FAILED, err);
            }
        });

        this.camera.addEventListener('onDeviceChange', () => {
            // Optional: Handle hot-swap. For now, we rely on track ended to fire onError.
        });

        // Wiring Gesture Engine
        const emitInteraction = (event, data) => this.interaction.handleGesture(event, data);
        
        this.gestureEngine.addEventListener((event, data) => {
            emitInteraction(event, data);
            
            // Flash UI for important transitions
            switch (event) {
                case AR_GESTURE_EVENTS.PINCH_START:
                    this.hud.showFlash('PINCH LOCKED');
                    break;
                case AR_GESTURE_EVENTS.GRAB_START:
                    this.hud.showFlash('GRAB LOCKED');
                    break;
                case AR_GESTURE_EVENTS.SCALE_START:
                    this.hud.showFlash('SCALING');
                    break;
                case AR_GESTURE_EVENTS.OPEN_PALM_HOLD:
                    this.hud.showFlash('RESETTING VIEW');
                    break;
            }
        });

        // Auto-activate/deactivate based on global state. Leaving CAR_AR ALWAYS
        // begins a teardown (previously this was gated by a transition flag, so a
        // Back press during AR init was silently dropped and AR got stuck).
        this.globalStateManager.onChange((oldState, newState) => {
            if (newState === 'CAR_AR') {
                this.enable();
            } else if (oldState === 'CAR_AR') {
                this._beginExit();
            }
        });

        // Tab visibility edge case — free the camera when hidden, restore on return
        // (but only if the app is still in AR; the user may have left while hidden).
        this._onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                if (this.stateMachine.isActive() || this._isInitializing) {
                    this._wasActiveBeforeHide = true;
                    this.disable();
                }
            } else if (this._wasActiveBeforeHide) {
                this._wasActiveBeforeHide = false;
                if (this.globalStateManager.getState && this.globalStateManager.getState() === 'CAR_AR') {
                    this.enable();
                }
            }
        };
        document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    async enable() {
        // Guard against double-enable and re-entry during async init.
        if (this._isInitializing || this.stateMachine.isActive()) return;

        this._isInitializing = true;
        this._pendingExit = false;
        this._exiting = false;

        this.hud.show();
        this.stateMachine.transition(AR_STATES.INITIALIZING);
        this.sceneManager.enable();

        // 1. Init MediaPipe (async — the user may press Back during this window).
        try {
            await this.tracker.init();
        } catch (error) {
            console.error('[ARController] Tracker init failed:', error);
            this._isInitializing = false;
            if (this._pendingExit) { this.disable(); return; }
            this.stateMachine.transition(AR_STATES.INIT_FAILED);
            return;
        }

        this._isInitializing = false;

        // Exit was requested while initializing — tear down immediately.
        if (this._pendingExit) { this.disable(); return; }

        // 2. Request Camera
        this.stateMachine.transition(AR_STATES.REQUESTING_PERMISSION);
        this.camera.start().then(() => {
            // Don't fade in if we've been asked to exit / are no longer active.
            if (this._pendingExit || this._exiting || !this.stateMachine.isActive()) return;
            this._tweenOpacity(0, 1, 800);
        }).catch(e => console.error('[ARController] Camera start failed:', e));

        this._startRenderLoop();
    }

    _handleStateChange(newState, oldState, payload) {
        switch (newState) {
            case AR_STATES.PERMISSION_DENIED:
                this.hud.showModal(
                    '🚫 CAMERA BLOCKED',
                    'Camera access was denied. Enable it in browser settings and try again.',
                    [{ label: 'EXIT AR', primary: true, onClick: () => this.exitAR() }]
                );
                break;
                
            case AR_STATES.CAMERA_FAILED:
                this.hud.showModal(
                    '⚠️ CAMERA ERROR',
                    'Could not start the camera. Check that no other app is using it, then try again.',
                    [
                        { label: 'RETRY', primary: true, onClick: () => {
                            this.hud.hideModal();
                            this.stateMachine.transition(AR_STATES.REQUESTING_PERMISSION);
                            this.camera.start().catch(e => console.error(e));
                        }},
                        { label: 'EXIT', onClick: () => this.exitAR() }
                    ]
                );
                break;
                
            case AR_STATES.INIT_FAILED:
                this.hud.showModal(
                    '⚠️ SYSTEM ERROR',
                    'AR components could not be loaded. Check your internet connection.',
                    [{ label: 'EXIT AR', primary: true, onClick: () => this.exitAR() }]
                );
                break;
        }
    }

    /**
     * Public exit (e.g. HUD button). Drives the app back to the previous car
     * mode; the global-state onChange handler runs the actual AR teardown via
     * _beginExit(). We also call _beginExit() directly so a HUD exit still tears
     * down even if the state was already mid-change.
     */
    exitAR() {
        this.globalStateManager.requestState('CAR_IDLE');
        this._beginExit();
    }

    /**
     * Idempotent teardown entry point. Safe to call from any exit path
     * (Back/global state change, HUD button, camera error). Fades out then
     * fully disables. If called while still initializing, it defers — enable()
     * disables as soon as init settles (fixes the "Back during init" hang).
     */
    _beginExit() {
        if (this._exiting) return;
        if (!this.stateMachine.isActive() && !this._isInitializing) return;

        if (this._isInitializing) {
            this._pendingExit = true; // enable() will disable() when init settles
            return;
        }

        this._exiting = true;
        this.stateMachine.transition(AR_STATES.EXITING);
        this._tweenOpacity(1, 0, 700, () => {
            this.disable();
        });
    }

    /**
     * Full, idempotent teardown. Every listener/loop/tween/camera/resource is
     * released and all per-session state is reset, so reopening AR behaves
     * identically every time and nothing accumulates.
     */
    disable() {
        // Reset lifecycle flags first (idempotent).
        this._isInitializing = false;
        this._pendingExit = false;
        this._exiting = false;
        this._isTransitioning = false;
        this._loggedUpdateError = false;

        // Stop the render loop and any in-flight opacity tween.
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this._tweenRaf) {
            cancelAnimationFrame(this._tweenRaf);
            this._tweenRaf = null;
        }

        if (this.stateMachine.isActive()) {
            this.stateMachine.transition(AR_STATES.INACTIVE);
        }

        // Release the camera + hide the AR scene layer.
        this.camera.stop();
        this.sceneManager.disable();

        // Reset per-session tracking / gesture / interaction state for a clean
        // next open (no stale filters, gestures, or transforms carry over).
        if (this.tracker && typeof this.tracker.reset === 'function') this.tracker.reset();
        if (this.gestureEngine && typeof this.gestureEngine.reset === 'function') this.gestureEngine.reset();
        this.interaction.resetTransform();

        this.hud.hide();
    }

    _startRenderLoop() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        
        const tick = () => {
            if (!this.stateMachine.isActive()) return;

            this.animationId = requestAnimationFrame(tick);
            // A per-frame error must NEVER kill the render loop (which would
            // freeze AR and flood the console). Contain it and keep going.
            try {
                this._update();
            } catch (err) {
                if (!this._loggedUpdateError) {
                    this._loggedUpdateError = true; // log once, not 60×/sec
                    console.error('[ARController] _update error (contained):', err);
                }
            }
        };
        tick();
    }

    _update() {
        const state = this.stateMachine.getState();

        // 1. Process Hand Tracking if camera is ready
        if (this.camera.hasNewFrame() && (state === AR_STATES.CALIBRATING || state === AR_STATES.TRACKING_ACTIVE || state === AR_STATES.WAITING_FOR_HANDS || state === AR_STATES.TRACKING_LOST)) {
            const video = this.camera.getVideoElement();
            const results = this.tracker.detect(video, performance.now());

            if (results) {
                if (results.hands.length > 0) {
                    if (state !== AR_STATES.TRACKING_ACTIVE) {
                        this.stateMachine.transition(AR_STATES.TRACKING_ACTIVE);
                    }
                    
                    // 2. Process Gestures
                    this.gestureEngine.process(results.hands);
                    
                    // 3. Update HUD Confidence
                    // We just use the first hand's confidence for the UI
                    this.hud.updateTracking(results.confidences[0], this.gestureEngine.currentGesture);
                    
                } else {
                    if (state === AR_STATES.TRACKING_ACTIVE) {
                        if (this.tracker.lostFramesCount > 15) {
                            this.stateMachine.transition(AR_STATES.TRACKING_LOST);
                        }
                    } else if (state === AR_STATES.CALIBRATING) {
                        if (this.tracker.lostFramesCount > 120) { // ~2 seconds
                            this.stateMachine.transition(AR_STATES.WAITING_FOR_HANDS);
                        }
                    }
                    // Pass empty hands to end current gestures
                    this.gestureEngine.process([]);
                    this.hud.updateTracking(0, AR_GESTURES.NEUTRAL);
                }
            }
        }
        
        // 4. Update Interaction Physics (Inertia/Damping)
        this.interaction.update();
    }

    _tweenOpacity(start, end, duration, onComplete = null) {
        // Cancel any in-flight tween so fades never overlap or double-fire.
        if (this._tweenRaf) {
            cancelAnimationFrame(this._tweenRaf);
            this._tweenRaf = null;
        }
        const startTime = performance.now();
        const animate = (now) => {
            let p = (now - startTime) / duration;
            if (p >= 1) p = 1;

            // easeInOutQuad
            const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            const current = start + (end - start) * ease;

            this.sceneManager.setOpacity(current);

            if (p < 1) {
                this._tweenRaf = requestAnimationFrame(animate);
            } else {
                this._tweenRaf = null;
                if (onComplete) onComplete();
            }
        };
        this._tweenRaf = requestAnimationFrame(animate);
    }
}
