/** Seeded town planning; coordinates here are local to a 100 m block. */
export type District = 'market' | 'homes' | 'farm' | 'park' | 'depot' | 'city';
export interface Placement {
    id: string;
    x: number;
    z: number;
    size: number;
    rotation: number;
    building?: BuildingType;
    route?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export type BuildingType = 'house' | 'bakery' | 'cafe' | 'barn' | 'warehouse' | 'apartments' | 'skyscraper';
interface BuildingProfile {
    name: string; emoji: string; height: number; door: number; opening: number;
    color: number; roofColor: number; stepped?: boolean;
    contents: readonly (readonly [string, number])[];
}
export const BUILDINGS: Record<BuildingType, BuildingProfile> = {
    house: { name: '住宅', emoji: '🏠', height: 7, door: 8, opening: 6.2, color: 0xfff4e0, roofColor: 0xe85d75, stepped: true,
        contents: [['table', 2.4], ['chair', 1.2], ['gift', 0.8], ['chair', 1.2]] },
    bakery: { name: '麵包店', emoji: '🥯', height: 7, door: 8, opening: 6.2, color: 0xffe08a, roofColor: 0xff8fab,
        contents: [['donut', 0.6], ['donut', 0.8], ['crate', 1.1], ['table', 2.4]] },
    cafe: { name: '咖啡館', emoji: '☕', height: 7, door: 8, opening: 6.2, color: 0x9be8c8, roofColor: 0x4ecdc4,
        contents: [['table', 2.4], ['chair', 1.2], ['donut', 0.6], ['chair', 1.2]] },
    barn: { name: '穀倉', emoji: '🌾', height: 9, door: 10, opening: 8.2, color: 0xe88575, roofColor: 0x7a5236, stepped: true,
        contents: [['crate', 1.1], ['sheep', 1.6], ['crate', 1.1], ['cow', 2.4]] },
    warehouse: { name: '倉庫', emoji: '🏭', height: 11, door: 12, opening: 10.2, color: 0x8ecdf7, roofColor: 0x6e7191,
        contents: [['crate', 1.1], ['crate', 1.6], ['cone', 0.8], ['crate', 2.4]] },
    apartments: { name: '公寓', emoji: '🏘️', height: 16, door: 10, opening: 8.2, color: 0xffb38a, roofColor: 0xe85d75,
        contents: [['chair', 1.2], ['table', 2.4], ['mailbox', 1.4], ['gift', 0.8]] },
    skyscraper: { name: '辦公大樓', emoji: '🏢', height: 24, door: 12, opening: 10, color: 0xc4ecff, roofColor: 0x7194b5,
        contents: [['chair', 1.2], ['table', 2.4], ['person', 1.8], ['chair', 1.2]] },
};
const DISTRICT_BUILDINGS: Record<District, readonly BuildingType[]> = {
    market: ['bakery', 'cafe'], homes: ['house', 'apartments'], farm: ['barn'],
    park: [], depot: ['warehouse'], city: ['skyscraper', 'apartments', 'cafe', 'bakery'],
};

export function seededRandom(seed: number): () => number {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let n = Math.imul(state ^ (state >>> 15), 1 | state);
        n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
}

export function districtAt(seed: number, cx: number, cz: number, tier: number): District {
    // Start beside shops; elsewhere adjacent blocks share a neighbourhood, with local variation.
    if (cx === 0 && cz === 0) return tier < 1 ? 'market' : 'city';
    const random = seededRandom(seed ^ Math.imul(Math.floor(cx / 2), 73856093) ^ Math.imul(Math.floor(cz / 2), 19349663));
    const choices: District[] = tier === 0 ? ['market', 'homes', 'farm', 'park'] : ['city', 'homes', 'depot', 'park'];
    return choices[Math.floor(random() * choices.length)];
}

const CONTENTS: Record<District, readonly [string, number][]> = {
    market: [['donut', 0.6], ['gift', 0.8], ['crate', 1.1], ['table', 2.4], ['chair', 1.2]],
    homes: [['chair', 1.2], ['table', 2.4], ['gift', 0.8]],
    farm: [['cow', 2.4], ['sheep', 1.6], ['crate', 1.1]],
    park: [['flower', 0.5], ['bush', 1.6], ['tree', 6.5], ['bench', 2.4], ['duck', 0.8]],
    depot: [['crate', 1.1], ['cone', 0.8]],
    city: [['chair', 1.2], ['table', 2.4], ['person', 1.8]],
};

export function planBlock(seed: number, cx: number, cz: number, tier: number): { district: District; objects: Placement[] } {
    const district = districtAt(seed, cx, cz, tier);
    const random = seededRandom(seed ^ Math.imul(cx, 83492791) ^ Math.imul(cz, 2971215073) ^ tier);
    const objects: Placement[] = [];
    const add = (id: string, size: number, x: number, z: number, rotation = 0): Placement => {
        const p: Placement = { id, size, x, z, rotation };
        objects.push(p);
        return p;
    };
    if (tier >= 3) return { district, objects: planRegion(district, random) };
    const types = DISTRICT_BUILDINGS[district];
    let lot = Math.floor(random() * Math.max(1, types.length));
    for (const x of [-24, 24]) for (const z of [-24, 24]) {
        const built = district !== 'park' && !(district === 'farm' && x > 0);
        const type = types[lot++ % types.length];
        if (built) add(type, 16, x, z, z > 0 ? Math.PI : 0).building = type;
        const items = built ? BUILDINGS[type].contents : CONTENTS[district];
        for (let i = 0; i < (built ? 12 : 28); i++) {
            const [id, size] = items[built ? i % items.length : Math.floor(random() * items.length)];
            // Shelves run along the side walls; leave the doorway and central aisle open.
            const px = built ? x + (i % 2 ? 1 : -1) * 5 : x + (random() - 0.5) * 26;
            const pz = built ? z - 5 + Math.floor(i / 2) * 2 : z + (random() - 0.5) * 26;
            const p = add(id, size, px, pz, random() * Math.PI * 2);
            p.route = { minX: x - 6, maxX: x + 6, minZ: z - 6, maxZ: z + 6 };
        }
        add(district === 'homes' ? 'mailbox' : 'tree', district === 'homes' ? 1.4 : 6.5, x - 9, Math.sign(z) * 12);
        add('bench', 2.4, x + 4, Math.sign(z) * 11);
        for (let i = 0; i < 8; i++) add(district === 'market' ? 'crate' : 'flower', district === 'market' ? 1.1 : 0.5, x - 8 + i * 2, Math.sign(z) * 10);
    }
    for (const x of [-36, -12, 12, 36]) {
        const car = add(district === 'depot' ? 'bus' : 'car', district === 'depot' ? 8 : 4.2, x, 2.5, Math.PI / 2);
        car.route = { minX: -44, maxX: 44, minZ: 2.5, maxZ: 2.5 };
        const person = add('person', 1.8, x, -8);
        person.route = { minX: -44, maxX: 44, minZ: -8, maxZ: -8 };
    }
    return { district, objects };
}

/** Three reachable size steps; small buildings sit outside the landmark's footprint. */
function planRegion(district: District, random: () => number): Placement[] {
    const objects: Placement[] = [];
    const nature = district === 'park';
    const small = nature ? ['pine', 'tree'] : ['house', 'bakery', 'cafe', 'warehouse', 'apartments'];
    for (const x of [-24, 24]) for (const z of [-24, 24]) {
        objects.push({ id: nature ? 'mountain' : 'city', size: 8 + random() * 2, x, z, rotation: 0 });
        for (const [dx, dz] of [[-11, 0], [11, 0], [0, -11], [0, 11]]) {
            objects.push({ id: nature ? 'pine' : 'skyscraper', size: 4 + random() * 2,
                x: x + dx, z: z + dz, rotation: 0 });
        }
        for (const dx of [-13, -8, 8, 13]) for (const dz of [-11, 11]) {
            objects.push({ id: small[Math.floor(random() * small.length)], size: 1.8 + random() * 0.8,
                x: x + dx, z: z + dz, rotation: random() * Math.PI * 2 });
        }
    }
    return objects;
}

export interface SolidBox { x: number; y: number; z: number; w: number; h: number; d: number }
/** Walls, doorway lintels and roof share exactly the same boxes as the visible building. */
export function buildingBoxes(type: BuildingType): SolidBox[] {
    const { height, door, opening, stepped } = BUILDINGS[type];
    const pillar = (16 - door) / 2, side = (16 + door) / 4;
    return [
        { x: -7.6, y: height / 2, z: 0, w: 0.8, h: height, d: 16 },
        { x: 7.6, y: height / 2, z: 0, w: 0.8, h: height, d: 16 },
        ...[-7.6, 7.6].flatMap(z => [
            { x: -side, y: height / 2, z, w: pillar, h: height, d: 0.8 },
            { x: side, y: height / 2, z, w: pillar, h: height, d: 0.8 },
            { x: 0, y: (height + opening) / 2, z, w: door, h: height - opening, d: 0.8 },
        ]),
        { x: 0, y: height + 0.4, z: 0, w: 16.8, h: 0.8, d: 16.8 },
        ...(stepped ? [12, 8, 4].map((w, i) => ({ x: 0, y: height + 1.2 + i * 0.8, z: 0, w, h: 0.8, d: 16 })) : []),
    ];
}

export function buildingVolume(type: BuildingType, scale: number): number {
    return 16 * 16 * BUILDINGS[type].height * 0.04 * scale ** 3;
}

/** Sphere against a box; also returns the nearest escape when the centre is inside. */
export function boxContact(x: number, y: number, z: number, r: number, b: SolidBox) {
    const dx = x - b.x, dy = y - b.y, dz = z - b.z;
    const nx = dx - Math.max(-b.w / 2, Math.min(b.w / 2, dx));
    const ny = dy - Math.max(-b.h / 2, Math.min(b.h / 2, dy));
    const nz = dz - Math.max(-b.d / 2, Math.min(b.d / 2, dz));
    const distance = Math.hypot(nx, ny, nz);
    if (distance >= r) return null;
    if (distance > 0) return { x: nx / distance, y: ny / distance, z: nz / distance, depth: r - distance };
    const gaps = [b.w / 2 - Math.abs(dx), b.h / 2 - Math.abs(dy), b.d / 2 - Math.abs(dz)];
    const axis = gaps.indexOf(Math.min(...gaps));
    return { x: axis === 0 ? Math.sign(dx) || 1 : 0, y: axis === 1 ? Math.sign(dy) || 1 : 0,
        z: axis === 2 ? Math.sign(dz) || 1 : 0, depth: r + gaps[axis] };
}
