import * as THREE from 'three';

export class Engine {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;

    private appContainer: HTMLElement;

    public cameraDistance: number = 10;
    public cameraHeight: number = 8;
    public cameraAngle: number = 0;

    private targetSize: number = 1.0;
    private currentSize: number = 1.0;

    public dirLight: THREE.DirectionalLight;
    public ambientLight: THREE.AmbientLight;

    constructor() {
        this.appContainer = document.getElementById('app') as HTMLElement;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.005);

        const aspect = window.innerWidth / window.innerHeight;
        // Near plane adjusted for logarithmic buffer best practices
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.appContainer.appendChild(this.renderer.domElement);

        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.dirLight.position.set(100, 200, 100);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far = 1000;
        const d = 200;
        this.dirLight.shadow.camera.left = -d;
        this.dirLight.shadow.camera.right = d;
        this.dirLight.shadow.camera.top = d;
        this.dirLight.shadow.camera.bottom = -d;
        this.dirLight.shadow.bias = -0.0001;
        this.scene.add(this.dirLight);

        let isDragging = false;
        let previousMouseX = 0;

        document.addEventListener('mousedown', (e) => {
            if (e.target === this.renderer.domElement) {
                isDragging = true;
                previousMouseX = e.clientX;
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const deltaX = e.clientX - previousMouseX;
                // clamp extreme mouse inputs
                const clampedDelta = Math.max(Math.min(deltaX, 100), -100);
                this.cameraAngle -= clampedDelta * 0.01;
                previousMouseX = e.clientX;
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    public updateCamera(playerPosition: THREE.Vector3, playerSize: number, deltaTime: number, getTerrainHeight: (x: number, z: number) => number) {
        // Prevent size from being NaN or Infinite
        if (isNaN(playerSize) || !isFinite(playerSize)) playerSize = this.targetSize;

        this.targetSize = playerSize;
        this.currentSize += (this.targetSize - this.currentSize) * deltaTime * 2;

        const dynamicDistance = this.cameraDistance * this.currentSize;
        const dynamicHeight = this.cameraHeight * this.currentSize;

        const offsetX = Math.sin(this.cameraAngle) * dynamicDistance;
        const offsetZ = Math.cos(this.cameraAngle) * dynamicDistance;

        const camX = playerPosition.x + offsetX;
        const camZ = playerPosition.z + offsetZ;
        let camY = playerPosition.y + dynamicHeight;

        // --- CAMERA ANTI-CLIPPING ---
        const terrainHeightAtCam = getTerrainHeight(camX, camZ);
        const minHeightAllowed = terrainHeightAtCam + (this.currentSize * 0.5); // Always stay above ground

        if (camY < minHeightAllowed) {
            camY = minHeightAllowed;
        }

        this.camera.position.set(camX, camY, camZ);

        const lookTarget = playerPosition.clone().add(new THREE.Vector3(0, this.currentSize * 0.5, 0));
        this.camera.lookAt(lookTarget);
    }
}
