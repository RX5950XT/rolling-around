import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BUILDINGS, buildingBoxes, boxContact, districtAt, planBlock, type BuildingType } from '../src/worldLayout.ts';
import { createBuilding } from '../src/Buildings.ts';
import { canEat, sphereVolume } from '../src/rules.ts';

const types = Object.keys(BUILDINGS) as BuildingType[];

test('a seed preserves a block across visits, another seed changes its contents', () => {
    assert.deepEqual(planBlock(123, -3, 2, 0), planBlock(123, -3, 2, 0));
    assert.notDeepEqual(planBlock(123, 0, 0, 0), planBlock(124, 0, 0, 0));
    const districts = new Set<string>();
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) districts.add(districtAt(123, x, z, 0));
    assert.equal(districts.size, 4);
    assert.equal(districtAt(123, -4, 2, 0), districtAt(123, -3, 3, 0));
});

test('shops contain goods, farms contain livestock, roads have bounded traffic', () => {
    const shop = planBlock(42, 0, 0, 0);
    assert.equal(shop.objects.filter(o => o.building).length, 4);
    assert.ok(shop.objects.some(o => o.id === 'donut'));
    assert.ok(!shop.objects.some(o => ['cow', 'sheep', 'ufo', 'planet'].includes(o.id)));
    for (const car of shop.objects.filter(o => o.id === 'car')) {
        assert.equal(car.z, 2.5);
        assert.equal(car.route?.minZ, car.route?.maxZ);
    }
    for (const o of shop.objects.filter(o => !o.route && !o.building)) assert.ok(Math.abs(o.z) >= 10);
});

test('growth changes the scene from shops to towers to regional towns and mountains', () => {
    assert.ok(planBlock(42, 0, 0, 0).objects.some(o => o.id === 'bakery'));
    assert.ok(planBlock(42, 0, 0, 1).objects.some(o => o.building && o.id === 'skyscraper'));
    const region = planBlock(42, 0, 0, 3).objects;
    assert.ok(region.some(o => o.id === 'city'));
    assert.ok(region.every(o => ['city', 'skyscraper', 'mountain', 'pine', 'tree', ...types].includes(o.id)));
});

test('both doors and the central aisle are open for the starting ball', () => {
    for (const type of types) for (let z = -12; z <= 12; z += 0.2) {
        for (const b of buildingBoxes(type)) assert.equal(boxContact(0, 1, z, 1, b), null, `${type} door blocked at ${z}`);
    }
});

test('walls stop the ball; jumping hits the lintel; roofs support from above', () => {
    const boxes = buildingBoxes('bakery');
    const wall = boxContact(7, 1, 0, 1, boxes[1]);
    assert.ok(wall && wall.x < 0 && wall.depth > 0);
    assert.ok(boxes.some(b => boxContact(4, 1, 7.6, 1, b)));
    assert.ok(boxes.some(b => boxContact(0, 5.7, 7.6, 1, b)?.y === -1));
    const roof = boxes[boxes.length - 1];
    assert.equal(boxContact(0, 8.5, 0, 1, roof)?.y, 1);
    assert.equal(boxContact(0, 6.5, 0, 1, roof)?.y, -1);
    assert.equal(boxContact(0, 1, 0, 3.2, boxes[2]), null);
    assert.ok(boxes.some(b => boxContact(0, 4, 7.6, 4.3, b)), 'oversized ball cannot fit through the door');
});

test('a growing indoor ball can eat the building before it no longer fits the doorway', () => {
    for (const type of types) for (const scale of [1, 4, 16]) {
        const building = createBuilding(type, scale);
        for (let radius = 1; radius <= 8; radius += 0.1) {
            if (canEat(building.userData.volume, sphereVolume(radius * scale))) continue;
            assert.ok(buildingBoxes(type).every(b => !boxContact(0, radius * 0.9, 7.6, radius, b)), `${type} trapped at ${radius}`);
        }
    }
});

test('visible walls and colliders agree; buildings share geometry without sharing roof visibility', () => {
    const a = createBuilding('bakery', 1), b = createBuilding('bakery', 4);
    assert.deepEqual(a.userData.boxes, buildingBoxes('bakery'));
    assert.equal(a.userData.volume * 64, b.userData.volume);
    assert.equal(a.userData.height * 4, b.userData.height);
    assert.equal(a.children[0].type, 'Mesh');
    const roofA = a.children.find(c => c.userData.roof)!;
    roofA.visible = false;
    assert.equal(b.children.find(c => c.userData.roof)!.visible, true);
});

test('each building has a distinct facade, correct catalogue kind and inexpensive shared geometry', () => {
    const signatures = new Set<string>();
    for (const type of types) {
        const a = createBuilding(type, 1), b = createBuilding(type, 4);
        assert.equal(a.userData.kind, type);
        assert.equal(a.children.length, 2, 'details should be merged into the facade and roof');
        assert.ok(a.children[0] instanceof THREE.Mesh && b.children[0] instanceof THREE.Mesh);
        assert.equal(a.children[0].geometry, b.children[0].geometry);
        const geometry = a.children[0].geometry;
        signatures.add(JSON.stringify([Array.from(geometry.attributes.position.array), Array.from(geometry.attributes.color.array)]));
    }
    assert.equal(signatures.size, types.length);
});

test('all seven buildings appear and their interior goods match their purpose', () => {
    const found = new Set<string>();
    for (let tier = 0; tier < 2; tier++) for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
        const { objects } = planBlock(42, x, z, tier);
        for (const b of objects.filter(p => p.building)) {
            found.add(b.building!);
            const goods = objects.filter(p => !p.building && Math.abs(p.x - b.x) <= 6 && Math.abs(p.z - b.z) <= 6);
            const allowed = new Set(BUILDINGS[b.building!].contents.map(([id]) => id));
            assert.equal(goods.length, 12);
            assert.ok(goods.every(p => allowed.has(p.id)), `wrong goods in ${b.building}`);
        }
    }
    assert.deepEqual([...found].sort(), [...types].sort());
});

test('all generated blocks fit their bounds and the object budget', () => {
    for (let tier = 0; tier < 8; tier++) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
        const { objects } = planBlock(123, x, z, tier);
        assert.ok(objects.length < 200);
        for (const o of objects) {
            assert.ok(Number.isFinite(o.size) && o.size > 0);
            assert.ok(Math.abs(o.x) + o.size / 2 <= 50 && Math.abs(o.z) + o.size / 2 <= 50);
        }
    }
});
