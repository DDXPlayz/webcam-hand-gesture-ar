export const AR_STATES = {
    INACTIVE: 'INACTIVE',
    INITIALIZING: 'INITIALIZING',
    REQUESTING_PERMISSION: 'REQUESTING_PERMISSION',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    INIT_FAILED: 'INIT_FAILED',
    CAMERA_STARTING: 'CAMERA_STARTING',
    CAMERA_FAILED: 'CAMERA_FAILED',
    CALIBRATING: 'CALIBRATING',
    WAITING_FOR_HANDS: 'WAITING_FOR_HANDS',
    TRACKING_ACTIVE: 'TRACKING_ACTIVE',
    TRACKING_LOST: 'TRACKING_LOST',
    EXITING: 'EXITING'
};

export class ARStateMachine {
    constructor() {
        this.state = AR_STATES.INACTIVE;
        this.listeners = [];
        this.debug = false;
    }

    /**
     * Attempts to transition to a new state.
     * @param {string} newState 
     * @param {Object} [payload] Optional data associated with the state change
     * @returns {boolean} True if the transition was successful
     */
    transition(newState, payload = null) {
        if (!Object.values(AR_STATES).includes(newState)) {
            console.error(`[ARStateMachine] Invalid state: ${newState}`);
            return false;
        }

        // Prevent redundant transitions
        if (this.state === newState) return false;

        const oldState = this.state;
        
        // --- Optional Transition Validation ---
        // (You could enforce strict state machine graph rules here, 
        // e.g. can't go from INACTIVE -> TRACKING_ACTIVE directly)
        
        this.state = newState;
        
        if (this.debug) {
            console.log(`[ARStateMachine] ${oldState} -> ${newState}`);
        }

        // Notify listeners
        this.listeners.forEach(cb => {
            try {
                cb(newState, oldState, payload);
            } catch (err) {
                console.error('[ARStateMachine] Error in listener:', err);
            }
        });

        return true;
    }

    /**
     * Add a listener for state changes.
     * @param {Function} callback (newState, oldState, payload) => {}
     */
    subscribe(callback) {
        if (!this.listeners.includes(callback)) {
            this.listeners.push(callback);
        }
        return () => this.unsubscribe(callback); // Return an unsubscribe function
    }

    unsubscribe(callback) {
        this.listeners = this.listeners.filter(cb => cb !== callback);
    }

    getState() {
        return this.state;
    }

    isActive() {
        return this.state !== AR_STATES.INACTIVE;
    }
}
