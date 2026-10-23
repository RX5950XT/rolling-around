import * as THREE from 'three';
import {
    BALL_FRICTION, GRIP, SLOPE_HOLD, SPRINT_BOOST, accelerationFor, gravityFor, jumpVelocity, radiusFromVolume, sphereVolume,
    stepStamina, topSpeed, type Stamina,
} from './rules';

const UP = new THREE.Vector3(0, 1, 0);
/** Attached objects beyond this are buried deep inside the ball; drop the oldest to keep the scene light. */
const MAX_ATTACHED = 180;

export class Player {
    public mesh: THREE.Group;
    public ballMesh: THREE.Mesh;
    private ballMat: THREE.MeshPhysicalMaterial;

    public size: number = 1.0;
    public volume: number;
    private minVolume: number;

    public velocity: THREE.Vector3 = new THREE.Vector3();
    public friction: number = BALL_FRICTION;
    /** Multiplies friction retention: above 1 keeps more speed (slippery rain). */
    public weatherFrictionModifier: number = 1.0;
    /** Top-speed multiplier from power-ups. */
    public speedBoost: number = 1.0;
    /** Joystick input, x = right, y = backward (screen-down), length ≤ 1. */
    public touchMove = new THREE.Vector2();
    public enabled = false;

    public verticalVelocity: number = 0;
    public isGrounded: boolean = true;
    /** Mid-bounce after a landing: still counts as touching the ground for jumps. */
    private bouncing = false;
    /** Impact speed of the latest landing, collected by `takeLanding()`. */
    private landingImpact = 0;
    /** How deep the bottom of the ball sits below the water surface (0 = dry). */
    public waterDepth = 0;
    private waterDrag = 1;
    private floatTime = 0;
    private onJump?: () => void;
    private onSprint?: () => void;
    private onWinded?: () => void;
    /** Hold-to-sprint: Shift on keyboard, the 衝 button on touch. */
    public touchSprint = false;
    public sprinting = false;
    private stamina: Stamina = { level: 1, exhausted: false, rest: 0 };

    private keys: { [key: string]: boolean } = {};
    private attached: THREE.Object3D[] = [];

    // Reusable temp vectors to avoid per-frame GC
    private _force = new THREE.Vector3();
    private _moveAxis = new THREE.Vector3();

    constructor(scene: THREE.Scene) {
        this.mesh = new THREE.Group();

        // Glossy lacquered candy: clearcoat catches the sun and reflects the sky.
        this.ballMat = new THREE.MeshPhysicalMaterial({
            map: Player.makeBallTexture(), roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12,
        });
        this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), this.ballMat);
        this.ballMesh.castShadow = true;
        this.ballMesh.receiveShadow = true;

        this.mesh.add(this.ballMesh);
        this.mesh.position.y = 1.0;
        this.mesh.userData.isPlayer = true;
        this.mesh.traverse(child => { child.userData.isPlayer = true; });
        scene.add(this.mesh);

        this.volume = sphereVolume(this.size);
        this.minVolume = this.volume;
        this.initControls();
    }

    /** Candy-striped ball so the roll reads clearly even before anything sticks to it. */
    private static makeBallTexture(): THREE.CanvasTexture {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 256;
        const g = c.getContext('2d')!;
        g.fillStyle = '#ff7aa8';
        g.fillRect(0, 0, 512, 256);
        g.fillStyle = '#ffe08a';
        g.fillRect(0, 112, 512, 32);
        g.fillStyle = '#ffffff';
        g.fillRect(0, 104, 512, 6);
        g.fillRect(0, 146, 512, 6);
        for (const x of [0, 128, 256, 384]) g.fillRect(x + 60, 0, 10, 256);
        for (let i = 0; i < 16; i++) {
            g.beginPath();
            g.arc((i % 8) * 64 + (i < 8 ? 24 : 56), i < 8 ? 56 : 200, 11, 0, Math.PI * 2);
            g.fill();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        return tex;
    }

    public setJumpCallback(cb: () => void) {
        this.onJump = cb;
    }

    public setSprintCallbacks(onSprint: () => void, onWinded: () => void) {
        this.onSprint = onSprint;
        this.onWinded = onWinded;
    }

    private initControls() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space') {
                e.preventDefault();
                this.attemptJump();
            }
        });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
        window.addEventListener('blur', () => {
            for (const key in this.keys) {
                this.keys[key] = false;
            }
        });
    }

    public attemptJump() {
        if (this.enabled && (this.isGrounded || this.bouncing)) {
            this.verticalVelocity = jumpVelocity(this.size);
            this.isGrounded = false;
            this.bouncing = false;
            if (this.onJump) this.onJump();
        }
    }

    public get staminaState(): Readonly<Stamina> {
        return this.stamina;
    }

    public get currentTopSpeed(): number {
        return topSpeed(this.size) * this.speedBoost * (this.sprinting ? SPRINT_BOOST : 1);
    }

    /** Sprint only while holding the key and steering; returns true on the frame it starts. */
    private updateSprint(deltaTime: number, moving: boolean): boolean {
        const held = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touchSprint;
        const was = this.sprinting;
        const wasWinded = this.stamina.exhausted;
        const { next, sprinting } = stepStamina(this.stamina, this.enabled && moving && held, deltaTime);
        this.stamina = next;
        this.sprinting = sprinting;
        if (next.exhausted && !wasWinded) this.onWinded?.();
        if (!sprinting || was) return false;
        this.onSprint?.();
        return true;
    }

    public update(deltaTime: number, cameraAngle: number, getTerrainHeight: (x: number, z: number) => number, waterLevel: number) {
        if (isNaN(deltaTime) || !isFinite(deltaTime)) deltaTime = 0.016;
        if (deltaTime > 0.1) deltaTime = 0.1;

        this.applyInput(deltaTime, cameraAngle);
        if (this.isGrounded) this.applySlope(deltaTime, getTerrainHeight);
        this.mesh.position.x += this.velocity.x * deltaTime;
        this.mesh.position.z += this.velocity.z * deltaTime;
        if (isNaN(this.mesh.position.x)) this.mesh.position.x = 0;
        if (isNaN(this.mesh.position.z)) this.mesh.position.z = 0;

        this.applyGravity(deltaTime, getTerrainHeight, waterLevel);
        this.roll(deltaTime);
    }

    /** Impact speed of the last landing since the previous call (0 = none). */
    public takeLanding(): number {
        const v = this.landingImpact;
        this.landingImpact = 0;
        return v;
    }

    private applyInput(deltaTime: number, cameraAngle: number) {
        const force = this._force;
        force.set(this.touchMove.x, 0, this.touchMove.y);
        if (this.keys['KeyW'] || this.keys['ArrowUp']) force.z -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) force.z += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) force.x -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) force.x += 1;

        const moving = force.lengthSq() > 0.0001;
        const sprintStarted = this.updateSprint(deltaTime, moving);
        const retention = Math.min(this.friction * this.weatherFrictionModifier, 0.9);
        const top = this.currentTopSpeed * this.waterDrag;

        if (moving) {
            const strength = Math.min(force.length(), 1);
            force.normalize().applyAxisAngle(UP, cameraAngle);
            let accel = accelerationFor(top, retention) * strength;
            // Steering against the current motion brakes harder so turns stay responsive.
            const along = force.x * this.velocity.x + force.z * this.velocity.z;
            if (along < 0) accel *= 2.5;
            // Grip: bleed off sideways motion so turns bite instead of drifting (wet grass grips less).
            const keep = Math.exp((-GRIP * strength * deltaTime) / this.weatherFrictionModifier);
            this.velocity.x = force.x * along + (this.velocity.x - force.x * along) * keep;
            this.velocity.z = force.z * along + (this.velocity.z - force.z * along) * keep;
            this.velocity.x += force.x * accel * deltaTime;
            this.velocity.z += force.z * accel * deltaTime;
            // A small shove so the sprint answers the instant the key goes down.
            if (sprintStarted) {
                this.velocity.x += force.x * top * 0.3;
                this.velocity.z += force.z * top * 0.3;
            }
        }

        const cap = top * 2; // headroom for the sprint shove and downhill runs
        if (this.velocity.lengthSq() > cap * cap) this.velocity.setLength(cap);

        this.velocity.multiplyScalar(Math.pow(retention, deltaTime));
        if (this.velocity.lengthSq() < 0.0025 * this.size * this.size) {
            this.velocity.set(0, 0, 0);
        }
    }

    /** Gravity along the hillside: steep slopes roll the ball downhill, gentle ones hold it (rolling resistance). */
    private applySlope(deltaTime: number, getTerrainHeight: (x: number, z: number) => number) {
        if (this.waterDepth > 0) return;
        const { x, z } = this.mesh.position;
        const e = this.size * 0.5;
        const gx = (getTerrainHeight(x + e, z) - getTerrainHeight(x - e, z)) / (2 * e);
        const gz = (getTerrainHeight(x, z + e) - getTerrainHeight(x, z - e)) / (2 * e);
        const slope = Math.hypot(gx, gz);
        if (slope <= SLOPE_HOLD) return;
        const pull = (accelerationFor(topSpeed(this.size), this.friction) * (slope - SLOPE_HOLD)) / slope;
        this.velocity.x -= gx * pull * deltaTime;
        this.velocity.z -= gz * pull * deltaTime;
    }

    private applyGravity(deltaTime: number, getTerrainHeight: (x: number, z: number) => number, waterLevel: number) {
        const terrainY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z) + this.size * 0.9;
        // The ball is hollow: over deep water it floats a third under the surface, bobbing gently.
        this.floatTime += deltaTime;
        const floatY = waterLevel + this.size * (0.35 + Math.sin(this.floatTime * 2.2) * 0.04);
        const groundY = Math.max(terrainY, floatY);
        // Walking off a roof starts a fall instead of snapping straight down to the street.
        if (this.isGrounded && this.mesh.position.y > groundY + this.size * 0.5) this.isGrounded = false;
        if (!this.isGrounded) {
            this.verticalVelocity -= gravityFor(this.size) * deltaTime;
            this.mesh.position.y += this.verticalVelocity * deltaTime;
            if (this.mesh.position.y <= groundY) this.land(groundY, floatY > terrainY);
        } else {
            this.mesh.position.y = groundY;
        }
        this.waterDepth = Math.max(0, waterLevel - (this.mesh.position.y - this.size));
        this.waterDrag = 1 - 0.35 * Math.min(1, this.waterDepth / this.size);
    }

    /** Rubber-ball landing: one small bounce on grass; water swallows the bounce. */
    private land(groundY: number, onWater: boolean) {
        const impact = -this.verticalVelocity;
        this.mesh.position.y = groundY;
        this.landingImpact = Math.max(this.landingImpact, impact);
        const bounce = onWater ? 0 : impact * 0.35;
        this.bouncing = bounce > jumpVelocity(this.size) * 0.18;
        this.verticalVelocity = this.bouncing ? bounce : 0;
        this.isGrounded = !this.bouncing;
    }

    private roll(deltaTime: number) {
        if (this.velocity.lengthSq() < 0.001) return;
        const moveAxis = this._moveAxis;
        moveAxis.set(-this.velocity.z, 0, this.velocity.x).normalize();
        let angle = -(this.velocity.length() * deltaTime) / this.size;
        if (isNaN(angle) || !isFinite(angle)) angle = 0;
        this.mesh.rotateOnWorldAxis(moveAxis, angle);
    }

    public grow(addedVolume: number) {
        if (isNaN(addedVolume) || !isFinite(addedVolume)) return;
        this.volume = Math.max(this.minVolume, this.volume + addedVolume);
        this.size = radiusFromVolume(this.volume);
        this.ballMesh.scale.setScalar(this.size);
    }

    /** Glow tint for active power-ups (0 = none). */
    public setGlow(color: number, intensity: number) {
        this.ballMat.emissive.setHex(color);
        this.ballMat.emissiveIntensity = intensity;
    }

    public attachObject(object: THREE.Object3D, growthVolume: number) {
        const objSize = object.userData.size || 1;
        // Too small to see once stuck on the ball: just absorb it.
        if (objSize < this.size * 0.1) {
            object.removeFromParent();
            this.grow(growthVolume);
            return;
        }

        this.mesh.attach(object);
        // Pull it onto the surface; as the ball grows it gets buried like a real katamari.
        object.position.setLength(this.size * 0.85);
        object.traverse(child => { child.userData.isPlayer = true; });
        this.attached.push(object);
        if (this.attached.length > MAX_ATTACHED) this.attached.shift()!.removeFromParent();
        this.grow(growthVolume);
    }

    /** Knock the most recently stuck objects off. Returns their world positions for effects. */
    public knockOff(count: number): THREE.Vector3[] {
        const lost: THREE.Vector3[] = [];
        for (let i = 0; i < count && this.attached.length > 0; i++) {
            const obj = this.attached.pop()!;
            lost.push(obj.getWorldPosition(new THREE.Vector3()));
            this.grow(-(obj.userData.volume || 0));
            obj.removeFromParent();
        }
        return lost;
    }
}
