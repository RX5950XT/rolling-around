import * as THREE from 'three';

/** Matte PBR surface: every material in the world starts here so lighting stays consistent. */
export function surface(params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...params });
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Seamless fractal value noise in [0, 1]; `size` and every period must be powers of two. */
function tileableNoise(size: number, periods: readonly number[]): Float32Array {
    const out = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (const period of periods) {
        const lattice = Float32Array.from({ length: period * period }, Math.random);
        const at = (i: number, j: number) => lattice[(j % period) * period + (i % period)];
        const cell = size / period;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const x0 = Math.floor(x / cell);
                const y0 = Math.floor(y / cell);
                const tx = smooth(x / cell - x0);
                const ty = smooth(y / cell - y0);
                const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
                const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
                out[y * size + x] += (top + (bottom - top) * ty) * amp;
            }
        }
        total += amp;
        amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
}

function repeatingTexture(data: Uint8Array, size: number): THREE.DataTexture {
    const tex = new THREE.DataTexture(data, size, size);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
}

/** Grey mottling multiplied over the ground's vertex colors: grass grain up close, soft patches far away. */
export function groundDetailTexture(): THREE.DataTexture {
    const size = 256;
    const n = tileableNoise(size, [4, 8, 32, 64]);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < n.length; i++) {
        const v = Math.min(255, Math.round(255 * (0.92 + (n[i] - 0.5) * 0.4)));
        data.set([v, v, v, 255], i * 4);
    }
    return repeatingTexture(data, size);
}

/** Tangent-space normal map of gentle ripples for the water surface. */
export function waterNormalTexture(): THREE.DataTexture {
    const size = 256;
    const h = tileableNoise(size, [8, 16, 32]);
    const at = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * 8;
            const dy = (at(x, y + 1) - at(x, y - 1)) * 8;
            const len = Math.hypot(dx, dy, 1);
            const to8 = (v: number) => Math.round((v / len * 0.5 + 0.5) * 255);
            data.set([to8(-dx), to8(-dy), to8(1), 255], (y * size + x) * 4);
        }
    }
    return repeatingTexture(data, size);
}
