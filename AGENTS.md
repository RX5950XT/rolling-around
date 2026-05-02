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
| Engine | 3D 渲染、相機、光照 | Three.js |
| Player | 輸入、物理、成長 | Three.js |
| WorldManager | 區塊生成、地形、物件管理 | Three.js, ObjectFactory, Player |
| ObjectFactory | 程序化物件生成 | Three.js |
| WeatherSystem | 時間、天氣、粒子 | Three.js, Player |
| AudioManager | 程序化音效 | Web Audio API |
| GameManager | 協調所有模組、主循環 | 所有模組 |

## 修改注意事項

### 物理系統
- `velocity` 單位為 `units/sec`
- 位移公式：`position.add(velocity.clone().multiplyScalar(deltaTime))`
- 滾動角度：`angle = (velocity.length() * deltaTime) / size`
- 調整 `speed`、`maxSpeed`、`friction` 時必須測試不同幀率（30/60/144Hz）

### 碰撞檢測
- `checkCollisions()` 同時清理 `collidables` 和 `movingEntities`
- 每幀最多處理 5 個碰撞物件，統一計算平均推開方向
- 彈開分離距離上限為 `playerRadius * 1.5`，彈跳力度上限為 8
- 不再使用 `break`，避免漏檢導致反覆彈跳
- **位置快取**: 每個 collidable 在 `userData.cachedPos` 預存 `{x,y,z}`，避免每幀 `getWorldPosition()`
- **距離預過濾**: 使用 `quickRejectDist` 先用平方距離排除遠處物件，再對近處物件做精確計算

### 區塊管理
- `destroyChunk()` 使用 `userData.isGround` 識別地面
- 區塊大小 200，渲染距離動態 2→5（依球大小）
- 調整物件密度時注意低階裝置效能
- 遠處區塊先只生成地面，玩家靠近時才補充物件（`chunksWithObjects` 追蹤）

### 天氣系統
- 透過 `player.weatherFrictionModifier` 影響摩擦，不直接覆蓋 `Player.friction`
- `weatherFrictionModifier` 在 `Player.update()` 中與基礎 `friction` 相乘後套用

### 音訊系統
- 必須在使用者互動後初始化 AudioContext
- 不可動態修改執行中 OscillatorNode 的 type
- 使用 BiquadFilter + GainNode 模擬不同環境音效
- 暫停時呼叫 `audioContext.suspend()`，恢復時 `resume()`

### UI 修改
- 使用 CSS 變數（`--primary`, `--secondary` 等）
- 字體使用 'Quicksand'
- 支援 `prefers-reduced-motion`
- 響應式設計：手機 < 480px 有獨立樣式

## 開發設定

- `vite.config.ts` 已關閉 HMR (`hmr: false`)，避免熱重載導致多 GameManager 實例堆積
- HMR 觸發時執行 `window.location.reload()` 硬重載

## 部署流程

1. 確認 `npm run build` 通過
2. 確認 `dist/` 目錄存在且包含正確檔案
3. 推送至 GitHub `main` 分支
4. Render 自動觸發建置
5. 驗證線上版本

## 環境變數

無特殊環境變數需求。

## 常見問題

### TypeScript 建置失敗
- 檢查 `noUnusedLocals` / `noUnusedParameters` 是否觸發
- 移除未使用的 import 或改為 `_` 前綴

### 音效沒有聲音
- 確認 `audio.init()` 在使用者點擊後呼叫
- 檢查瀏覽器是否封鎖自動播放

### 效能問題
- 降低 `renderDistance`
- 減少各類別物件數量
- 關閉陰影或降低 shadow map 解析度
- **getWorldPosition() 是頭號效能殺手**: 碰撞檢測務必使用 `cachedPos`
- **raycaster 每 3 幀執行一次**即可，不需要每幀
- **大球時銷毀小物件而非 attach**: 避免子 mesh 數量爆炸