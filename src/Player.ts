import * as THREE from 'three';

export class Player {
    public mesh: THREE.Group;
    public ballMesh: THREE.Mesh;

    public size: number = 1.0;
    public volume: number;

    public velocity: THREE.Vector3 = new THREE.Vector3();
    public speed: number = 15; // base speed
    public maxSpeed: number = 20;
    public friction: number = 0.95; // default friction

    // Inputs
    private keys: { [key: string]: boolean } = {};

    constructor(scene: THREE.Scene) {
        this.mesh = new THREE.Group();

        // Katamari Ball
        const geometry = new THREE.SphereGeometry(1, 32, 32);
        // Create a toon-like material
        const material = new THREE.MeshToonMaterial({
            color: 0x44aa44,
            wireframe: false
        });

        this.ballMesh = new THREE.Mesh(geometry, material);
        this.ballMesh.castShadow = true;
        this.ballMesh.receiveShadow = true;

        this.mesh.add(this.ballMesh);
        this.mesh.position.y = this.size;

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

    public update(deltaTime: number, cameraAngle: number) {
        // Handle input to apply force relative to camera angle
        const force = new THREE.Vector3(0, 0, 0);

        if (this.keys['KeyW'] || this.keys['ArrowUp']) force.z -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) force.z += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) force.x -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) force.x += 1;

        if (force.lengthSq() > 0) {
            force.normalize();

            // Rotate force vector to match camera angle
            force.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngle);

            // Apply speed based on current size (bigger = feels heavier/faster momentum)
            // Adjust acceleration formula for feel
            const acceleration = (this.speed / Math.sqrt(this.size)) * deltaTime;
            this.velocity.add(force.multiplyScalar(acceleration));
        }

        // Clamp speed
        const currentMaxSpeed = this.maxSpeed * Math.sqrt(this.size);
        if (this.velocity.length() > currentMaxSpeed) {
            this.velocity.normalize().multiplyScalar(currentMaxSpeed);
        }

        // Apply friction
        this.velocity.multiplyScalar(this.friction);

        // Update position
        this.mesh.position.add(this.velocity);

        // Keep ball on ground
        this.mesh.position.y = this.size;

        // Rotate ball based on movement
        if (this.velocity.lengthSq() > 0.001) {
            // Movement axis in XZ plane
            const moveAxis = new THREE.Vector3(-this.velocity.z, 0, this.velocity.x).normalize();
            // Rotation amount based on distance traveled and radius
            const distance = this.velocity.length();
            const angle = distance / this.size;

            // Apply rotation to the ball mesh (not the group, so objects attached to group rotate with it)
            this.mesh.rotateOnWorldAxis(moveAxis, angle);
        }
    }

    public grow(addedVolume: number) {
        this.volume += addedVolume;
        // recalculate radius (size) from volume: r = cubeRoot(V / (4/3*PI))
        this.size = Math.pow(this.volume / ((4/3) * Math.PI), 1/3);

        // Note: the entire mesh group doesn't scale.
        // We will move the mesh up and scale only the core ball if needed,
        // but attached objects will naturally expand the bounds.
        // For visual representation, we can just update the sphere radius or scale it
        this.ballMesh.scale.setScalar(this.size);
    }

    public attachObject(object: THREE.Mesh | THREE.Group) {
        // Convert object's world position/rotation to local relative to the player mesh
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();

        object.getWorldPosition(worldPos);
        object.getWorldQuaternion(worldQuat);
        object.getWorldScale(worldScale);

        this.mesh.attach(object);

        // update volume
        // Simple bounding box approximation for volume
        const box = new THREE.Box3().setFromObject(object);
        const size = new THREE.Vector3();
        box.getSize(size);
        const objVol = size.x * size.y * size.z;
        this.grow(objVol);
    }
}
