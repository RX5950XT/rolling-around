import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingVolume, planBlock } from '../src/worldLayout.ts';
import { KIND_BY_ID, ObjectFactory } from '../src/ObjectFactory.ts';
import { canEat, chunkObjectCap, GROWTH_EFFICIENCY, sphereVolume } from '../src/rules.ts';

test('regional landmarks can be eaten before the next world enlargement', () => {
    for (const seed of [1, 42, 123, 9876]) for (const tier of [3, 4, 6, 9]) {
        const scale = 4 ** tier, nextRadius = 150 * 4 ** (tier - 2);
        for (const x of [-2, 0, 2]) {
            const { objects } = planBlock(seed, x, 0, tier);
            for (const p of objects.filter(o => ['city', 'mountain'].includes(o.id))) {
                const o = ObjectFactory.create(KIND_BY_ID.get(p.id)!, p.size * scale);
                assert.ok(canEat(o.userData.volume, sphereVolume(nextRadius * 0.8)),
                    `${p.id} cannot be eaten before tier ${tier + 1}, seed ${seed}`);
            }
        }
    }
});

test('regional starter food is reachable without overlapping an inedible landmark', () => {
    for (const seed of [1, 42, 123, 9876]) for (let x = -3; x <= 3; x++) {
        const radius = 150 / 64;
        const objects = planBlock(seed, x, 0, 3).objects.map(p => ({
            ...p, data: ObjectFactory.create(KIND_BY_ID.get(p.id)!, p.size).userData,
        }));
        const food = objects.filter(o => canEat(o.data.volume, sphereVolume(radius)));
        const obstacles = objects.filter(o => !canEat(o.data.volume, sphereVolume(radius)));
        assert.ok(food.length >= objects.length * 0.6, 'new tier has too few edible objects');
        for (const a of food) for (const b of obstacles) {
            assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > radius + b.data.radius,
                `${a.id} is buried inside ${b.id}`);
        }
    }
});

test('a fresh neighbourhood supplies a continuous growth path through every tier', () => {
    for (const seed of [1, 42, 123, 9876]) for (const tier of [0, 1, 2, 3, 4, 6, 9]) {
        const scale = 4 ** tier;
        const start = [1, 5, 30][tier] ?? 150 * 4 ** (tier - 3);
        const next = [5, 30, 150][tier] ?? start * 4;
        let volume = sphereVolume(start);
        const remaining: number[] = [];
        for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
            const placements = planBlock(seed, x, z, tier).objects
                .filter(o => o.size * scale >= start * 0.08).slice(0, chunkObjectCap(start, 100 * scale));
            for (const p of placements) remaining.push(p.building ? buildingVolume(p.building, scale)
                : ObjectFactory.create(KIND_BY_ID.get(p.id)!, p.size * scale).userData.volume);
        }
        remaining.sort((a, b) => a - b);
        for (const food of remaining) {
            if (!canEat(food, volume)) break;
            volume += food * GROWTH_EFFICIENCY;
        }
        assert.ok(volume >= sphereVolume(next), `growth gap at tier ${tier}, seed ${seed}`);
    }
});
