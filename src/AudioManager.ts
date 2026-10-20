// C major pentatonic: every pop and every melody note lands in the same key, so chains sound like music.
const PENTATONIC = [0, 2, 4, 7, 9];
// I - vi - IV - V, two bars each (semitones from C)
const PROGRESSION = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]];
const BPM = 112;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export type RollSurface = 'ground' | 'water' | 'air';

export class AudioManager {
    private ctx: AudioContext;
    /** Everything goes through here: a dry path plus a reverb send, then a gentle compressor so stacked sounds never clip. */
    private master: GainNode;

    // Rolling: noise layers that change with the surface under the ball
    private rollBus: GainNode;
    private bedFilter: BiquadFilterNode;
    private bedGain: GainNode;
    private rustleGain: GainNode;
    private waterGain: GainNode;
    private speedWindGain: GainNode;
    private subOsc: OscillatorNode | null = null;
    private subGain: GainNode;

    // Ambience
    private noiseBuffer: AudioBuffer | null = null;
    private brownBuffer: AudioBuffer | null = null;
    private windGain: GainNode;
    private rainGain: GainNode;
    private nextCritter = 0;
    private started = false;

    // Music
    private musicGain: GainNode;
    public musicOn = true;
    private musicTimer: number | null = null;
    private nextNoteTime = 0;
    private step = 0;
    private motif: (number | null)[] = [];
    private lastPopTime = 0;

    constructor() {
        this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -14;
        compressor.knee.value = 10;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.2;
        compressor.connect(this.ctx.destination);

        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(compressor);
        const reverb = this.ctx.createConvolver();
        reverb.buffer = this.makeImpulse(1.8);
        const send = this.gain(0.22, reverb);
        reverb.connect(compressor);
        this.master.connect(send);

        this.rollBus = this.gain(1, this.master);
        this.bedGain = this.gain(0, this.rollBus);
        this.bedFilter = this.filter('lowpass', 300, 0.7, this.bedGain);
        this.rustleGain = this.gain(0, this.rollBus);
        this.waterGain = this.gain(0, this.rollBus);
        this.subGain = this.gain(0, this.rollBus);
        this.speedWindGain = this.gain(0, this.master);
        this.windGain = this.gain(0, this.master);
        this.rainGain = this.gain(0, this.master);
        this.musicGain = this.gain(0, this.master);
        try {
            this.musicOn = localStorage.getItem('rolling-music') !== 'off';
        } catch {
            // storage blocked (private mode): keep the default
        }
    }

    private gain(value: number, dest: AudioNode): GainNode {
        const g = this.ctx.createGain();
        g.gain.value = value;
        g.connect(dest);
        return g;
    }

    private filter(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
        const f = this.ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        f.connect(dest);
        return f;
    }

    /** Small-room tail: decaying stereo noise. */
    private makeImpulse(seconds: number): AudioBuffer {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buffer = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        }
        return buffer;
    }

    public init() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (this.started) return;
        this.started = true;

        const white = this.loop(this.getNoiseBuffer());
        const brown = this.loop(this.getBrownBuffer());
        brown.connect(this.bedFilter);
        // Grass rustle: small balls brush through the blades.
        white.connect(this.filter('bandpass', 3800, 0.8, this.rustleGain));
        // Water: a mid band that sloshes with a slow wobble.
        const slosh = this.gain(0.6, this.waterGain);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 1.3;
        const depth = this.ctx.createGain();
        depth.gain.value = 0.4;
        lfo.connect(depth);
        depth.connect(slosh.gain);
        lfo.start();
        white.connect(this.filter('bandpass', 750, 1.1, slosh));
        // Rushing air at speed (dashes, big drops).
        white.connect(this.filter('bandpass', 650, 0.5, this.speedWindGain));
        white.connect(this.filter('lowpass', 300, 0.3, this.windGain));
        white.connect(this.filter('bandpass', 2000, 0.7, this.rainGain));

        this.subOsc = this.ctx.createOscillator();
        this.subOsc.frequency.value = 35;
        this.subOsc.connect(this.subGain);
        this.subOsc.start();

        this.startMusic();
    }

    private loop(buffer: AudioBuffer): AudioBufferSourceNode {
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.start(0, Math.random() * buffer.duration);
        return src;
    }

    private getNoiseBuffer(): AudioBuffer {
        if (this.noiseBuffer) return this.noiseBuffer;
        const size = this.ctx.sampleRate * 2;
        this.noiseBuffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
        return this.noiseBuffer;
    }

    /** Brown noise (integrated white): the deep, soft roar of a ball rolling over ground. */
    private getBrownBuffer(): AudioBuffer {
        if (this.brownBuffer) return this.brownBuffer;
        const size = this.ctx.sampleRate * 2;
        this.brownBuffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
        const data = this.brownBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < size; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            data[i] = last * 3.5;
        }
        return this.brownBuffer;
    }

    /** Rolling texture follows the surface: rumble + grass on land, sloshing in water, silence in the air. */
    public updateRollingSound(speed: number, maxSpeed: number, size: number, surface: RollSurface) {
        if (!this.subOsc) return;
        const now = this.ctx.currentTime;
        const r = Math.min(speed / maxSpeed, 1.6);
        const v = Math.min(r, 1);
        const big = Math.min(1, Math.log10(size + 1) / 2.5); // 0 for a marble, ~1 for a 300 m ball
        const ground = surface === 'ground';
        const set = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, 0.08);

        set(this.bedGain.gain, ground ? v * 0.32 : 0);
        set(this.bedFilter.frequency, (140 + v * 520) * (1 - big * 0.6));
        set(this.rustleGain.gain, ground ? v * 0.08 * (1 - big * 0.8) : 0);
        set(this.subGain.gain, ground ? v * 0.3 * big : 0);
        set(this.subOsc.frequency, 30 + v * 25);
        set(this.waterGain.gain, surface === 'water' ? 0.06 + v * 0.32 : 0);
        set(this.speedWindGain.gain, Math.max(0, r - 0.5) * 0.22);
    }

    /** Stereo position for one sound (-1 left … 1 right). */
    private panner(pan: number): AudioNode {
        if (Math.abs(pan) < 0.02) return this.master;
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        p.connect(this.master);
        return p;
    }

    /** One enveloped oscillator note; the building block for every jingle. */
    private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode = this.master, slideTo?: number) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(vol, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(start);
        osc.stop(start + dur + 0.05);
    }

    private noiseBurst(start: number, dur: number, vol: number, freq: number, freqTo?: number, dest: AudioNode = this.master, type: BiquadFilterType = 'bandpass') {
        const src = this.ctx.createBufferSource();
        src.buffer = this.getNoiseBuffer();
        const filter = this.ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.setValueAtTime(freq, start);
        if (freqTo) filter.frequency.exponentialRampToValueAtTime(freqTo, start + dur);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(dest);
        src.start(start, Math.random());
        src.stop(start + dur + 0.05);
    }

    private get live(): boolean {
        return this.ctx.state === 'running';
    }

    public playJumpSound() {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        this.tone(300, now, 0.08, 'sine', 0.22, this.master, 640);
        this.tone(640, now + 0.08, 0.18, 'sine', 0.14, this.master, 260);
        this.noiseBurst(now, 0.22, 0.05, 700, 2600);
    }

    public playSprintSound() {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        this.noiseBurst(now, 0.4, 0.22, 300, 2800);
        this.tone(220, now, 0.28, 'triangle', 0.07, this.master, 880);
    }

    /** Out of stamina: a tired little huff. */
    public playWindedSound() {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        this.noiseBurst(now, 0.35, 0.12, 900, 300, this.master, 'lowpass');
        this.tone(420, now, 0.3, 'triangle', 0.06, this.master, 240);
    }

    /** Cork-like bloop pitched by combo: each bite in a chain climbs one step up the pentatonic scale. */
    public playPopSound(objectSize: number, combo: number, pan = 0) {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        if (now - this.lastPopTime < 0.045) return; // avoid a wall of sound when eating many at once
        this.lastPopTime = now;

        const out = this.panner(pan);
        const i = Math.min(combo, 14);
        const octaveDrop = Math.min(2, Math.floor(Math.log10(objectSize + 1) * 1.2));
        const f = midi(72 - octaveDrop * 12 + 12 * Math.floor(i / 5) + PENTATONIC[i % 5]);
        this.tone(f, now, 0.16, 'sine', 0.2, out, f * 0.55);
        this.tone(f * 1.5, now + 0.012, 0.1, 'triangle', 0.05, out);
        this.noiseBurst(now, 0.035, 0.05, 2800, undefined, out);
        // Big things land with some weight.
        if (octaveDrop > 0) this.tone(f / 2, now, 0.24, 'sine', 0.1 * octaveDrop, out, f / 4);
    }

    public playBumpSound(hard: boolean, pan = 0) {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        const out = this.panner(pan);
        this.tone(hard ? 110 : 180, now, hard ? 0.45 : 0.2, 'sine', hard ? 0.45 : 0.22, out, hard ? 45 : 90);
        this.noiseBurst(now, hard ? 0.25 : 0.08, hard ? 0.22 : 0.08, hard ? 900 : 1400, hard ? 180 : undefined, out, 'lowpass');
        if (!hard) return;
        // Debris: a few clacks of things knocked loose.
        for (let k = 0; k < 4; k++) {
            this.noiseBurst(now + 0.06 + k * (0.05 + Math.random() * 0.05), 0.04, 0.06, 2500 + Math.random() * 2000, undefined, out);
        }
    }

    /** Plunge, wash and droplets falling back; `strength` ~0.2 (wake) to 1.5 (big drop). */
    public playSplashSound(strength: number, pan = 0) {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        const v = Math.min(1, strength);
        const out = this.panner(pan);
        this.tone(260 + (1 - v) * 200, now, 0.18, 'sine', 0.03 + v * 0.16, out, 90);
        this.noiseBurst(now, 0.25 + v * 0.45, 0.05 + v * 0.22, 1400, 250, out, 'lowpass');
        this.noiseBurst(now + 0.02, 0.15 + v * 0.2, 0.02 + v * 0.07, 5000, undefined, out);
        const drops = Math.round(2 + v * 8);
        for (let k = 0; k < drops; k++) {
            const f = 900 + Math.random() * 1800;
            this.tone(f, now + 0.12 + Math.random() * (0.25 + v * 0.35), 0.05, 'sine', 0.02 + v * 0.03, out, f * 1.6);
        }
    }

    /** Soft thud and a brush of grass when the ball lands. */
    public playLandSound(strength: number) {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        const v = Math.min(1, strength);
        this.tone(120, now, 0.2, 'sine', 0.3 * v, this.master, 50);
        this.noiseBurst(now, 0.12, 0.1 * v, 500, 150, this.master, 'lowpass');
        this.noiseBurst(now, 0.08, 0.04 * v, 3500);
    }

    public playMilestoneSound() {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        [72, 76, 79, 84, 88].forEach((n, k) => {
            this.tone(midi(n), now + k * 0.09, 0.5, 'triangle', 0.16);
            this.tone(midi(n + 12), now + k * 0.09, 0.3, 'sine', 0.05);
        });
        this.tone(midi(48), now, 0.9, 'sine', 0.18, this.master, midi(43));
    }

    public playPowerupSound() {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        this.tone(midi(79), now, 0.5, 'sine', 0.18, this.master, midi(103));
        [84, 88, 91].forEach((n, k) => this.tone(midi(n), now + 0.05 + k * 0.06, 0.25, 'triangle', 0.08));
    }

    public playTickSound(urgent: boolean) {
        if (!this.live) return;
        this.tone(urgent ? 1320 : 880, this.ctx.currentTime, 0.08, 'square', 0.05);
    }

    public playEndSound() {
        if (!this.live) return;
        const now = this.ctx.currentTime;
        [67, 72, 76, 79, 84].forEach((n, k) => this.tone(midi(n), now + k * 0.12, 0.9, 'triangle', 0.15));
    }

    // ---------- Music: a tiny generative loop in the spirit of a sunny katamari stroll ----------
    private startMusic() {
        if (this.musicTimer !== null) return;
        this.musicGain.gain.value = this.musicOn ? 0.55 : 0;
        this.nextNoteTime = this.ctx.currentTime + 0.1;
        this.musicTimer = window.setInterval(() => this.scheduleMusic(), 50);
    }

    public toggleMusic(): boolean {
        this.musicOn = !this.musicOn;
        this.musicGain.gain.setTargetAtTime(this.musicOn ? 0.55 : 0, this.ctx.currentTime, 0.1);
        try {
            localStorage.setItem('rolling-music', this.musicOn ? 'on' : 'off');
        } catch {
            // storage blocked: the toggle still works for this session
        }
        return this.musicOn;
    }

    private scheduleMusic() {
        const stepDur = 60 / BPM / 2; // eighth notes
        while (this.nextNoteTime < this.ctx.currentTime + 0.15) {
            this.playStep(this.step, this.nextNoteTime);
            this.nextNoteTime += stepDur;
            this.step = (this.step + 1) % 64;
        }
    }

    private newMotif() {
        // 16-step phrase that repeats, so the melody has shape instead of random noodling.
        this.motif = Array.from({ length: 16 }, (_, k) =>
            Math.random() < (k % 2 === 0 ? 0.7 : 0.3) ? Math.floor(Math.random() * 7) : null);
    }

    private playStep(step: number, t: number) {
        if ((step === 0 && Math.random() < 0.5) || this.motif.length === 0) this.newMotif();
        const chord = PROGRESSION[Math.floor(step / 16) % 4];
        const out = this.musicGain;

        if (step % 16 === 0) chord.forEach(n => this.tone(midi(60 + n), t, 1.9, 'sine', 0.035, out));
        if (step % 4 === 0) this.tone(midi(36 + chord[0]), t, 0.4, 'triangle', 0.16, out);
        if (step % 4 === 2) this.tone(midi(43 + chord[0]), t, 0.25, 'triangle', 0.08, out);

        const degree = this.motif[step % 16];
        if (degree !== null) {
            // Snap the motif degree onto the pentatonic scale, an octave above the chord.
            const n = 72 + 12 * Math.floor(degree / 5) + PENTATONIC[degree % 5];
            this.tone(midi(n), t, 0.28, 'triangle', 0.06, out);
            this.tone(midi(n + 12), t, 0.12, 'sine', 0.02, out);
        }
        if (step % 2 === 1) this.noiseBurst(t, 0.05, 0.025, 7000, undefined, out, 'highpass');
    }

    public suspend() {
        if (this.ctx.state === 'running') this.ctx.suspend();
    }

    public resume() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    public updateAmbientSound(isRaining: boolean, nightFactor: number) {
        const now = this.ctx.currentTime;
        this.rainGain.gain.setTargetAtTime(isRaining ? 0.12 : 0, now, 1.0);
        // Night wind: quiet, deep; daytime nearly silent
        this.windGain.gain.setTargetAtTime(isRaining ? 0.04 : nightFactor * 0.07, now, 1.0);
        this.updateCritters(isRaining, nightFactor);
    }

    /** Birds sing on clear days, crickets chirp at night; each from a random side. */
    private updateCritters(isRaining: boolean, nightFactor: number) {
        const now = this.ctx.currentTime;
        if (!this.started || now < this.nextCritter) return;
        if (nightFactor > 0.6) {
            this.crickets(now, this.panner(Math.random() * 1.6 - 0.8));
            this.nextCritter = now + 0.8 + Math.random() * 1.6;
        } else if (nightFactor < 0.3 && !isRaining) {
            this.birdCall(now, this.panner(Math.random() * 1.6 - 0.8));
            this.nextCritter = now + 2.5 + Math.random() * 6;
        } else {
            this.nextCritter = now + 2;
        }
    }

    private birdCall(t: number, out: AudioNode) {
        const base = 2200 + Math.random() * 1600;
        const notes = 2 + Math.floor(Math.random() * 4);
        const up = Math.random() < 0.5;
        for (let k = 0; k < notes; k++) {
            const f = base * (1 + (Math.random() - 0.3) * 0.25);
            this.tone(f, t + k * (0.09 + Math.random() * 0.06), 0.07 + Math.random() * 0.05, 'sine', 0.022, out, f * (up ? 1.35 : 0.75));
        }
    }

    private crickets(t: number, out: AudioNode) {
        const f = 4200 + Math.random() * 600;
        for (let k = 0; k < 3; k++) this.tone(f, t + k * 0.055, 0.035, 'sine', 0.012, out);
    }
}
