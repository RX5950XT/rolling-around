# Rolling Around

一個可愛的 3D 滾球收集遊戲，使用 Three.js + TypeScript + Vite 打造。在無限生成的世界中滾動你的球，收集各種大小的物件，讓自己變得越來越大！

## 遊戲簡介

在《Rolling Around》中，你控制一顆可愛的珊瑚粉色球體，在充滿各種物件的開放世界中自由探索。從微小的花朵、石頭，到房屋、樹木，甚至高樓大廈——只要你的球夠大，什麼都可以「吃」掉！隨著收集的物件越來越多，你的球也會不斷成長，能夠吞噬更大的目標。

## 操作方式

| 按鍵 | 功能 |
|------|------|
| **W / A / S / D** 或 **方向鍵** | 移動球體 |
| **滑鼠拖曳** | 旋轉相機視角 |
| **ESC** | 暫停 / 繼續遊戲 |

## 技術棧

- **Three.js** — 3D 渲染引擎
- **TypeScript** — 型別安全的 JavaScript
- **Vite** — 快速開發與建置工具
- **Web Audio API** — 程序化音效生成

## 本地開發

```bash
# 安裝依賴
npm install

# 啟動開發伺服器
npm run dev

# 建置生產版本
npm run build

# 預覽生產版本
npm run preview
```

## 部署資訊

本專案部署於 [Render](https://render.com/) 靜態網站服務：

- **線上網址**：https://katamari-web-game.onrender.com/
- **建置指令**：`npm run build`
- **發布目錄**：`dist`

## 專案結構

```
rolling-around/
├── src/
│   ├── main.ts              # 程式進入點
│   ├── GameManager.ts       # 遊戲主循環與狀態管理
│   ├── Engine.ts            # 3D 渲染引擎與相機控制
│   ├── Player.ts            # 玩家球體、物理與成長
│   ├── WorldManager.ts      # 無限地形區塊生成
│   ├── ObjectFactory.ts     # 程序化場景物件生成
│   ├── WeatherSystem.ts     # 日夜循環與天氣系統
│   └── AudioManager.ts      # 滾動音效與環境音
├── index.html               # 主頁面
├── style.css                # 遊戲 UI 樣式
├── package.json             # 專案設定
└── tsconfig.json            # TypeScript 設定
```

## 核心機制

### 物理系統
- 幀率獨立的物理模擬，確保在任何裝置上都有一致的手感
- 時間指數摩擦衰減，球體自然減速
- 動態最大速度隨球體大小調整

### 成長系統
- 吞食物體獲得其體積，球體隨之成長
- 基礎緩慢成長機制，即使沒有吃東西也會慢慢變大
- 體積上限 500m，防止數值崩潰

### 碰撞檢測
- 距離檢測為基礎的碰撞系統
- 小球無法吃掉比自己大的物體，會被彈開
- 吃掉移動中的物件（動物、車子）時會從移動清單中移除

### 世界生成
- 200x200 的區塊（Chunk）動態載入/卸載
- 渲染距離 2 個區塊，同時存在 25 個區塊
- 四種尺寸類別的物件：微小、小型、中型、大型

### 天氣系統
- 24 小時日夜循環，影響天空顏色與光照
- 隨機降雨事件，雨粒子效果跟隨玩家
- 動態霧效密度根據相機距離調整

## 注意事項

- 需要支援 WebGL 的瀏覽器
- 建議使用 Chrome、Firefox、Edge 等現代瀏覽器
- 音效需要使用者互動（點擊「開始滾動」）後才會初始化
- 支援 `prefers-reduced-motion` 無障礙設定

## 授權

MIT License