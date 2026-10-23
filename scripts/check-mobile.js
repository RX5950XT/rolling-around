async page => {
    const context = await page.context().browser().newContext({
        viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce',
    });
    const phone = await context.newPage();
    const errors = [];
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    phone.on('pageerror', e => errors.push(e.message));
    await phone.addInitScript(() => {
        Element.prototype.requestPointerLock = () => Promise.resolve();
        // Render only on demand; touch and physics checks do not need an animation loop.
        window.requestAnimationFrame = () => 0;
    });
    try {
        await phone.goto('http://127.0.0.1:5191/');
        await phone.waitForFunction(() => window.game);
        check(await phone.evaluate(() => document.body.classList.contains('touch')), 'touch mode not detected');
        await phone.screenshot({ path: 'output/playwright/phone-menu.png' });
        await phone.getByRole('button', { name: '限時挑戰' }).tap();
        await phone.evaluate(() => {
            const g = window.game;
            g.hud.setSize(g.player.size);
            g.hud.setStamina(0.6, false, true);
            document.getElementById('banner').replaceChildren();
            for (let i = 0; i < 4; i++) g.world.update(0);
            for (let i = 0; i < 90; i++) g.engine.updateCamera(g.player.mesh.position, g.player.size, 1 / 60, g.terrain);
            g.engine.render(0);
        });
        const cdp = await context.newCDPSession(phone);
        const points = new Map();
        const touch = async (type, id, x, y) => {
            if (type === 'touchEnd' || type === 'touchCancel') points.delete(id);
            else points.set(id, { id, x, y });
            await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...points.values()] });
            await phone.waitForTimeout(35);
        };
        const state = () => phone.evaluate(() => ({
            move: window.game.player.touchMove.length(), sprint: window.game.player.touchSprint,
            angle: window.game.engine.cameraAngle, jump: window.game.player.verticalVelocity,
        }));
        await touch('touchStart', 1, 80, 580);
        await touch('touchMove', 1, 80, 540);
        check((await state()).move > 0.5, 'joystick does not steer');
        const angle = (await state()).angle;
        await touch('touchStart', 2, 260, 430);
        await touch('touchMove', 2, 300, 445);
        check((await state()).angle !== angle && (await state()).move > 0.5, 'simultaneous steering and looking failed: ' + JSON.stringify({before: angle, after: await state()}));
        const dash = await phone.locator('#touch-dash').boundingBox();
        await touch('touchStart', 3, dash.x + dash.width / 2, dash.y + dash.height / 2);
        check((await state()).sprint, 'sprint hold failed');
        await phone.evaluate(() => { window.game.player.isGrounded = true; });
        const jump = await phone.locator('#touch-jump').boundingBox();
        await touch('touchStart', 4, jump.x + jump.width / 2, jump.y + jump.height / 2);
        check((await state()).jump > 0, 'jump with other fingers held failed');
        for (const id of [4, 3, 2, 1]) await touch('touchEnd', id);
        check((await state()).move === 0 && !(await state()).sprint, 'release leaves input active');
        await touch('touchStart', 3, dash.x + 30, dash.y + 30);
        await touch('touchMove', 3, 20, 300);
        check((await state()).sprint, 'sprint lost capture outside button');
        await touch('touchEnd', 3);
        check(!(await state()).sprint, 'sprint release outside button stuck');
        await touch('touchStart', 1, 80, 580);
        await touch('touchMove', 1, 80, 540);
        await touch('touchCancel', 1);
        check((await state()).move === 0, 'cancel leaves steering active');
        await touch('touchStart', 1, 80, 580);
        await touch('touchMove', 1, 80, 540);
        await touch('touchStart', 3, dash.x + 30, dash.y + 30);
        await phone.evaluate(() => window.game.pauseGame());
        check((await state()).move === 0 && !(await state()).sprint, 'pause leaves input active');
        check(await phone.locator('#touch-controls').isHidden(), 'pause leaves touch buttons on top');
        for (const id of [3, 1]) await touch('touchEnd', id);
        const on = await phone.evaluate(() => window.game.audio.musicOn);
        await phone.locator('#music-btn').tap();
        check(await phone.evaluate(() => window.game.audio.musicOn) !== on, 'mobile music button failed');
        await phone.locator('#resume-btn').tap();
        check((await state()).move === 0 && !(await state()).sprint, 'resume restores stale input');
        await touch('touchStart', 1, 80, 580);
        await touch('touchMove', 1, 80, 540);
        await phone.evaluate(() => window.dispatchEvent(new Event('blur')));
        check((await state()).move === 0, 'blur leaves steering active');
        await touch('touchEnd', 1);
        await touch('touchStart', 1, 80, 580);
        await touch('touchMove', 1, 80, 540);
        await phone.setViewportSize({ width: 844, height: 390 });
        await phone.waitForTimeout(80);
        check((await state()).move === 0, 'orientation resize leaves steering active');
        await touch('touchEnd', 1);

        const layouts = [];
        for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024]]) {
            await phone.setViewportSize({ width, height });
            await phone.waitForTimeout(80);
            const result = await phone.evaluate(() => {
                const box = selector => document.querySelector(selector).getBoundingClientRect();
                const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
                const controls = ['.size-card', '.hud-right', '#timer', '#touch-jump', '#touch-dash', '#stamina', '#joystick'];
                const outside = controls.filter(s => {
                    const r = box(s);
                    return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight;
                });
                const pairs = [['.size-card', '.hud-right'], ['.size-card', '#timer'], ['#timer', '.hud-right'],
                    ['#touch-jump', '#touch-dash'], ['#stamina', '#touch-jump'], ['#stamina', '#touch-dash'],
                    ['#joystick', '#touch-dash']];
                const collisions = pairs.filter(([a, b]) => overlap(box(a), box(b)));
                return { width: innerWidth, clientWidth: document.documentElement.clientWidth, visual: visualViewport.width, scale: visualViewport.scale, height: innerHeight, outside, collisions, overflow: document.body.scrollWidth > innerWidth };
            });
            check(Math.abs(result.width - width) <= 1 && !result.outside.length && !result.collisions.length && !result.overflow, JSON.stringify(result));
            layouts.push(result);
            if (width === 390 || width === 844) {
                await phone.evaluate(() => { window.game.hud.hideHint(); window.game.engine.render(0); });
                await phone.screenshot({ path: `output/playwright/phone-${width}.png` });
            }
            await phone.locator('#pause-btn').tap();
            await phone.screenshot({ path: `output/playwright/phone-pause-${width}.png` });
            check(await phone.locator('#resume-btn').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight), 'pause resume button below screen');
            await phone.locator('#resume-btn').tap();
        }
        await phone.setViewportSize({ width: 844, height: 390 });
        await phone.waitForTimeout(80);
        await phone.evaluate(() => {
            document.body.style.setProperty('--safe-side', '44px');
            document.body.style.setProperty('--safe-right', '44px');
            document.body.style.setProperty('--safe-top', '30px');
            document.body.style.setProperty('--safe-bottom', '34px');
            window.game.pauseGame();
        });
        await phone.locator('#resume-btn').tap();
        const insetSafe = await phone.evaluate(() => {
            const left = document.querySelector('.size-card').getBoundingClientRect();
            const right = document.getElementById('touch-jump').getBoundingClientRect();
            return left.left >= 43.5 && left.top >= 29.5 && right.right <= innerWidth - 43.5 && right.bottom <= innerHeight - 33.5;
        });
        check(insetSafe, 'simulated notch/home indicator covered UI');
        await phone.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
            delete document.hidden;
        });
        check(await phone.evaluate(() => window.game.isPaused), 'background did not pause');
        await phone.evaluate(() => { window.game.resumeGame(); window.game.endGame(); });
        check(await phone.locator('#touch-controls').isHidden(), 'end leaves touch buttons visible');
        await phone.locator('#again-btn').scrollIntoViewIfNeeded();
        check(await phone.locator('#again-btn').isVisible(), 'result button unreachable');
        check(!errors.length, errors.join('\n'));
        return { layouts, gestures: 'move/look/sprint/jump/release/cancel/capture/pause/resume/blur/resize/music/end passed', pageErrors: errors };
    } finally { await context.close(); }
}
