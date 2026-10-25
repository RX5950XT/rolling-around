// Run in the existing development tab via import('/scripts/check-experience.js').
export async function checkExperience() {
    const g = window.game;
    const passed = [];
    const check = (ok, name) => { if (!ok) throw new Error(name); passed.push(name); };
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const $ = id => document.getElementById(id);
    const originalBest = localStorage.getItem('rolling-best');
    g.disposed = true;
    g.engine.requestPointerLock = () => {};
    try {
        key('keydown', 'Space');
        check(g.player.verticalVelocity === 0, 'menu does not jump');
        document.querySelector('[data-mode="free"]').click();
        check(!g.isPaused && g.player.enabled && g.engine.inputEnabled, 'start free mode');
        for (let i = 0; i < 5; i++) g.world.update(0);
        const before = g.player.mesh.position.clone();
        key('keydown', 'KeyW');
        for (let i = 0; i < 12; i++) g.step(1 / 60);
        key('keyup', 'KeyW');
        check(g.player.mesh.position.distanceTo(before) > 0.1, 'keyboard rolls the ball');

        key('keydown', 'KeyQ');
        key('keydown', 'ShiftLeft');
        g.pauseGame();
        check(!g.engine.inputEnabled && Object.keys(g.player.keys).length === 0, 'pause clears keyboard input');
        key('keydown', 'KeyE');
        key('keydown', 'Space');
        g.resumeGame();
        const angle = g.engine.cameraAngle;
        g.engine.updateCamera(g.player.mesh.position, g.player.size, 0.1, g.terrain);
        check(g.engine.cameraAngle === angle, 'resume has no stuck camera turn');
        key('keydown', 'KeyQ');
        window.dispatchEvent(new Event('blur'));
        check(g.isPaused && !g.engine.camKeys.left, 'focus loss pauses and clears camera input');
        g.resumeGame();

        g.hud.setSize(1);
        g.hud.setSize(1000);
        check($('size-unit').textContent === 'km', 'same formatted number updates its unit');
        g.hud.setSize(1.999);
        g.hud.setSize(2);
        check($('title-val').textContent === '雪球', 'rounded size does not delay title change');
        g.hud.setCombo(20);
        g.hud.setComboTime(0.7);
        check($('combo-label').textContent.includes('30%') && $('combo-fill').style.transform === 'scaleX(0.5)', 'combo bonus and countdown agree');

        g.updateGuide(1);
        check(g.snack && g.world.collidables.includes(g.snack), 'guide chooses live edible food');
        check(g.snack.userData.volume < g.player.volume * 0.6, 'guide uses actual eating threshold');
        const target = g.snack;
        g.world.forget(new Set([target]));
        target.removeFromParent();
        g.updateGuide(0);
        check($('snack-guide').classList.contains('hidden'), 'eaten or unloaded target clears immediately');
        g.updateGuide(1);

        g.pauseGame();
        $('finish-btn').click();
        check(g.ended && !$('end-screen').classList.contains('hidden') && $('pause-screen').classList.contains('hidden'), 'free mode reaches visible result');
        check($('end-heading').textContent !== '時間到！', 'voluntary finish uses correct heading');
        check(JSON.parse(localStorage.getItem('rolling-best')).free >= g.player.size, 'free mode saves its record');
        const eaten = g.eaten;
        g.endGame(false);
        check(g.eaten === eaten && g.isPaused, 'ending twice keeps result stable');
        g.audio.suspend();
        return passed;
    } finally {
        if (originalBest === null) localStorage.removeItem('rolling-best');
        else localStorage.setItem('rolling-best', originalBest);
    }
}

export async function checkWorldScales() {
    const { canEat, sphereVolume } = await import('/src/rules.ts');
    const g = window.game, p = g.player, w = g.world;
    const results = [];
    g.disposed = true;
    g.engine.requestPointerLock = () => {};
    g.startGame('free');
    for (const size of [150.01, 600.01, 9600.01, 38400.01, 614400.01]) {
        for (const [key, chunk] of w.activeChunks) w.destroyChunk(key, chunk);
        p.grow(sphereVolume(size) - p.volume);
        p.waterDepth = 0;
        p.mesh.position.set(0, w.getTerrainHeight(0, 0) + p.size * 0.9, 0);
        for (let i = 0; i < 6; i++) w.update(0);
        const solids = w.collidables.filter(o => !o.userData.powerup);
        const food = solids.find(o => !o.userData.motion && canEat(o.userData.volume, p.volume));
        if (!food || solids.length > 2600) throw new Error(`invalid supply at ${size}`);
        const volume = p.volume;
        p.mesh.position.copy(food.position);
        p.mesh.position.y += p.size * 0.9;
        g.checkCollisions(0);
        if (w.collidables.includes(food) || p.volume <= volume) throw new Error(`cannot eat at ${size}`);
        const kinds = [...new Set(solids.map(o => o.userData.kind))];
        if (size >= 38400 && !kinds.includes('galaxy')) throw new Error('missing space objects');
        results.push({ size, objects: solids.length, eaten: food.userData.kind, kinds });
    }
    g.audio.suspend();
    g.started = false; // Test-only scale jumps must not become saved records on reload.
    return results;
}

export function checkLayout() {
    const selectors = ['.size-card', '.hud-right', '#timer', '#combo', '#snack-guide', '#stamina',
        '#touch-jump', '#touch-dash', '#joystick'];
    const boxes = selectors.map(selector => ({ selector, node: document.querySelector(selector) }))
        .filter(({ node }) => node.checkVisibility({ checkOpacity: true }))
        .map(({ selector, node }) => ({ selector, r: node.getBoundingClientRect() }));
    for (const { selector, r } of boxes) {
        if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
            throw new Error(`${selector} outside ${innerWidth}x${innerHeight}`);
        }
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (Math.min(a.r.right, b.r.right) > Math.max(a.r.left, b.r.left)
            && Math.min(a.r.bottom, b.r.bottom) > Math.max(a.r.top, b.r.top)) {
            throw new Error(`${a.selector} overlaps ${b.selector} at ${innerWidth}x${innerHeight}`);
        }
    }
    return { width: innerWidth, height: innerHeight, checked: boxes.length };
}

export async function checkCameraVisibility() {
    const THREE = await import('three');
    const engine = window.game.engine, scene = engine.scene;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 1), new THREE.MeshBasicMaterial());
    mesh.userData.height = 5;
    const group = new THREE.Group();
    group.position.z = 5;
    group.add(mesh);
    engine.scene = new THREE.Scene();
    engine.scene.add(group);
    engine.scene.updateMatrixWorld(true);
    try {
        const from = new THREE.Vector3(), direction = new THREE.Vector3(0, 0, 1);
        if (!engine.findSafeDistance(from, direction, 1, 10)) throw new Error('visible obstacle ignored');
        group.visible = false;
        if (engine.findSafeDistance(from, direction, 1, 10) !== 0) throw new Error('hidden parent obstructs camera');
        return 'visible obstacle blocks; hidden parent does not';
    } finally {
        engine.scene = scene;
        mesh.geometry.dispose();
        mesh.material.dispose();
    }
}
