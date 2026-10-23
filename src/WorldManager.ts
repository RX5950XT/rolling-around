import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Player } from './Player';
import { ObjectFactory, KIND_BY_ID, type PowerupType } from './ObjectFactory';
import { groundDetailTexture, surface, waterNormalTexture } from './materials';
import { canEat, chunkObjectCap, populateRadius } from './rules';
import { districtAt, planBlock, type Placement, type SolidBox } from './worldLayout';
import { createBuilding, updateBuildingRoof } from './Buildings';

export const WATER_LEVEL = -4.6;
/** Layer for scenery the camera raycast must ignore (ground, water, particles, sky). */
export const SCENERY_LAYER = 1;

const POWERUP_ROLL: PowerupType[] = ['magnet', 'magnet', 'boost', 'boost', 'giant'];
const SAND = new THREE.Color(0xf3dfa2);
const GRASS_A = new THREE.Color(0xa3d96a);
const GRASS_B = new THREE.Color(0x76c25e);
const MEADOW = new THREE.Color(0xc4e57d);

/** Rolling hills in tier-0 units (meters at the first tier): ±8 high, waves of ~125 m and ~300 m. */
const baseHeight = (x: number, z: number) => Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3 + Math.sin(x * 0.02 + z * 0.01) * 5;

// Chunk offsets nearest-first, so the per-frame stocking budget goes to what the player sees.
const OFFSETS = (() => {
    const list: [number, number, number][] = [];
    for (let x = -5; x <= 5; x++) {
        for (let z = -5; z <= 5; z++) list.push([x, z, Math.max(Math.abs(x), Math.abs(z))]);
    }
    return list.sort((a, b) => a[2] - b[2] || (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));
})();

export class WorldManager {
    private scene: THREE.Scene;
    private player: Player;

    private chunkSize: number = 100;
    private worldTier = 0;
    private readonly seed = Math.floor(Math.random() * 0x100000000);
    /** Where the scaled terrain is sampled (x, z in tier-0 units) and how far it is lifted (y, meters). */
    private terrainShift = { x: 0, z: 0, y: 0 };
    private activeChunks: Map<string, THREE.Group> = new Map();
    /** Ball size when each chunk was last stocked; it gets restocked once the ball doubles. */
    private stockedAt: Map<string, number> = new Map();

    // Chunk groups sit at the origin, so each object's .position is already its world position.
    public collidables: THREE.Object3D[] = [];
    public movingEntities: THREE.Object3D[] = [];
    public powerups: THREE.Object3D[] = [];

    private groundMaterial = surface({ vertexColors: true, roughness: 0.95, map: groundDetailTexture() });
    private streetMaterial = surface({ vertexColors: true, roughness: 0.95 });
    private water: THREE.Mesh;
    private waterRipples = waterNormalTexture();
    /** Plain lawn far below the chunks so the world never ends in a void at the horizon. */
    private farGround: THREE.Mesh;
    private time = 0;
    private cullFrame = 0;

    constructor(scene: THREE.Scene, player: Player) {
        this.scene = scene;
        this.player = player;

        // One detail tile per ground segment (20 per chunk), so the grain scales with the world tier.
        this.groundMaterial.map!.repeat.set(20, 20);
        this.water = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
            surface({
                color: 0x4cb6e0, roughness: 0.06, transparent: true, opacity: 0.82,
                normalMap: this.waterRipples, normalScale: new THREE.Vector2(0.4, 0.4),
            })
        );
        this.water.position.y = WATER_LEVEL;
        this.water.receiveShadow = true;
        this.water.layers.set(SCENERY_LAYER);
        scene.add(this.water);

        this.farGround = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), surface({ color: 0x74c46c, roughness: 1 }));
        this.farGround.position.y = WATER_LEVEL - 0.6;
        this.farGround.layers.set(SCENERY_LAYER);
        scene.add(this.farGround);
    }

    /** Radius of the loaded terrain around the player. */
    public get worldRadius(): number {
        return this.getRenderDistance() * this.chunkSize;
    }

    public update(deltaTime: number) {
        this.time += deltaTime;
        this.updateChunks();
        this.updateMovers(deltaTime);
        this.updatePowerups(deltaTime);
        this.updateVisibility();

        const p = this.player.mesh.position;
        // Water spans exactly the loaded chunks (snapped to their grid); beyond them the far lawn takes over.
        this.water.position.x = Math.round(p.x / this.chunkSize) * this.chunkSize;
        this.water.position.z = Math.round(p.z / this.chunkSize) * this.chunkSize;
        const span = this.getRenderDistance() * 2 + 1;
        this.water.scale.setScalar(span * this.chunkSize - 0.5);
        // 16 ripple tiles per chunk: a whole number, so snapping the plane to the chunk grid never shifts the pattern.
        this.waterRipples.repeat.setScalar(span * 16);
        this.waterRipples.offset.set(this.time * 0.035, this.time * 0.022);
        this.farGround.position.x = p.x;
        this.farGround.position.z = p.z;
        this.farGround.scale.setScalar(Math.max(20000, this.player.size * 400));
    }

    /**
     * Chunks grow 4x at 5 m / 30 m / 150 m, then every time the ball grows 4x more (no upper limit): small chunks keep the start dense,
     * big ones keep the loaded world filling the view. The ball stays exactly where it was (same ground or
     * water height under it) and every object is carried over, so the rebuild never looks like a teleport.
     */
    private updateWorldTier() {
        const s = this.player.size;
        const tier = s >= 150 ? 3 + Math.floor(Math.log(s / 150) / Math.log(4)) : s >= 30 ? 2 : s >= 5 ? 1 : 0;
        if (tier <= this.worldTier) return;
        const p = this.player.mesh.position;
        const ground = this.getTerrainHeight(p.x, p.z);
        const floating = this.player.waterDepth > 0;
        const anchor = floating ? this.waterLevel : ground;
        const rel = (ground - this.waterLevel) / this.terrainScale;
        const kept = this.detachAllObjects();
        for (const [key, chunk] of this.activeChunks.entries()) this.destroyChunk(key, chunk);

        this.worldTier = tier;
        this.chunkSize = 100 * Math.pow(4, tier);
        this.alignTerrain(p.x, p.z, rel, anchor, floating);
        this.water.position.y = this.waterLevel;
        this.farGround.position.y = this.waterLevel - 0.6 * this.terrainScale;
        this.reattach(kept);
    }

    /**
     * Sample the bigger terrain where the ball's spot has the same shape (as far above or below the water,
     * in proportion), then lift it so the ground under the ball — or the water it floats on — keeps its height.
     */
    private alignTerrain(px: number, pz: number, rel: number, anchor: number, floating: boolean) {
        const k = this.terrainScale;
        let best = Infinity;
        for (let i = 0; i < 300; i++) {
            const x = Math.random() * 4000;
            const z = Math.random() * 4000;
            const miss = Math.abs(baseHeight(px / k + x, pz / k + z) - WATER_LEVEL - rel);
            if (miss < best) {
                best = miss;
                this.terrainShift.x = x;
                this.terrainShift.z = z;
            }
        }
        const t = this.terrainShift;
        t.y = 0; // measure the unlifted terrain first
        t.y = floating ? anchor - this.waterLevel : anchor - this.getTerrainHeight(px, pz);
    }

    /** Take every object out of its chunk and out of the tracking lists, ready to be carried into new chunks. */
    private detachAllObjects(): THREE.Object3D[] {
        const all: THREE.Object3D[] = [];
        for (const chunk of this.activeChunks.values()) {
            for (const child of chunk.children) if (!child.userData.isGround) all.push(child);
        }
        all.forEach(o => o.removeFromParent());
        this.collidables = [];
        this.movingEntities = [];
        this.powerups = [];
        return all;
    }

    /** Set carried-over objects on the new ground; ones that would now stand in water are dropped. */
    private reattach(objs: readonly THREE.Object3D[]) {
        const S = this.chunkSize;
        const shore = this.waterLevel + 0.3 * this.terrainScale;
        for (const o of objs) {
            const ground = this.getTerrainHeight(o.position.x, o.position.z);
            if (ground < shore || o.userData.size < this.player.size * 0.08) continue;
            o.position.y = ground + (o.userData.altitude || 0);
            const cx = Math.round(o.position.x / S);
            const cz = Math.round(o.position.z / S);
            const key = `${cx},${cz}`;
            (this.activeChunks.get(key) ?? this.generateChunk(cx, cz, key)).add(o);
            this.collidables.push(o);
            if (o.userData.motion) this.movingEntities.push(o);
            if (o.userData.powerup) this.powerups.push(o);
        }
    }

    /** Hills scale with the chunk so the 20×20 ground mesh samples them equally well at every tier (no aliasing). */
    private get terrainScale(): number {
        return this.chunkSize / 100;
    }

    public get waterLevel(): number {
        return WATER_LEVEL * this.terrainScale + this.terrainShift.y;
    }

    public getTerrainHeight(worldX: number, worldZ: number): number {
        const k = this.terrainScale;
        const t = this.terrainShift;
        const x = worldX / k, z = worldZ / k;
        const cx = Math.round(x / 100) * 100, cz = Math.round(z / 100) * 100;
        const edge = Math.max(Math.abs(x - cx), Math.abs(z - cz));
        const blend = Math.max(0, Math.min(1, (edge - 40) / 10));
        const raw = baseHeight(x + t.x, z + t.z);
        const pad = Math.max(WATER_LEVEL + 1, baseHeight(cx + t.x, cz + t.z));
        let h = pad + (raw - pad) * blend * blend * (3 - 2 * blend);
        // Connected roads stay above water, with grassy embankments instead of submerged crossings.
        const road = Math.min(Math.abs(x - cx), Math.abs(z - cz));
        h = Math.max(h, WATER_LEVEL + 1 - Math.max(0, road - 10) * 0.5);
        return h * k + t.y;
    }

    /** Roof support only when approaching from above; an indoor ball still rolls on the floor. */
    public getRollingHeight(x: number, z: number, bottom: number): number {
        let height = this.getTerrainHeight(x, z);
        for (const o of this.collidables) {
            if (!o.userData.building || canEat(o.userData.volume, this.player.volume)) continue;
            const k = o.userData.buildingScale;
            const c = Math.cos(o.rotation.y), s = Math.sin(o.rotation.y);
            const dx = (x - o.position.x) / k, dz = (z - o.position.z) / k;
            const lx = c * dx - s * dz, lz = s * dx + c * dz;
            for (const b of o.userData.boxes as SolidBox[]) {
                const top = o.position.y + (b.y + b.h / 2) * k;
                if (bottom >= top - this.player.size * 0.2 && Math.abs(lx - b.x) <= b.w / 2
                    && Math.abs(lz - b.z) <= b.d / 2) height = Math.max(height, top);
            }
        }
        return height;
    }

    /** Enough chunks to reach past the camera (which trails ~9 ball radii behind). */
    private getRenderDistance(): number {
        const min = this.worldTier === 0 ? 3 : 2;
        return Math.min(5, Math.max(min, Math.ceil((this.player.size * 12) / this.chunkSize) + 1));
    }

    private updateChunks() {
        this.updateWorldTier();
        const p = this.player.mesh.position;
        const size = this.player.size;
        // Chunks are centered on cx * chunkSize, so round (not floor) to find the one we stand on.
        const ccx = Math.round(p.x / this.chunkSize);
        const ccz = Math.round(p.z / this.chunkSize);
        const renderDist = this.getRenderDistance();
        const popDist = populateRadius(size, this.chunkSize);
        const needed = new Set<string>();
        let stockBudget = 3;

        for (const [ox, oz, dist] of OFFSETS) {
            if (dist > renderDist) break;
            const cx = ccx + ox;
            const cz = ccz + oz;
            const key = `${cx},${cz}`;
            needed.add(key);
            const chunk = this.activeChunks.get(key) ?? this.generateChunk(cx, cz, key);

            const last = this.stockedAt.get(key);
            if (dist <= popDist && stockBudget > 0 && (last === undefined || size > last * 2)) {
                this.stockChunk(chunk, cx, cz);
                this.stockedAt.set(key, size);
                stockBudget--;
            } else if (dist > popDist + 1 && last !== undefined) {
                // Left behind: drop its objects (restocked if we come back). The +1 avoids churn at borders.
                this.removeObjects(chunk, () => true);
                this.stockedAt.delete(key);
            }
        }

        for (const [key, chunk] of this.activeChunks.entries()) {
            if (!needed.has(key)) this.destroyChunk(key, chunk);
        }
    }

    /** Coordinates and height are in tier-0 units (divided by terrainScale). */
    private groundColor(x: number, z: number, h: number, out: THREE.Color) {
        if (h < WATER_LEVEL + 0.9) {
            out.copy(SAND);
            return;
        }
        const patch = Math.sin(x * 0.013 + Math.cos(z * 0.011) * 2) * 0.5 + 0.5;
        out.lerpColors(GRASS_A, GRASS_B, patch);
        if (h > 5) out.lerp(MEADOW, Math.min(1, (h - 5) / 3));
    }

    private generateChunk(cx: number, cz: number, key: string): THREE.Group {
        const chunkGroup = new THREE.Group();
        const S = this.chunkSize;
        const k = this.terrainScale;
        const planeGeo = new THREE.PlaneGeometry(S, S, 20, 20);
        const posAttr = planeGeo.attributes.position;
        const colors = new Float32Array(posAttr.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < posAttr.count; i++) {
            const worldX = posAttr.getX(i) + cx * S;
            const worldZ = -posAttr.getY(i) + cz * S;
            const h = this.getTerrainHeight(worldX, worldZ);
            posAttr.setZ(i, h);
            this.groundColor(worldX / k + this.terrainShift.x, worldZ / k + this.terrainShift.z, (h - this.terrainShift.y) / k, c);
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        planeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        planeGeo.computeVertexNormals();

        const plane = new THREE.Mesh(planeGeo, this.groundMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(cx * S, 0, cz * S);
        plane.receiveShadow = true;
        plane.userData.isGround = true;
        plane.layers.set(SCENERY_LAYER);
        chunkGroup.add(plane);
        this.addStreets(chunkGroup, cx, cz);

        this.scene.add(chunkGroup);
        this.activeChunks.set(key, chunkGroup);
        return chunkGroup;
    }

    private addStreets(chunk: THREE.Group, cx: number, cz: number) {
        const k = this.terrainScale, S = this.chunkSize;
        const parts: THREE.BufferGeometry[] = [];
        const strip = (x: number, z: number, w: number, d: number, color: number, lift: number) => {
            const geo = new THREE.PlaneGeometry(w * k, d * k, Math.max(1, Math.ceil(w / 5)), Math.max(1, Math.ceil(d / 5)));
            geo.rotateX(-Math.PI / 2).translate(cx * S + x * k, 0, cz * S + z * k);
            const pos = geo.attributes.position;
            const colors = new Float32Array(pos.count * 3), c = new THREE.Color(color);
            for (let i = 0; i < pos.count; i++) {
                pos.setY(i, this.getTerrainHeight(pos.getX(i), pos.getZ(i)) + lift * k);
                c.toArray(colors, i * 3);
            }
            geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            geo.computeVertexNormals();
            parts.push(geo);
        };
        strip(0, 0, 20, 100, 0xe6d9be, 0.025);
        strip(0, 0, 100, 20, 0xe6d9be, 0.026);
        strip(0, 0, 10, 100, 0x737d8b, 0.05);
        strip(0, 0, 100, 10, 0x737d8b, 0.051);
        for (const t of [-44, -32, -20, 20, 32, 44]) {
            strip(t, 0, 5, 0.25, 0xfff4e0, 0.08);
            strip(0, t, 0.25, 5, 0xfff4e0, 0.08);
        }
        for (const t of [-3, -1, 1, 3]) for (const side of [-8, 8]) {
            strip(t, side, 1, 3, 0xfff4e0, 0.08);
            strip(side, t, 3, 1, 0xfff4e0, 0.08);
        }
        const district = districtAt(this.seed, cx, cz, this.worldTier);
        if (this.worldTier < 3) for (const x of [-24, 24]) for (const z of [-24, 24]) {
            if (district === 'park') continue;
            strip(x, Math.sign(z) * 13, 6, 8, 0xe6d9be, 0.03);
            strip(x, z, 16, 16, district === 'farm' ? 0xa77c50 : 0xe8cfa5, 0.03);
            if (district === 'farm' && x > 0) for (const row of [-6, -3, 0, 3, 6]) strip(x, z + row, 16, 1, 0x628e45, 0.05);
        }
        const mesh = new THREE.Mesh(mergeGeometries(parts), this.streetMaterial);
        parts.forEach(p => p.dispose());
        mesh.userData.isGround = true;
        mesh.receiveShadow = true;
        mesh.layers.set(SCENERY_LAYER);
        chunk.add(mesh);
    }

    /** Stock named places, not size-matched objects scattered over empty grass. */
    private stockChunk(chunk: THREE.Group, cx: number, cz: number) {
        const size = this.player.size;
        this.removeObjects(chunk, o => o.userData.size < size * 0.08);
        const { objects } = planBlock(this.seed, cx, cz, this.worldTier);
        const existing = new Set(chunk.children.map(o => o.userData.slot));
        let budget = chunkObjectCap(size, this.chunkSize) - chunk.children.filter(o => !o.userData.isGround).length;
        for (const [index, placement] of objects.entries()) {
            const slot = `${this.worldTier}:${cx},${cz}:${index}`;
            if (budget <= 0) break;
            if (existing.has(slot) || placement.size * this.terrainScale < size * 0.08) continue;
            if (this.spawnPlacement(chunk, placement, cx, cz, slot)) budget--;
        }
        if (!chunk.children.some(o => o.userData.powerup)) {
            const type = POWERUP_ROLL[Math.abs(cx + cz) % POWERUP_ROLL.length];
            this.spawnPowerup(chunk, type, cx * this.chunkSize + 11 * this.terrainScale, cz * this.chunkSize);
        }
    }

    private spawnPlacement(chunk: THREE.Group, p: Placement, cx: number, cz: number, slot: string) {
        const k = this.terrainScale;
        const x = cx * this.chunkSize + p.x * k, z = cz * this.chunkSize + p.z * k;
        const ground = this.getTerrainHeight(x, z);
        if (ground < this.waterLevel + 0.3 * k) return false;
        const kind = KIND_BY_ID.get(p.id)!;
        const obj = p.building ? createBuilding(p.building, k) : ObjectFactory.create(kind, p.size * k);
        const ud = obj.userData;
        const player = this.player.mesh.position;
        const s = this.player.size;
        const clear = s + ud.radius + s;
        if (!canEat(ud.volume, this.player.volume) && (x - player.x) ** 2 + (z - player.z) ** 2 < clear * clear) return false;
        // Carried-over buildings own their footprint even after the street grid grows.
        if (this.collidables.some(o => o.userData.building && o.userData.slot?.split(':')[0] !== String(this.worldTier)
            && Math.abs(x - o.position.x) < 9 * o.userData.buildingScale + ud.radius
            && Math.abs(z - o.position.z) < 9 * o.userData.buildingScale + ud.radius)) return false;
        ud.slot = slot;
        ud.altitude = 0;
        if (p.route) ud.route = { minX: cx * this.chunkSize + p.route.minX * k, maxX: cx * this.chunkSize + p.route.maxX * k,
            minZ: cz * this.chunkSize + p.route.minZ * k, maxZ: cz * this.chunkSize + p.route.maxZ * k };
        obj.rotation.y = p.rotation;
        obj.position.set(x, ground, z);
        obj.castShadow = true;
        obj.receiveShadow = true;
        chunk.add(obj);
        this.collidables.push(obj);
        if (ud.motion) this.movingEntities.push(obj);
        return true;
    }

    private spawnPowerup(chunk: THREE.Group, type: PowerupType, x: number, z: number) {
        const obj = ObjectFactory.createPowerup(type, Math.max(0.6, this.player.size * 0.7));
        obj.position.set(x, this.getTerrainHeight(x, z), z);
        obj.castShadow = true;
        chunk.add(obj);
        this.collidables.push(obj);
        this.powerups.push(obj);
    }

    private updateMovers(deltaTime: number) {
        const p = this.player.mesh.position;
        const fearRadius = this.player.size * 10 + 12;
        for (const e of this.movingEntities) {
            const ud = e.userData;
            const dx = e.position.x - p.x;
            const dz = e.position.z - p.z;
            // Critters you can eat panic and run; everything else wanders.
            const scared = ud.motion === 'walk' && canEat(ud.volume, this.player.volume) && dx * dx + dz * dz < fearRadius * fearRadius;
            if (scared) {
                ud.moveDir.set(dx, 0, dz).normalize();
            } else if (Math.random() < (ud.motion === 'drive' ? 0.15 : 0.5) * deltaTime) {
                ud.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
            }

            const speed = ud.moveSpeed * (scared ? 2.2 : 1);
            let x = e.position.x + ud.moveDir.x * speed * deltaTime;
            let z = e.position.z + ud.moveDir.z * speed * deltaTime;
            const route = ud.route;
            if (route) {
                if (route.minZ === route.maxZ) { ud.moveDir.set(ud.moveDir.x >= 0 ? 1 : -1, 0, 0); z = route.minZ; }
                if (x < route.minX || x > route.maxX) ud.moveDir.x *= -1;
                if (z < route.minZ || z > route.maxZ) ud.moveDir.z *= -1;
                x = Math.max(route.minX, Math.min(route.maxX, x));
                z = Math.max(route.minZ, Math.min(route.maxZ, z));
            }
            const hop = scared ? Math.abs(Math.sin(this.time * 14 + ud.size)) * ud.height * 0.25 : 0;
            const bob = ud.motion === 'fly' ? Math.sin(this.time * 2 + ud.size) * ud.height * 0.3 : 0;
            e.position.set(x, this.getTerrainHeight(x, z) + ud.altitude + hop + bob, z);

            if (ud.motion === 'fly') {
                e.rotation.y += deltaTime * 1.5;
            } else {
                const diff = Math.atan2(ud.moveDir.x, ud.moveDir.z) - e.rotation.y;
                e.rotation.y += Math.atan2(Math.sin(diff), Math.cos(diff)) * Math.min(1, deltaTime * 6);
            }
        }
    }

    /** Hide objects too small to matter at their distance; cuts draw calls without touching gameplay. */
    private updateVisibility() {
        for (const o of this.collidables) if (o.userData.building) updateBuildingRoof(o, this.player.mesh.position, this.player.size);
        if (++this.cullFrame % 8 !== 0) return;
        const p = this.player.mesh.position;
        const base = this.player.size * 40;
        for (const o of this.collidables) {
            const range = base + o.userData.size * 150;
            const dx = o.position.x - p.x;
            const dz = o.position.z - p.z;
            o.visible = dx * dx + dz * dz < range * range;
        }
    }

    private updatePowerups(deltaTime: number) {
        for (const pu of this.powerups) {
            const s = pu.userData.size;
            pu.rotation.y += deltaTime * 2.2;
            pu.position.y = this.getTerrainHeight(pu.position.x, pu.position.z) + s * 0.5
                + Math.sin(this.time * 3 + pu.position.x) * s * 0.25;
        }
    }

    /** Drop an object from every tracking list (after it was eaten or unloaded). */
    public forget(objs: ReadonlySet<THREE.Object3D>) {
        if (objs.size === 0) return;
        this.collidables = this.collidables.filter(c => !objs.has(c));
        this.movingEntities = this.movingEntities.filter(c => !objs.has(c));
        this.powerups = this.powerups.filter(c => !objs.has(c));
    }

    private removeObjects(chunk: THREE.Group, predicate: (o: THREE.Object3D) => boolean) {
        const doomed = new Set(chunk.children.filter(c => !c.userData.isGround && predicate(c)));
        doomed.forEach(o => chunk.remove(o));
        this.forget(doomed);
    }

    private destroyChunk(key: string, chunk: THREE.Group) {
        this.removeObjects(chunk, () => true);
        for (const child of chunk.children) {
            if (child.userData.isGround) (child as THREE.Mesh).geometry.dispose();
        }
        this.scene.remove(chunk);
        this.activeChunks.delete(key);
        this.stockedAt.delete(key);
    }
}
