import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface } from './materials.ts';
import { BUILDINGS, buildingBoxes, buildingVolume, type BuildingType } from './worldLayout.ts';

const geometryCache = new Map<BuildingType, readonly THREE.BufferGeometry[]>();
const material = surface({ vertexColors: true });
const GLASS = 0x7194b5, CREAM = 0xfff4e0, STONE = 0x8d90a6, METAL = 0xc9ced8, LEAF = 0x6cc06a, PLANTER = 0x8a5a3c;

function painted(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
    const colors = new Float32Array(geometry.attributes.position.count * 3), c = new THREE.Color(color);
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
}

function part(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
    return painted(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
}

/** Two shared draws per building: facade and cutaway roof, including all decorative details. */
function geometryFor(type: BuildingType): readonly THREE.BufferGeometry[] {
    const cached = geometryCache.get(type);
    if (cached) return cached;
    const profile = BUILDINGS[type], walls: THREE.BufferGeometry[] = [], roofs: THREE.BufferGeometry[] = [];
    for (const b of buildingBoxes(type)) {
        const roof = b.y > profile.height;
        (roof ? roofs : walls).push(part(b.w, b.h, b.d, b.x, b.y, b.z, roof ? profile.roofColor : profile.color));
    }
    addFacade(type, walls);
    addTrim(type, walls);
    addRoofDetails(type, roofs);
    const geometry = [mergeGeometries(walls), mergeGeometries(roofs)];
    [...walls, ...roofs].forEach(p => p.dispose());
    geometryCache.set(type, geometry);
    return geometry;
}

function addFacade(type: BuildingType, parts: THREE.BufferGeometry[]) {
    const { height, door, opening, roofColor } = BUILDINGS[type];
    for (const z of [-8.08, 8.08]) {
        const side = (16 + door) / 4, width = (16 - door) / 2 - 0.7;
        for (const x of [-side, side]) {
            parts.push(part(width, 2.6, 0.12, x, 3.3, z, GLASS));
            if (type === 'barn') parts.push(part(0.25, height - 1, 0.2, x, height / 2, z, CREAM));
        }
        if (type === 'bakery' || type === 'cafe') addShopfront(type, z, parts);
        else parts.push(part(door + 0.5, 0.4, 1, 0, opening + 0.3, z, roofColor));
        for (let y = opening + 3; y < height - 1; y += 4) {
            if (type === 'skyscraper') parts.push(part(14, 1.8, 0.15, 0, y, z, GLASS));
            else for (const x of [-5, 0, 5]) {
                parts.push(part(2.6, 2.2, 0.15, x, y, z, GLASS));
                parts.push(part(3.2, 0.3, 1.2, x, y - 1.2, z, CREAM));
            }
        }
    }
    if (type === 'warehouse') for (const x of [-8.05, 8.05]) for (const z of [-6, -3, 0, 3, 6]) {
        parts.push(part(0.15, height - 0.5, 0.3, x, height / 2, z, CREAM));
    }
    if (type === 'skyscraper') for (const z of [-8.2, 8.2]) for (const x of [-7, 7]) {
        parts.push(part(0.35, height, 0.2, x, height / 2, z, CREAM));
    }
}

function addShopfront(type: 'bakery' | 'cafe', z: number, parts: THREE.BufferGeometry[]) {
    const { roofColor, opening } = BUILDINGS[type];
    for (let x = -7; x <= 7; x++) {
        parts.push(part(1, 0.35, 1.6, x, opening + 0.3, z, x % 2 ? CREAM : roofColor));
    }
    const signZ = z + Math.sign(z) * 0.25;
    if (type === 'bakery') {
        parts.push(painted(new THREE.TorusGeometry(0.9, 0.32, 6, 12).translate(6, 3.5, signZ), 0xc08457));
        parts.push(painted(new THREE.TorusGeometry(0.9, 0.18, 6, 12).translate(6, 3.5, signZ + Math.sign(z) * 0.2), 0xff8fab));
    } else {
        parts.push(painted(new THREE.CylinderGeometry(0.9, 0.65, 1.4, 8).translate(6, 3.5, signZ), CREAM));
        parts.push(painted(new THREE.TorusGeometry(0.5, 0.15, 6, 10).translate(7, 3.6, signZ), CREAM));
    }
}

/** Stone plinth, door frames, side windows and window boxes: purely visual, collision stays on `buildingBoxes`. */
function addTrim(type: BuildingType, parts: THREE.BufferGeometry[]) {
    const { height, door, opening } = BUILDINGS[type];
    const pillar = (16 - door) / 2, side = (16 + door) / 4;
    for (const x of [-8.05, 8.05]) parts.push(part(0.2, 0.6, 16.3, x, 0.3, 0, STONE));
    for (const z of [-8.05, 8.05]) {
        for (const x of [-side, side]) parts.push(part(pillar, 0.6, 0.2, x, 0.3, z, STONE));
        for (const x of [-1, 1]) parts.push(part(0.35, opening, 0.35, x * (door / 2 + 0.18), opening / 2, z, CREAM));
        if (type === 'house' || type === 'bakery' || type === 'cafe') for (const x of [-side, side]) {
            const out = z + Math.sign(z) * 0.3, width = pillar - 0.9;
            parts.push(part(width, 0.35, 0.5, x, 1.75, out, PLANTER));
            parts.push(part(width - 0.2, 0.3, 0.4, x, 2.05, out, LEAF));
        }
    }
    if (type === 'barn' || type === 'warehouse') return;
    for (const x of [-8.08, 8.08]) {
        for (let y = 3.3; y < height - 1.5; y += 4) {
            if (type === 'skyscraper') parts.push(part(0.15, 1.8, 14, x, y, 0, GLASS));
            else for (const z of [-4, 4]) {
                parts.push(part(0.15, 2.2, 2.6, x, y, z, GLASS));
                parts.push(part(1.2, 0.3, 3.2, x, y - 1.2, z, CREAM));
            }
        }
    }
}

/** Chimneys, parapets, rooftop machinery: drawn with the cutaway roof so they hide with it. */
function addRoofDetails(type: BuildingType, parts: THREE.BufferGeometry[]) {
    const { height, roofColor, stepped } = BUILDINGS[type];
    const top = height + 0.8;
    if (stepped) {
        parts.push(part(1.4, 2.6, 1.4, 5, height + 2.9, 4, roofColor), part(1.8, 0.3, 1.8, 5, height + 4.3, 4, STONE));
        if (type === 'barn') {
            parts.push(part(2.2, 1.8, 2.2, 0, height + 4.1, 0, CREAM), part(2.8, 0.4, 2.8, 0, height + 5.2, 0, roofColor));
            parts.push(part(0.1, 1.4, 1.2, 0, height + 6, 0, METAL), part(1.2, 0.1, 0.1, 0, height + 6.4, 0, METAL));
        }
        return;
    }
    for (const s of [-1, 1]) {
        parts.push(part(16.8, 0.6, 0.3, 0, top + 0.3, s * 8.25, roofColor));
        parts.push(part(0.3, 0.6, 16.8, s * 8.25, top + 0.3, 0, roofColor));
    }
    for (const x of [-4, 3]) {
        parts.push(part(1.8, 1, 1.4, x, top + 0.5, -4, METAL));
        parts.push(painted(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 10).translate(x, top + 1.05, -4), STONE));
    }
    if (type === 'apartments') {
        for (const [x, z] of [[3.3, 2.3], [4.7, 2.3], [3.3, 3.7], [4.7, 3.7]]) parts.push(part(0.2, 1.4, 0.2, x, top + 0.7, z, STONE));
        parts.push(painted(new THREE.CylinderGeometry(1.1, 1.1, 2, 12).translate(4, top + 2.4, 3), 0xb88a6a));
        parts.push(painted(new THREE.ConeGeometry(1.25, 0.8, 12).translate(4, top + 3.8, 3), roofColor));
    }
    if (type === 'warehouse') for (const x of [-5, 0, 5]) {
        parts.push(part(2.4, 0.5, 6, x, top + 0.25, 3, GLASS));
        parts.push(painted(new THREE.CylinderGeometry(0.4, 0.5, 1.2, 8).translate(x, top + 0.6, -6.5), METAL));
    }
    if (type === 'skyscraper') {
        parts.push(part(7, 2.4, 6, 0, top + 1.2, 1, STONE));
        parts.push(painted(new THREE.CylinderGeometry(0.12, 0.2, 7, 6).translate(0, top + 5.9, 1), METAL));
        parts.push(painted(new THREE.SphereGeometry(0.35, 8, 6).translate(0, top + 9.5, 1), 0xff5a5a));
    }
    if (type === 'cafe' || type === 'bakery') {
        parts.push(part(10, 1.4, 0.2, 0, top + 1.3, 7.6, CREAM), part(10.4, 0.2, 0.4, 0, top + 2.1, 7.6, roofColor));
    }
}

/** The catalogue reuses the same silhouettes for distant, solid miniature buildings. */
export function buildingParts(type: BuildingType): THREE.BufferGeometry[] {
    return geometryFor(type).map(g => g.clone());
}

export function createBuilding(type: BuildingType, scale: number): THREE.Group {
    const group = new THREE.Group(), boxes = buildingBoxes(type);
    geometryFor(type).forEach((geometry, i) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.roof = i === 1;
        group.add(mesh);
    });
    group.scale.setScalar(scale);
    const height = Math.max(...boxes.map(b => b.y + b.h / 2)) * scale;
    group.userData = { building: true, boxes, buildingScale: scale, kind: type,
        size: Math.max(17.8 * scale, height), radius: 12 * scale, height, volume: buildingVolume(type, scale) };
    group.traverse(child => { child.castShadow = true; child.receiveShadow = true; child.userData.height = height; });
    return group;
}

/** Cutaway roof when the ball enters; its physical support remains intact. */
export function updateBuildingRoof(building: THREE.Object3D, position: THREE.Vector3, radius: number) {
    const k = building.userData.buildingScale as number;
    const inside = Math.abs(position.x - building.position.x) < 9 * k + radius
        && Math.abs(position.z - building.position.z) < 9 * k + radius
        && position.y < building.position.y + building.userData.height - radius * 0.1;
    for (const child of building.children) if (child.userData.roof) child.visible = !inside;
}
