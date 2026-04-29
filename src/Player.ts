import * as THREE from 'three';

export class Player {
    public mesh: THREE.Group;
    public ballMesh: THREE.Mesh;

    public size: number = 1.0;
    public volume: number;

    public velocity: THREE.Vector3 = new THREE.Vector3();
    public speed: number = 15;
    public maxSpeed: number = 20;
    public friction: number = 0.95;

    private baseGrowthRate: number = 0.05;

    // Safety Limits
    private MAX_SIZE: number = 500.0; // Prevent infinite NaN breakdown

    private keys: { [key: string]: boolean } = {};

    constructor(scene: THREE.Scene) {
        this.mesh = new THREE.Group();

        const geometry = new THREE.SphereGeometry(1, 64, 64);
        const material = new THREE.MeshToonMaterial({
            color: 0x44aa44,
            roughness: 0.4
        } as any);

        this.ballMesh = new THREE.Mesh(geometry, material);
        this.ballMesh.castShadow = true;
        this.ballMesh.receiveShadow = true;

        this.mesh.add(this.ballMesh);

        const initialY = 1.0;
        this.mesh.position.y = initialY;

        scene.add(this.mesh);

        this.volume = (4/3) * Math.PI * Math.pow(this.size, 3);

        this.initControls();
    }

    private initControls() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    public update(deltaTime: number, cameraAngle: number, getTerrainHeight: (x: number, z: number) => number) {
        if (isNaN(deltaTime) || !isFinite(deltaTime)) deltaTime = 0.016;

        if (this.size < this.MAX_SIZE) {
            const growthAmount = this.baseGrowthRate * this.size * deltaTime;
            this.grow(growthAmount);
        }

        const force = new THREE.Vector3(0, 0, 0);

        if (this.keys['KeyW'] || this.keys['ArrowUp']) force.z -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) force.z += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) force.x -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) force.x += 1;

        if (force.lengthSq() > 0) {
            force.normalize();
            force.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngle);
            const acceleration = (this.speed / Math.sqrt(this.size)) * deltaTime;
            this.velocity.add(force.multiplyScalar(acceleration));
        }

        const currentMaxSpeed = this.maxSpeed * Math.sqrt(this.size);
        if (this.velocity.length() > currentMaxSpeed) {
            this.velocity.normalize().multiplyScalar(currentMaxSpeed);
        }

        // Safety clamp on velocity to prevent physics teleportation
        this.velocity.clampScalar(-currentMaxSpeed * 2, currentMaxSpeed * 2);

        this.velocity.multiplyScalar(this.friction);
        this.mesh.position.add(this.velocity);

        // Follow rolling hills perfectly
        let px = this.mesh.position.x;
        let pz = this.mesh.position.z;
        if (isNaN(px)) px = 0;
        if (isNaN(pz)) pz = 0;

        const terrainHeight = getTerrainHeight(px, pz);
        this.mesh.position.y = terrainHeight + this.size;

        if (this.velocity.lengthSq() > 0.001) {
            const moveAxis = new THREE.Vector3(-this.velocity.z, 0, this.velocity.x).normalize();
            const distance = this.velocity.length();
            let angle = distance / this.size;

            // Safety check for rotation
            if (isNaN(angle) || !isFinite(angle)) angle = 0;

            this.mesh.rotateOnWorldAxis(moveAxis, angle);
        }
    }

    public grow(addedVolume: number) {
        if (isNaN(addedVolume) || !isFinite(addedVolume)) return;

        this.volume += addedVolume;
        this.size = Math.pow(this.volume / ((4/3) * Math.PI), 1/3);

        if (this.size > this.MAX_SIZE) {
            this.size = this.MAX_SIZE;
            this.volume = (4/3) * Math.PI * Math.pow(this.size, 3);
        }

        this.ballMesh.scale.setScalar(this.size);
    }

    public attachObject(object: THREE.Mesh | THREE.Group) {
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();

        object.getWorldPosition(worldPos);
        object.getWorldQuaternion(worldQuat);
        object.getWorldScale(worldScale);

        this.mesh.attach(object);

        const objVol = (object as any).userData.volume || 1;
        this.grow(objVol);
    }
}
