import * as THREE from 'three';
import { Player } from './Player';
import { ObjectFactory } from './ObjectFactory';

export class WorldManager {
    private scene: THREE.Scene;
    private player: Player;

    // Chunk system
    private chunkSize: number = 100;
    private activeChunks: Map<string, THREE.Group> = new Map();
    private renderDistance: number = 2; // Number of chunks in each direction

    // Collision system
    // A list of interactable/absorbable objects
    public collidables: (THREE.Mesh | THREE.Group)[] = [];

    constructor(scene: THREE.Scene, player: Player) {
        this.scene = scene;
        this.player = player;
    }

    public update() {
        const playerPos = this.player.mesh.position;
        const currentChunkX = Math.floor(playerPos.x / this.chunkSize);
        const currentChunkZ = Math.floor(playerPos.z / this.chunkSize);

        const neededChunks = new Set<string>();

        // Determine which chunks should be active
        for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
            for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
                const cx = currentChunkX + x;
                const cz = currentChunkZ + z;
                const key = `${cx},${cz}`;
                neededChunks.add(key);

                if (!this.activeChunks.has(key)) {
                    this.generateChunk(cx, cz, key);
                }
            }
        }

        // Remove chunks that are out of bounds
        for (const [key, chunk] of this.activeChunks.entries()) {
            if (!neededChunks.has(key)) {
                this.destroyChunk(key, chunk);
            }
        }
    }

    private generateChunk(cx: number, cz: number, key: string) {
        const chunkGroup = new THREE.Group();

        // Base ground for chunk
        const planeGeo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize);
        const planeMat = new THREE.MeshToonMaterial({
            color: ((cx + cz) % 2 === 0) ? 0x2e8b57 : 0x228b22, // Checkerboard pattern for ground
            side: THREE.DoubleSide
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.rotation.x = -Math.PI / 2;

        const chunkWorldX = cx * this.chunkSize + this.chunkSize / 2;
        const chunkWorldZ = cz * this.chunkSize + this.chunkSize / 2;
        plane.position.set(chunkWorldX, 0, chunkWorldZ);
        plane.receiveShadow = true;
        chunkGroup.add(plane);

        // Procedural Objects
        const numObjects = Math.floor(Math.random() * 25) + 15; // 15 to 40 objects per chunk

        for (let i = 0; i < numObjects; i++) {
            const obj = ObjectFactory.createRandomObject();

            // Random position within chunk
            const offsetX = (Math.random() - 0.5) * this.chunkSize;
            const offsetZ = (Math.random() - 0.5) * this.chunkSize;

            // Random rotation
            obj.rotation.y = Math.random() * Math.PI * 2;

            // Scale object based on a random factor to get huge variety
            const scaleBase = Math.pow(Math.random(), 2); // favor smaller objects
            const scale = scaleBase * 14.9 + 0.1; // 0.1 to 15
            obj.scale.setScalar(scale);

            // Update Volume and radius based on scale
            if ((obj as any).userData.volume) {
                (obj as any).userData.volume *= Math.pow(scale, 3);
            }
            if ((obj as any).userData.radius) {
                (obj as any).userData.radius *= scale;
            }

            obj.position.set(chunkWorldX + offsetX, obj.position.y * scale, chunkWorldZ + offsetZ);

            chunkGroup.add(obj);
            this.collidables.push(obj);
        }

        this.scene.add(chunkGroup);
        this.activeChunks.set(key, chunkGroup);
    }

    private destroyChunk(key: string, chunk: THREE.Group) {
        const objectsToRemove = new Set<THREE.Object3D>();
        chunk.children.forEach(child => {
            if (child !== chunk.children[0]) { // skip plane
                objectsToRemove.add(child);
            }
        });

        this.collidables = this.collidables.filter(c => !objectsToRemove.has(c));

        this.scene.remove(chunk);
        this.activeChunks.delete(key);
    }
}
