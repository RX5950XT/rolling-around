import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/Player.ts';
import { comboBonus, GROWTH_EFFICIENCY, radiusFromVolume } from '../src/rules.ts';

function playerAt(volume: number): Player {
    const player = Object.create(Player.prototype) as Player;
    Object.assign(player, { mesh: new THREE.Group(), ballMesh: new THREE.Mesh(),
        volume, minVolume: 1, size: radiusFromVolume(volume), attached: [] });
    return player;
}

function item(volume: number, size = 1): THREE.Object3D {
    const object = new THREE.Object3D();
    object.userData = { volume, size };
    object.position.set(2, 0, 0);
    return object;
}

test('losing a collected object removes only the growth it contributed, including combo bonuses', () => {
    for (const combo of [1, 20]) {
        const player = playerAt(100), object = item(10);
        const growth = 10 * GROWTH_EFFICIENCY * comboBonus(combo);
        player.attachObject(object, growth);
        assert.equal(player.volume, 100 + growth);
        assert.equal(player.knockOff(1).length, 1);
        assert.ok(Math.abs(player.volume - 100) < 1e-10);
        assert.equal(object.parent, null);
        assert.equal(player.knockOff(1).length, 0);
    }
});

test('the attachment limit keeps absorbed growth and only drops the newest visible objects', () => {
    const player = playerAt(100);
    const objects = Array.from({ length: 181 }, () => item(10));
    for (const object of objects) player.attachObject(object, 0.5);
    assert.equal(player.mesh.children.length, 180);
    assert.equal(objects[0].parent, null);
    assert.equal(player.volume, 190.5);
    assert.equal(player.knockOff(200).length, 180);
    assert.equal(player.volume, 100.5);
});

test('tiny objects are absorbed without becoming detachable', () => {
    const player = playerAt(100);
    player.attachObject(item(1, 0.01), 0.7);
    assert.equal(player.knockOff(1).length, 0);
    assert.equal(player.volume, 100.7);
});
