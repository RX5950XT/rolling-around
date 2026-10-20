import * as THREE from 'three';
import { SCENERY_LAYER } from './WorldManager';

const HIDDEN_Y = -1e6;
export const CONFETTI = [0xff8fab, 0xffe08a, 0x9be8c8, 0x8ecdf7, 0xb9a3f0, 0xffffff];
export const DUST = [0xe9dcb8, 0xd8caa0, 0xbcd9a0];
const WATER = [0xffffff, 0xeefaff, 0xd2f0fc, 0xb4e4f8];
const MAX_RINGS = 24;
const RING_LIFE = 1.1;

function makeDot(softness: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(softness, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/** Ring buffer of gravity-driven particles drawn as one `Points` (one draw call per pool). */
class ParticlePool {
    private points: THREE.Points;
    private material: THREE.PointsMaterial;
    private positions: Float32Array;
    private colors: Float32Array;
    private velocities: Float32Array;
    private life: Float32Array;
    private cursor = 0;
    private tmpColor = new THREE.Color();

    constructor(scene: THREE.Scene, private max: number, private sizeFactor: number, softness: number, opacity: number) {
        this.positions = new Float32Array(max * 3);
        this.colors = new Float32Array(max * 3);
        this.velocities = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        for (let i = 0; i < max; i++) this.positions[i * 3 + 1] = HIDDEN_Y;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
        this.material = new THREE.PointsMaterial({
            size: 0.3, map: makeDot(softness), vertexColors: true, transparent: true, opacity, depthWrite: false,
        });
        this.points = new THREE.Points(geo, this.material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 3; // after the transparent water, which would otherwise paint over the spray
        this.points.layers.set(SCENERY_LAYER);
        scene.add(this.points);
    }

    public emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.max;
        this.positions.set([x, y, z], i * 3);
        this.velocities.set([vx, vy, vz], i * 3);
        this.tmpColor.setHex(color);
        this.colors.set([this.tmpColor.r, this.tmpColor.g, this.tmpColor.b], i * 3);
        this.life[i] = life;
        this.points.geometry.attributes.color.needsUpdate = true;
    }

    /** `count` particles from one point, `speed` in m/s, biased upward. */
    public burst(x: number, y: number, z: number, count: number, speed: number, palette: readonly number[]) {
        for (let k = 0; k < count; k++) {
            const a = Math.random() * Math.PI * 2;
            const up = 0.35 + Math.random() * 0.65;
            const v = speed * (0.4 + Math.random() * 0.8);
            const flat = Math.sqrt(1 - up * up);
            this.emit(x, y, z, Math.cos(a) * flat * v, up * v, Math.sin(a) * flat * v, palette[k % palette.length], 0.5 + Math.random() * 0.7);
        }
    }

    public update(deltaTime: number, ballSize: number) {
        this.material.size = Math.max(0.12, ballSize * this.sizeFactor);
        const g = 25 * Math.max(1, ballSize) * deltaTime;
        for (let i = 0; i < this.max; i++) {
            if (this.life[i] <= 0) continue;
            const o = i * 3;
            this.life[i] -= deltaTime;
            this.velocities[o + 1] -= g;
            this.positions[o] += this.velocities[o] * deltaTime;
            this.positions[o + 1] += this.velocities[o + 1] * deltaTime;
            this.positions[o + 2] += this.velocities[o + 2] * deltaTime;
            if (this.life[i] <= 0) this.positions[o + 1] = HIDDEN_Y;
        }
        this.points.geometry.attributes.position.needsUpdate = true;
    }
}

/** Confetti sparks, soft spray (water / dust) and ripple rings, all pooled. */
export class Effects {
    private sparks: ParticlePool;
    private spray: ParticlePool;
    private activeFor = 0;
    private rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
    private ringAge = new Float32Array(MAX_RINGS);
    private ringSize = new Float32Array(MAX_RINGS);
    private ringAlpha = new Float32Array(MAX_RINGS);
    private ringCursor = 0;

    constructor(scene: THREE.Scene) {
        this.sparks = new ParticlePool(scene, 800, 0.16, 0.55, 1);
        this.spray = new ParticlePool(scene, 600, 0.42, 0.2, 0.8);

        const ringGeo = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
        for (let i = 0; i < MAX_RINGS; i++) {
            const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
            }));
            ring.visible = false;
            ring.renderOrder = 2; // after the transparent water
            ring.layers.set(SCENERY_LAYER);
            scene.add(ring);
            this.rings.push(ring);
        }
    }

    /** Confetti from a point; `speed` in m/s, biased upward. */
    public burst(x: number, y: number, z: number, count: number, speed: number, palette: readonly number[] = CONFETTI) {
        this.sparks.burst(x, y, z, count, speed, palette);
        this.activeFor = Math.max(this.activeFor, 1.5);
    }

    /** Soft puff (dust kicked up on landing). */
    public puff(x: number, y: number, z: number, count: number, speed: number, palette: readonly number[] = DUST) {
        this.spray.burst(x, y, z, count, speed, palette);
        this.activeFor = Math.max(this.activeFor, 1.5);
    }

    /** Ring spreading over the water; `delay` staggers rings of the same splash, `alpha` fades wakes. */
    public ripple(x: number, y: number, z: number, radius: number, delay = 0, alpha = 0.6) {
        const i = this.ringCursor;
        this.ringCursor = (this.ringCursor + 1) % MAX_RINGS;
        this.rings[i].position.set(x, y + radius * 0.01, z);
        this.rings[i].visible = true;
        this.ringAge[i] = -delay;
        this.ringSize[i] = radius;
        this.ringAlpha[i] = alpha;
        this.activeFor = Math.max(this.activeFor, RING_LIFE + delay);
    }

    /**
     * Crown of water thrown up and out from the ball's waterline (about 1.3 radii high at full strength).
     * `strength` ~0.1 (wake spray) to 1.5 (big drop); real splashes also send rings across the surface.
     */
    public splash(x: number, y: number, z: number, size: number, strength: number) {
        const n = Math.round(10 + 45 * strength);
        const v = size * (4 + 5 * strength);
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + Math.random() * 0.3;
            const r = size * (0.8 + Math.random() * 0.3);
            const out = v * (0.25 + Math.random() * 0.35);
            const up = v * (0.6 + Math.random() * 0.6);
            this.spray.emit(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * out, up, Math.sin(a) * out, WATER[k % WATER.length], 0.6 + Math.random() * 0.5);
        }
        // Big drops also throw a few fast droplets straight up through the middle.
        for (let k = 0; strength > 0.6 && k < 12; k++) {
            const a = Math.random() * Math.PI * 2;
            this.sparks.emit(x + Math.cos(a) * size * 0.5, y, z + Math.sin(a) * size * 0.5, 0, v * (1.1 + Math.random() * 0.5), 0, 0xffffff, 0.9);
        }
        this.activeFor = Math.max(this.activeFor, 1.5);
        if (strength < 0.3) return;
        this.ripple(x, y, z, size * 1.1);
        if (strength > 0.5) this.ripple(x, y, z, size * 0.8, 0.18);
    }

    private updateRings(deltaTime: number) {
        for (let i = 0; i < MAX_RINGS; i++) {
            const ring = this.rings[i];
            if (!ring.visible) continue;
            const t = (this.ringAge[i] += deltaTime) / RING_LIFE;
            if (t >= 1) {
                ring.visible = false;
                continue;
            }
            const grow = t <= 0 ? 0 : 1 - (1 - t) * (1 - t);
            ring.scale.setScalar(this.ringSize[i] * (1 + grow * 2.2));
            ring.material.opacity = t <= 0 ? 0 : this.ringAlpha[i] * (1 - t);
        }
    }

    public update(deltaTime: number, ballSize: number) {
        if (this.activeFor <= 0) return;
        this.activeFor -= deltaTime;
        this.updateRings(deltaTime);
        this.sparks.update(deltaTime, ballSize);
        this.spray.update(deltaTime, ballSize);
    }
}
