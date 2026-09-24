import './ar-hud.css';
import { AR_STATES } from '../ARStateMachine.js';
import { AR_GESTURES } from '../gestures/ARGestureEngine.js';

export class ARHUD {
    constructor() {
        this.container = null;
        this.statusDot = null;
        this.statusText = null;
        this.confidenceBar = null;
        this.gestureHint = null;
        this.gestureFlash = null;
        this.modalOverlay = null;
        this.modalTitle = null;
        this.modalBody = null;
        this.modalActions = null;
        
        this.onExitCallback = null;
        this.onResetCallback = null;
        
        this.flashTimeout = null;

        this._initDOM();
    }

    _initDOM() {
        this.container = document.createElement('div');
        this.container.className = 'ar-hud-container';
        this.container.style.display = 'none'; // Hidden by default
        
        // Status Badge (Top Left)
        const statusBadge = document.createElement('div');
        statusBadge.className = 'ar-bracket-box ar-status-badge';
        
        this.statusDot = document.createElement('div');
        this.statusDot.className = 'ar-status-dot';
        
        this.statusText = document.createElement('div');
        this.statusText.textContent = 'INITIALIZING';
        
        this.confidenceBar = document.createElement('div');
        this.confidenceBar.className = 'ar-confidence-bar';
        for (let i = 0; i < 8; i++) {
            const seg = document.createElement('div');
            seg.className = 'ar-conf-segment';
            this.confidenceBar.appendChild(seg);
        }
        
        statusBadge.appendChild(this.statusDot);
        statusBadge.appendChild(this.statusText);
        statusBadge.appendChild(this.confidenceBar);
        this.container.appendChild(statusBadge);

        // Exit Button removed (Controlled remotely)        // Gesture Hint (Bottom Left)
        this.gestureHint = document.createElement('div');
        this.gestureHint.className = 'ar-bracket-box ar-gesture-hint';
        this.gestureHint.innerHTML = '✊ GRAB TO MOVE<br/>🤏 PINCH TO ROTATE<br/>👐 2-HAND PINCH TO ZOOM';
        this.container.appendChild(this.gestureHint);

        // Reset Button removed (Controlled remotely)        // Gesture Flash (Center)
        this.gestureFlash = document.createElement('div');
        this.gestureFlash.className = 'ar-bracket-box ar-gesture-flash';
        this.container.appendChild(this.gestureFlash);
        
        // Modal Overlay
        this.modalOverlay = document.createElement('div');
        this.modalOverlay.className = 'ar-modal-overlay';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'ar-modal-content';
        
        this.modalTitle = document.createElement('div');
        this.modalTitle.className = 'ar-modal-title';
        
        this.modalBody = document.createElement('div');
        this.modalBody.className = 'ar-modal-body';
        
        this.modalActions = document.createElement('div');
        this.modalActions.className = 'ar-modal-actions';
        
        modalContent.appendChild(this.modalTitle);
        modalContent.appendChild(this.modalBody);
        modalContent.appendChild(this.modalActions);
        this.modalOverlay.appendChild(modalContent);
        
        this.container.appendChild(this.modalOverlay);

        document.getElementById('app').appendChild(this.container);
    }

    setCallbacks(onExit, onReset) {
        this.onExitCallback = onExit;
        this.onResetCallback = onReset;
    }

    updateState(state) {
        this.statusDot.className = 'ar-status-dot';
        
        switch (state) {
            case AR_STATES.INITIALIZING:
            case AR_STATES.REQUESTING_PERMISSION:
            case AR_STATES.CAMERA_STARTING:
                this.statusText.textContent = 'INITIALIZING';
                break;
            case AR_STATES.CALIBRATING:
                this.statusText.textContent = 'CALIBRATING';
                this.statusDot.classList.add('calibrating');
                break;
            case AR_STATES.WAITING_FOR_HANDS:
                this.statusText.textContent = 'WAITING FOR HANDS';
                break;
            case AR_STATES.TRACKING_ACTIVE:
                this.statusText.textContent = 'TRACKING ACTIVE';
                this.statusDot.classList.add('active');
                this.hideModal();
                break;
            case AR_STATES.TRACKING_LOST:
                this.statusText.textContent = 'TRACKING LOST';
                break;
        }
        
        this._updateGestureHint(state, AR_GESTURES.NEUTRAL); // Reset hint on state change
    }

    updateTracking(confidence, currentGesture) {
        // Update confidence bar only when the filled count actually changes —
        // this runs every frame during tracking, so avoid redundant DOM writes.
        const filledSegments = Math.round(confidence * 8);
        if (filledSegments !== this._lastFilled) {
            this._lastFilled = filledSegments;
            const segments = this.confidenceBar.children;
            for (let i = 0; i < 8; i++) {
                segments[i].classList.toggle('filled', i < filledSegments);
            }
        }

        this._updateGestureHint(AR_STATES.TRACKING_ACTIVE, currentGesture);
    }

    _setHint(html) {
        // Only touch the DOM when the hint text actually changes.
        if (html === this._lastHint) return;
        this._lastHint = html;
        this.gestureHint.innerHTML = html;
    }

    _updateGestureHint(state, gesture) {
        if (state === AR_STATES.WAITING_FOR_HANDS || state === AR_STATES.TRACKING_LOST) {
            this._setHint('SHOW YOUR HANDS TO BEGIN');
            return;
        }

        if (state === AR_STATES.TRACKING_ACTIVE) {
            switch (gesture) {
                case AR_GESTURES.NEUTRAL:
                    this._setHint('✋ PINCH TO GRAB<br/>↕ DRAG TO ROTATE');
                    break;
                case AR_GESTURES.PINCH:
                    this._setHint('DRAG TO ROTATE<br/>RELEASE TO DROP');
                    break;
                case AR_GESTURES.GRAB:
                    this._setHint('MOVE TO REPOSITION');
                    break;
                case AR_GESTURES.TWO_HAND_SCALE:
                    this._setHint('SPREAD TO SCALE<br/>TWIST TO ROTATE');
                    break;
            }
        }
    }

    showFlash(text) {
        this.gestureFlash.textContent = text;
        this.gestureFlash.classList.add('show');
        
        if (this.flashTimeout) clearTimeout(this.flashTimeout);
        this.flashTimeout = setTimeout(() => {
            this.gestureFlash.classList.remove('show');
        }, 800);
    }

    showModal(title, body, actions = []) {
        this.modalTitle.textContent = title;
        this.modalBody.innerHTML = body; // Allow HTML for line breaks
        
        this.modalActions.innerHTML = '';
        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = `ar-btn ${action.primary ? 'primary' : ''}`;
            btn.textContent = action.label;
            btn.onclick = () => {
                if (action.onClick) action.onClick();
            };
            this.modalActions.appendChild(btn);
        });
        
        this.modalOverlay.classList.add('show');
    }

    hideModal() {
        this.modalOverlay.classList.remove('show');
    }

    show() {
        // Invalidate change-trackers so the first frame repaints cleanly.
        this._lastFilled = -1;
        this._lastHint = null;
        if (this.container) {
            this.container.style.display = 'block';
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
        this.hideModal();
    }

    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        if (this.flashTimeout) clearTimeout(this.flashTimeout);
    }
}
