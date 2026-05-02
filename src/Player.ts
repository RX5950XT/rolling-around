import * as THREE from 'three';

export class Player {
    public mesh: THREE.Group;
    public ballMesh: THREE.Mesh;

    public size: number = 1.0;
    public volume: number;

    public velocity: THREE.Vector3 = new THREE.Vector3();
    public speed: number = 120;
    public maxSpeed: number = 60;
    public friction: number = 0.15;
    public weatherFrictionModifier: number = 1.0;

    public verticalVelocity: number = 0;
    public isGrounded: boolean = true;
    private jumpForce: number = 25;
    private gravity: number = -60;
    private onJump?: () => void;

    private baseGrowthRate: number = 0.05;
    private MAX_SIZE: number = 500.0;

    private keys: { [key: string]: boolean } = {};

    constructor(scene: THREE.Scene) {
        this.mesh = new THREE.Group();

        const geometry = new THREE.SphereGeometry(1, 32, 32);
        const material = new THREE.MeshToonMaterial({ color: 0xFF6B9D });

        this.ballMesh = new THREE.Mesh(geometry, material);
        this.ballMesh.castShadow = true;
        this.ballMesh.receiveShadow = true;

        this.mesh.add(this.ballMesh);
        this.mesh.position.y = 1.0;
        this.mesh.userData.isPlayer = true;
        this.mesh.traverse(child => { child.userData.isPlayer = true; });
        scene.add(this.mesh);

        this.volume = (4 / 3) * Math.PI * Math.pow(this.size, 3);
        this.initControls();
    }

    public setJumpCallback(cb: () => void) {
        this.onJump = cb;
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

    private attemptJump() {
        if (this.isGrounded) {
            this.verticalVelocity = this.jumpForce;
            this.isGrounded = false;
            if (this.onJump) this.onJump();
        }
    }

    public update(deltaTime: number, cameraAngle: number, getTerrainHeight: (x: number, z: number) => number) {
        if (isNaN(deltaTime) || !isFinite(deltaTime) || deltaTime > 0.1) deltaTime = 0.016;

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
            let scaleFactor: number;
            if (this.size > 100) {
                scaleFactor = Math.max(1, Math.pow(this.size, 0.08));
            } else {
                scaleFactor = Math.max(1, Math.pow(this.size, 0.15));
            }
            const acceleration = (this.speed / scaleFactor) * deltaTime;
            this.velocity.add(force.multiplyScalar(acceleration));
        }

        let currentMaxSpeed: number;
        if (this.size > 100) {
            currentMaxSpeed = this.maxSpeed * Math.pow(this.size, 0.75);
        } else {
            currentMaxSpeed = this.maxSpeed * Math.pow(this.size, 0.6);
        }
        if (this.velocity.length() > currentMaxSpeed) {
            this.velocity.normalize().multiplyScalar(currentMaxSpeed);
        }

        const effectiveFriction = Math.min(this.friction * this.weatherFrictionModifier, 0.99);
        this.velocity.multiplyScalar(Math.pow(effectiveFriction, deltaTime));

        if (this.velocity.lengthSq() < 0.25) {
            this.velocity.set(0, 0, 0);
        }

        this.mesh.position.add(this.velocity.clone().multiplyScalar(deltaTime));

        let px = this.mesh.position.x;
        let pz = this.mesh.position.z;
        if (isNaN(px)) px = 0;
        if (isNaN(pz)) pz = 0;

        const terrainHeight = getTerrainHeight(px, pz);
        const groundY = terrainHeight + this.size * 0.9;

        if (!this.isGrounded) {
            this.verticalVelocity += this.gravity * deltaTime;
            this.mesh.position.y += this.verticalVelocity * deltaTime;
            if (this.mesh.position.y <= groundY) {
                this.mesh.position.y = groundY;
                this.verticalVelocity = 0;
                this.isGrounded = true;
            }
        } else {
            this.mesh.position.y = groundY;
        }

        if (this.velocity.lengthSq() > 0.001) {
            const moveAxis = new THREE.Vector3(-this.velocity.z, 0, this.velocity.x).normalize();
            const distance = this.velocity.length() * deltaTime;
            let angle = -distance / this.size;
            if (isNaN(angle) || !isFinite(angle)) angle = 0;
            this.mesh.rotateOnWorldAxis(moveAxis, angle);
        }
    }

    public grow(addedVolume: number) {
        if (isNaN(addedVolume) || !isFinite(addedVolume)) return;
        this.volume += addedVolume;
        this.size = Math.pow(this.volume / ((4 / 3) * Math.PI), 1 / 3);
        if (this.size > this.MAX_SIZE) {
            this.size = this.MAX_SIZE;
            this.volume = (4 / 3) * Math.PI * Math.pow(this.size, 3);
        }
        this.ballMesh.scale.setScalar(this.size);
    }

    public attachObject(object: THREE.Mesh | THREE.Group) {
        const objVol = (object as THREE.Object3D).userData.volume || 1;
        const objSize = Math.pow(objVol, 1 / 3);

        // Performance optimization: when ball is huge, tiny objects are invisible.
        // Don't attach them - just destroy and add volume.
        if (this.size > 50 && objSize < this.size * 0.15) {
            this.grow(objVol);
            return;
        }

        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        object.getWorldPosition(worldPos);
        object.getWorldQuaternion(worldQuat);
        object.getWorldScale(worldScale);
        this.mesh.attach(object);
        object.traverse(child => { child.userData.isPlayer = true; });
        this.grow(objVol);
    }
}