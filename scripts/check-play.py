# Autopilot play from 1 m to 10000 km against the dev server (python scripts/check-play.py); screenshots land in output/playwright/.
import time, json
from playwright.sync_api import sync_playwright
RUN = """async n => { const g = window.game, p = g.player, e = g.engine; const t0 = performance.now();
  const st = window.__st ??= { stuck: 0, last: p.size, maxStuck: 0, nan: 0 };
  for (let i = 0; i < n; i++) {
    const s = g.snack;
    const slow = p.velocity.length() < p.currentTopSpeed * 0.25;
    st.slow = slow ? (st.slow || 0) + 1 : 0;
    if (st.slow > 40 && !(st.detour > 0)) { st.detour = 90; const r = Math.random() * 6.283; st.dir = [Math.cos(r), Math.sin(r)]; }
    if (st.detour > 0) { st.detour--; p.touchMove.set(st.dir[0], st.dir[1]); }
    else if (s) { const dx = s.position.x - p.mesh.position.x, dz = s.position.z - p.mesh.position.z, L = Math.hypot(dx, dz) || 1;
      const a = e.cameraAngle, x = dx / L, z = dz / L;
      p.touchMove.set(x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)); }
    else p.touchMove.set(0, -1);
    g.step(1 / 60);
    if (!isFinite(p.mesh.position.x + p.mesh.position.y + e.camera.position.y)) st.nan++;
    if (p.size > st.last * 1.001) { st.last = p.size; st.stuck = 0; } else if (++st.stuck % 240 === 0) p.attemptJump();
    st.maxStuck = Math.max(st.maxStuck, st.stuck);
    if (p.size > 1.1e7) break;
  }
  return { size: p.size, eaten: g.eaten, attached: p.attached.length, ms: Math.round(performance.now() - t0), stuck: st.stuck, maxStuck: st.maxStuck, nan: st.nan,
    camRatio: +(e.currentCamDistance / p.size).toFixed(2), rain: g.weather.isRaining, objs: g.world.collidables.length }; }"""
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='msedge', args=['--use-angle=d3d11'])
    pg = b.new_page(viewport={'width': 800, 'height': 450})
    pg.add_init_script("Element.prototype.requestPointerLock = () => Promise.resolve(); window.requestAnimationFrame = () => 0;")
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:5173'); pg.wait_for_function('window.game')
    pg.evaluate("window.game.engine.autoQuality=false; window.game.startGame('free'); window.game.audio.suspend?.()")
    shots = [3, 30, 600, 40000, 1e7]; start = time.time()
    while time.time() - start < 900:
        r = pg.evaluate(RUN, 3600); print(json.dumps(r), flush=True)
        while shots and r['size'] >= shots[0]:
            pg.evaluate("window.game.engine.render(0.016)"); pg.screenshot(path=f"output/playwright/play-{shots.pop(0):g}.png")
        if r['size'] > 1e7 or r['stuck'] > 3600 * 3: break
    print('errors', errs, 'seconds', round(time.time() - start))
    b.close()
