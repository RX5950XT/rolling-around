import * as THREE from 'three';
import { Player } from './Player';
import { ObjectFactory } from './ObjectFactory';

export class WorldManager {
    private scene: THREE.Scene;
    private player: Player;

    private chunkSize: number = 200;
    private activeChunks: Map<string, THREE.Group> = new Map();
    private renderDistance: number = 2;

    public collidables: (THREE.Mesh | THREE.Group)[] = [];
    public movingEntities: THREE.Object3D[] = [];

    private groundMaterial = new THREE.MeshToonMaterial({
        color: 0x55aa55,
        side: THREE.DoubleSide
    });

    constructor(scene: THREE.Scene, player: Player) {
        this.scene = scene;
        this.player = player;
    }

    public update(deltaTime: number) {
        const playerPos = this.player.mesh.position;
        const currentChunkX = Math.floor(playerPos.x / this.chunkSize);
        const currentChunkZ = Math.floor(playerPos.z / this.chunkSize);

        const neededChunks = new Set<string>();

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

        for (const [key, chunk] of this.activeChunks.entries()) {
            if (!neededChunks.has(key)) {
                this.destroyChunk(key, chunk);
            }
        }

        for (const entity of this.movingEntities) {
            const userData = (entity as THREE.Object3D).userData;
            if (userData.isMoving && userData.moveDir) {
                const newX = entity.position.x + userData.moveDir.x * userData.moveSpeed * deltaTime;
                const newZ = entity.position.z + userData.moveDir.z * userData.moveSpeed * deltaTime;
                const newY = this.getTerrainHeight(newX, newZ) + ((entity as THREE.Object3D).userData.baseYOffset || 0);
                entity.position.set(newX, newY, newZ);

                const targetRot = Math.atan2(userData.moveDir.x, userData.moveDir.z);
                entity.rotation.y += (targetRot - entity.rotation.y) * deltaTime * 5;

                if (Math.random() < 0.02) {
                    userData.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
                }
            }
        }
    }

    public getTerrainHeight(worldX: number, worldZ: number): number {
        return Math.sin(worldX * 0.05) * Math.cos(worldZ * 0.05) * 3 + Math.sin(worldX * 0.02 + worldZ * 0.01) * 5;
    }

    private generateChunk(cx: number, cz: number, key: string) {
        const chunkGroup = new THREE.Group();

        // Exact chunkSize to eliminate overlap between adjacent chunks
        const planeGeo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, 32, 32);
        const posAttr = planeGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i) + cx * this.chunkSize;
            const vy = posAttr.getY(i) + cz * this.chunkSize;
            posAttr.setZ(i, this.getTerrainHeight(vx, vy));
        }
        planeGeo.computeVertexNormals();

        const plane = new THREE.Mesh(planeGeo, this.groundMaterial);
        plane.rotation.x = -Math.PI / 2;

        const chunkWorldX = cx * this.chunkSize + this.chunkSize / 2;
        const chunkWorldZ = cz * this.chunkSize + this.chunkSize / 2;
        plane.position.set(chunkWorldX, 0, chunkWorldZ);
        plane.receiveShadow = true;
        (plane as THREE.Object3D).userData.isGround = true;
        chunkGroup.add(plane);

        // Reduced density for performance
        this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'tiny', 30, 0.3, 1.5);
        this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'small', 15, 0.8, 3.0);
        this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'medium', 6, 2.0, 10.0);
        this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'large', 2, 10.0, 25.0);

        this.scene.add(chunkGroup);
        this.activeChunks.set(key, chunkGroup);
    }

    private populateCategory(
        chunkGroup: THREE.Group,
        chunkWorldX: number,
        chunkWorldZ: number,
        category: 'tiny' | 'small' | 'medium' | 'large',
        count: number,
        minScale: number,
        maxScale: number
    ) {
        for (let i = 0; i < count; i++) {
            const generated = ObjectFactory.createRandomObject(category);
            const obj = generated.mesh;

            const offsetX = (Math.random() - 0.5) * this.chunkSize;
            const offsetZ = (Math.random() - 0.5) * this.chunkSize;

            obj.rotation.y = Math.random() * Math.PI * 2;

            const scaleBase = Math.pow(Math.random(), 3);
            const scale = scaleBase * (maxScale - minScale) + minScale;
            obj.scale.setScalar(scale);

            if ((obj as THREE.Object3D).userData.volume) {
                (obj as THREE.Object3D).userData.volume *= Math.pow(scale, 3);
            }
            if ((obj as THREE.Object3D).userData.radius) {
                (obj as THREE.Object3D).userData.radius *= scale;
            }

            const worldX = chunkWorldX + offsetX;
            const worldZ = chunkWorldZ + offsetZ;
            const terrainHeight = this.getTerrainHeight(worldX, worldZ);

            const baseYOffset = obj.position.y * scale;
            (obj as THREE.Object3D).userData.baseYOffset = baseYOffset;

            obj.position.set(worldX, terrainHeight + baseYOffset, worldZ);

            chunkGroup.add(obj);
            this.collidables.push(obj);

            if (generated.isMoving) {
                this.movingEntities.push(obj);
            }
        }
    }

    private destroyChunk(key: string, chunk: THREE.Group) {
        const objectsToRemove = new Set<THREE.Object3D>();
        chunk.children.forEach(child => {
            if (!(child as THREE.Object3D).userData.isGround) {
                objectsToRemove.add(child);
            }
        });

        this.collidables = this.collidables.filter(c => !objectsToRemove.has(c));
        this.movingEntities = this.movingEntities.filter(c => !objectsToRemove.has(c));

        this.scene.remove(chunk);
        this.activeChunks.delete(key);
    }
}