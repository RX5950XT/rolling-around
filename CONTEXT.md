# 世界生成交接

- 世界先由 `worldLayout.ts` 用每局固定種子安排街區用途，再由 `WorldManager` 放置可收集物件。初期是商店／住宅／農地／公園，之後加入高樓與物流，tier 3 起是城市與山岳。保留原有無上限世界尺度。
- `Buildings.ts` 共用幾何與材質；碰撞盒是牆面幾何的來源。建築前後都有門，屋頂剖視不取消碰撞。可吞食體積與門洞的防卡住條件由測試保護。
- `worldLayout.BUILDINGS` 定義七種建築的門洞、層高、配色與室內物品；`buildingBoxes(type)` 包含階梯屋頂，`getRollingHeight()` 依各碰撞盒與旋轉算屋頂支撐。`Buildings` 每種只快取牆面／屋頂兩份合併幾何，`ObjectFactory` 的新圖鑑種類共用同一外形。
- tier 3 以上採 1.8–2.6、4–6、8–10 的區塊內尺寸階梯。最大地標必須在下次世界升級門檻的 80% 前可吃；小建築與地標隔開，避免能吃卻碰不到。`tests/growth.test.ts` 涵蓋多種種子、尺寸、可達性與無連擊／道具的成長供給。
- 吞食、成長與清除仍走既有 `canEat()`、`Player.attachObject()`、`world.forget()`。物理改用短步進避免穿牆，屋頂支撐由 `getRollingHeight()` 提供。
- 測試：`npm test`、`npm run build`；瀏覽器驗收腳本見 `scripts/check-world.js`（Playwright CLI `run-code --filename`）。先啟動 5191 port 的 Vite；停掉遊戲動畫後手動推進物理，只渲染少數畫面，且禁用 pointer lock。
- Vite 關閉 HMR 時本輪觀察到舊模組快取；修改後做瀏覽器驗收前，重開自己啟動的測試 port，不能殺掉其他 Node 程序。
- 瀏覽器驗收直接沿用使用者已開啟的 Edge 預覽分頁（瀏覽器工具），不要另開 Playwright 測試視窗。`scripts/check-growth.js` 保留本輪門洞／屋頂／八個大小階段吞食的驗收案例；後續以現有瀏覽器執行適用檢查。

## 手機介面

- `mobile.css` 管觸控版面與橫向選單，保留 `style.css` 的配色與字體。畫布 CSS 跟隨容器，`renderer.setSize(..., false)` 只調整渲染尺寸，避免轉向後舊寬度撐大手機頁面。`#ui-layer` 截住滑入動畫，避免隱藏元素撐寬畫面。
- `TouchControls` 各自追蹤移動、視角、衝刺手指並捕捉指標；暫停／結束、失焦、背景與 resize 呼叫 `reset()`，避免恢復後仍在移動。`GameManager` 管理觸控按鈕顯示及暫停畫面的音樂開關。
- `scripts/check-mobile.js` 由 Playwright CLI `run-code --filename` 執行，用 Edge Chromium 合成觸控驗證多指、取消、捕捉、橫直向、暫停及安全區域。動畫停下來、按需渲染以降低負載；每次 resize 後須等瀏覽器套用新尺寸再讀版面。未涵蓋手機實機與 Safari。
