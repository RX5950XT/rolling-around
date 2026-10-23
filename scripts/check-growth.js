async page => {
    await page.setViewportSize({ width: 800, height: 450 });
    await page.addInitScript(() => {
        Element.prototype.requestPointerLock = () => Promise.resolve();
        window.requestAnimationFrame = () => 0;
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5191');
    await page.waitForFunction(() => window.game);
    const buildings = await page.evaluate(async () => {
        const { createBuilding } = await import('/src/Buildings.ts');
        const { BUILDINGS } = await import('/src/worldLayout.ts');
        const g = window.game, p = g.player, w = g.world;
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        g.startGame('free'); g.dispose();
        for (const [key, chunk] of w.activeChunks) w.destroyChunk(key, chunk);
        const chunk = w.generateChunk(0, 0, '0,0'), ground = w.getTerrainHeight(0, 0);
        const place = (x, z, y = ground + 0.9) => {
            p.mesh.position.set(x, y, z); p.velocity.set(0, 0, 0); p.verticalVelocity = 0; p.isGrounded = true;
        };
        const checked = [];
        for (const type of Object.keys(BUILDINGS)) {
            const b = createBuilding(type, 1);
            b.position.set(0, ground, 0); b.rotation.y = Math.PI;
            chunk.add(b); w.collidables = [b];
            place(0, 12); p.touchMove.set(0, -1);
            for (let i = 0; i < 200 && p.mesh.position.z > -12; i++) {
                p.update(1 / 60, 0, g.rollingSurface, w.waterLevel); g.checkCollisions(1 / 60);
            }
            check(p.mesh.position.z < -12 && Math.abs(p.mesh.position.x) < 0.01, type + ' blocked doorway');
            p.touchMove.set(0, 0);
            for (const x of [0, 7]) {
                const roofHeight = x === 0 ? b.userData.height : BUILDINGS[type].height + 0.8;
                const y = ground + roofHeight;
                check(Math.abs(w.getRollingHeight(x, 0, y + 0.1) - y) < 1e-7, type + ' wrong roof support');
                place(x, 0, y + 0.9);
                for (let i = 0; i < 6; i++) { p.update(1 / 60, 0, g.rollingSurface, w.waterLevel); g.checkCollisions(1 / 60); }
                check(p.mesh.position.y >= y + 0.89, type + ' falls through roof');
            }
            b.removeFromParent(); w.forget(new Set([b])); checked.push(type);
        }
        Object.keys(BUILDINGS).forEach((type, i) => {
            const b = createBuilding(type, 1), x = (i % 4 - 1.5) * 24, z = Math.floor(i / 4) * 30 - 15;
            b.position.set(x, ground, z); b.rotation.y = Math.PI;
            chunk.add(b); w.collidables.push(b);
        });
        p.mesh.visible = false;
        document.getElementById('ui-layer').style.display = 'none';
        document.getElementById('touch-controls').style.display = 'none';
        g.engine.camera.position.set(74, ground + 66, 100); g.engine.camera.lookAt(0, ground + 5, 0);
        g.weather.update(1, 180, 500); g.engine.render(0);
        return checked;
    });
    await page.screenshot({ path: 'output/playwright/building-variety.png' });
    const growth = await page.evaluate(async () => {
        const { canEat, sphereVolume, radiusFromVolume } = await import('/src/rules.ts');
        const g = window.game, p = g.player, w = g.world;
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        const results = [];
        p.mesh.visible = true; w.seed = 42;
        for (const radius of [1, 5.01, 30.01, 150.01, 600.01, 2400.01, 9600.01, 614400.01]) {
            for (const [key, chunk] of w.activeChunks) w.destroyChunk(key, chunk);
            p.grow(sphereVolume(radius) - p.volume); p.waterDepth = 0;
            p.mesh.position.set(0, w.getTerrainHeight(0, 0) + p.size * 0.9, 0);
            for (let i = 0; i < 4; i++) w.update(0);
            const solids = w.collidables.filter(o => !o.userData.powerup);
            const edible = solids.filter(o => canEat(o.userData.volume, p.volume));
            check(edible.length >= solids.length * 0.4, 'too few edible objects at ' + radius);
            check(solids.length <= 2600, 'object budget exceeded');
            const food = edible.find(o => !o.userData.building && !o.userData.motion);
            check(food, 'no ground food at ' + radius);
            const startVolume = p.volume;
            p.mesh.position.set(food.position.x, food.position.y + p.size * 0.9,
                food.position.z + p.size * 2 + food.userData.radius);
            p.velocity.set(0, 0, 0); p.verticalVelocity = 0; p.touchMove.set(0, -1);
            for (let i = 0; i < 180 && w.collidables.includes(food); i++) {
                p.update(1 / 60, 0, g.rollingSurface, w.waterLevel); g.checkCollisions(1 / 60);
            }
            p.touchMove.set(0, 0);
            check(!w.collidables.includes(food) && p.volume > startVolume, 'cannot roll up starter food at ' + radius);
            const landmark = solids.find(o => o.userData.kind === 'city');
            if (landmark) {
                const needed = radiusFromVolume(landmark.userData.volume / 0.6) * 1.01;
                const nextTierRadius = 150 * 4 ** (w.worldTier - 2);
                check(needed < nextTierRadius * 0.8, 'landmark target is unreachable');
                p.grow(sphereVolume(needed) - p.volume);
                p.mesh.position.copy(landmark.position); p.mesh.position.y += p.size * 0.9;
                g.checkCollisions(0);
                check(!w.collidables.includes(landmark), 'cannot eat city after growing');
            }
            results.push({ radius, tier: w.worldTier, edible: edible.length, total: solids.length });
        }
        return results;
    });
    if (errors.length) throw new Error(errors.join('\n'));
    return { buildings, growth, pageErrors: errors };
}
