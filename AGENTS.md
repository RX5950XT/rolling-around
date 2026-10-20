# AGENTS.md

## 專案資訊

- **名稱**: Rolling Around
- **類型**: 3D 網頁遊戲（Three.js + TypeScript + Vite）
- **部署平台**: Render Static Site
- **線上網址**: https://katamari-web-game.onrender.com/

## 技術棧約束

- **語言**: TypeScript（strict mode）
- **Runtime**: ES2020, DOM
- **3D 引擎**: Three.js 0.184.0
- **建置工具**: Vite 8.x
- **套件管理**: npm
- **建置輸出**: `dist/` 目錄

## 編碼風格

- 使用 `import * as THREE from 'three'` 匯入 Three.js
- 優先使用 `THREE.Object3D` 型別而非 `any`
- 物理計算必須考慮 `deltaTime` 確保幀率獨立
- 使用 `Math.pow(friction, deltaTime)` 進行時間指數衰減
- 避免 `as any` 強制轉型
- 函數行數 < 50，檔案行數 < 800
- 不超過 4 層巢狀

## 模組邊界

| 模組 | 職責 | 依賴 |
|------|------|------|
| rules | 純遊戲公式（速度、跳躍、吃的判定、稱號、生成密度） | 無 |
| Engine | 3D 渲染、後製光暈、自動降級、相機、光照 | Three.js |
| Player | 輸入、物理（抓地、坡道、彈跳、浮水）、成長、黏附物件 | Three.js, rules |
| WorldManager | 區塊生成、地形、物件管理、世界分級 | Three.js, ObjectFactory, Player, rules |
| ObjectFactory | 物件型錄與程序化幾何、道具 | Three.js, materials |
| materials | 共用 PBR 材質、程序化地面 / 水波貼圖 | Three.js |
| WeatherSystem | 時間、天空、天氣、陽光跟隨、天空環境貼圖 | Three.js, Player |
| AudioManager | 程序化音效（殘響、壓縮、立體聲、依地面變化的滾動聲、鳥叫蟲鳴）與背景音樂 | Web Audio API |
| Effects | 彩紙 / 水霧粒子池、水花、漣漪 | Three.js |
| HUD | DOM 介面、暫停 / 結算 / 圖鑑 | ObjectFactory, rules |
| TouchControls | 觸控搖桿與按鈕 | Engine, Player |
| GameManager | 協調所有模組、主循環、模式與計分 | 所有模組 |

## 修改注意事項

### 物理系統
- `velocity` 單位為 `units/sec`；位移 `position.x += velocity.x * deltaTime`
- 加速度 = `accelerationFor(topSpeed(size) × speedBoost, retention)`，終端速度剛好等於 `topSpeed`
- **不要再用速度倍率**：舊版 5x/10x/100x 倍率被摩擦鎖死在 ~63 m/s，完全沒作用
- 100 m 之後速度、跳躍、重力都跟大小成正比（`rules.ts` 的 `sizePower`），巨球不會變慢動作；新的隨大小變化的物理量也要走這個轉折
- 滾動角度：`angle = (velocity.length() * deltaTime) / size`
- 調整數值改 `src/rules.ts` 並執行 `npm test`

### 碰撞檢測
- 判定：水平距離 < `size + userData.radius` 且垂直區間重疊
- 吃的判定一律用 `canEat()`（物件體積 < 球體積 60%）
- 比球大的物件累積推開方向，速度沿法線反彈；高速撞擊會 `knockOff()` 掉落物件
- 吃掉 / 卸載用 `world.forget(set)`，同時清 `collidables`、`movingEntities`、`powerups`
- 物件位置直接讀 `obj.position`（區塊 Group 在原點），不需要 `getWorldPosition()`

### 區塊管理
- 區塊大小隨世界分級：100 → 400（5m）→ 1600（30m）→ 6400（150m），之後球每大 4 倍再 ×4，沒有上限；升級時重建全部區塊；地形與水位用 `terrainScale` 等比放大，改地形公式時要保持這個縮放
- `destroyChunk()` 用 `userData.isGround` 識別地面，只 dispose 地面幾何；物件幾何是共用快取
- 球體積翻倍時補貨並移除 < 8% size 的物件；離開 `populateRadius + 1` 的區塊清空物件
- 每 8 幀依距離切換物件 `visible`

### 天氣系統
- 透過 `player.weatherFrictionModifier` 影響摩擦（雨天 > 1 = 更滑），不直接覆蓋 `Player.friction`
- 陽光 / 月光與陰影範圍跟隨玩家；天空是 shader 半球，霧色 = 地平線色

### 音訊系統
- 必須在使用者互動後初始化 AudioContext
- 不可動態修改執行中 OscillatorNode 的 type
- 吞食音與背景音樂共用 C 大調五聲音階
- 暫停時呼叫 `audioContext.suspend()`，恢復時 `resume()`

### UI 修改
- 使用 `style.css` 的 CSS 變數（`--pink`, `--pink-deep`, `--teal`, `--ink` 等）
- 字體：拉丁 'Quicksand'、中文 'Huninn'（粉圓體），由 Google Fonts 載入
- 數字一律 `font-variant-numeric: tabular-nums`
- 支援 `prefers-reduced-motion`；手機 < 560px 有獨立樣式；觸控裝置 `body.touch`
- DOM 文字一律用 `textContent`，不用 `innerHTML`

## 開發設定

- `vite.config.ts` 已關閉 HMR (`hmr: false`)，避免熱重載導致多 GameManager 實例堆積
- HMR 觸發時執行 `window.location.reload()` 硬重載

## 部署流程

1. 確認 `npm test` 與 `npm run build` 通過
2. 確認 `dist/` 目錄存在且包含正確檔案
3. 推送至 GitHub `main` 分支
4. Render 自動觸發建置
5. 驗證線上版本

## 環境變數

無特殊環境變數需求。

## 測試

- `npm test`：`tests/*.test.ts`，Node 內建 test runner，零依賴
- 開發模式下 `window.game` 暴露 GameManager，可用 Playwright 等工具做自動化遊玩測試

## 常見問題

### TypeScript 建置失敗
- 檢查 `noUnusedLocals` / `noUnusedParameters` 是否觸發
- 移除未使用的 import 或改為 `_` 前綴

### 音效沒有聲音
- 確認 `audio.init()` 在使用者點擊後呼叫
- 檢查瀏覽器是否封鎖自動播放

### 效能問題
- 降低 `rules.ts` 的 `OBJECT_BUDGET`
- 降低 shadow map 解析度（Engine）或關閉 MSAA
- **避免 getWorldPosition()**：碰撞直接讀 `obj.position`
- **raycaster 每 3 幀執行一次**即可，且只掃 layer 0
- 球上黏附物件最多 180 個；太小的物件直接吸收不黏