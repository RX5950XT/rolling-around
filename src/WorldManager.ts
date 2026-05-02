import * as THREE from 'three';
import { Player } from './Player';
import { ObjectFactory } from './ObjectFactory';

export class WorldManager {
    private scene: THREE.Scene;
    private player: Player;

    private chunkSize: number = 200;
    private activeChunks: Map<string, THREE.Group> = new Map();

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

        const targetRenderDist = this.getRenderDistance();
        const neededChunks = new Set<string>();

        for (let x = -targetRenderDist; x <= targetRenderDist; x++) {
            for (let z = -targetRenderDist; z <= targetRenderDist; z++) {
                const cx = currentChunkX + x;
                const cz = currentChunkZ + z;
                const key = `${cx},${cz}`;
                neededChunks.add(key);

                if (!this.activeChunks.has(key)) {
                    const dist = Math.max(Math.abs(x), Math.abs(z));
                    const isNear = dist <= 1;
                    this.generateChunk(cx, cz, key, isNear);
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

    private getRenderDistance(): number {
        const s = this.player.size;
        if (s < 30) return 2;
        if (s < 80) return 3;
        if (s < 150) return 4;
        return 5;
    }

    private getSpawnCount(baseCount: number, category: 'tiny' | 'small' | 'medium' | 'large'): number {
        const s = this.player.size;
        let multiplier = 1.0;
        switch (category) {
            case 'tiny':
                if (s < 2) multiplier = 4.0;
                else if (s < 5) multiplier = 2.5;
                else if (s < 10) multiplier = 1.5;
                else if (s < 30) multiplier = 0.8;
                else if (s < 80) multiplier = 0.4;
                else multiplier = 0.15;
                break;
            case 'small':
                if (s < 2) multiplier = 2.5;
                else if (s < 5) multiplier = 2.0;
                else if (s < 10) multiplier = 1.5;
                else if (s < 30) multiplier = 1.0;
                else if (s < 80) multiplier = 0.6;
                else multiplier = 0.3;
                break;
            case 'medium':
                if (s < 2) multiplier = 0.0;
                else if (s < 5) multiplier = 0.3;
                else if (s < 10) multiplier = 0.8;
                else if (s < 30) multiplier = 1.5;
                else if (s < 80) multiplier = 2.5;
                else multiplier = 3.0;
                break;
            case 'large':
                if (s < 5) multiplier = 0.0;
                else if (s < 10) multiplier = 0.2;
                else if (s < 30) multiplier = 0.6;
                else if (s < 80) multiplier = 1.5;
                else multiplier = 3.0;
                break;
        }
        return Math.floor(baseCount * multiplier);
    }

    private generateChunk(cx: number, cz: number, key: string, withObjects: boolean = true) {
        const chunkGroup = new THREE.Group();

        // Terrain LOD: lower resolution for distant chunks
        const seg = withObjects ? 32 : 16;
        const planeGeo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, seg, seg);
        const posAttr = planeGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const worldX = posAttr.getX(i) + cx * this.chunkSize;
            const worldZ = -posAttr.getY(i) + cz * this.chunkSize;
            posAttr.setZ(i, this.getTerrainHeight(worldX, worldZ));
        }
        planeGeo.computeVertexNormals();

        const plane = new THREE.Mesh(planeGeo, this.groundMaterial);
        plane.rotation.x = -Math.PI / 2;

        const chunkWorldX = cx * this.chunkSize;
        const chunkWorldZ = cz * this.chunkSize;
        plane.position.set(chunkWorldX, 0, chunkWorldZ);
        plane.receiveShadow = true;
        (plane as THREE.Object3D).userData.isGround = true;
        chunkGroup.add(plane);

        if (withObjects) {
            // Dynamic spawn counts based on player size
            this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'tiny', this.getSpawnCount(35, 'tiny'), 0.3, 1.5);
            this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'small', this.getSpawnCount(18, 'small'), 0.8, 3.0);
            this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'medium', this.getSpawnCount(7, 'medium'), 2.0, 10.0);
            this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'large', this.getSpawnCount(2, 'large'), 10.0, 25.0);
        } else {
            // Distant chunks: only large landmarks so the world doesn't look empty
            const distantLargeCount = this.player.size < 50 ? 0 : 1;
            this.populateCategory(chunkGroup, chunkWorldX, chunkWorldZ, 'large', distantLargeCount, 15.0, 30.0);
        }

        if (withObjects) {
            this.generateMazeWalls(chunkGroup, chunkWorldX, chunkWorldZ);
        }

        this.scene.add(chunkGroup);
        this.activeChunks.set(key, chunkGroup);
    }

    private generateMazeWalls(chunkGroup: THREE.Group, chunkWorldX: number, chunkWorldZ: number) {
        const wallMat = new THREE.MeshToonMaterial({ color: 0x8b7355 });
        const wallCount = Math.floor(Math.random() * 4) + 3;

        for (let i = 0; i < wallCount; i++) {
            const isHorizontal = Math.random() > 0.5;
            const length = Math.random() * 25 + 15;
            const height = Math.random() * 7 + 5;
            const width = Math.random() * 1.5 + 1.5;

            const geo = new THREE.BoxGeometry(
                isHorizontal ? length : width,
                height,
                isHorizontal ? width : length
            );
            const wall = new THREE.Mesh(geo, wallMat);

            const offsetX = (Math.random() - 0.5) * (this.chunkSize - length);
            const offsetZ = (Math.random() - 0.5) * (this.chunkSize - length);
            const worldX = chunkWorldX + offsetX;
            const worldZ = chunkWorldZ + offsetZ;
            const terrainHeight = this.getTerrainHeight(worldX, worldZ);

            wall.position.set(worldX, terrainHeight + height / 2, worldZ);
            wall.castShadow = true;
            wall.receiveShadow = true;

            const volume = length * height * width;
            const radius = Math.max(isHorizontal ? length : width, isHorizontal ? width : length) / 2 * 0.6;
            wall.userData.volume = volume;
            wall.userData.radius = radius;
            wall.userData.baseYOffset = height / 2;

            chunkGroup.add(wall);
            this.collidables.push(wall);
        }
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