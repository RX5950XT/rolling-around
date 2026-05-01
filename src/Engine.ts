import * as THREE from 'three';

export class Engine {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;

    private appContainer: HTMLElement;

    public cameraDistance: number = 12;
    public cameraHeight: number = 10;
    public cameraAngle: number = 0;

    private targetSize: number = 1.0;
    private currentSize: number = 1.0;

    public dirLight: THREE.DirectionalLight;
    public ambientLight: THREE.AmbientLight;

    private raycaster: THREE.Raycaster;

    constructor() {
        this.appContainer = document.getElementById('app') as HTMLElement;

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
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
            }
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        this.raycaster = new THREE.Raycaster();
    }

    public requestPointerLock() {
        this.renderer.domElement.requestPointerLock();
    }

    public exitPointerLock() {
        if (document.pointerLockElement === this.renderer.domElement) {
            document.exitPointerLock();
        }
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

        const dynamicDistance = Math.max(this.cameraDistance * this.currentSize, this.currentSize * 2.5);
        const dynamicHeight = this.cameraHeight * this.currentSize;

        const offsetX = Math.sin(this.cameraAngle) * dynamicDistance;
        const offsetZ = Math.cos(this.cameraAngle) * dynamicDistance;

        let camX = playerPosition.x + offsetX;
        let camZ = playerPosition.z + offsetZ;
        let camY = playerPosition.y + dynamicHeight;

        // Camera anti-clipping: raycast from player to camera
        const playerToCam = new THREE.Vector3(camX, camY, camZ).sub(playerPosition);
        const distanceToCam = playerToCam.length();
        playerToCam.normalize();

        this.raycaster.set(playerPosition, playerToCam);
        this.raycaster.near = playerSize * 1.5;
        this.raycaster.far = distanceToCam;

        const intersects = this.raycaster.intersectObjects(this.scene.children, true);
        if (intersects.length > 0) {
            const hit = intersects[0];
            const safeDist = Math.max(hit.distance - playerSize * 0.5, playerSize * 2);
            camX = playerPosition.x + playerToCam.x * safeDist;
            camZ = playerPosition.z + playerToCam.z * safeDist;
            camY = playerPosition.y + playerToCam.y * safeDist;
        }

        // Anti-clipping with terrain
        const terrainHeightAtCam = getTerrainHeight(camX, camZ);
        const minHeightAllowed = terrainHeightAtCam + (this.currentSize * 0.3);
        if (camY < minHeightAllowed) {
            camY = minHeightAllowed;
        }

        this.camera.position.set(camX, camY, camZ);

        const lookTarget = playerPosition.clone().add(new THREE.Vector3(0, this.currentSize * 0.5, 0));
        this.camera.lookAt(lookTarget);
    }
}