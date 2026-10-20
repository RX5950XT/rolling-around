# CLAUDE.md

## 專案概述

Rolling Around 是一個基於 Three.js 的 3D 滾球收集遊戲（Katamari 風格），使用 TypeScript + Vite 開發，部署於 Render 靜態網站。

## 技術棧

- **Runtime**: TypeScript 6.x, ES2020
- **3D Engine**: Three.js 0.184.0
- **Bundler**: Vite 8.x
- **Test**: `npm test`（Node 內建 `node --test`，直接跑 `tests/*.test.ts`，零依賴）
- **Deploy**: Render Static Site
- **Build Output**: `dist/` directory

## 模組架構

### rules.ts（純函式，無 three.js 依賴）
所有可調的遊戲公式集中在此，`tests/rules.test.ts` 直接測：
- `topSpeed(size) = 12 × size^0.8`，`accelerationFor(top, retention)` 讓終端速度剛好等於 `topSpeed`
- `jumpVelocity` / `gravityFor`：跳躍高度約 5 個半徑，滯空時間到 100 m 前慢慢變長（0.8 → 3.3 秒）
- 100 m 之後（`SELF_SIMILAR_SIZE`）速度、跳躍、重力都改成跟大小成正比（世界本身也是等比放大），100 km 的球手感和 100 m 一樣；純次方公式會讓巨球變成慢動作（100 km 時一跳在空中飄 35 秒）
- `canEat(objVol, ballVol)`：物件體積 < 球體積 60% 才吃得下；`GROWTH_EFFICIENCY = 0.7`
- `COMBO_WINDOW = 1.4s`、`comboBonus`（最高 +30%）
- `TITLES` 稱號門檻（小彈珠 → 小行星 → … → 宇宙之球 300 km）、`titleProgress`（對數進度）
- 衝刺體力：`stepStamina()` 純函式（按住時 3 秒用完、休息 0.6 秒後 4 秒回滿、用光要回到 35% 才能再衝），`SPRINT_BOOST = 1.6`
- `populateRadius`、`chunkObjectCap`（每塊物件數 ∝ 1/size²，總量受 `OBJECT_BUDGET` 限制）、`pickObjectSize`
- `CHALLENGE_SECONDS = 240`

### GameManager.ts
遊戲主控制器：
- 初始化所有子系統（Engine, Player, WorldManager, WeatherSystem, AudioManager, Effects, HUD, TouchControls）
- 模式：`challenge`（限時 4 分鐘）/ `free`；最佳紀錄存 localStorage（`rolling-best`，讀取時驗證數值）
- 暫停：P / Esc / 失去 Pointer Lock / 切換分頁；重新開始用 `location.reload()`
- 主循環（`THREE.Timer`）；開始前在選單背後慢慢環繞鏡頭（`idle`）
- 碰撞：吃（`eat`）、彈開（`resolveBump`，高速撞大物會掉落最近黏上的物件）、道具（`collectPowerup`）、磁吸（`pull`）
- 連擊、稱號升級（`checkMilestone`）、計時器
- 開發模式下 `window.game` 可供除錯 / 自動化測試

### Engine.ts
- Scene、Camera、Renderer（`NeutralToneMapping`、`PCFShadowMap` 2048，`shadow.radius = 3` 軟陰影）
- 後製：`EffectComposer`（HalfFloat + MSAA 4x 目標）→ `UnrealBloomPass`（只讓陽光反光、道具等最亮處發光）→ `OutputPass`；一律用 `engine.render(delta)` 繪製
- 自動降級：連續約 3 秒低於 40 fps 就永久關掉光暈、解析度降為 1x、陰影貼圖降為 1024（`autoQuality = false` 可停用，給自動化測試用）
- `HemisphereLight`（夜晚補光為主）+ `DirectionalLight`（其 `target` 已加入場景，由 WeatherSystem 跟隨玩家）；白天的環境光來自 WeatherSystem 烘焙的天空環境貼圖
- Pointer Lock 滑鼠視角（pitch clamped [0.05, PI/2.2]），Q/E 鍵轉視角
- 鏡頭距離 `9 × size`、速度越快 FOV 越寬、`shake()` 撞擊震動（多個正弦疊加的平滑晃動，不是每幀亂跳）
- 鏡頭穩定：垂直方向平滑跟隨球（跳躍、彈跳、浮水不會晃鏡頭）；離地保護也是平滑抬升；滑鼠單次移動超過 250px 視為瀏覽器異常值直接丟掉；Pointer Lock 優先用 `unadjustedMovement`（原始滑鼠輸入）
- 相機防穿牆：raycaster 只掃 layer 0（地面、水、天空、粒子在 `SCENERY_LAYER` 不參與），每 3 幀一次，只有高度 > 1.5 倍球半徑的物件才會把鏡頭拉近；拉近後停留 0.8 秒再慢慢退回，避免來回抽動
- `panOf(point)`：世界座標 → 立體聲左右位置，給音效定位用

### Player.ts
- 鍵盤（WASD/方向鍵、空白鍵跳、按住 Shift 衝刺）+ 觸控搖桿輸入（`touchMove`、`touchSprint`）
- **幀率獨立物理**：加速度由 `accelerationFor(topSpeed × speedBoost, retention)` 算出，`velocity *= retention^dt`
- `friction = 0.03`（每秒保留比例，約 0.3 秒起步 / 停下）× `weatherFrictionModifier`（雨天 >1 → 更滑）
- 抓地力 `GRIP`：轉彎時側向速度快速衰減（雨天變弱），90° 轉彎約 0.2 秒；反方向時煞車 ×2.5
- 長按衝刺：有方向輸入且按住時才衝刺、才耗體力；開始的那一幀往前推一下（0.3 × 最高速）；`sprinting` 時最高速 ×1.6，體力用光觸發 `onWinded`
- 坡道：坡度超過 `SLOPE_HOLD` 會往下坡滾（緩坡靜止不動，模擬滾動阻力）
- 落地：橡皮球式彈一下（衝擊 ×0.35，太小就停）；`takeLanding()` 回傳衝擊速度給 GameManager 做塵土 / 水花
- 水：球是空心的，深水處浮在水面（約 1/3 沒入、輕微起伏），`waterDepth` 記錄沒入深度，泡水時最高速最多 −35%
- 球體是條紋 Canvas 貼圖的亮面 `MeshPhysicalMaterial`（clearcoat），滾動清楚可見；道具期間 `setGlow` 發光
- `attachObject`：物件貼到球面（`setLength(size*0.85)`），太小（< 10% size）直接吸收；最多保留 180 個，最舊的（埋最深的）移除
- `knockOff`：撞擊時掉落最近黏上的物件並扣回體積
- 沒有大小上限（舊版卡在 500 m）

### WorldManager.ts
- 區塊大小隨世界分級放大：`<5m: 100`、`5–30m: 400`、`30–150m: 1600`、`150–600m: 6400`，之後球每大 4 倍再升一級（區塊 ×4），沒有上限
- 地形起伏與水位跟著分級等比放大（`terrainScale = chunkSize / 100`），20×20 地面網格在每一級都取樣得到山丘，不會出現鋸齒狀水面
- 升級不瞬移：`alignTerrain()` 在放大版地形裡挑一個「離水面相對高度」和球腳下一樣的位置（`terrainShift.x/z`），再整體抬高（`terrainShift.y`）讓球腳下的地面（浮水時是水面）高度完全不變；所有物件用 `detachAllObjects()` / `reattach()` 搬進新區塊並貼齊新地面，只有落進新湖裡的會消失
- 渲染距離依鏡頭距離計算（2–5 塊），地面頂點色（沙灘 / 草地斑塊 / 高地）× 程序化細節貼圖（每段一格），水面只覆蓋已載入區塊，遠景草地墊底
- 水面：低粗糙度 PBR + 會流動的程序化法線貼圖（每塊 16 格，整數格數讓水面跟著區塊格線移動時花紋不會跳）
- 物件以群聚方式生成（球小時群聚半徑小、密度高；球所在區塊必有一群在身邊）
- 球體積翻倍時附近區塊補貨，並移除 < 8% size 的物件；離開 `populateRadius + 1` 的區塊清空物件（回來時再補）
- 每 8 幀依距離切換 `visible`（遠處小物件不畫）
- 移動實體：會走的小動物在能被吃時逃跑（彈跳），車子直行，幽浮盤旋
- 物件位置直接用 `obj.position`（區塊 Group 在原點，position 即世界座標）
- `forget(set)` 同時清 `collidables` / `movingEntities` / `powerups`

### ObjectFactory.ts
- 40 種物件型錄 `KINDS`（名稱、emoji、自然尺寸、移動方式、權重），從小花到火山，再到金字塔、城市、山脈、彩虹、龍捲風、浮空島、月亮、行星、太陽（`glow` 自發光）、星系
- 比型錄最大的還大時，從最大的 7 種裡依權重挑（放大使用），所以球可以無限長大
- 每個物件 = 1 個 mesh：零件以頂點色合併（`mergeGeometries`），共用 `MeshStandardMaterial`（`surface()`）；`finish()` 會把貼地的頂點壓暗（烘焙環境遮蔽），物件看起來站在草地上
- 幾何體每種最多 3 個變體、全程共用快取 → 卸載區塊不需 dispose 物件，也不會洩漏
- `kindForSize(size)`：挑自然尺寸在 2.5 倍內的種類
- 道具 `POWERUPS`：磁吸（8 秒）、衝刺（6 秒）、巨大化（體積 +25%）

### WeatherSystem.ts
- 一天 4 分鐘（`timeSpeed = 0.1 hr/sec`，從 9 點開始），日夜平滑過渡
- 漸層天空 shader（太陽 / 月亮光暈）+ 夜晚星空；霧色 = 地平線色，濃度依鏡頭距離與世界半徑（按比例平滑過渡：濃度會差好幾個數量級，線性插值會追不上）
- 太陽 / 月光跟隨玩家，陰影範圍隨球大小縮放
- 環境光：用 `PMREMGenerator` 把當下的天空（加一塊草地色地面）烘焙成 `scene.environment`，遊戲時間每過約 3 秒或雨量變化才重烘（每次幾毫秒）
- 每 35 秒 30% 機率下雨，雨量平滑漸變；雨絲跟著鏡頭；雨天 `weatherFrictionModifier` 最高 2.2（更滑）

### AudioManager.ts
- 總線：乾聲 + 殘響（程序化 1.8 秒衝激響應）→ `DynamicsCompressor`，同時很多聲音也不會爆音
- 滾動聲依地面（`RollSurface`）變化：陸地 = 棕噪音低沉滾動 + 小球的草叢沙沙聲 + 大球的次低頻轟隆；水裡 = 會晃動的潑水聲；空中 = 靜音；高速時加風切聲
- 吞食音：C 大調五聲音階，連擊越高音越高，大物件多一層低音；撞擊（重撞有碎片聲）、升級、道具、衝刺、落水（撲通 + 水花 + 水滴落回）、落地悶響、倒數、結束音效
- 吞食、撞擊有立體聲定位（`StereoPannerNode`，位置來自 `engine.panOf`）
- 環境音：風雨；晴天白天隨機鳥叫、夜晚蟲鳴（左右隨機）
- 程序化背景音樂（I–vi–IV–V、16 步重複動機），M 鍵開關並記在 localStorage
- 需使用者互動後 `init()`；暫停時 `suspend()`

### Effects.ts
- 兩個 `Points` 粒子池（各一個 draw call）：`sparks` 彩紙（吞食、道具、升級、撞擊）、`spray` 柔和水霧 / 塵土
- `splash()`：從球的吃水線噴出一圈水花（強度 0.1 = 航跡、1.5 = 高處落水），強的再加漣漪；`ripple()`：水面擴散的圓環（24 個池化）
- 粒子 `renderOrder = 3`、漣漪 `= 2`：一定要畫在半透明水面之後，否則會被水面蓋掉

### materials.ts
- `surface()`：全遊戲共用的 PBR 材質起點（roughness 0.8、metalness 0）
- 程序化無縫雜訊貼圖：`groundDetailTexture()`（地面顆粒）、`waterNormalTexture()`（水波法線）

### HUD.ts
- 大小 / 稱號進度條（1 km 起改用 km 顯示）、計時、吞食數、道具剩餘、連擊、吞食清單（同種合併、新發現標記）、升級橫幅、提示
- 衝刺體力條：畫面下方中央，只在消耗或回復時出現，沒力時變灰
- 暫停與結算畫面的收集圖鑑

### TouchControls.ts
- 觸控裝置（`pointer: coarse`）：左半邊浮動搖桿、右半邊拖曳轉視角、跳躍按鈕（點）/ 衝刺按鈕（按住）

## 資料流

```
GameManager.animate()
  ├── timer.update() → delta（上限 0.1）
  ├── [未開始] idle(): world.update + 鏡頭環繞
  └── step(delta)
      ├── player.update(delta, cameraAngle, terrain, waterLevel)
      ├── updateContact → 入水 / 落水水花、航跡漣漪、落地塵土與音效
      ├── world.update(delta)  → 分級 / 區塊 / 補貨 / 移動實體 / 道具動畫 / 距離剔除
      ├── updatePowerups → player.speedBoost / glow / HUD
      ├── checkCollisions → eat / collectPowerup / resolveBump / checkMilestone
      ├── updateCombo, effects.update
      ├── weather.update(delta, cameraDist, worldRadius)
      ├── audio.updateRollingSound / updateAmbientSound
      ├── engine.updateCamera
      └── hud.setSize, updateTimer
```

## 建置流程

1. `npm test` → 遊戲公式單元測試
2. `npm run build` → `tsc && vite build`（strict mode）
3. 產出 `dist/index.html`、`dist/assets/index-*.js`、`dist/assets/index-*.css`

## 部署流程

1. 程式碼推送至 GitHub `main` 分支
2. Render 自動觸發建置，執行 `npm run build`
3. 發布 `dist/` 目錄內容

## 已知限制

- 需要 WebGL；低階裝置可能在物件多時掉幀（總物件數受 `OBJECT_BUDGET` 限制）
- 音效需使用者互動後才能初始化（瀏覽器限制）
- 碰撞為「水平距離 + 垂直重疊」近似，非精確物理
- 從 Esc 解除 Pointer Lock 後，瀏覽器可能拒絕立刻重新鎖定；會顯示「點一下畫面」提示
- 世界分級時地面區塊重建、遠處地形換成放大版（與升級橫幅同時發生）；球腳下高度與現有物件都保留，但落進新湖裡的物件會消失
- Vite HMR 已關閉（vite.config.ts: `hmr: false`），避免多實例堆積

## 修改注意事項

- **遊戲數值**：改 `rules.ts`，並跑 `npm test`
- **物理系統**：所有位移乘 `deltaTime`；摩擦用 `Math.pow(retention, deltaTime)`
- **吃的判定**：一律用 `canEat()`，不要直接比體積（GameManager、WorldManager 的逃跑與生成都依賴它）
- **碰撞清單**：吃掉 / 卸載物件時用 `world.forget()`，三個清單一起清
- **區塊卸載**：用 `userData.isGround` 識別地面，只 dispose 地面幾何（物件幾何是共用快取，不可 dispose）
- **新物件種類**：在 `ObjectFactory.KINDS` 加一筆（builder 回傳零件陣列），圖鑑會自動出現
- **不參與相機遮擋的場景物**：`layers.set(SCENERY_LAYER)`
- **AudioContext**：需在使用者互動後呼叫 `audio.init()`
- **材質**：新材質用 `surface()`（PBR），亮度由太陽 + 天空環境貼圖決定；要發光（會被 bloom 抓到）就把 `emissiveIntensity` 調到 1.5 以上
- **半透明特效**：疊在水面上的東西要設 `renderOrder` > 0，不然會被半透明水面畫過去
