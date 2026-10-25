# 世界生成交接

- 2026-10-25：48 種圖鑑皆有生成位置。公園增加露營與小物、區域地標增加遊樂設施／自然景觀，tier 7 起出現宇宙物件；仍使用三段尺寸與既有格位。`Player.attached` 保存 `{ object, growthVolume }`，掉落只扣回實際增加的體積。
- `GameManager.updateGuide()` 每 0.25 秒選附近可吞食目標，HUD 顯示相對鏡頭方向與距離，不做尋路。連擊條使用同一 `COMBO_WINDOW`／`comboBonus`；新增暫停頁結算按鈕。自由與限時結算共用 `endGame()`，重新開始／離頁也保存紀錄。
- 暫停、失焦與結算清除 Player／Engine 輸入；開始／恢復釋放按鈕焦點，避免空白鍵誤按選單。HUD 大小、單位、稱號分別更新；相機障礙檢查包含父物件可見性。
- 本輪瀏覽器檢查：既有開發分頁載入 `scripts/check-experience.js`，提供 `checkExperience()`、`checkWorldScales()`、`checkCameraVisibility()`、`checkLayout()`。這些會操作測試局並停掉自動渲染，驗收後須重載；不得在使用者進行中的遊戲執行。

- 世界先由 `worldLayout.ts` 用每局固定種子安排街區用途，再由 `WorldManager` 放置可收集物件。初期是商店／住宅／農地／公園，之後加入高樓與物流，tier 3 起是城市與山岳。保留原有無上限世界尺度。
- `Buildings.ts` 共用幾何與材質；碰撞盒是牆面幾何的來源。建築前後都有門，屋頂剖視不取消碰撞。可吞食體積與門洞的防卡住條件由測試保護。
- `worldLayout.BUILDINGS` 定義七種建築的門洞、層高、配色與室內物品；`buildingBoxes(type)` 包含階梯屋頂，`getRollingHeight()` 依各碰撞盒與旋轉算屋頂支撐。`Buildings` 每種只快取牆面／屋頂兩份合併幾何，`ObjectFactory` 的新圖鑑種類共用同一外形。
- tier 3 以上採 1.8–2.6、4–6、8–10 的區塊內尺寸階梯。最大地標必須在下次世界升級門檻的 80% 前可吃；小建築與地標隔開，避免能吃卻碰不到。`tests/growth.test.ts` 涵蓋多種種子、尺寸、可達性與無連擊／道具的成長供給。
- 吞食、成長與清除仍走既有 `canEat()`、`Player.attachObject()`、`world.forget()`。物理改用短步進避免穿牆，屋頂支撐由 `getRollingHeight()` 提供。
- 測試：`npm test`、`npm run build`；瀏覽器驗收腳本見 `scripts/check-world.js`（Playwright CLI `run-code --filename`）。先啟動 5191 port 的 Vite；停掉遊戲動畫後手動推進物理，只渲染少數畫面，且禁用 pointer lock。
- Vite 關閉 HMR 時本輪觀察到舊模組快取；修改後做瀏覽器驗收前，重開自己啟動的測試 port，不能殺掉其他 Node 程序。
- 瀏覽器驗收直接沿用使用者已開啟的 Edge 預覽分頁（瀏覽器工具），不要另開 Playwright 測試視窗。`scripts/check-growth.js` 保留本輪門洞／屋頂／八個大小階段吞食的驗收案例；後續以現有瀏覽器執行適用檢查。

## 大尺度與黏著物

- 黏著物朝外站在球面、隨成長外移（< 6% 吸收）；鏡頭以 1.6 倍分段退鏡；`COSMIC_TIER` 起紫色月塵地面、無馬路，15 km 起太空天空且不下雨；建築加牆腳、門框、側窗、花台與屋頂設備（純外觀，碰撞不變）。
- `python scripts/check-play.py`：自動駕駛從 1 m 連續吃到 10000 km（約 23 秒、7000+ 口），檢查 NaN、卡住與頁面錯誤，截圖存 `output/playwright/play-*.png`。需 5173 開發伺服器。

## 手機介面

- `mobile.css` 管觸控版面與橫向選單，保留 `style.css` 的配色與字體。畫布 CSS 跟隨容器，`renderer.setSize(..., false)` 只調整渲染尺寸，避免轉向後舊寬度撐大手機頁面。`#ui-layer` 截住滑入動畫，避免隱藏元素撐寬畫面。
- `TouchControls` 各自追蹤移動、視角、衝刺手指並捕捉指標；暫停／結束、失焦、背景與 resize 呼叫 `reset()`，避免恢復後仍在移動。`GameManager` 管理觸控按鈕顯示及暫停畫面的音樂開關。
- `scripts/check-mobile.js` 由 Playwright CLI `run-code --filename` 執行，用 Edge Chromium 合成觸控驗證多指、取消、捕捉、橫直向、暫停及安全區域。動畫停下來、按需渲染以降低負載；每次 resize 後須等瀏覽器套用新尺寸再讀版面。未涵蓋手機實機與 Safari。
