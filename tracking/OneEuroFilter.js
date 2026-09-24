/**
 * One-Euro Filter for smoothing noisy signals (e.g. hand landmarks).
 * http://cristal.univ-lille.fr/~casiez/1euro/
 */

class LowPassFilter {
    constructor(alpha, initVal = 0) {
        this.y = initVal;
        this.s = initVal;
        this.isInitialized = false;
    }

    filter(value, alpha) {
        if (!this.isInitialized) {
            this.y = value;
            this.s = value;
            this.isInitialized = true;
        } else {
            this.s = alpha * value + (1.0 - alpha) * this.s;
        }
        return this.s;
    }
}

export class OneEuroFilter {
    /**
     * @param {number} minCutoff Decreasing this reduces jitter at low speeds (but increases lag)
     * @param {number} beta Increasing this reduces lag at high speeds (but increases jitter)
     * @param {number} dCutoff Cutoff frequency for the derivative (usually 1.0)
     */
    constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        
        this.x = new LowPassFilter(this.alpha(this.minCutoff));
        this.dx = new LowPassFilter(this.alpha(this.dCutoff));
        
        this.lastTime = null;
    }

    alpha(cutoff, dte = 1.0 / 60.0) {
        const tau = 1.0 / (2.0 * Math.PI * cutoff);
        return 1.0 / (1.0 + tau / dte);
    }

    /**
     * Filter a noisy value.
     * @param {number} value The noisy value
     * @param {number} timestamp Timestamp in milliseconds
     * @returns {number} The smoothed value
     */
    filter(value, timestamp) {
        if (this.lastTime !== null && timestamp !== undefined) {
            // Calculate time delta in seconds
            let dte = (timestamp - this.lastTime) / 1000.0;
            // Prevent division by zero or negative time
            if (dte <= 0) dte = 1e-5;

            // Estimate speed
            const dxVal = (value - this.x.y) / dte;
            const edx = this.dx.filter(dxVal, this.alpha(this.dCutoff, dte));

            // Calculate adaptive cutoff
            const cutoff = this.minCutoff + this.beta * Math.abs(edx);
            
            const result = this.x.filter(value, this.alpha(cutoff, dte));
            this.lastTime = timestamp;
            return result;
        } else {
            // First run or missing timestamp
            this.lastTime = timestamp !== undefined ? timestamp : performance.now();
            return this.x.filter(value, this.alpha(this.minCutoff));
        }
    }
    
    reset() {
        this.x.isInitialized = false;
        this.dx.isInitialized = false;
        this.lastTime = null;
    }
}
