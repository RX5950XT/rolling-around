import * as THREE from 'three';

export class Engine {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;

    private appContainer: HTMLElement;

    // Auto zoom & follow parameters
    public cameraDistance: number = 10;
    public cameraHeight: number = 8;
    public cameraAngle: number = 0;

    private targetSize: number = 1.0;
    private currentSize: number = 1.0;

    public dirLight: THREE.DirectionalLight;
    public ambientLight: THREE.AmbientLight;

    constructor() {
        this.appContainer = document.getElementById('app') as HTMLElement;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

        // Camera
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000); // increased far plane

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.appContainer.appendChild(this.renderer.domElement);

        // Lights
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.dirLight.position.set(50, 100, 50);
        this.dirLight.castShadow = true;
        this.dirLight.shadow.mapSize.width = 2048;
        this.dirLight.shadow.mapSize.height = 2048;
        this.dirLight.shadow.camera.near = 0.5;
        this.dirLight.shadow.camera.far = 500;
        const d = 150; // Increased shadow range
        this.dirLight.shadow.camera.left = -d;
        this.dirLight.shadow.camera.right = d;
        this.dirLight.shadow.camera.top = d;
        this.dirLight.shadow.camera.bottom = -d;
        this.scene.add(this.dirLight);

        // Mouse Drag Control (Camera Rotation)
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
                this.cameraAngle -= deltaX * 0.01;
                previousMouseX = e.clientX;
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Handle resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    public updateCamera(playerPosition: THREE.Vector3, playerSize: number, deltaTime: number) {
        this.targetSize = playerSize;
        this.currentSize += (this.targetSize - this.currentSize) * deltaTime * 2;

        const dynamicDistance = this.cameraDistance * this.currentSize;
        const dynamicHeight = this.cameraHeight * this.currentSize;

        const offsetX = Math.sin(this.cameraAngle) * dynamicDistance;
        const offsetZ = Math.cos(this.cameraAngle) * dynamicDistance;

        this.camera.position.set(
            playerPosition.x + offsetX,
            playerPosition.y + dynamicHeight,
            playerPosition.z + offsetZ
        );

        const lookTarget = playerPosition.clone().add(new THREE.Vector3(0, this.currentSize * 0.5, 0));
        this.camera.lookAt(lookTarget);
    }
}
