import * as THREE from 'three';
import { Engine } from './Engine';
import { Player } from './Player';
import { WorldManager } from './WorldManager';
import { WeatherSystem } from './WeatherSystem';
import { AudioManager } from './AudioManager';
import { Effects } from './Effects';
import { HUD, formatLength, type RunStats } from './HUD';
import { TouchControls } from './TouchControls';
import { POWERUPS, type PowerupType } from './ObjectFactory';
import { boxContact, type SolidBox } from './worldLayout';
import {
    CHALLENGE_SECONDS, COMBO_WINDOW, GROWTH_EFFICIENCY, TITLES, canEat, comboBonus, jumpVelocity, titleIndex, topSpeed,
} from './rules';

type Mode = 'challenge' | 'free';
const BEST_KEY = 'rolling-best';

export class GameManager {
    public engine: Engine;
    public player: Player;
    public world: WorldManager;
    public weather: WeatherSystem;
    public audio: AudioManager;
    private effects: Effects;
    private hud: HUD;

    public isPaused: boolean = true;
    private started = false;
    private ended = false;
    private disposed: boolean = false;
    private timer = new THREE.Timer();
    private isTouch: boolean;
    private touchControls?: TouchControls;

    private mode: Mode = 'free';
    private timeLeft = CHALLENGE_SECONDS;
    private combo = 0;
    private comboClock = 0;
    private bestCombo = 0;
    private eaten = 0;
    private collection = new Map<string, number>();
    private titleIdx = 0;
    private powerTime = { magnet: 0, boost: 0 };
    private bumpCooldown = 0;
    private lastAutoPause = 0;
    private inWater = false;
    private wakeClock = 0;
    private bumpPoint = new THREE.Vector3();

    private terrain = (x: number, z: number) => this.world.getTerrainHeight(x, z);
    private rollingSurface = (x: number, z: number) => this.world.getRollingHeight(x, z, this.player.mesh.position.y - this.player.size * 0.9);

    constructor() {
        this.engine = new Engine();
        this.player = new Player(this.engine.scene);
        this.world = new WorldManager(this.engine.scene, this.player);
        this.weather = new WeatherSystem(
            this.engine.scene, this.player, this.engine.dirLight, this.engine.hemiLight, this.engine.camera, this.engine.renderer,
        );
        this.audio = new AudioManager();
        this.effects = new Effects(this.engine.scene);
        this.hud = new HUD();
        this.timer.connect(document);

        this.isTouch = window.matchMedia('(pointer: coarse)').matches;
        if (this.isTouch) {
            document.body.classList.add('touch');
            this.touchControls = new TouchControls(this.player, this.engine);
        }

        document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => this.startGame(btn.dataset.mode === 'challenge' ? 'challenge' : 'free'));
        });
        document.getElementById('resume-btn')!.addEventListener('click', () => this.resumeGame());
        document.getElementById('pause-btn')!.addEventListener('click', () => this.pauseGame());
        document.getElementById('music-btn')!.addEventListener('click', () => this.toggleMusic());
        // A fresh page is the simplest full reset of world, ball and audio graph.
        document.getElementById('restart-btn')!.addEventListener('click', () => window.location.reload());
        document.getElementById('again-btn')!.addEventListener('click', () => window.location.reload());
        this.showBestRecords();

        this.player.setJumpCallback(() => this.audio.playJumpSound());
        this.player.setSprintCallbacks(() => this.audio.playSprintSound(), () => this.audio.playWindedSound());
        this.initControls();

        if (import.meta.env.DEV) (window as unknown as { game: GameManager }).game = this;
        this.animate();
    }

    private initControls() {
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.code === 'KeyP') this.togglePause();
            // Pointer lock eats Esc to unlock and pointerlockchange already paused; ignore the trailing keydown.
            if (e.code === 'Escape' && performance.now() - this.lastAutoPause > 400) this.togglePause();
            if (e.code === 'KeyM' && this.started) {
                this.toggleMusic();
            }
        });

        this.engine.onPointerLockChange((isLocked) => {
            if (isLocked) {
                this.hud.hideHint();
            } else if (!this.isPaused && this.started && !this.ended) {
                this.lastAutoPause = performance.now();
                this.pauseGame();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.pauseGame();
        });
    }

    private toggleMusic() {
        const on = this.audio.toggleMusic();
        const button = document.getElementById('music-btn')!;
        button.textContent = on ? '音樂：開' : '音樂：關';
        button.setAttribute('aria-pressed', String(on));
        this.hud.hint(on ? '音樂：開' : '音樂：關', 1.2);
    }

    private loadBest(): Record<Mode, number> {
        try {
            const raw: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
            const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
            const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
            return { challenge: num(rec.challenge), free: num(rec.free) };
        } catch {
            return { challenge: 0, free: 0 };
        }
    }

    private showBestRecords() {
        const best = this.loadBest();
        if (best.challenge) document.getElementById('best-challenge')!.textContent = `最佳紀錄 ${formatLength(best.challenge)}`;
        if (best.free) document.getElementById('best-free')!.textContent = `最大紀錄 ${formatLength(best.free)}`;
    }

    /** Saves the run if it beats the record; returns [isRecord, best]. */
    private saveBest(): [boolean, number] {
        const best = this.loadBest();
        const isRecord = this.player.size > best[this.mode];
        if (isRecord) {
            best[this.mode] = this.player.size;
            try {
                localStorage.setItem(BEST_KEY, JSON.stringify(best));
            } catch {
                // storage blocked: the record just won't persist
            }
        }
        return [isRecord, best[this.mode]];
    }

    private get stats(): RunStats {
        return { size: this.player.size, eaten: this.eaten, bestCombo: this.bestCombo, collection: this.collection };
    }

    public startGame(mode: Mode) {
        if (this.started) return;
        this.started = true;
        this.mode = mode;
        document.getElementById('start-screen')!.classList.add('hidden');
        if (this.isTouch) document.getElementById('touch-controls')!.classList.remove('hidden');
        this.hud.show(mode === 'challenge');
        this.hud.setTimer(this.timeLeft);
        this.audio.init();
        this.isPaused = false;
        this.player.enabled = true;
        this.timer.reset();
        if (!this.isTouch) this.engine.requestPointerLock();
        this.hud.banner('出發！', mode === 'challenge' ? '4 分鐘內滾到最大' : '想滾多久就滾多久');
    }

    public pauseGame() {
        if (!this.started || this.ended || this.isPaused) return;
        this.isPaused = true;
        this.player.enabled = false;
        this.touchControls?.reset();
        document.getElementById('touch-controls')!.classList.add('hidden');
        const music = document.getElementById('music-btn')!;
        music.textContent = this.audio.musicOn ? '音樂：開' : '音樂：關';
        music.setAttribute('aria-pressed', String(this.audio.musicOn));
        this.hud.showPause(this.stats);
        this.audio.suspend();
        this.engine.exitPointerLock();
    }

    public resumeGame() {
        if (!this.started || this.ended || !this.isPaused) return;
        this.isPaused = false;
        this.player.enabled = true;
        if (this.isTouch) document.getElementById('touch-controls')!.classList.remove('hidden');
        this.hud.hidePause();
        this.timer.reset();
        this.audio.resume();
        if (!this.isTouch) {
            this.engine.requestPointerLock();
            if (!this.engine.isPointerLocked()) this.hud.hint('點一下畫面就能用滑鼠轉視角', 3);
        }
    }

    public togglePause() {
        if (this.isPaused) {
            this.resumeGame();
        } else {
            this.pauseGame();
        }
    }

    private endGame() {
        this.ended = true;
        this.isPaused = true;
        this.player.enabled = false;
        this.touchControls?.reset();
        document.getElementById('touch-controls')!.classList.add('hidden');
        this.engine.exitPointerLock();
        this.audio.updateRollingSound(0, 1, this.player.size, 'ground');
        this.audio.playEndSound();
        const [isRecord, best] = this.saveBest();
        this.hud.showEnd(this.stats, isRecord, best);
    }

    // ---------- Collisions: eat what is smaller, bounce off what is bigger ----------
    private checkCollisions(delta: number) {
        const pp = this.player.mesh.position;
        const r = this.player.size;
        const pv = this.player.volume;
        const magnetR = this.powerTime.magnet > 0 ? r * 9 + 10 : 0;
        const gone = new Set<THREE.Object3D>();
        let pushX = 0;
        let pushZ = 0;
        let maxSep = 0;

        for (const obj of this.world.collidables) {
            const ud = obj.userData;
            const op = obj.position;
            const edible = canEat(ud.volume, pv);
            if (ud.building && !edible) {
                this.collideBuilding(obj);
                continue;
            }
            let dx = pp.x - op.x;
            let dz = pp.z - op.z;
            let d2 = dx * dx + dz * dz;
            if (magnetR > 0 && edible && d2 < magnetR * magnetR) {
                this.pull(obj, dx, dz, d2, delta);
                dx = pp.x - op.x;
                dz = pp.z - op.z;
                d2 = dx * dx + dz * dz;
            }

            const reach = r + ud.radius;
            if (d2 >= reach * reach) continue;
            if (pp.y - r > op.y + ud.height || pp.y + r < op.y) continue; // passing over / under it

            if (ud.powerup) {
                this.collectPowerup(obj);
                gone.add(obj);
            } else if (edible) {
                this.eat(obj);
                gone.add(obj);
            } else {
                const d = Math.sqrt(d2) || 0.001;
                pushX += dx / d;
                pushZ += dz / d;
                maxSep = Math.max(maxSep, reach - d);
            }
        }

        this.world.forget(gone);
        if (maxSep > 0) this.resolveBump(pushX, pushZ, maxSep);
        if (gone.size) {
            // HUD once per frame: a big ball can swallow dozens of things in one frame.
            this.hud.setEaten(this.eaten);
            if (this.combo >= 2) this.hud.setCombo(this.combo);
            this.checkMilestone();
        }
    }

    private collideBuilding(obj: THREE.Object3D) {
        const pos = this.player.mesh.position, k = obj.userData.buildingScale as number;
        if (Math.abs(pos.x - obj.position.x) > 9 * k + this.player.size
            || Math.abs(pos.z - obj.position.z) > 9 * k + this.player.size) return;
        const c = Math.cos(obj.rotation.y), s = Math.sin(obj.rotation.y);
        for (const box of obj.userData.boxes as SolidBox[]) {
            const dx = pos.x - obj.position.x, dz = pos.z - obj.position.z;
            const hit = boxContact((c * dx - s * dz) / k, (pos.y - obj.position.y) / k,
                (s * dx + c * dz) / k, this.player.size / k, box);
            if (!hit) continue;
            if (Math.abs(hit.y) > 0.5) {
                pos.y += hit.y * hit.depth * k;
                if (this.player.verticalVelocity * hit.y < 0) this.player.verticalVelocity = 0;
                if (hit.y > 0) this.player.isGrounded = true;
            } else {
                this.resolveBump(c * hit.x + s * hit.z, -s * hit.x + c * hit.z, hit.depth * k);
            }
        }
    }

    private pull(obj: THREE.Object3D, dx: number, dz: number, d2: number, delta: number) {
        const d = Math.sqrt(d2) || 1;
        const step = Math.min(d, (this.player.size * 12 + 8) * delta);
        obj.position.x += (dx / d) * step;
        obj.position.z += (dz / d) * step;
        obj.position.y = this.world.getTerrainHeight(obj.position.x, obj.position.z) + (obj.userData.altitude || 0);
    }

    private eat(obj: THREE.Object3D) {
        const ud = obj.userData;
        this.combo = this.comboClock > 0 ? this.combo + 1 : 1;
        this.comboClock = COMBO_WINDOW;
        this.bestCombo = Math.max(this.bestCombo, this.combo);

        const op = obj.position;
        this.effects.burst(op.x, op.y + ud.height * 0.5, op.z, 5 + Math.min(10, this.combo), this.player.size * 5 + 3);
        if (ud.building) for (const child of obj.children) child.visible = true;
        this.player.attachObject(obj, ud.volume * GROWTH_EFFICIENCY * comboBonus(this.combo));

        this.eaten++;
        const n = (this.collection.get(ud.kind) ?? 0) + 1;
        this.collection.set(ud.kind, n);
        this.hud.feed(ud.kind, n === 1);
        this.audio.playPopSound(ud.size, this.combo - 1, this.engine.panOf(op));
    }

    private collectPowerup(obj: THREE.Object3D) {
        const type = obj.userData.powerup as PowerupType;
        const info = POWERUPS[type];
        const p = obj.position;
        this.effects.burst(p.x, p.y, p.z, 40, this.player.size * 8 + 4, [info.color, 0xffffff, 0xffe08a]);
        this.audio.playPowerupSound();
        obj.removeFromParent();
        if (type === 'giant') {
            this.player.grow(this.player.volume * 0.25);
            this.engine.shake(0.3);
            this.hud.feedText(`${info.name}！體積 +25%`, 'power');
        } else {
            this.powerTime[type] = info.seconds;
            this.hud.feedText(`${info.name}！${info.seconds} 秒`, 'power');
        }
    }

    private resolveBump(pushX: number, pushZ: number, maxSep: number) {
        const len = Math.hypot(pushX, pushZ);
        if (len < 1e-3) {
            pushX = 1;
            pushZ = 0;
        } else {
            pushX /= len;
            pushZ /= len;
        }
        const pos = this.player.mesh.position;
        const sep = maxSep + this.player.size * 0.05;
        pos.x += pushX * sep;
        pos.z += pushZ * sep;

        // Reflect off the obstacle with a little bounce instead of a dead stop.
        const v = this.player.velocity;
        const into = -(v.x * pushX + v.z * pushZ);
        if (into > 0) {
            v.x += pushX * into * 1.5;
            v.z += pushZ * into * 1.5;
        }

        const top = topSpeed(this.player.size);
        if (this.bumpCooldown > 0 || into < top * 0.25) return;
        const hard = into > top * 0.75;
        this.bumpCooldown = 0.35;
        const obstacle = this.bumpPoint.set(pos.x - pushX * this.player.size, pos.y, pos.z - pushZ * this.player.size);
        this.audio.playBumpSound(hard, this.engine.panOf(obstacle));
        this.engine.shake(hard ? 0.6 : 0.2);
        if (!hard) return;

        const lost = this.player.knockOff(1 + Math.floor(Math.random() * 3));
        lost.forEach(p => this.effects.burst(p.x, p.y, p.z, 10, this.player.size * 8, [0xb9bccb, 0xffffff, 0xff8fab]));
        if (lost.length) this.hud.feedText(`撞掉了 ${lost.length} 件！`, 'bad');
        this.combo = 0;
        this.comboClock = 0;
        this.hud.hideCombo();
    }

    private checkMilestone() {
        const i = titleIndex(this.player.size);
        if (i <= this.titleIdx) return;
        this.titleIdx = i;
        const p = this.player.mesh.position;
        const r = this.player.size;
        this.hud.banner(TITLES[i].name, i === TITLES.length - 1 ? '最高稱號達成！' : '升級了！');
        this.audio.playMilestoneSound();
        this.effects.burst(p.x, p.y + r, p.z, 120, r * 12 + 6);
        this.engine.shake(0.25);
    }

    // ---------- Per-frame systems ----------
    private updatePowerups(delta: number) {
        this.powerTime.magnet = Math.max(0, this.powerTime.magnet - delta);
        this.powerTime.boost = Math.max(0, this.powerTime.boost - delta);
        this.player.speedBoost = this.powerTime.boost > 0 ? 1.7 : 1;
        const pulse = 0.35 + Math.sin(performance.now() * 0.008) * 0.15;
        if (this.powerTime.boost > 0) this.player.setGlow(POWERUPS.boost.color, pulse);
        else if (this.powerTime.magnet > 0) this.player.setGlow(POWERUPS.magnet.color, pulse);
        else this.player.setGlow(0x000000, 0);
        this.hud.setPowerups(this.powerTime);
    }

    private updateCombo(delta: number) {
        this.bumpCooldown = Math.max(0, this.bumpCooldown - delta);
        if (this.comboClock <= 0) return;
        this.comboClock -= delta;
        if (this.comboClock <= 0) {
            this.combo = 0;
            this.hud.hideCombo();
        }
    }

    private updateTimer(delta: number) {
        if (this.mode !== 'challenge') return;
        const before = Math.ceil(this.timeLeft);
        this.timeLeft -= delta;
        const after = Math.ceil(this.timeLeft);
        if (after !== before && after <= 10 && after > 0) this.audio.playTickSound(after <= 3);
        this.hud.setTimer(this.timeLeft);
        if (this.timeLeft <= 0) this.endGame();
    }

    /** Splashes, wake rings and landing thuds: what the ball's contact with ground and water looks and sounds like. */
    private updateContact(delta: number) {
        const p = this.player;
        const pos = p.mesh.position;
        const s = p.size;
        const surfaceY = this.world.waterLevel;
        const impact = p.takeLanding() / jumpVelocity(s);
        const speedRatio = p.velocity.length() / topSpeed(s);
        // Hysteresis so the shoreline doesn't flicker in and out of the water.
        const wet = p.waterDepth > s * (this.inWater ? 0.03 : 0.1);

        if (wet && (!this.inWater || impact > 0.3)) {
            const strength = Math.min(1.5, 0.3 + impact + speedRatio * 0.4);
            this.effects.splash(pos.x, surfaceY, pos.z, s, strength);
            this.audio.playSplashSound(strength);
            if (strength > 0.8) this.engine.shake(0.15);
        } else if (!wet && impact > 0.3) {
            this.effects.puff(pos.x, pos.y - s * 0.9, pos.z, Math.round(6 + impact * 10), s * 3 * impact);
            this.audio.playLandSound(impact);
            if (impact > 0.8) this.engine.shake(0.1);
        }
        this.inWater = wet;

        this.wakeClock -= delta;
        if (wet && speedRatio > 0.15 && this.wakeClock <= 0) {
            this.wakeClock = 0.2;
            this.effects.ripple(pos.x, surfaceY, pos.z, s * 0.6, 0, 0.25);
            this.effects.splash(pos.x, surfaceY, pos.z, s, 0.1);
        }
        // Sprinting on land kicks up a trail of dust behind the ball.
        if (p.sprinting && p.isGrounded && !wet && this.wakeClock <= 0) {
            this.wakeClock = 0.07;
            const v = p.velocity;
            const back = s / (v.length() || 1);
            this.effects.puff(pos.x - v.x * back, pos.y - s * 0.85, pos.z - v.z * back, 2, s * 1.5);
        }
    }

    private step(delta: number) {
        this.world.update(delta);
        this.updatePowerups(delta);
        // Short physics steps keep sprinting balls from skipping thin walls on a slow frame.
        const steps = Math.max(1, Math.ceil(delta / (1 / 60)));
        for (let i = 0; i < steps; i++) {
            this.player.update(delta / steps, this.engine.cameraAngle, this.rollingSurface, this.world.waterLevel);
            this.checkCollisions(delta / steps);
        }
        this.updateContact(delta);
        this.updateCombo(delta);
        this.effects.update(delta, this.player.size);

        const size = this.player.size;
        this.weather.update(delta, this.engine.cameraDistance * size, this.world.worldRadius);

        const speed = this.player.velocity.length();
        this.engine.speedRatio = speed / topSpeed(size);
        const surface = this.player.waterDepth > 0 ? 'water' : this.player.isGrounded ? 'ground' : 'air';
        this.audio.updateRollingSound(speed, this.player.currentTopSpeed, size, surface);
        this.audio.updateAmbientSound(this.weather.isRaining, this.weather.nightFactor);
        this.engine.updateCamera(this.player.mesh.position, size, delta, this.terrain);

        this.hud.setSize(size);
        const stamina = this.player.staminaState;
        this.hud.setStamina(stamina.level, stamina.exhausted, this.player.sprinting);
        this.updateTimer(delta);
    }

    /** Behind the start menu: the world loads and the camera slowly circles the ball. */
    private idle(delta: number) {
        this.engine.cameraAngle += delta * 0.12;
        this.world.update(delta);
        this.weather.update(0, this.engine.cameraDistance, this.world.worldRadius);
        this.engine.updateCamera(this.player.mesh.position, this.player.size, delta, this.terrain);
    }

    public dispose() {
        this.disposed = true;
        this.touchControls?.reset();
        this.engine.exitPointerLock();
    }

    private animate = (timestamp?: number) => {
        if (this.disposed) return;
        requestAnimationFrame(this.animate);
        this.timer.update(timestamp);
        const delta = Math.min(this.timer.getDelta(), 0.1);
        if (!this.isPaused) this.step(delta);
        else if (!this.started) this.idle(delta);
        this.engine.render(delta);
    };
}
