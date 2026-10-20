import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SCENERY_LAYER } from './WorldManager';

export class Engine {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    private composer: EffectComposer;
    /** Bloom, full resolution and 2048 shadows; dropped for good if the device can't hold ~40 fps. */
    private highQuality = true;
    /** Automated tests turn this off so slow software rendering keeps the full-quality look. */
    public autoQuality = true;
    private slowTime = 0;

    private appContainer: HTMLElement;

    public cameraDistance: number = 9;
    public cameraHeight: number = 10;
    public cameraAngle: number = 0;
    public cameraPitch: number = 0.4; // default ~23° above horizon
    /** Speed relative to top speed, set each frame; widens the FOV for a sense of speed. */
    public speedRatio: number = 0;

    private targetSize: number = 1.0;
    private currentSize: number = 1.0;

    private currentCamDistance: number = 9;
    /** Ball height the camera follows, eased so jumps, bounces and bobbing don't jerk the view. */
    private followY = NaN;
    private camLift = 0;
    private shakeAmount = 0;
    private shakeTime = 0;
    private camKeys = { left: false, right: false };

    public dirLight: THREE.DirectionalLight;
    public hemiLight: THREE.HemisphereLight;

    private raycaster: THREE.Raycaster;
    private raycastFrameCounter: number = 0;
    /** Pulled-in distance while something tall blocks the view; held briefly so the camera doesn't pump in and out. */
    private blockedDist = 0;
    private blockedHold = 0;

    // Reusable temp vectors
    private _camPlayerToCam = new THREE.Vector3();
    private _camLookTarget = new THREE.Vector3();
    private _pan = new THREE.Vector3();

    constructor() {
        this.appContainer = document.getElementById('app') as HTMLElement;

        // Clean up old canvases from HMR reloads
        while (this.appContainer.firstChild) {
            this.appContainer.removeChild(this.appContainer.firstChild);
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x9fd8ff);
        this.scene.fog = new THREE.FogExp2(0x9fd8ff, 0.008);

        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.3, 4000);
        this.camera.layers.enable(SCENERY_LAYER);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.appContainer.appendChild(this.renderer.domElement);

        // HDR scene → bloom on the brightest highlights (sun glints, power-ups) → tone mapping. MSAA lives on the target.
        this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.45, 0.92));
        this.composer.addPass(new OutputPass());

        // Sky-blue from above, grass-green bounce from below; the sky environment map adds the rest of the fill.
        this.hemiLight = new THREE.HemisphereLight(0xd6eeff, 0x9ccf86, 0.8);
        this.scene.add(this.hemiLight);

        this.dirLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.dirLight.shadow.bias = -0.0004;
        this.dirLight.shadow.radius = 3; // soft penumbra (PCF Vogel-disk taps)
        this.scene.add(this.dirLight);
        this.scene.add(this.dirLight.target); // target must be in the scene so it follows the player

        this.initInput();
        this.raycaster = new THREE.Raycaster();
        this.raycaster.layers.set(0);
    }

    private initInput() {
        // Pointer Lock mouse look
        document.addEventListener('mousemove', (e) => {
            if (!this.isPointerLocked()) return;
            // Chrome sometimes reports one huge bogus jump while the pointer is locked: drop it instead of snapping the view.
            if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
            this.cameraAngle -= e.movementX * 0.002;
            this.rotatePitch(e.movementY * 0.003);
        });

        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyQ') this.camKeys.left = true;
            if (e.code === 'KeyE') this.camKeys.right = true;
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyQ') this.camKeys.left = false;
            if (e.code === 'KeyE') this.camKeys.right = false;
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        });

        // Click canvas to re-enter pointer lock when lost (mouse only; touch has its own controls)
        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') this.requestPointerLock();
        });

        document.addEventListener('pointerlockerror', () => {
            console.warn('Pointer lock error - user gesture may be required');
        });
    }

    public render(deltaTime: number) {
        if (this.highQuality) this.composer.render(deltaTime);
        else this.renderer.render(this.scene, this.camera);
        this.watchFrameRate(deltaTime);
    }

    /** One-way switch to performance mode after ~3 s of frames slower than 40 fps (short hitches decay away). */
    private watchFrameRate(deltaTime: number) {
        if (!this.highQuality || !this.autoQuality) return;
        this.slowTime = deltaTime > 1 / 40 ? this.slowTime + deltaTime : Math.max(0, this.slowTime - deltaTime * 0.5);
        if (this.slowTime < 3) return;
        this.highQuality = false;
        this.renderer.setPixelRatio(1);
        // Shadows are the most expensive pass: halve the map (it is recreated at the new size on the next render).
        this.dirLight.shadow.mapSize.setScalar(1024);
        this.dirLight.shadow.map?.dispose();
        this.dirLight.shadow.map = null;
        console.info('Rolling Around: low frame rate, switched to performance mode (no bloom, 1x resolution, 1024 shadows)');
    }

    /** Clamp pitch: avoid flipping and ground clipping */
    public rotatePitch(delta: number) {
        this.cameraPitch = Math.max(0.05, Math.min(this.cameraPitch + delta, Math.PI / 2.2));
    }

    public isPointerLocked(): boolean {
        return document.pointerLockElement === this.renderer.domElement;
    }

    public requestPointerLock() {
        // Automated browsers (Playwright/headless) must never lock: on Windows that clips the user's real cursor to the hidden viewport.
        if (navigator.webdriver) return;
        if (this.isPointerLocked()) return;
        const el = this.renderer.domElement;
        const warn = (err: unknown) => console.warn('Pointer Lock request failed:', err);
        // Raw mouse input (no OS acceleration) also avoids the bogus-jump bug; not every browser supports it.
        el.requestPointerLock({ unadjustedMovement: true })?.catch(() => el.requestPointerLock()?.catch(warn));
    }

    public exitPointerLock() {
        if (this.isPointerLocked()) {
            document.exitPointerLock();
        }
    }

    public onPointerLockChange(callback: (isLocked: boolean) => void) {
        document.addEventListener('pointerlockchange', () => {
            callback(this.isPointerLocked());
        });
    }

    /** Stereo position of a world point for sound effects: -1 = screen left, 1 = screen right. */
    public panOf(point: THREE.Vector3): number {
        const v = this._pan.copy(point).applyMatrix4(this.camera.matrixWorldInverse);
        return Math.max(-1, Math.min(1, v.x / Math.max(1, Math.abs(v.z)))) * 0.8;
    }

    /** Camera kick for impacts; strength ~0.2 (bump) to 1 (huge hit). */
    public shake(strength: number) {
        this.shakeAmount = Math.max(this.shakeAmount, strength);
    }

    private updateLens(deltaTime: number) {
        // Dynamic far plane: must outrun camera distance for big balls
        const farPlane = Math.max(4000, this.currentSize * 60);
        const targetFov = 60 + Math.min(this.speedRatio, 1.8) * 8;
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, deltaTime * 3);
        this.camera.far = farPlane;
        this.camera.near = Math.max(0.3, this.currentSize * 0.1);
        this.camera.updateProjectionMatrix();
    }

    public updateCamera(
        playerPosition: THREE.Vector3,
        playerSize: number,
        deltaTime: number,
        getTerrainHeight: (x: number, z: number) => number
    ) {
        if (isNaN(playerSize) || !isFinite(playerSize)) playerSize = this.targetSize;

        this.targetSize = playerSize;
        this.currentSize += (this.targetSize - this.currentSize) * Math.min(deltaTime * 3, 1);
        this.cameraAngle += ((this.camKeys.left ? 1 : 0) - (this.camKeys.right ? 1 : 0)) * 2.2 * deltaTime;
        this.updateLens(deltaTime);

        const idealDistance = Math.max(this.cameraDistance * this.currentSize, this.currentSize * 2.5);
        if (Number.isNaN(this.followY)) this.followY = playerPosition.y;
        this.followY += (playerPosition.y - this.followY) * Math.min(deltaTime * 6, 1);

        const dir = this._camPlayerToCam.set(
            Math.sin(this.cameraAngle) * Math.cos(this.cameraPitch),
            Math.sin(this.cameraPitch),
            Math.cos(this.cameraAngle) * Math.cos(this.cameraPitch),
        );
        // Only tall obstacles pull the camera in (checked every 3 frames); it eases in, waits, then eases back out.
        if (++this.raycastFrameCounter % 3 === 0) {
            const blocked = this.findSafeDistance(playerPosition, dir, playerSize, idealDistance);
            if (blocked > 0) {
                this.blockedDist = blocked;
                this.blockedHold = 0.8;
            }
        }
        this.blockedHold -= deltaTime;
        const want = this.blockedHold > 0 ? Math.min(idealDistance, this.blockedDist) : idealDistance;
        const rate = want < this.currentCamDistance ? 2.5 : 1.5;
        this.currentCamDistance += (want - this.currentCamDistance) * Math.min(deltaTime * rate, 1);

        const d = this.currentCamDistance;
        let camX = playerPosition.x + dir.x * d;
        let camY = this.followY + dir.y * d;
        let camZ = playerPosition.z + dir.z * d;

        // Stay above the ground; eased (fast up, slow down) so a hill or a rebuilt world lifts the view instead of popping it.
        const need = Math.max(0, getTerrainHeight(camX, camZ) + this.currentSize * 0.3 - camY);
        this.camLift += (need - this.camLift) * Math.min(1, deltaTime * (need > this.camLift ? 10 : 3));
        camY += this.camLift;

        // Smooth rumble (layered sines) instead of per-frame random jumps, which read as the view glitching.
        this.shakeAmount *= Math.pow(0.002, deltaTime);
        this.shakeTime += deltaTime;
        if (this.shakeAmount > 0.002) {
            const a = this.shakeAmount * this.currentSize * 0.12;
            const t = this.shakeTime;
            camX += Math.sin(t * 31) * a;
            camY += Math.sin(t * 37 + 1.3) * a;
            camZ += Math.sin(t * 29 + 2.1) * a;
        }

        this.camera.position.set(camX, camY, camZ);

        const lookTarget = this._camLookTarget;
        lookTarget.set(playerPosition.x, this.followY + this.currentSize * 0.5, playerPosition.z);
        this.camera.lookAt(lookTarget);
    }

    /** Distance to the first obstacle between ball and camera (0 when the view is clear). */
    private findSafeDistance(origin: THREE.Vector3, dir: THREE.Vector3, playerSize: number, maxDist: number): number {
        this.raycaster.set(origin, dir);
        this.raycaster.near = playerSize * 1.5;
        this.raycaster.far = maxDist;

        const intersects = this.raycaster.intersectObjects(this.scene.children, true);
        const hit = intersects.find(i => {
            // Flowers, cars and anything else shorter than the ball never block the view enough to move the camera.
            if ((i.object.userData.height ?? 0) < playerSize * 1.5) return false;
            let p: THREE.Object3D | null = i.object;
            while (p) {
                if (p.userData.isPlayer) return false;
                p = p.parent;
            }
            return true;
        });
        return hit ? Math.max(hit.distance - playerSize * 0.5, playerSize * 2) : 0;
    }
}
