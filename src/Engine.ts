import * as THREE from 'three';

export class Engine {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;

    private appContainer: HTMLElement;

    public cameraDistance: number = 12;
    public cameraHeight: number = 10;
    public cameraAngle: number = 0;
    public cameraPitch: number = 0.4; // default ~23° above horizon

    private targetSize: number = 1.0;
    private currentSize: number = 1.0;

    private targetCamDistance: number = 12;
    private currentCamDistance: number = 12;

    public dirLight: THREE.DirectionalLight;
    public ambientLight: THREE.AmbientLight;

    private raycaster: THREE.Raycaster;
    private raycastFrameCounter: number = 0;
    private lastRaycastSafeDist: number = 0;

    // Reusable temp vectors
    private _camPlayerToCam = new THREE.Vector3();
    private _camLookTarget = new THREE.Vector3();

    constructor() {
        this.appContainer = document.getElementById('app') as HTMLElement;

        // Clean up old canvases from HMR reloads
        while (this.appContainer.firstChild) {
            this.appContainer.removeChild(this.appContainer.firstChild);
        }

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.5, 2000);

        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = (THREE as any).PCFSoftShadowMap ?? 'pcf-soft';
        this.appContainer.appendChild(this.renderer.domElement);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.dirLight.position.set(100, 200, 100);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 1024;
        this.dirLight.shadow.mapSize.height = 1024;
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far = 800;
        const d = 150;
        this.dirLight.shadow.camera.left = -d;
        this.dirLight.shadow.camera.right = d;
        this.dirLight.shadow.camera.top = d;
        this.dirLight.shadow.camera.bottom = -d;
        this.dirLight.shadow.bias = -0.0005;
        this.scene.add(this.dirLight);

        // Pointer Lock mouse look
        document.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === this.renderer.domElement) {
                this.cameraAngle -= e.movementX * 0.002;
                this.cameraPitch += e.movementY * 0.003;
                // Clamp pitch: avoid flipping and ground clipping
                this.cameraPitch = Math.max(0.05, Math.min(this.cameraPitch, Math.PI / 2.2));
            }
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Click canvas to re-enter pointer lock when lost
        this.renderer.domElement.addEventListener('click', () => {
            if (document.pointerLockElement !== this.renderer.domElement) {
                this.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockerror', () => {
            console.warn('Pointer lock error - user gesture may be required');
        });

        this.raycaster = new THREE.Raycaster();
    }

    public requestPointerLock() {
        if (document.pointerLockElement !== this.renderer.domElement) {
            this.renderer.domElement.requestPointerLock().catch((err: unknown) => {
                console.warn('Pointer Lock request failed:', err);
            });
        }
    }

    public exitPointerLock() {
        if (document.pointerLockElement === this.renderer.domElement) {
            document.exitPointerLock();
        }
    }

    public onPointerLockChange(callback: (isLocked: boolean) => void) {
        document.addEventListener('pointerlockchange', () => {
            callback(document.pointerLockElement === this.renderer.domElement);
        });
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

        // Dynamic far plane: must outrun camera distance for big balls
        const farPlane = Math.max(4000, this.currentSize * 60);
        if (Math.abs(this.camera.far - farPlane) > 200) {
            this.camera.far = farPlane;
            this.camera.updateProjectionMatrix();
        }

        // Dynamic shadow range: only update when change is significant
        const shadowFar = Math.max(800, this.currentSize * 12);
        if (Math.abs(this.dirLight.shadow.camera.far - shadowFar) > 100) {
            this.dirLight.shadow.camera.far = shadowFar;
            this.dirLight.shadow.camera.updateProjectionMatrix();
        }

        const idealDistance = Math.max(this.cameraDistance * this.currentSize, this.currentSize * 2.5);
        this.targetCamDistance = idealDistance;
        this.currentCamDistance += (this.targetCamDistance - this.currentCamDistance) * Math.min(deltaTime * 4, 1);
        const dynamicDistance = this.currentCamDistance;

        const horizontalDist = dynamicDistance * Math.cos(this.cameraPitch);
        const verticalDist = dynamicDistance * Math.sin(this.cameraPitch);

        const offsetX = Math.sin(this.cameraAngle) * horizontalDist;
        const offsetZ = Math.cos(this.cameraAngle) * horizontalDist;

        let camX = playerPosition.x + offsetX;
        let camZ = playerPosition.z + offsetZ;
        let camY = playerPosition.y + verticalDist;

        // Camera anti-clipping: raycast from player to camera (every 3 frames to save CPU)
        this.raycastFrameCounter++;
        const playerToCam = this._camPlayerToCam;
        playerToCam.set(camX - playerPosition.x, camY - playerPosition.y, camZ - playerPosition.z);
        const distanceToCam = playerToCam.length();
        playerToCam.normalize();

        if (this.raycastFrameCounter % 3 === 0) {
            this.raycaster.set(playerPosition, playerToCam);
            this.raycaster.near = playerSize * 1.5;
            this.raycaster.far = distanceToCam;

            const intersects = this.raycaster.intersectObjects(this.scene.children, true);
            const hit = intersects.find(i => {
                const obj = i.object as THREE.Object3D;
                if (obj.userData.isGround) return false;
                let p: THREE.Object3D | null = obj;
                while (p) {
                    if (p.userData.isPlayer) return false;
                    p = p.parent;
                }
                return true;
            });
            if (hit) {
                this.lastRaycastSafeDist = Math.max(hit.distance - playerSize * 0.5, playerSize * 2);
            } else {
                this.lastRaycastSafeDist = 0;
            }
        }

        if (this.lastRaycastSafeDist > 0) {
            // Smoothly pull camera distance toward safe distance
            this.currentCamDistance += (this.lastRaycastSafeDist - this.currentCamDistance) * Math.min(deltaTime * 8, 1);
            const smoothDist = this.currentCamDistance;
            camX = playerPosition.x + playerToCam.x * smoothDist;
            camZ = playerPosition.z + playerToCam.z * smoothDist;
            camY = playerPosition.y + playerToCam.y * smoothDist;
        }

        // Anti-clipping with terrain
        const terrainHeightAtCam = getTerrainHeight(camX, camZ);
        const minHeightAllowed = terrainHeightAtCam + (this.currentSize * 0.3);
        if (camY < minHeightAllowed) {
            camY = minHeightAllowed;
        }

        this.camera.position.set(camX, camY, camZ);

        const lookTarget = this._camLookTarget;
        lookTarget.set(playerPosition.x, playerPosition.y + this.currentSize * 0.5, playerPosition.z);
        this.camera.lookAt(lookTarget);
    }
}