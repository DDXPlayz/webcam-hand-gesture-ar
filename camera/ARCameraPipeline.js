export class ARCameraPipeline {
    constructor() {
        this.videoElement = null;
        this.stream = null;
        this.isInitialized = false;
        this.isPlaying = false;
        this.listeners = {
            onStart: [],
            onStop: [],
            onError: [],
            onDeviceChange: []
        };
        
        this._handleDeviceChange = this._handleDeviceChange.bind(this);
    }

    /**
     * Initializes the video element. Does not request camera permissions yet.
     */
    init() {
        if (this.isInitialized) return;

        this.videoElement = document.createElement('video');
        this.videoElement.autoplay = true;
        this.videoElement.playsInline = true;
        // Don't append to DOM here. It will be used as a VideoTexture in ARSceneManager.
        // We do not want it visible as a DOM element.
        this.videoElement.style.display = 'none';
        
        // Listen for hot-swap
        navigator.mediaDevices.addEventListener('devicechange', this._handleDeviceChange);

        this.isInitialized = true;
    }

    /**
     * Requests camera permissions and starts the video stream.
     */
    /** Reject `promise` if it doesn't settle within `ms` — prevents a hung
     *  getUserMedia / metadata load from freezing AR indefinitely. */
    _withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const e = new Error(`${label} timed out after ${ms}ms`);
                e.name = 'TimeoutError';
                reject(e);
            }, ms);
            promise.then(
                (v) => { clearTimeout(timer); resolve(v); },
                (e) => { clearTimeout(timer); reject(e); }
            );
        });
    }

    async start() {
        if (!this.isInitialized) {
            this.init();
        }

        if (this.isPlaying || this._isStarting) return;
        this._isStarting = true;

        try {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const cameras = devices.filter(d => d.kind === 'videoinput');
                console.log('[CAMERA] Available cameras:', cameras.map(c => c.label || c.deviceId || 'Unknown'));
                if (cameras.length === 0) {
                    console.log('[CAMERA] No camera detected.');
                    throw new Error('No camera detected');
                }
            } catch (e) {
                console.error('[CAMERA] Failed to enumerate devices:', e);
                if (e.message === 'No camera detected') throw e;
            }

            // Use ideal constraints for a balance of quality and latency
            let constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30, max: 60 },
                    facingMode: 'user'
                },
                audio: false
            };

            try {
                this.stream = await this._withTimeout(
                    navigator.mediaDevices.getUserMedia(constraints), 15000, 'Camera request'
                );
            } catch (err) {
                if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
                    console.warn('[CAMERA] Requested camera not found. Falling back to video: true. Reason:', err.message);
                    constraints = { video: true, audio: false };
                    this.stream = await this._withTimeout(
                        navigator.mediaDevices.getUserMedia(constraints), 15000, 'Camera request'
                    );
                } else if (err.name === 'NotAllowedError') {
                    console.error('[CAMERA] Permission failure for camera.');
                    throw err;
                } else {
                    throw err;
                }
            }

            const selectedCam = this.stream.getVideoTracks()[0];
            console.log('[CAMERA] Selected camera:', selectedCam ? selectedCam.label : 'Unknown');

            this.videoElement.srcObject = this.stream;

            await this._withTimeout(new Promise((resolve, reject) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play().then(resolve).catch(reject);
                };
                this.videoElement.onerror = (e) => reject(e);
            }), 10000, 'Camera video start');

            this.isPlaying = true;
            this._isStarting = false;
            this._emit('onStart');

            // Monitor stream ended (unplug / permission revoked mid-session).
            this.stream.getVideoTracks()[0].onended = () => {
                this.stop();
                const e = new Error('Camera disconnected');
                e.type = 'CAMERA_UNAVAILABLE';
                this._emit('onError', e);
            };

        } catch (error) {
            this._isStarting = false;
            // A stream may have been acquired before a later step failed — release it.
            if (this.stream) {
                try { this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
                this.stream = null;
            }
            let errorType = 'UNKNOWN_ERROR';
            if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
                errorType = 'PERMISSION_DENIED';
            } else if (error.name === 'NotFoundError' || error.name === 'NotReadableError' ||
                       error.name === 'TimeoutError' || error.name === 'AbortError' ||
                       error.message === 'No camera detected') {
                errorType = 'CAMERA_UNAVAILABLE';
            }
            const enhancedError = new Error(error.message);
            enhancedError.type = errorType;
            enhancedError.originalError = error;
            
            this._emit('onError', enhancedError);
            throw enhancedError;
        }
    }

    /**
     * Stops the video stream and releases the camera.
     */
    stop() {
        if (!this.isPlaying) return;

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.videoElement) {
            this.videoElement.srcObject = null;
            this.videoElement.pause();
        }

        this.isPlaying = false;
        this._emit('onStop');
    }

    /**
     * Checks if the video is ready to be processed by MediaPipe/Three.js
     */
    hasNewFrame() {
        return this.isPlaying && this.videoElement && this.videoElement.readyState >= 2;
    }
    
    /**
     * Returns the underlying video element to be used as a texture.
     */
    getVideoElement() {
        return this.videoElement;
    }

    _handleDeviceChange() {
        // If we are currently playing, a device change might mean our active camera was unplugged,
        // or a better one was plugged in. We let the track 'ended' event handle disconnects,
        // but we emit this event so the controller can decide to restart.
        this._emit('onDeviceChange');
    }

    // --- Simple Event Emitter ---

    addEventListener(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    removeEventListener(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    _emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }

    dispose() {
        this.stop();
        if (this.videoElement) {
            this.videoElement.remove();
            this.videoElement = null;
        }
        navigator.mediaDevices.removeEventListener('devicechange', this._handleDeviceChange);
        this.listeners = { onStart: [], onStop: [], onError: [], onDeviceChange: [] };
        this.isInitialized = false;
    }
}
