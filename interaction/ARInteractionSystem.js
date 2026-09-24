import { AR_GESTURE_EVENTS } from '../gestures/ARGestureEngine.js';
import { EVENTS, CAR_CMD } from '../../../shared/constants.js';

export class ARInteractionSystem {
    /**
     * @param {CarRenderer} carRenderer 
     * @param {StateManager} stateManager 
     */
    constructor(carRenderer, stateManager) {
        this.renderer = carRenderer;
        this.stateManager = stateManager;
        
        // Physics / Inertia state
        this.velocity = { x: 0, y: 0, z: 0 };
        this.rotVelocity = { x: 0, y: 0 };
        
        this.isInteracting = false;
        
        // Sensitivities
        this.rotSensitivity = 4.0;
        this.moveSensitivity = 2.0; // Reduced for closer to 1:1 physical mapping
        
        this.bounds = {
            scale: { min: 0.3, max: 3.0 },
            x: { min: -5, max: 5 },
            y: { min: -2, max: 5 }, // Relative to base
            z: { min: -5, max: 5 }
        };

        this.baseScale = 1.0;
        this.targetScale = 1.0;

        this.lastSyncTime = 0;
        
        this.handleGesture = this.handleGesture.bind(this);
    }

    /**
     * Called by ARController on requestAnimationFrame
     */
    update() {
        if (!this.renderer || !this.renderer.carGroup) return;

        // Apply inertia if not actively interacting
        if (!this.isInteracting) {
            const decay = 0.85; // Friction

            this.velocity.x *= decay;
            this.velocity.y *= decay;
            this.velocity.z *= decay;

            this.rotVelocity.x *= decay;
            this.rotVelocity.y *= decay;

            if (Math.abs(this.velocity.x) > 0.001 || Math.abs(this.velocity.y) > 0.001 || Math.abs(this.velocity.z) > 0.001) {
                this._applyTranslation(this.velocity);
                this._emitSyncState();
            }

            if (Math.abs(this.rotVelocity.x) > 0.001 || Math.abs(this.rotVelocity.y) > 0.001) {
                this._applyRotation(this.rotVelocity);
                this._emitSyncState();
            }
        }
        
        // Smooth scale interpolation
        const interactionScale = this.renderer.transformStack.interaction.scale;
        if (Math.abs(this.targetScale - interactionScale) > 0.001) {
            const newScale = interactionScale + (this.targetScale - interactionScale) * 0.2; // Damping
            this.renderer.transformStack.interaction.scale = newScale;
            this._emitSyncState();
        }
    }

    handleGesture(event, data) {
        if (!this.renderer || !this.renderer.carGroup) return;

        switch (event) {
            case AR_GESTURE_EVENTS.PINCH_START:
            case AR_GESTURE_EVENTS.SCALE_START:
                this.isInteracting = true;
                this.velocity = { x: 0, y: 0, z: 0 };
                this.rotVelocity = { x: 0, y: 0 };
                if (event === AR_GESTURE_EVENTS.SCALE_START) {
                    this.baseScale = this.renderer.transformStack.interaction.scale;
                }
                break;
                
            case AR_GESTURE_EVENTS.GRAB_START:
                this.isInteracting = true;
                this.velocity = { x: 0, y: 0, z: 0 };
                this.rotVelocity = { x: 0, y: 0 };
                this.renderer.setHighlight(true, 0xff0000); // Red highlight
                break;

            case AR_GESTURE_EVENTS.PINCH_END:
            case AR_GESTURE_EVENTS.SCALE_END:
                this.isInteracting = false;
                // Kill momentum immediately upon release to prevent "flying off"
                this.velocity = { x: 0, y: 0, z: 0 };
                this.rotVelocity = { x: 0, y: 0 };
                break;
                
            case AR_GESTURE_EVENTS.GRAB_END:
                this.isInteracting = false;
                this.velocity = { x: 0, y: 0, z: 0 };
                this.rotVelocity = { x: 0, y: 0 };
                this.renderer.setHighlight(false);
                break;

            case AR_GESTURE_EVENTS.PINCH_MOVE:
                // data is {x, y} delta
                this.rotVelocity = {
                    x: data.y * this.rotSensitivity, // Vertical screen movement -> X-axis rotation
                    y: -data.x * this.rotSensitivity  // Invert lateral (Horizontal screen movement) -> Y-axis rotation
                };
                
                this._applyRotation(this.rotVelocity);
                this._emitSyncState();
                break;

            case AR_GESTURE_EVENTS.GRAB_MOVE:
                // Direct Screen-Space Manipulation
                // 1. Project car position to 2D screen space (NDC: -1 to 1)
                const camera = this.renderer.camera;
                const carPos = this.renderer.carGroup.position.clone();
                carPos.project(camera);

                // 2. Apply the hand's screen-space delta
                carPos.x += (-data.x * 2.0);
                carPos.y += (-data.y * 2.0);

                // 3. Unproject back to 3D world space
                carPos.unproject(camera);

                // 4. Convert world position to interaction stack position
                const stack = this.renderer.transformStack;
                const newInteractionPos = carPos.clone()
                    .sub(stack.canonical.position)
                    .sub(stack.state.position)
                    .sub(stack.transition.position);
                
                // Clamp
                newInteractionPos.x = Math.max(this.bounds.x.min, Math.min(this.bounds.x.max, newInteractionPos.x));
                newInteractionPos.y = Math.max(this.bounds.y.min, Math.min(this.bounds.y.max, newInteractionPos.y));
                newInteractionPos.z = Math.max(this.bounds.z.min, Math.min(this.bounds.z.max, newInteractionPos.z));

                stack.interaction.position.copy(newInteractionPos);

                this._emitSyncState();
                break;

            case AR_GESTURE_EVENTS.SCALE_MOVE:
                let desiredScale = this.baseScale * data.scaleFactor;
                desiredScale = Math.max(this.bounds.scale.min, Math.min(this.bounds.scale.max, desiredScale));
                this.targetScale = desiredScale;
                break;

            case AR_GESTURE_EVENTS.OPEN_PALM_HOLD:
                this.resetTransform();
                break;
        }
    }

    _applyRotation(delta) {
        const interaction = this.renderer.transformStack.interaction;
        interaction.rotation.y += delta.y;
        interaction.rotation.x += delta.x;
    }

    _applyTranslation(delta) {
        // Deprecated: Replaced by direct screen-space manipulation in GRAB_MOVE
    }

    resetTransform() {
        this.targetScale = 1.0;
        this.velocity = { x: 0, y: 0, z: 0 };
        this.rotVelocity = { x: 0, y: 0 };
        
        this.renderer.transformStack.interaction.position.set(0, 0, 0);
        this.renderer.transformStack.interaction.rotation.set(0, 0, 0);
        this.renderer.transformStack.interaction.scale = 1.0;
        
        this._emitSyncState();
    }

    _emitSyncState() {
        const now = performance.now();
        if (now - this.lastSyncTime < 50) return; // 20Hz max

        this.lastSyncTime = now;
        const interaction = this.renderer.transformStack.interaction;

        this.stateManager.emitCommand(EVENTS.CAR_CMD, {
            action: CAR_CMD.SYNC_STATE,
            mode: 'ar',
            rotation: {
                x: interaction.rotation.x,
                y: interaction.rotation.y,
                z: interaction.rotation.z
            },
            position: {
                x: interaction.position.x,
                y: interaction.position.y,
                z: interaction.position.z
            },
            scale: interaction.scale
        });
    }
}
