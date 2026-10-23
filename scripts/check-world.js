async page => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.addInitScript(() => { Element.prototype.requestPointerLock = () => Promise.resolve(); });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:5191');
    await page.waitForFunction(() => window.game);
    const result = await page.evaluate(() => {
        const g = window.game, p = g.player, w = g.world;
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        g.startGame('free'); g.dispose();
        document.getElementById('banner').style.display = 'none';
        w.seed = 42;
        for (const [key, chunk] of w.activeChunks) w.destroyChunk(key, chunk);
        for (let i = 0; i < 4; i++) w.update(0);
        const building = w.collidables.find(o => o.userData.building && o.position.x === -24 && o.position.z === -24);
        check(building, 'starting shop missing');
        const setPosition = (x, z, y) => {
            p.mesh.position.set(x, y ?? w.getTerrainHeight(x, z) + p.size * 0.9, z);
            p.velocity.set(0, 0, 0); p.verticalVelocity = 0; p.isGrounded = true;
        };
        setPosition(-24, -12); p.touchMove.set(0, -1);
        for (let i = 0; i < 220 && p.mesh.position.z > -37; i++) {
            p.update(1 / 60, 0, g.rollingSurface, w.waterLevel); g.checkCollisions(1 / 60);
        }
        check(p.mesh.position.z < -36, 'cannot roll through both doors');
        check(Math.abs(p.mesh.position.x + 24) < 0.1, 'door unexpectedly pushes sideways');
        p.touchMove.set(-1, 0); p.touchSprint = true;
        setPosition(-12, -24);
        let minX = Infinity;
        for (let i = 0; i < 35; i++) { g.step(0.1); minX = Math.min(minX, p.mesh.position.x); }
        check(minX > -15.3, 'sprint tunneled through side wall: ' + minX);
        p.touchMove.set(0, 0); p.touchSprint = false;
        const top = building.position.y + building.userData.height;
        setPosition(-24, -24, top + p.size * 0.9);
        for (let i = 0; i < 30; i++) { p.update(1 / 60, 0, g.rollingSurface, w.waterLevel); g.checkCollisions(1 / 60); }
        check(p.mesh.position.y >= top + p.size * 0.89, 'fell through roof');
        p.mesh.position.x = building.position.x + 12;
        const beforeFall = p.mesh.position.y;
        p.update(1 / 60, 0, g.rollingSurface, w.waterLevel);
        check(!p.isGrounded && p.mesh.position.y < beforeFall && p.mesh.position.y > beforeFall - 1, 'stepping off roof snapped down');
        for (let i = 0; i < 60; i++) w.updateMovers(1 / 60);
        check(w.movingEntities.every(o => !o.userData.route || (o.position.x >= o.userData.route.minX && o.position.x <= o.userData.route.maxX
            && o.position.z >= o.userData.route.minZ && o.position.z <= o.userData.route.maxZ)), 'traffic escaped its route');
        setPosition(0, 0);
        g.engine.camera.position.set(39, 34, 48); g.engine.camera.lookAt(0, 0, 0);
        g.engine.render(0);
        window.probeBuilding = building;
        return { doors: 'pass', sprintWall: 'pass', roof: 'pass', routes: 'pass', objects: w.collidables.length };
    });
    await page.screenshot({ path: 'output/playwright/town.png' });
    await page.evaluate(() => {
        const g = window.game, b = window.probeBuilding;
        g.player.mesh.position.set(b.position.x, b.position.y + 0.9, b.position.z);
        g.world.updateVisibility();
        g.engine.cameraAngle = 0; g.engine.cameraPitch = 0.6;
        for (let i = 0; i < 90; i++) g.engine.updateCamera(g.player.mesh.position, 1, 1 / 60, g.terrain);
        g.engine.render(0);
    });
    await page.screenshot({ path: 'output/playwright/interior.png' });
    const growth = await page.evaluate(() => {
        const g = window.game, p = g.player, w = g.world, b = window.probeBuilding;
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        p.grow((4 / 3) * Math.PI * 12 ** 3 - p.volume);
        g.checkCollisions(0);
        check(!w.collidables.includes(b), 'edible building remains tracked');
        check(b.parent === p.mesh, 'building was not attached');
        const stages = [];
        for (const size of [12, 30.1, 150.1, 600.1]) {
            p.grow((4 / 3) * Math.PI * size ** 3 - p.volume);
            p.waterDepth = 0;
            const pos = p.mesh.position.clone(), ground = w.getTerrainHeight(pos.x, pos.z);
            for (let i = 0; i < 4; i++) w.update(0);
            check(p.mesh.position.distanceTo(pos) < 1e-8, 'growth moved the player');
            check(Math.abs(w.getTerrainHeight(pos.x, pos.z) - ground) < 1e-7, 'ground jumped at growth');
            check(w.collidables.length < 2800, 'unbounded world population');
            check(w.collidables.every(o => Number.isFinite(o.position.y)), 'invalid object height');
            stages.push({ size, tier: w.worldTier, objects: w.collidables.length,
                kinds: [...new Set(w.collidables.map(o => o.userData.kind))] });
        }
        const old = new Set(w.collidables);
        p.mesh.position.x += w.chunkSize * 12;
        for (let i = 0; i < 4; i++) w.update(0);
        check(!w.collidables.some(o => old.has(o)), 'unloaded objects retained');
        check(w.movingEntities.every(o => w.collidables.includes(o)), 'stale movers');
        return { eatBuilding: 'pass', growth: stages, unload: 'pass' };
    });
    await page.setViewportSize({ width: 390, height: 360 });
    await page.evaluate(() => {
        const g = window.game, p = g.player.mesh.position, k = g.world.terrainScale;
        for (let i = 0; i < 90; i++) g.engine.updateCamera(p, g.player.size, 1 / 60, g.terrain);
        g.hud.setSize(g.player.size);
        document.getElementById('feed').replaceChildren();
        const ground = g.world.getTerrainHeight(p.x, p.z);
        g.engine.camera.position.set(p.x + 35 * k, ground + 35 * k, p.z + 35 * k);
        g.engine.camera.lookAt(p.x, g.world.getTerrainHeight(p.x, p.z), p.z);
        // The probe jumps several tiers instantly; advance the same fog easing used during play.
        g.weather.update(1, g.engine.cameraDistance * g.player.size, g.world.worldRadius);
        g.engine.render(0);
    });
    await page.screenshot({ path: 'output/playwright/region-mobile.png' });
    if (errors.length) throw new Error(errors.join('\n'));
    return { ...result, ...growth, pageErrors: errors };
}
