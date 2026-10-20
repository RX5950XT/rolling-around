import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BALL_FRICTION, SPRINT_SECONDS, STAMINA_RECOVER_AT, accelerationFor, canEat, chunkObjectCap, comboBonus, jumpVelocity,
    gravityFor, pickObjectSize, populateRadius, stepStamina, titleIndex, titleProgress, topSpeed, TITLES, type Stamina,
} from '../src/rules.ts';

test('terminal velocity matches topSpeed at every size', () => {
    for (const size of [1, 10, 100, 500]) {
        const top = topSpeed(size);
        const accel = accelerationFor(top, BALL_FRICTION);
        let v = 0;
        const dt = 1 / 60;
        for (let i = 0; i < 60 * 20; i++) {
            v += accel * dt;
            v *= Math.pow(BALL_FRICTION, dt);
        }
        assert.ok(Math.abs(v - top) / top < 0.03, `size ${size}: ${v} vs ${top}`);
    }
});

test('bigger balls are faster', () => {
    assert.ok(topSpeed(100) > topSpeed(10) * 5);
});

test('jump height scales with size (about 5 radii)', () => {
    for (const size of [1, 50, 400, 1e6]) {
        const v = jumpVelocity(size);
        const h = (v * v) / (2 * gravityFor(size));
        assert.ok(h / size > 4 && h / size < 6.5, `size ${size}: ${h / size}`);
    }
});

test('huge balls move and jump like a 100 m one (no slow motion), with no jolt at the bend', () => {
    const feel = (s: number) => [topSpeed(s) / s, (2 * jumpVelocity(s)) / gravityFor(s)]; // radii per second, airtime
    const [speed, airtime] = feel(100);
    for (const size of [1e3, 1e5, 1e7]) {
        const [sp, air] = feel(size);
        assert.ok(Math.abs(sp / speed - 1) < 1e-9 && Math.abs(air / airtime - 1) < 1e-9, `size ${size}: ${sp}, ${air}`);
    }
    for (const f of [topSpeed, jumpVelocity, gravityFor]) assert.ok(Math.abs(f(100.001) / f(100) - 1) < 1e-4);
});

test('titles and progress', () => {
    assert.equal(titleIndex(1), 0);
    assert.equal(titleIndex(2), 1);
    assert.equal(titleIndex(1e9), TITLES.length - 1);
    assert.equal(titleProgress(1), 0);
    assert.ok(titleProgress(1.5) > 0 && titleProgress(1.5) < 1);
    assert.equal(titleProgress(1e9), 1);
});

test('stamina: full bar sprints ~3 s, empty bar leaves you winded until it refills a bit', () => {
    const dt = 1 / 60;
    let s: Stamina = { level: 1, exhausted: false, rest: 0 };
    let t = 0;
    for (let r = stepStamina(s, true, dt); r.sprinting; r = stepStamina(s, true, dt)) {
        s = r.next;
        t += dt;
    }
    assert.ok(Math.abs(t - SPRINT_SECONDS) < 0.05, `sprinted ${t}s`);
    s = stepStamina(s, true, dt).next;
    assert.ok(s.exhausted);
    while (s.level < STAMINA_RECOVER_AT - 0.01) {
        const r = stepStamina(s, true, dt); // holding the key while winded does nothing
        assert.equal(r.sprinting, false);
        s = r.next;
    }
    for (let i = 0; i < 120; i++) s = stepStamina(s, false, dt).next;
    assert.ok(!s.exhausted && stepStamina(s, true, dt).sprinting);
});

test('combo bonus is capped', () => {
    assert.equal(comboBonus(0), 1);
    assert.equal(comboBonus(100), comboBonus(20));
});

test('spawn budget stays bounded', () => {
    for (const size of [1, 5, 30, 80, 200, 500]) {
        const r = populateRadius(size, 200);
        const total = chunkObjectCap(size, 200) * (2 * r + 1) ** 2;
        assert.ok(total <= 2700, `size ${size}: ${total}`);
        assert.ok(chunkObjectCap(size, 200) >= 4);
    }
});

test('object sizes span bite-sized to bigger-than-you', () => {
    assert.ok(Math.abs(pickObjectSize(10, 0) - 1.2) < 1e-9);
    assert.ok(Math.abs(pickObjectSize(10, 1) - 26) < 1e-9);
});

test('eat rule leaves near-equal objects as obstacles', () => {
    assert.ok(canEat(50, 100));
    assert.ok(!canEat(80, 100));
});
