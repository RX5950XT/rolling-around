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
- 滑鼠拖曳相機旋轉控制
- 視窗大小變化響應
- 動態相機跟隨（根據玩家大小調整距離與高度）
- 相機防穿地形邏輯

### Player.ts
玩家球體，負責：
- 鍵盤輸入處理（WASD/方向鍵）
- **幀率獨立物理模擬**（velocity in units/sec）
- 時間指數摩擦衰減
- 球體滾動旋轉動畫
- 成長邏輯（基礎緩慢成長 + 吞食物體）
- 物件附加（attach）到球體表面

**關鍵參數**:
- `speed = 35` — 基礎加速度
- `maxSpeed = 50` — 最大速度（隨 sqrt(size) 調整）
- `friction = 0.3` — 每秒摩擦係數
- `baseGrowthRate = 0.05` — 基礎成長速率
- `MAX_SIZE = 500` — 體積上限

### WorldManager.ts
無限世界管理，負責：
- 200x200 區塊動態載入/卸載（renderDistance = 2）
- 地形高度計算（sin/cos 組合雜訊）
- 物件密度控制（tiny:80, small:40, medium:15, large:4）
- 移動實體更新（動物、車子）
- collidables 與 movingEntities 清單管理

### ObjectFactory.ts
程序化物件工廠，負責：
- 四種尺寸類別的隨機物件生成
- 體積與碰撞半徑計算
- MeshToonMaterial 材質池

### WeatherSystem.ts
天氣與時間系統，負責：
- 24 小時日夜循環（timeSpeed = 0.5 hr/sec）
- 動態天空顏色與光照強度
- 隨機降雨（每 40 秒判定一次）
- 雨粒子效果（10,000 粒子）
- 動態霧效

### AudioManager.ts
程序化音效，負責：
- 滾動音效（triangle oscillator，根據速度與大小調整）
- 吞食音效（sine oscillator，根據大小調整音高）
- 環境音效（sawtooth + lowpass filter，模擬風聲/雨聲）
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

## 修改注意事項

- **物理系統**：所有位移計算必須乘 `deltaTime`
- **摩擦係數**：使用 `Math.pow(friction, deltaTime)` 確保幀率獨立
- **碰撞清單**：吃掉物件時必須同時從 `collidables` 和 `movingEntities` 移除
- **區塊卸載**：使用 `userData.isGround` 標記識別地面，勿依賴 `children[0]`
- **AudioContext**：需在使用者互動後呼叫 `audio.init()`
- **MeshToonMaterial**：不支援 `roughness` 屬性