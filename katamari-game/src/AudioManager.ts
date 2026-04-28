export class AudioManager {
    private ctx: AudioContext;
    private rollingOscillator: OscillatorNode | null = null;
    private rollingGain: GainNode;

    // Ambient
    private ambientOsc: OscillatorNode | null = null;
    private ambientGain: GainNode;

    constructor() {
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

        // Setup Rolling Sound
        this.rollingGain = this.ctx.createGain();
        this.rollingGain.gain.value = 0;
        this.rollingGain.connect(this.ctx.destination);

        // Setup Ambient Sound (Wind/Rain)
        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = 0;
        this.ambientGain.connect(this.ctx.destination);
    }

    public init() {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        if (!this.rollingOscillator) {
            this.rollingOscillator = this.ctx.createOscillator();
            this.rollingOscillator.type = 'triangle';
            this.rollingOscillator.frequency.value = 50;
            this.rollingOscillator.connect(this.rollingGain);
            this.rollingOscillator.start();
        }

        if (!this.ambientOsc) {
            // Pseudo noise with low frequency oscillator
            this.ambientOsc = this.ctx.createOscillator();
            this.ambientOsc.type = 'sawtooth';
            this.ambientOsc.frequency.value = 100;

            // Add a lowpass filter for wind effect
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 400;

            this.ambientOsc.connect(filter);
            filter.connect(this.ambientGain);
            this.ambientOsc.start();
        }
    }

    public updateRollingSound(speed: number, maxSpeed: number, size: number) {
        if (!this.rollingOscillator) return;

        // Volume based on speed
        const speedRatio = Math.min(speed / maxSpeed, 1);
        this.rollingGain.gain.setTargetAtTime(speedRatio * 0.2, this.ctx.currentTime, 0.1);

        // Pitch based on size (bigger = deeper) and speed
        const baseFreq = Math.max(10, 100 / Math.sqrt(size));
        const freq = baseFreq + (speedRatio * 20);
        this.rollingOscillator.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.1);
    }

    public playPopSound(size: number) {
        if (this.ctx.state === 'suspended') return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Bigger objects = lower pitch
        const freq = Math.max(100, 800 - (size * 10));
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + 0.1);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    public updateAmbientSound(isRaining: boolean, isNight: boolean) {
        if (!this.ambientOsc) return;

        let targetGain = 0;
        let targetFreq = 100;

        if (isRaining) {
            targetGain = 0.3; // Louder for rain
            targetFreq = 600; // Harsher sound
            this.ambientOsc.type = 'square';
        } else if (isNight) {
            targetGain = 0.1; // Quiet wind
            targetFreq = 50;  // Deep sound
            this.ambientOsc.type = 'sawtooth';
        } else {
            targetGain = 0; // Quiet day
        }

        this.ambientGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 1.0);
        this.ambientOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 1.0);
    }
}
