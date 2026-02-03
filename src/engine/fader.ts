/**
 * Simple fader utility inspired by Stellarium's fader_t.
 *
 * Smoothly transitions a value between 0 and 1 over a configurable duration.
 * Multiple faders can be multiplied together for layered control
 * (e.g., module_visible * individual_visible * texture_loaded).
 */
export class Fader {
    target = false;
    value = 0;
    duration: number;

    constructor(duration = 0.3) {
        this.duration = duration;
    }

    update(dt: number) {
        const goal = this.target ? 1 : 0;
        if (this.value === goal) return;
        const speed = 1 / this.duration;
        const step = speed * dt;
        const diff = goal - this.value;
        this.value += Math.sign(diff) * Math.min(step, Math.abs(diff));
    }

    /** Smoothstep-eased value for perceptually smooth transitions */
    get eased(): number {
        const v = this.value;
        return v * v * (3 - 2 * v);
    }
}
