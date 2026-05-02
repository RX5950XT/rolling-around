export class AudioManager {
    private ctx: AudioContext;

    // Rolling sound: layered rumble + texture
    private rumbleOsc: OscillatorNode | null = null;
    private rumbleGain: GainNode;
    private textureOsc: OscillatorNode | null = null;
    private textureGain: GainNode;
    private rollingFilter: BiquadFilterNode;
    private rollingMaster: GainNode;

    // Ambient noise
    private noiseNode: AudioBufferSourceNode | null = null;
    private noiseGain: GainNode;
    private noiseFilter: BiquadFilterNode;
    private windGain: GainNode;
    private rainGain: GainNode;

    constructor() {
        this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

        // Rolling master gain
        this.rollingMaster = this.ctx.createGain();
        this.rollingMaster.gain.value = 0;
        this.rollingMaster.connect(this.ctx.destination);

        // Rumble layer: deep sine
        this.rumbleGain = this.ctx.createGain();
        this.rumbleGain.gain.value = 0;
        this.rumbleGain.connect(this.rollingMaster);

        // Texture layer: triangle with filter
        this.textureGain = this.ctx.createGain();
        this.textureGain.gain.value = 0;
        this.rollingFilter = this.ctx.createBiquadFilter();
        this.rollingFilter.type = 'lowpass';
        this.rollingFilter.frequency.value = 200;
        this.textureGain.connect(this.rollingFilter);
        this.rollingFilter.connect(this.rollingMaster);

        // Ambient noise setup
        this.noiseGain = this.ctx.createGain();
        this.noiseGain.gain.value = 0;
        this.noiseGain.connect(this.ctx.destination);

        this.noiseFilter = this.ctx.createBiquadFilter();
        this.noiseFilter.type = 'bandpass';
        this.noiseFilter.frequency.value = 400;
        this.noiseFilter.Q.value = 0.5;
        this.noiseFilter.connect(this.noiseGain);

        // Wind vs rain are the same noise source with different perception via filter
        this.windGain = this.ctx.createGain();
        this.windGain.gain.value = 0;
        this.windGain.connect(this.ctx.destination);

        this.rainGain = this.ctx.createGain();
        this.rainGain.gain.value = 0;
        this.rainGain.connect(this.ctx.destination);
    }

    public init() {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        if (!this.rumbleOsc) {
            this.rumbleOsc = this.ctx.createOscillator();
            this.rumbleOsc.type = 'sine';
            this.rumbleOsc.frequency.value = 40;
            this.rumbleOsc.connect(this.rumbleGain);
            this.rumbleOsc.start();
        }

        if (!this.textureOsc) {
            this.textureOsc = this.ctx.createOscillator();
            this.textureOsc.type = 'triangle';
            this.textureOsc.frequency.value = 80;
            this.textureOsc.connect(this.textureGain);
            this.textureOsc.start();
        }

        if (!this.noiseNode) {
            this.noiseNode = this.ctx.createBufferSource();
            this.noiseNode.buffer = this.createWhiteNoiseBuffer();
            this.noiseNode.loop = true;

            // Split noise into two paths: wind (low) and rain (high)
            const windFilter = this.ctx.createBiquadFilter();
            windFilter.type = 'lowpass';
            windFilter.frequency.value = 300;
            windFilter.Q.value = 0.3;

            const rainFilter = this.ctx.createBiquadFilter();
            rainFilter.type = 'bandpass';
            rainFilter.frequency.value = 2000;
            rainFilter.Q.value = 0.7;

            this.noiseNode.connect(windFilter);
            windFilter.connect(this.windGain);

            this.noiseNode.connect(rainFilter);
            rainFilter.connect(this.rainGain);

            this.noiseNode.start();
        }
    }

    private createWhiteNoiseBuffer(): AudioBuffer {
        const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    public updateRollingSound(speed: number, maxSpeed: number, size: number) {
        const speedRatio = Math.min(speed / maxSpeed, 1);
        const now = this.ctx.currentTime;

        // Master volume: silent when still, up to 0.15 when fast
        this.rollingMaster.gain.setTargetAtTime(speedRatio * 0.15, now, 0.1);

        // Rumble: deeper for bigger ball, pitch rises with speed
        const rumbleFreq = Math.max(30, 60 / Math.sqrt(size)) + speedRatio * 30;
        this.rumbleOsc!.frequency.setTargetAtTime(rumbleFreq, now, 0.1);
        this.rumbleGain.gain.setTargetAtTime(speedRatio * 0.6, now, 0.1);

        // Texture: brighter with speed, filtered
        const textureFreq = 80 + speedRatio * 150;
        this.textureOsc!.frequency.setTargetAtTime(textureFreq, now, 0.1);
        this.textureGain.gain.setTargetAtTime(speedRatio * 0.3, now, 0.1);
        this.rollingFilter.frequency.setTargetAtTime(200 + speedRatio * 600, now, 0.1);
    }

    public playPopSound(size: number) {
        if (this.ctx.state === 'suspended') return;
        const now = this.ctx.currentTime;

        // Base frequency: smaller object = higher pitch
        const baseFreq = Math.max(150, 800 - size * 5);

        // Layer 1: main tone (sine)
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(baseFreq, now);
        osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.15);

        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.25, now + 0.01);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);

        // Layer 2: harmonic overtone (triangle, one octave up)
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(baseFreq * 2, now);
        osc2.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.15);

        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(0.1, now + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);

        // Layer 3: short noise burst for "impact" texture
        const bufferSize = this.ctx.sampleRate * 0.05;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noiseOsc = this.ctx.createBufferSource();
        noiseOsc.buffer = noiseBuffer;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.08, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        noiseOsc.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        osc1.start(now);
        osc1.stop(now + 0.25);
        osc2.start(now);
        osc2.stop(now + 0.2);
        noiseOsc.start(now);
    }

    public suspend() {
        if (this.ctx.state === 'running') {
            this.ctx.suspend();
        }
    }

    public resume() {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    public updateAmbientSound(isRaining: boolean, isNight: boolean) {
        const now = this.ctx.currentTime;

        if (isRaining) {
            // Rain: louder, brighter noise
            this.rainGain.gain.setTargetAtTime(0.15, now, 1.0);
            this.windGain.gain.setTargetAtTime(0.05, now, 1.0);
        } else if (isNight) {
            // Night wind: quiet, deep
            this.rainGain.gain.setTargetAtTime(0, now, 1.0);
            this.windGain.gain.setTargetAtTime(0.08, now, 1.0);
        } else {
            // Day: nearly silent
            this.rainGain.gain.setTargetAtTime(0, now, 1.0);
            this.windGain.gain.setTargetAtTime(0, now, 1.0);
        }
    }
}