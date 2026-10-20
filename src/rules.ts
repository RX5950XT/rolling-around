// Pure gameplay formulas. No three.js imports so `npm test` can run them under plain node.

/** Fraction of velocity kept after one second of rolling (exponential decay). Low = snappy start and stop (~0.3 s). */
export const BALL_FRICTION = 0.03;

/** Per-second decay of sideways motion while steering: turns bite instead of drifting. Divided by the rain modifier. */
export const GRIP = 9;

/** Slopes gentler than this don't roll a resting ball (rolling resistance); steeper ones pull it downhill. */
export const SLOPE_HOLD = 0.05;

/** Holding sprint multiplies top speed by this. */
export const SPRINT_BOOST = 1.6;
/** A full stamina bar lasts this long while sprinting… */
export const SPRINT_SECONDS = 3;
/** …and refills from empty in this long, once you have rested a moment. */
export const STAMINA_REFILL_SECONDS = 4;
const STAMINA_REST_DELAY = 0.6;
/** Running dry leaves you winded: no sprint until the bar is back to this level. */
export const STAMINA_RECOVER_AT = 0.35;

export interface Stamina {
    level: number;
    exhausted: boolean;
    /** Seconds since the last sprint. */
    rest: number;
}

/** One tick of the sprint meter: drains while sprinting, refills after a short rest. */
export function stepStamina(s: Stamina, wantSprint: boolean, dt: number): { next: Stamina; sprinting: boolean } {
    if (wantSprint && !s.exhausted && s.level > 0) {
        const level = Math.max(0, s.level - dt / SPRINT_SECONDS);
        return { next: { level, exhausted: level === 0, rest: 0 }, sprinting: level > 0 };
    }
    const rest = s.rest + dt;
    const level = rest > STAMINA_REST_DELAY ? Math.min(1, s.level + dt / STAMINA_REFILL_SECONDS) : s.level;
    return { next: { level, exhausted: s.exhausted && level < STAMINA_RECOVER_AT, rest }, sprinting: false };
}

/**
 * Past this size the world is self-similar (chunks, hills and objects all scale with the ball), so the physics goes
 * linear too. Plain power laws would drift into slow motion: a 100 km ball would crawl and hang 35 s in the air per jump.
 */
const SELF_SIMILAR_SIZE = 100;

/** size^p, bending into straight proportion past SELF_SIMILAR_SIZE (continuous at the bend). */
function sizePower(size: number, p: number): number {
    if (size <= SELF_SIMILAR_SIZE) return Math.pow(size, p);
    return Math.pow(SELF_SIMILAR_SIZE, p) * (size / SELF_SIMILAR_SIZE);
}

/** Cruising speed in m/s. Grows with size so a big ball still crosses its own body quickly (~4.8 radii/s from 100 m on). */
export function topSpeed(size: number): number {
    return 12 * sizePower(size, 0.8);
}

/**
 * Acceleration whose terminal velocity under `v *= retention^dt` equals `top`.
 * Without this, friction alone caps every ball at ~63 m/s no matter how big it is.
 */
export function accelerationFor(top: number, retention: number): number {
    return top * -Math.log(retention);
}

/** Jump height ≈ 5 ball radii; airtime grows slowly up to 100 m (0.8 s → 3.3 s) and then stays put. */
export function jumpVelocity(size: number): number {
    return 25 * sizePower(size, 0.7);
}

export function gravityFor(size: number): number {
    return 60 * sizePower(size, 0.4);
}

export function sphereVolume(radius: number): number {
    return (4 / 3) * Math.PI * radius * radius * radius;
}

export function radiusFromVolume(volume: number): number {
    return Math.cbrt(volume / ((4 / 3) * Math.PI));
}

/** Combo keeps going while each bite lands within this many seconds of the previous one. */
export const COMBO_WINDOW = 1.4;

/** Growth multiplier from the current combo: up to +30% at 20 chained bites. */
export function comboBonus(combo: number): number {
    return 1 + Math.min(combo, 20) * 0.015;
}

/** You can roll up anything under 60% of your own volume. */
export function canEat(objectVolume: number, ballVolume: number): boolean {
    return objectVolume < ballVolume * 0.6;
}

/** Objects pack loosely around the ball, so only part of their volume becomes ball (~20 bites per volume doubling). */
export const GROWTH_EFFICIENCY = 0.7;

export const TITLES: ReadonlyArray<{ size: number; name: string }> = [
    { size: 0, name: '小彈珠' },
    { size: 2, name: '雪球' },
    { size: 5, name: '滾石' },
    { size: 12, name: '推土球' },
    { size: 30, name: '城鎮吞噬者' },
    { size: 70, name: '摩天巨球' },
    { size: 150, name: '怪獸級' },
    { size: 300, name: '天災級' },
    { size: 450, name: '小行星' },
    { size: 1000, name: '移山巨球' },
    { size: 2500, name: '大陸吞噬者' },
    { size: 6000, name: '月球級' },
    { size: 15000, name: '行星級' },
    { size: 40000, name: '恆星級' },
    { size: 100000, name: '星系級' },
    { size: 300000, name: '宇宙之球' },
];

export function titleIndex(size: number): number {
    let idx = 0;
    for (let i = 0; i < TITLES.length; i++) {
        if (size >= TITLES[i].size) idx = i;
    }
    return idx;
}

/** 0..1 progress from the current title threshold to the next (1 at the final title). */
export function titleProgress(size: number): number {
    const i = titleIndex(size);
    if (i >= TITLES.length - 1) return 1;
    const lo = Math.max(TITLES[i].size, 1);
    const hi = TITLES[i + 1].size;
    // Log scale so each title takes a similar amount of eating.
    return Math.min(1, Math.max(0, Math.log(size / lo) / Math.log(hi / lo)));
}

/** How many chunks around the player get objects: enough to stay a few ball-widths ahead. */
export function populateRadius(size: number, chunkSize: number): number {
    return Math.min(3, Math.max(1, Math.ceil((size * 4) / chunkSize)));
}

/** Total objects alive across populated chunks stays near this, to bound draw calls. */
export const OBJECT_BUDGET = 2600;

/**
 * Objects per chunk: one object per ~3.3 ball-radii² of ground (spacing ≈ 1.8 radii), capped by the draw-call budget.
 * Much denser and every bite chains into the next, so growth snowballs straight to the size cap.
 */
export function chunkObjectCap(size: number, chunkSize: number): number {
    const r = populateRadius(size, chunkSize);
    const cap = Math.floor(OBJECT_BUDGET / ((2 * r + 1) * (2 * r + 1)));
    const want = Math.round((0.3 * chunkSize * chunkSize) / (size * size));
    return Math.max(4, Math.min(cap, want));
}

/** Random object size relative to the ball: mostly bite-sized, some bigger than you. */
export function pickObjectSize(size: number, rand: number): number {
    const lo = Math.log(0.12);
    const hi = Math.log(2.6);
    return size * Math.exp(lo + (hi - lo) * Math.pow(rand, 1.6));
}

export const CHALLENGE_SECONDS = 240;
