import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface } from './materials.ts';
import { buildingParts } from './Buildings.ts';
import { BUILDINGS, type BuildingType } from './worldLayout.ts';

type G = THREE.BufferGeometry;
export type Motion = 'walk' | 'drive' | 'fly';
export type PowerupType = 'magnet' | 'boost' | 'giant';

export interface Kind {
    id: string;
    name: string;
    emoji: string;
    /** Natural size in meters (largest dimension), used to pick kinds that fit a target size. */
    size: number;
    motion?: Motion;
    /** Floats above the ground at roughly this many of its own heights. */
    sky?: boolean;
    /** Relative spawn chance among kinds that fit (default 1). */
    weight?: number;
    /** Self-lit (emissive) so it blooms. */
    glow?: boolean;
    build: () => G[];
}

// Pastel palette shared by every object so the world reads as one place.
const P = {
    pink: 0xff8fab, coral: 0xff6f69, peach: 0xffb38a, butter: 0xffe08a, gold: 0xffc94d,
    mint: 0x9be8c8, leaf: 0x6cc17a, deepLeaf: 0x3f9e6a, pine: 0x2f7d5b, sky: 0x8ecdf7,
    lavender: 0xb9a3f0, cream: 0xfff4e0, white: 0xfbfbff, stone: 0xb9bccb, slate: 0x6e7191,
    wood: 0xc08457, darkWood: 0x7a5236, roof: 0xe85d75, teal: 0x4ecdc4, ink: 0x3d3d55,
    glass: 0xc4ecff, orange: 0xff9f43, skin: 0xffd3b0, navy: 0x4a5a8c, lava: 0xff5e3a,
};
const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

function paint(geo: G, color: number): G {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
}

const box = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0) =>
    paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const cyl = (rt: number, rb: number, h: number, c: number, x = 0, y = 0, z = 0, seg = 8) =>
    paint(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), c);
const cone = (r: number, h: number, c: number, x = 0, y = 0, z = 0, seg = 8) =>
    paint(new THREE.ConeGeometry(r, h, seg).translate(x, y, z), c);
const ball = (r: number, c: number, x = 0, y = 0, z = 0, seg = 10) =>
    paint(new THREE.SphereGeometry(r, seg, Math.max(5, Math.round(seg * 0.7))).translate(x, y, z), c);
const blob = (r: number, c: number, x = 0, y = 0, z = 0, detail = 0) =>
    paint(new THREE.IcosahedronGeometry(r, detail).translate(x, y, z), c);
const wheel = (r: number, w: number, x: number, y: number, z: number) =>
    paint(new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2).translate(x, y, z), P.ink);

// --- tiny ---
function flower(): G[] {
    const petal = pick([P.pink, P.lavender, P.butter, P.coral, P.white]);
    const parts = [cyl(0.03, 0.03, 0.45, P.leaf, 0, 0.225, 0, 5), box(0.14, 0.02, 0.06, P.leaf, 0.07, 0.18, 0)];
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        parts.push(ball(0.09, petal, Math.cos(a) * 0.11, 0.47, Math.sin(a) * 0.11, 6));
    }
    parts.push(ball(0.07, P.butter, 0, 0.49, 0, 6));
    return parts;
}

function mushroom(): G[] {
    const cap = pick([P.coral, P.roof, P.peach]);
    const parts = [
        cyl(0.09, 0.12, 0.32, P.cream, 0, 0.16, 0),
        paint(new THREE.SphereGeometry(0.28, 12, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.3, 0), cap),
    ];
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4;
        parts.push(ball(0.045, P.white, Math.cos(a) * 0.16, 0.44, Math.sin(a) * 0.16, 5));
    }
    return parts;
}

function candy(): G[] {
    const c = pick([P.pink, P.teal, P.butter, P.lavender]);
    return [
        ball(0.11, c, 0, 0.11, 0, 8),
        paint(new THREE.ConeGeometry(0.08, 0.12, 6).rotateZ(Math.PI / 2).translate(0.16, 0.11, 0), P.white),
        paint(new THREE.ConeGeometry(0.08, 0.12, 6).rotateZ(-Math.PI / 2).translate(-0.16, 0.11, 0), P.white),
    ];
}

function pebble(): G[] {
    const geo = new THREE.DodecahedronGeometry(0.2, 0).scale(rnd(0.9, 1.4), rnd(0.5, 0.9), rnd(0.8, 1.2));
    return [paint(geo.translate(0, 0.12, 0), pick([P.stone, P.slate, P.cream]))];
}

function gift(): G[] {
    const c = pick([P.coral, P.teal, P.lavender, P.sky]);
    const ribbon = pick([P.butter, P.white, P.gold]);
    return [
        box(0.5, 0.4, 0.5, c, 0, 0.2, 0),
        box(0.52, 0.42, 0.1, ribbon, 0, 0.2, 0),
        box(0.1, 0.42, 0.52, ribbon, 0, 0.2, 0),
        ball(0.08, ribbon, 0.07, 0.45, 0, 6),
        ball(0.08, ribbon, -0.07, 0.45, 0, 6),
    ];
}

function donut(): G[] {
    const icing = pick([P.pink, P.lavender, P.mint, P.cream]);
    return [
        paint(new THREE.TorusGeometry(0.14, 0.07, 8, 16).rotateX(Math.PI / 2).translate(0, 0.07, 0), P.wood),
        paint(new THREE.TorusGeometry(0.14, 0.055, 6, 16).rotateX(Math.PI / 2).translate(0, 0.1, 0), icing),
    ];
}

// --- small ---
function bush(): G[] {
    const c = pick([P.leaf, P.deepLeaf, P.mint]);
    const parts: G[] = [];
    for (let i = 0; i < 4; i++) {
        parts.push(blob(rnd(0.35, 0.55), c, rnd(-0.4, 0.4), rnd(0.35, 0.6), rnd(-0.3, 0.3), 1));
    }
    if (Math.random() < 0.5) parts.push(ball(0.1, P.coral, 0.3, 0.8, 0.2, 6), ball(0.1, P.coral, -0.2, 0.7, 0.35, 6));
    return parts;
}

function crate(): G[] {
    return [
        box(1, 1, 1, P.wood, 0, 0.5, 0),
        box(1.04, 0.14, 1.04, P.darkWood, 0, 0.2, 0),
        box(1.04, 0.14, 1.04, P.darkWood, 0, 0.8, 0),
    ];
}

function sheep(): G[] {
    const parts: G[] = [];
    for (let i = 0; i < 6; i++) {
        parts.push(blob(0.38, P.white, rnd(-0.25, 0.25), rnd(0.75, 0.95), rnd(-0.45, 0.45), 1));
    }
    parts.push(box(0.36, 0.4, 0.4, P.ink, 0, 0.95, 0.62));
    parts.push(box(0.12, 0.08, 0.04, P.white, 0.1, 1.02, 0.83), box(0.12, 0.08, 0.04, P.white, -0.1, 1.02, 0.83));
    for (const [x, z] of [[0.2, 0.3], [-0.2, 0.3], [0.2, -0.3], [-0.2, -0.3]]) {
        parts.push(cyl(0.07, 0.07, 0.5, P.ink, x, 0.25, z, 5));
    }
    return parts;
}

function duck(): G[] {
    return [
        ball(0.3, P.butter, 0, 0.3, 0, 10).scale(1, 0.85, 1.2),
        ball(0.18, P.butter, 0, 0.62, 0.22, 8),
        paint(new THREE.ConeGeometry(0.07, 0.18, 6).rotateX(Math.PI / 2).translate(0, 0.6, 0.45), P.orange),
        ball(0.03, P.ink, 0.1, 0.68, 0.36, 4),
        ball(0.03, P.ink, -0.1, 0.68, 0.36, 4),
    ];
}

function person(): G[] {
    const shirt = pick([P.coral, P.teal, P.lavender, P.butter, P.sky]);
    return [
        box(0.16, 0.8, 0.2, P.navy, 0.11, 0.4, 0),
        box(0.16, 0.8, 0.2, P.navy, -0.11, 0.4, 0),
        box(0.5, 0.6, 0.28, shirt, 0, 1.1, 0),
        ball(0.2, P.skin, 0, 1.6, 0, 10),
        paint(new THREE.SphereGeometry(0.21, 10, 5, 0, TAU, 0, Math.PI / 2).translate(0, 1.63, -0.02), pick([P.ink, P.darkWood, P.gold])),
    ];
}

function trafficCone(): G[] {
    return [
        box(0.5, 0.06, 0.5, P.ink, 0, 0.03, 0),
        cone(0.2, 0.75, P.orange, 0, 0.42, 0, 10),
        cyl(0.11, 0.14, 0.12, P.white, 0, 0.45, 0, 10),
    ];
}

function snowman(): G[] {
    return [
        ball(0.55, P.white, 0, 0.5, 0, 12),
        ball(0.4, P.white, 0, 1.2, 0, 12),
        ball(0.28, P.white, 0, 1.75, 0, 10),
        paint(new THREE.ConeGeometry(0.06, 0.3, 6).rotateX(Math.PI / 2).translate(0, 1.75, 0.38), P.orange),
        ball(0.04, P.ink, 0.1, 1.85, 0.24, 4),
        ball(0.04, P.ink, -0.1, 1.85, 0.24, 4),
        cyl(0.22, 0.22, 0.04, P.ink, 0, 1.98, 0, 10),
        cyl(0.14, 0.14, 0.3, P.ink, 0, 2.13, 0, 10),
        paint(new THREE.TorusGeometry(0.33, 0.06, 6, 14).rotateX(Math.PI / 2).translate(0, 1.5, 0), P.coral),
    ];
}

function mailbox(): G[] {
    const c = pick([P.roof, P.deepLeaf]);
    return [
        box(0.5, 0.7, 0.45, c, 0, 0.75, 0),
        paint(new THREE.CylinderGeometry(0.25, 0.25, 0.45, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.1, 0), c),
        box(0.3, 0.05, 0.02, P.ink, 0, 0.9, 0.23),
        box(0.4, 0.4, 0.35, P.slate, 0, 0.2, 0),
    ];
}

function cow(): G[] {
    const parts = [
        box(0.9, 0.8, 1.6, P.white, 0, 1.0, 0),
        box(0.55, 0.55, 0.55, P.white, 0, 1.25, 0.95),
        box(0.4, 0.25, 0.12, P.pink, 0, 1.1, 1.25),
        box(0.92, 0.35, 0.5, P.ink, 0, 1.1, -0.3),
        box(0.5, 0.3, 0.4, P.ink, 0.21, 1.25, 0.4),
        cone(0.06, 0.2, P.cream, 0.22, 1.6, 0.95, 5),
        cone(0.06, 0.2, P.cream, -0.22, 1.6, 0.95, 5),
    ];
    for (const [x, z] of [[0.3, 0.6], [-0.3, 0.6], [0.3, -0.6], [-0.3, -0.6]]) {
        parts.push(box(0.2, 0.6, 0.2, P.cream, x, 0.3, z));
    }
    return parts;
}

// --- medium ---
function car(): G[] {
    const c = pick([P.coral, P.sky, P.butter, P.mint, P.lavender, P.white]);
    return [
        box(1.8, 0.7, 4, c, 0, 0.75, 0),
        box(1.6, 0.65, 2, P.glass, 0, 1.4, -0.3),
        box(1.64, 0.1, 2.04, c, 0, 1.77, -0.3),
        wheel(0.38, 0.3, 0.85, 0.38, 1.25), wheel(0.38, 0.3, -0.85, 0.38, 1.25),
        wheel(0.38, 0.3, 0.85, 0.38, -1.25), wheel(0.38, 0.3, -0.85, 0.38, -1.25),
        box(0.4, 0.18, 0.05, P.butter, 0.55, 0.85, 2.0), box(0.4, 0.18, 0.05, P.butter, -0.55, 0.85, 2.0),
    ];
}

function pineTree(): G[] {
    const h = rnd(1.2, 2);
    const parts = [cyl(0.25, 0.35, h, P.darkWood, 0, h / 2, 0, 6)];
    const layers = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < layers; i++) {
        parts.push(cone(2 - i * 0.4, 2, i % 2 ? P.pine : P.deepLeaf, 0, h + i * 1.1 + 0.6, 0, 7));
    }
    return parts;
}

function roundTree(): G[] {
    const crown = pick([P.leaf, P.deepLeaf, P.mint, P.pink]);
    const parts = [cyl(0.3, 0.45, 2.6, P.wood, 0, 1.3, 0, 6)];
    for (let i = 0; i < 4; i++) {
        parts.push(blob(rnd(1.3, 1.9), crown, rnd(-0.9, 0.9), rnd(3.2, 4.4), rnd(-0.9, 0.9), 1));
    }
    if (crown !== P.pink && Math.random() < 0.5) {
        for (let i = 0; i < 5; i++) parts.push(ball(0.2, P.coral, rnd(-1.6, 1.6), rnd(2.8, 4.8), rnd(1.2, 1.8), 6));
    }
    return parts;
}

function table(): G[] {
    const parts = [box(2.4, 0.16, 1.3, P.wood, 0, 1.1, 0)];
    for (const x of [-1, 1]) for (const z of [-0.45, 0.45]) parts.push(box(0.14, 1.1, 0.14, P.darkWood, x, 0.55, z));
    return parts;
}

function chair(): G[] {
    const parts = [box(0.8, 0.12, 0.8, P.teal, 0, 0.6, 0), box(0.8, 0.6, 0.12, P.teal, 0, 0.95, -0.35)];
    for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) parts.push(box(0.1, 0.6, 0.1, P.wood, x, 0.3, z));
    return parts;
}

function bench(): G[] {
    return [box(2.4, 0.15, 0.8, P.wood, 0, 0.7, 0), box(2.4, 0.6, 0.15, P.wood, 0, 1.05, -0.35),
        box(0.2, 0.7, 0.7, P.ink, -0.9, 0.35, 0), box(0.2, 0.7, 0.7, P.ink, 0.9, 0.35, 0)];
}

function house(): G[] {
    const wall = pick([P.cream, P.peach, P.mint, P.sky, P.white, P.butter]);
    const roof = pick([P.roof, P.coral, P.slate, P.teal]);
    const w = rnd(3, 4), d = rnd(3, 4), h = rnd(2.4, 3);
    const R = (w + 0.4) / Math.sqrt(3);
    return [
        box(w, h, d, wall, 0, h / 2, 0),
        // Triangular prism along z with its apex up.
        paint(new THREE.CylinderGeometry(R, R, d + 0.4, 3).rotateX(-Math.PI / 2).scale(1, 0.7, 1).translate(0, h + R * 0.35, 0), roof),
        box(0.8, 1.4, 0.06, P.darkWood, 0, 0.7, d / 2 + 0.02),
        box(0.7, 0.7, 0.06, P.glass, w * 0.28, h * 0.6, d / 2 + 0.02),
        box(0.7, 0.7, 0.06, P.glass, -w * 0.28, h * 0.6, d / 2 + 0.02),
        box(0.5, 1.4, 0.5, P.stone, w * 0.25, h + 1, -d * 0.15),
    ];
}

function tent(): G[] {
    const c = pick([P.coral, P.butter, P.teal, P.lavender]);
    return [
        cone(1.9, 2.4, c, 0, 1.2, 0, 6),
        paint(new THREE.ConeGeometry(0.6, 1.3, 3).translate(0, 0.65, 1.35), P.ink),
        cyl(0.04, 0.04, 0.6, P.darkWood, 0, 2.6, 0, 4),
        box(0.5, 0.3, 0.02, P.white, 0.25, 2.75, 0),
    ];
}

function bus(): G[] {
    const parts = [
        box(2.4, 2.2, 8, P.butter, 0, 1.6, 0),
        box(2.44, 0.8, 7.2, P.glass, 0, 2.1, -0.2),
        box(2.2, 0.8, 0.06, P.glass, 0, 2.1, 4.01),
        box(2.46, 0.2, 8.02, P.coral, 0, 1.1, 0),
    ];
    for (const z of [2.6, -2.6]) parts.push(wheel(0.55, 0.4, 1.1, 0.55, z), wheel(0.55, 0.4, -1.1, 0.55, z));
    return parts;
}

// --- large ---
function skyscraper(): G[] {
    const c = pick([P.slate, P.sky, P.lavender, P.stone, P.teal]);
    const parts: G[] = [];
    let y = 0;
    let w = rnd(7, 9);
    const tiers = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < tiers; i++) {
        const h = rnd(12, 20);
        parts.push(box(w, h, w, c, 0, y + h / 2, 0));
        for (let k = 2; k < h - 1; k += 3) parts.push(box(w + 0.1, 1, w + 0.1, P.glass, 0, y + k, 0));
        y += h;
        w *= 0.75;
    }
    parts.push(cyl(0.15, 0.25, 6, P.white, 0, y + 3, 0, 5), ball(0.5, P.coral, 0, y + 6, 0, 6));
    return parts;
}

function tower(): G[] {
    const parts: G[] = [];
    const tiers = [[9, 6, 14], [6, 3.4, 16], [3.4, 1.4, 16], [1.4, 0.3, 12]];
    let y = 0;
    tiers.forEach(([rb, rt, h], i) => {
        parts.push(cyl(rt, rb, h, i % 2 ? P.white : P.coral, 0, y + h / 2, 0, 4));
        y += h;
        if (i < 2) parts.push(box(rt * 2.4, 1.2, rt * 2.4, P.glass, 0, y, 0));
    });
    parts.push(cyl(0.1, 0.2, 8, P.white, 0, y + 4, 0, 4));
    return parts;
}

function ferrisWheel(): G[] {
    const R = 14;
    const parts = [
        paint(new THREE.TorusGeometry(R, 0.5, 6, 32).translate(0, R + 3, 0), P.white),
        paint(new THREE.TorusGeometry(R * 0.3, 0.4, 6, 16).translate(0, R + 3, 0), P.coral),
        box(1.2, R + 4, 1.2, P.slate, R * 0.35, (R + 3) / 2, 1.5),
        box(1.2, R + 4, 1.2, P.slate, -R * 0.35, (R + 3) / 2, 1.5),
    ];
    const colors = [P.coral, P.butter, P.teal, P.lavender, P.pink, P.mint];
    for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        parts.push(paint(new THREE.BoxGeometry(0.3, R, 0.3).translate(0, R / 2, 0).rotateZ(a).translate(0, R + 3, 0), P.white));
        parts.push(box(2, 2, 2, colors[i % colors.length], Math.sin(a) * R, R + 3 - Math.cos(a) * R - 1.2, 0));
    }
    return parts;
}

function cloud(): G[] {
    const parts: G[] = [];
    const puffs = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < puffs; i++) {
        parts.push(blob(rnd(3, 5.5), P.white, rnd(-8, 8), rnd(-1, 2), rnd(-4, 4), 1));
    }
    return parts;
}

function ufo(): G[] {
    const parts = [
        paint(new THREE.SphereGeometry(6, 16, 8).scale(1, 0.28, 1).translate(0, 2, 0), P.stone),
        paint(new THREE.SphereGeometry(2.8, 14, 7, 0, TAU, 0, Math.PI / 2).translate(0, 2.8, 0), P.glass),
        ball(0.8, P.leaf, 0, 3.6, 0, 8),
    ];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        parts.push(ball(0.45, i % 2 ? P.butter : P.pink, Math.cos(a) * 4.8, 1.8, Math.sin(a) * 4.8, 6));
    }
    return parts;
}

// --- huge ---
function mountain(): G[] {
    const r = rnd(70, 90);
    const h = rnd(60, 90);
    return [
        cone(r, h, pick([P.deepLeaf, P.leaf, P.pine]), 0, h / 2, 0, 9),
        cone(r * 0.32, h * 0.32, P.white, 0, h * 0.84 + 0.5, 0, 9),
        cone(r * 0.6, h * 0.6, P.pine, r * 0.7, h * 0.3, r * 0.2, 7),
    ];
}

function castle(): G[] {
    const c = pick([P.cream, P.stone, P.pink]);
    const roof = pick([P.roof, P.lavender, P.teal]);
    const parts = [box(60, 22, 60, c, 0, 11, 0), box(26, 50, 26, c, 0, 25, 0), cone(20, 26, roof, 0, 63, 0, 4)];
    for (const [x, z] of [[30, 30], [-30, 30], [30, -30], [-30, -30]]) {
        parts.push(cyl(8, 8, 36, c, x, 18, z, 10), cone(10, 18, roof, x, 45, z, 10));
    }
    parts.push(box(10, 14, 1, P.darkWood, 0, 7, 30.2));
    return parts;
}

function volcano(): G[] {
    return [
        cyl(30, 110, 90, P.darkWood, 0, 45, 0, 10),
        cyl(28, 34, 10, P.wood, 0, 86, 0, 10),
        cyl(26, 26, 2, P.lava, 0, 91, 0, 10),
        blob(14, P.orange, 0, 96, 0, 0),
    ];
}

function rocket(): G[] {
    const parts = [
        cyl(9, 9, 80, P.white, 0, 50, 0, 14),
        cone(9, 30, P.coral, 0, 105, 0, 14),
        ball(4.5, P.glass, 0, 70, 8.2, 10),
        cyl(6, 9, 10, P.slate, 0, 5, 0, 14),
    ];
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        parts.push(paint(new THREE.BoxGeometry(1.5, 26, 12).translate(0, 18, 12).rotateY(a), P.coral));
    }
    return parts;
}

// --- colossal: past the old 500 m cap the ball keeps going, all the way to the stars ---
function pyramid(): G[] {
    const parts: G[] = [];
    for (let i = 0; i < 6; i++) {
        const w = 120 - i * 20;
        parts.push(box(w, 14, w, i % 2 ? P.butter : P.peach, 0, 7 + i * 14, 0));
    }
    parts.push(box(14, 10, 14, P.gold, 0, 89, 0));
    return parts;
}

function city(): G[] {
    const parts = [box(124, 3, 124, P.slate, 0, 1.5, 0)];
    for (let x = -48; x <= 48; x += 24) {
        for (let z = -48; z <= 48; z += 24) {
            if (Math.random() < 0.15) continue; // a park
            const h = rnd(14, 26) + 60 * Math.max(0, 1 - Math.hypot(x, z) / 70); // downtown towers in the middle
            parts.push(box(16, h, 16, pick([P.sky, P.lavender, P.cream, P.mint, P.pink]), x, 3 + h / 2, z));
            if (h > 45) parts.push(box(11, 5, 11, P.glass, x, 5.5 + h, z));
        }
    }
    parts.push(cyl(2.5, 4, 100, P.white, 0, 53, 0, 8), cone(4, 22, P.coral, 0, 114, 0, 8));
    return parts;
}

function mountainRange(): G[] {
    const parts: G[] = [];
    for (let i = 0; i < 6; i++) {
        const h = rnd(70, 130);
        const r = h * rnd(0.7, 0.9);
        const x = (i - 2.5) * 46 + rnd(-8, 8);
        const z = rnd(-25, 25);
        parts.push(cone(r, h, pick([P.deepLeaf, P.pine, P.slate]), x, h / 2, z, 8));
        parts.push(cone(r * 0.3, h * 0.3, P.white, x, h * 0.85 + 0.5, z, 8));
    }
    return parts;
}

function rainbow(): G[] {
    const bands = [P.coral, P.orange, P.butter, P.mint, P.sky, P.lavender];
    const parts = bands.map((c, i) => paint(new THREE.TorusGeometry(60 - i * 5, 2.6, 6, 40, Math.PI), c));
    for (const x of [-50, 50]) {
        for (let k = 0; k < 4; k++) parts.push(blob(rnd(8, 12), P.white, x + rnd(-9, 9), rnd(3, 9), rnd(-6, 6), 1));
    }
    return parts;
}

function tornado(): G[] {
    const parts: G[] = [];
    for (let i = 0; i < 10; i++) {
        const ring = new THREE.TorusGeometry(5 + i * i * 0.8, 3 + i * 0.7, 6, 20).rotateX(Math.PI / 2);
        parts.push(paint(ring.translate(Math.sin(i * 0.8) * 5, 4 + i * 13, 0), i % 2 ? P.stone : P.white));
    }
    return parts;
}

function floatingIsland(): G[] {
    const parts = [
        paint(new THREE.ConeGeometry(50, 60, 9).rotateX(Math.PI).translate(0, 30, 0), P.darkWood),
        cyl(52, 50, 8, P.leaf, 0, 64, 0, 12),
        box(7, 48, 2, P.sky, 44, 42, 14), // waterfall spilling off the edge
    ];
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + rnd(0, 0.5);
        const r = rnd(12, 36);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        parts.push(cyl(1.5, 2, 10, P.wood, x, 73, z, 6), ball(7, pick([P.deepLeaf, P.leaf]), x, 82, z, 8));
    }
    return parts;
}

function moon(): G[] {
    const parts = [ball(50, P.cream, 0, 50, 0, 24)];
    for (let i = 0; i < 10; i++) {
        const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).normalize().multiplyScalar(48);
        parts.push(ball(rnd(5, 10), P.stone, d.x, 50 + d.y, d.z, 10));
    }
    return parts;
}

function planet(): G[] {
    const ring = new THREE.TorusGeometry(62, 10, 4, 48).rotateX(Math.PI / 2).scale(1, 0.12, 1).rotateZ(0.35);
    return [
        ball(40, pick([P.peach, P.lavender, P.sky, P.coral]), 0, 50, 0, 24),
        paint(new THREE.SphereGeometry(40.5, 24, 4, 0, TAU, Math.PI * 0.42, Math.PI * 0.14).translate(0, 50, 0), P.cream),
        paint(ring.translate(0, 50, 0), P.butter),
    ];
}

function sun(): G[] {
    const parts = [ball(45, P.gold, 0, 60, 0, 24)];
    for (let i = 0; i < 12; i++) {
        const ray = new THREE.ConeGeometry(7, 22, 6).translate(0, 58, 0).rotateZ((i / 12) * TAU);
        parts.push(paint(ray.translate(0, 60, 0), P.orange));
    }
    return parts;
}

function galaxy(): G[] {
    const parts = [ball(14, P.butter, 0, 10, 0, 12)];
    for (let arm = 0; arm < 3; arm++) {
        for (let i = 0; i < 10; i++) {
            const t = i / 10;
            const a = (arm / 3) * TAU + t * 4.5;
            const r = 16 + t * 70;
            parts.push(blob(7 - t * 4, pick([P.lavender, P.pink, P.sky, P.white]), Math.cos(a) * r, 10 + rnd(-2, 2), Math.sin(a) * r, 0));
        }
    }
    return parts;
}

export const KINDS: readonly Kind[] = [
    { id: 'flower', name: '小花', emoji: '🌸', size: 0.5, build: flower },
    { id: 'mushroom', name: '蘑菇', emoji: '🍄', size: 0.5, build: mushroom },
    { id: 'candy', name: '糖果', emoji: '🍬', size: 0.4, build: candy },
    { id: 'pebble', name: '小石頭', emoji: '🪨', size: 0.4, build: pebble },
    { id: 'gift', name: '禮物盒', emoji: '🎁', size: 0.55, build: gift },
    { id: 'donut', name: '甜甜圈', emoji: '🍩', size: 0.4, build: donut },
    { id: 'duck', name: '鴨子', emoji: '🦆', size: 0.8, motion: 'walk', build: duck },
    { id: 'cone', name: '三角錐', emoji: '🚧', size: 0.8, build: trafficCone },
    { id: 'crate', name: '木箱', emoji: '📦', size: 1.1, build: crate },
    { id: 'table', name: '桌子', emoji: '🪑', size: 2.4, build: table },
    { id: 'chair', name: '椅子', emoji: '🪑', size: 1.2, build: chair },
    { id: 'bench', name: '公園長椅', emoji: '🪑', size: 2.4, build: bench },
    { id: 'bush', name: '灌木叢', emoji: '🌿', size: 1.6, build: bush },
    { id: 'mailbox', name: '郵筒', emoji: '📮', size: 1.4, build: mailbox },
    { id: 'sheep', name: '綿羊', emoji: '🐑', size: 1.6, motion: 'walk', build: sheep },
    { id: 'person', name: '路人', emoji: '🧍', size: 1.8, motion: 'walk', build: person },
    { id: 'snowman', name: '雪人', emoji: '⛄', size: 2.2, build: snowman },
    { id: 'cow', name: '乳牛', emoji: '🐄', size: 2.4, motion: 'walk', build: cow },
    { id: 'tent', name: '帳篷', emoji: '⛺', size: 3.8, build: tent },
    { id: 'car', name: '汽車', emoji: '🚗', size: 4.2, motion: 'drive', build: car },
    { id: 'pine', name: '松樹', emoji: '🌲', size: 6.5, build: pineTree },
    { id: 'tree', name: '大樹', emoji: '🌳', size: 6.5, build: roundTree },
    { id: 'house', name: '小屋', emoji: '🏠', size: 6, build: house },
    ...(['bakery', 'cafe', 'barn', 'warehouse', 'apartments'] as const).map((id: BuildingType) => ({
        id, name: BUILDINGS[id].name, emoji: BUILDINGS[id].emoji,
        size: Math.max(16.8, BUILDINGS[id].height), build: () => buildingParts(id),
    })),
    { id: 'bus', name: '公車', emoji: '🚌', size: 8, motion: 'drive', build: bus },
    { id: 'ufo', name: '幽浮', emoji: '🛸', size: 14, motion: 'fly', sky: true, weight: 0.3, build: ufo },
    { id: 'cloud', name: '雲朵', emoji: '☁️', size: 22, sky: true, weight: 0.5, build: cloud },
    { id: 'ferris', name: '摩天輪', emoji: '🎡', size: 32, build: ferrisWheel },
    { id: 'skyscraper', name: '大樓', emoji: '🏢', size: 50, build: skyscraper },
    { id: 'tower', name: '電波塔', emoji: '🗼', size: 70, build: tower },
    { id: 'castle', name: '城堡', emoji: '🏰', size: 90, build: castle },
    { id: 'rocket', name: '火箭', emoji: '🚀', size: 120, build: rocket },
    { id: 'mountain', name: '小山', emoji: '⛰️', size: 170, build: mountain },
    { id: 'volcano', name: '火山', emoji: '🌋', size: 220, build: volcano },
    { id: 'pyramid', name: '金字塔', emoji: '🔺', size: 320, build: pyramid },
    { id: 'city', name: '城市', emoji: '🏙️', size: 600, build: city },
    { id: 'range', name: '山脈', emoji: '🏔️', size: 1100, build: mountainRange },
    { id: 'rainbow', name: '彩虹', emoji: '🌈', size: 1600, build: rainbow },
    { id: 'tornado', name: '龍捲風', emoji: '🌪️', size: 2500, build: tornado },
    { id: 'island', name: '浮空島', emoji: '🏝️', size: 4000, sky: true, weight: 0.6, build: floatingIsland },
    { id: 'moon', name: '月亮', emoji: '🌕', size: 8000, sky: true, weight: 0.5, build: moon },
    { id: 'planet', name: '行星', emoji: '🪐', size: 15000, sky: true, weight: 0.5, build: planet },
    { id: 'sun', name: '太陽', emoji: '☀️', size: 30000, sky: true, weight: 0.4, glow: true, build: sun },
    { id: 'galaxy', name: '星系', emoji: '🌌', size: 60000, sky: true, weight: 0.4, build: galaxy },
];

export const KIND_BY_ID: ReadonlyMap<string, Kind> = new Map(KINDS.map(k => [k.id, k]));

export const POWERUPS: Record<PowerupType, { name: string; color: number; seconds: number }> = {
    magnet: { name: '磁吸', color: 0x4ecdc4, seconds: 8 },
    boost: { name: '衝刺', color: 0xff9f43, seconds: 6 },
    giant: { name: '巨大化', color: 0xffc94d, seconds: 0 },
};

/** Unit-height geometry: largest dimension 1, pivot at bottom center. */
function finish(parts: G[]): G {
    const geo = mergeGeometries(parts);
    parts.forEach(p => p.dispose());
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const dims = bb.getSize(new THREE.Vector3());
    const maxDim = Math.max(dims.x, dims.y, dims.z);
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.scale(1 / maxDim, 1 / maxDim, 1 / maxDim);
    bakeGroundOcclusion(geo, dims.y / maxDim);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.dims = dims.divideScalar(maxDim);
    return geo;
}

/** Darken vertices near the ground (baked ambient occlusion) so objects sit in the grass instead of floating. */
function bakeGroundOcclusion(geo: G, height: number) {
    const pos = geo.getAttribute('position');
    const color = geo.getAttribute('color');
    const reach = Math.min(0.25, height * 0.6);
    for (let i = 0; i < pos.count; i++) {
        const t = Math.min(1, pos.getY(i) / reach);
        const k = 0.55 + 0.45 * t * t * (3 - 2 * t);
        color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
    }
}

function weightedPick(list: readonly Kind[]): Kind {
    let roll = Math.random() * list.reduce((sum, k) => sum + (k.weight ?? 1), 0);
    for (const k of list) {
        roll -= k.weight ?? 1;
        if (roll <= 0) return k;
    }
    return list[list.length - 1];
}

export class ObjectFactory {
    // Geometries are shared by every instance and live for the whole session, so chunk unloads never leak GPU memory.
    private static variants = new Map<string, G[]>();
    private static solidMat = surface({ vertexColors: true, roughness: 0.7 });
    private static cloudMat = surface({ vertexColors: true, transparent: true, opacity: 0.9, roughness: 1 });
    private static glowMat = surface({ vertexColors: true, emissive: 0xff9f43, emissiveIntensity: 0.9, roughness: 0.6 });
    private static powerupMats = new Map<PowerupType, THREE.Material>();
    private static powerupGeo = new THREE.OctahedronGeometry(0.5, 0).translate(0, 0.5, 0);
    private static readonly VARIANTS_PER_KIND = 3;

    private static geometryFor(kind: Kind): G {
        let list = this.variants.get(kind.id);
        if (!list) {
            list = [];
            this.variants.set(kind.id, list);
        }
        if (list.length < this.VARIANTS_PER_KIND) list.push(finish(kind.build()));
        return pick(list);
    }

    /** Kinds whose natural size is within 2.5x of the target; past either end of the catalogue, its smallest or colossal kinds. */
    public static kindForSize(size: number): Kind {
        const fits = KINDS.filter(k => size / k.size < 2.5 && k.size / size < 2.5);
        if (fits.length) return weightedPick(fits);
        return size < KINDS[0].size ? pick(KINDS.slice(0, 6)) : weightedPick(KINDS.slice(-7));
    }

    public static create(kind: Kind, size: number): THREE.Mesh {
        const geo = this.geometryFor(kind);
        const mesh = new THREE.Mesh(geo, kind.glow ? this.glowMat : kind.id === 'cloud' ? this.cloudMat : this.solidMat);
        mesh.scale.setScalar(size);
        const dims = geo.userData.dims as THREE.Vector3;
        const ud = mesh.userData;
        ud.kind = kind.id;
        ud.size = size;
        ud.volume = dims.x * dims.y * dims.z * size * size * size;
        // 60% of the footprint so near-misses don't feel like invisible walls.
        ud.radius = (Math.max(dims.x, dims.z) / 2) * size * 0.6;
        ud.height = dims.y * size;
        if (kind.motion) {
            ud.motion = kind.motion;
            ud.moveDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
            const pace = kind.motion === 'walk' ? 1.2 : kind.motion === 'drive' ? 3 : 1.5;
            ud.moveSpeed = pace * size * rnd(0.8, 1.2);
        }
        return mesh;
    }

    public static createPowerup(type: PowerupType, size: number): THREE.Mesh {
        let mat = this.powerupMats.get(type);
        if (!mat) {
            const color = POWERUPS[type].color;
            // Bright enough to cross the bloom threshold: power-ups glow from afar.
            mat = surface({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.25, metalness: 0.1 });
            this.powerupMats.set(type, mat);
        }
        const mesh = new THREE.Mesh(this.powerupGeo, mat);
        mesh.scale.set(size, size * 1.3, size);
        const ud = mesh.userData;
        ud.powerup = type;
        ud.size = size;
        ud.volume = 0;
        ud.radius = size * 0.9;
        ud.height = size * 2;
        return mesh;
    }
}
