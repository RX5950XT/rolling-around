# Rolling Around todo
最後更新：2026-11-19

## 現況（交接）
模組職責、物理／碰撞／區塊規則見 CLAUDE.md 與 AGENTS.md；以下只記那兩份沒寫的補充。

### 世界生成與建築
- `worldLayout.ts` 用每局固定種子安排街區用途，`WorldManager` 再放可收集物件：初期商店／住宅／農地／公園，之後加入高樓與物流，tier 3 起是城市與山岳；保留無上限世界尺度。
- `worldLayout.BUILDINGS` 定義七種可進入建築（含麵包店、咖啡館、穀倉、倉庫、公寓）的門洞、層高、配色與室內物品；前後都有門。`buildingBoxes(type)` 含階梯屋頂，碰撞盒也是牆面幾何的來源。
- `Buildings` 每種只快取牆面／屋頂兩份合併幾何（每棟兩個 Mesh）；建築外觀細節（牆腳、門框、側窗、花台、屋頂設備）純外觀，不影響碰撞。
- tier 3 以上區塊內尺寸階梯：小建築 1.8–2.6、高樓 4–6、地標 8–10。最大地標必須在下次世界升級門檻的 80% 前可吃；小建築與地標分開擺，避免「能吃卻碰不到」。`tests/growth.test.ts` 守這個條件（多種子、無連擊／道具）。
- 48 種圖鑑都有生成位置；tier 7 起出現宇宙物件。`Player.attached` 存 `{ object, growthVolume }`，掉落只扣回實際增加的體積。

### 遊玩體驗
- `GameManager.updateGuide()` 每 0.25 秒挑附近可吞食目標，HUD 顯示相對鏡頭的方向與距離（不做尋路、不繞牆）。
- 連擊條與加成共用 `COMBO_WINDOW`／`comboBonus`；自由與限時模式結算共用 `endGame()`，重新開始／離頁也會存紀錄；暫停頁有結算按鈕。
- 暫停、失焦、結算會清掉 Player／Engine 輸入；開始／恢復時釋放按鈕焦點，避免空白鍵誤按選單。相機障礙檢查包含父物件可見性。
- 減少動態效果偏好會停用相機震動與速度視野變化。

### 手機介面
- `mobile.css` 管觸控版面與橫向選單，沿用 `style.css` 配色字體。畫布 CSS 跟隨容器，`renderer.setSize(..., false)` 只改渲染尺寸，避免轉向後舊寬度撐大頁面；`#ui-layer` 截住滑入動畫。
- `TouchControls` 分別追蹤移動、視角、衝刺手指並捕捉指標；暫停／結束、失焦、背景、resize 都呼叫 `reset()`。觸控判斷沿用主要指標，避免有觸控螢幕的滑鼠電腦變手機版。

### 驗收方式與踩雷
- 基本：`npm test`、`npm run build`、`git diff --check`。Three.js bundle > 500 kB 提醒是既有的，可忽略。
- 瀏覽器驗收腳本（`scripts/`）：`check-world.js`（進出門、撞牆、屋頂、吞食、卸載）、`check-growth.js`（各建築門洞屋頂、各大小階段吞食）、`check-experience.js`（`checkExperience()`、`checkWorldScales()`、`checkCameraVisibility()`、`checkLayout()`）、`check-mobile.js`（合成多指觸控、橫直向、安全區域），以 Playwright CLI `run-code --filename` 或載入現有分頁執行。
- `python scripts/check-play.py`：自動駕駛從 1 m 連續吃到 10000 km，檢查 NaN、卡住與頁面錯誤，截圖存 `output/playwright/play-*.png`；需 5173 開發伺服器。
- 使用者偏好：直接沿用已開啟的 Edge 預覽分頁驗收，不另開 Playwright 視窗；驗收腳本會操作測試局並停掉自動渲染，驗收後要重載，**不可在使用者進行中的遊戲執行**。
- Vite 關 HMR 時會吃到舊模組快取：改完後重開自己啟動的測試 port（只結束該 port 的程序，不殺其他 Node）。
- 大尺度測試直接跳級時要推進天氣時間，否則會停在前一個尺度的濃霧（測試設定問題，非遊戲 bug）。

## 待辦
- [ ] 手機實機與 Safari 驗證（目前觸控、瀏海、背景事件都是 Edge 模擬）。
- [ ] 長時間連續遊玩效能，以及從 1 m 正常遊玩到宇宙的時間平衡（目前只有自動駕駛與直接設定大小的取樣驗證）。

## 已知問題／刻意不處理
- 方向提示只指出附近可吃物件，不提供繞牆導航。
- 顯示卡有既有 shader 精度 warning，不影響遊玩。
