import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface } from './materials.ts';
import { BUILDINGS, buildingBoxes, buildingVolume, type BuildingType } from './worldLayout.ts';

const geometryCache = new Map<BuildingType, readonly THREE.BufferGeometry[]>();
const material = surface({ vertexColors: true });
const GLASS = 0x7194b5, CREAM = 0xfff4e0;

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
