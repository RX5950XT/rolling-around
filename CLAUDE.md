# CLAUDE.md

## 專案概述

Rolling Around 是一個基於 Three.js 的 3D 滾球收集遊戲，使用 TypeScript + Vite 開發，部署於 Render 靜態網站。

## 技術棧

- **Runtime**: TypeScript 5.x, ES2020
- **3D Engine**: Three.js 0.184.0
- **Bundler**: Vite 8.x
- **Deploy**: Render Static Site
- **Build Output**: `dist/` directory

## 模組架構

### GameManager.ts
遊戲主控制器，負責：
- 初始化所有子系統（Engine, Player, WorldManager, WeatherSystem, AudioManager）
- 管理遊戲狀態（暫停/進行中）
- 主渲染循環（requestAnimationFrame）
- 碰撞檢測與物件吞噬邏輯
- UI 更新（大小顯示）

### Engine.ts
3D 渲染核心，負責：
- Three.js Scene、Camera、Renderer 初始化
- 方向光與環境光設定（含陰影）
- Pointer Lock 滑鼠相機控制（支援上下俯仰，pitch clamped [0.05, PI/2.2]）
- 視窗大小變化響應
- 動態相機跟隨（根據玩家大小調整距離與高度）
- 相機防穿牆：raycaster 排除 ground 與 player 後尋找遮擋物
- 相機防穿地形：確保不低於地表 + size*0.3

### Player.ts
玩家球體，負責：
- 鍵盤輸入處理（WASD/方向鍵）
- **幀率獨立物理模擬**（velocity in units/sec）
- 時間指數摩擦衰減
- 球體滾動旋轉動畫
- 成長邏輯（基礎緩慢成長 + 吞食物體）
- 物件附加（attach）到球體表面

**關鍵參數**:
- `speed = 120` — 基礎加速度
- `maxSpeed = 60` — 最大速度基礎值
- **速度公式**: `maxSpeed = 60 × size^0.95 × multiplier`
  - size < 50m: multiplier = 1.0
  - 50-100m: multiplier = 5.0
  - 100-200m: multiplier = 10.0
  - 200m+: multiplier = 100.0
- **加速度公式**: `120 / size^0.01`（幾乎不衰減，200m 仍有 113/sec）
- `friction = 0.15` — 每秒摩擦係數
- `weatherFrictionModifier = 1.0` — 天氣對摩擦的乘數（由 WeatherSystem 控制）
- `baseGrowthRate = 0.05` — 基礎成長速率
- `MAX_SIZE = 500` — 體積上限
- **跳躍**: `jumpForce = 25 × size^0.4`（大球跳得更高）

### WorldManager.ts
無限世界管理，負責：
- 200x200 區塊動態載入/卸載（renderDistance 動態 2→5）
- 地形高度計算（sin/cos 組合雜訊）
- 物件密度控制：動態根據球大小調整（tiny 4x→0x, small 2.5x→0x, medium 0.5x→2x, large 0.5x→5x）
- 150m+ 時 tiny/small 完全消失，節省效能投資於更多大型結構
- 大型物件 scale 範圍 10-60（150m+ 時最高 60x）
- 移動實體更新（動物、車子）
- collidables 與 movingEntities 清單管理
- **碰撞位置快取**: 每個 collidable 在 `userData.cachedPos` 預存世界座標，`checkCollisions()` 直接讀取，避免每幀呼叫昂貴的 `getWorldPosition()`
- **距離預過濾**: 碰撞檢測先用 `quickRejectDist` 排除遠處物件，大幅減少精確計算次數

### ObjectFactory.ts
程序化物件工廠，負責：
- 四種尺寸類別的隨機物件生成
- 體積與碰撞半徑計算（radius = max(x,z)/2，水平 footprint 避免垂直 phantom collision）
- MeshToonMaterial 材質池

### WeatherSystem.ts
天氣與時間系統，負責：
- 24 小時日夜循環（timeSpeed = 0.5 hr/sec）
- 動態天空顏色與光照強度
- 隨機降雨（每 40 秒判定一次）
- 雨粒子效果（2,000 粒子）— 已為效能調降
- 動態霧效
- 天氣影響摩擦：透過 `weatherFrictionModifier` 調整，不直接覆蓋 `Player.friction`

### AudioManager.ts
程序化音效，負責：
- 滾動音效：rumble（sine 40Hz）+ texture（pink noise），依速度與大小調整
- 吞食音效：sine + triangle + white noise 合成，依大小調整音高
- 環境音效：white noise + BiquadFilter（lowpass/highpass），模擬風聲/雨聲
- 注意：Web Audio API 需要使用者互動後初始化

## 資料流

```
GameManager.animate()
  ├── clock.getDelta() → deltaTime
  ├── player.update(deltaTime, cameraAngle, getTerrainHeight)
  ├── world.update(deltaTime)
  │   ├── generateChunk / destroyChunk
  │   └── update movingEntities
  ├── checkCollisions()
  │   ├── player.attachObject()
  │   └── audio.playPopSound()
  ├── weather.update(deltaTime, cameraDist)
  ├── audio.updateRollingSound()
  ├── audio.updateAmbientSound()
  ├── engine.updateCamera()
  └── updateUI()
```

## 建置流程

1. `npm run build` → `tsc && vite build`
2. TypeScript 編譯檢查（strict mode）
3. Vite 打包至 `dist/`：
   - `dist/index.html`
   - `dist/assets/index-*.js`
   - `dist/assets/index-*.css`

## 部署流程

1. 程式碼推送至 GitHub `main` 分支
2. Render 自動觸發建置
3. 執行 `npm run build`
4. 發布 `dist/` 目錄內容

## 已知限制

- 需要 WebGL 支援的瀏覽器
- 音效需使用者互動後才能初始化（瀏覽器限制）
- 同時存在約 25 個區塊 × ~150 物件 = ~3,750 個 mesh，低階裝置可能卡頓
- 碰撞檢測為簡單距離檢測，非精確物理
- 彈開分離距離為 `maxSeparation + 0.5`，確保完全脫離碰撞物體
- 每幀最多處理 5 個碰撞物件，統一推開方向
- 碰撞位置快取（cachedPos）避免每幀 getWorldPosition
- 距離預過濾（quickRejectDist）跳過不可能碰撞的物件
- Vite HMR 已關閉（vite.config.ts: `hmr: false`），避免多實例堆積

## 效能優化策略

### 1. 碰撞檢測優化（最大收益）
- **cachedPos**: 每個 collidable 生成時預存世界座標；moving entities 移動時同步更新
- **quickReject**: 先用簡單距離平方排除絕大多數物件，只對近處物件做精確碰撞
- **避免 getWorldPosition()**: 這個函數會觸發遞迴矩陣更新，是大場景的頭號殺手

### 2. 渲染優化
- **raycaster 降頻**: 相機防穿牆 raycast 從每幀改為每 3 幀一次
- **復用 temp vectors**: Player、Engine、GameManager 中使用類成員向量避免每幀 new
- **WeatherSystem 顏色快取**: 日夜天空顏色使用預先建立的 Color 物件，避免每幀 GC
- **shadow culling**: tiny/small 物件不投射陰影（ObjectFactory 中設定 castShadow=false）

### 3. 大球效能策略（size > 50）
- **attachObject 智能銷毀**: 當球 > 50m 且物件 < 球的 15% 時，直接銷毀而不 attach，避免子 mesh 累積導致矩陣更新爆炸
- **渲染距離**: 動態 2→5，大球時 121 個區塊
- **物件密度再分配**: tiny/small 歸零，節省下來的效能用於更多 large 結構

## 修改注意事項

- **物理系統**：所有位移計算必須乘 `deltaTime`；使用直接分量加法而非 `.add().multiplyScalar()` 避免臨時物件分配
- **摩擦係數**：使用 `Math.pow(friction, deltaTime)` 確保幀率獨立
- **碰撞清單**：吃掉物件時必須同時從 `collidables` 和 `movingEntities` 移除
- **區塊卸載**：使用 `userData.isGround` 標記識別地面，勿依賴 `children[0]`
- **AudioContext**：需在使用者互動後呼叫 `audio.init()`
- **MeshToonMaterial**：不支援 `roughness` 屬性