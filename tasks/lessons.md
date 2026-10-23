# Lessons

## 瀏覽器驗收沿用原生分頁（2026-10-24）

- 使用者已開啟遊戲預覽時，透過瀏覽器工具沿用該分頁，不另開 Playwright 瀏覽器或測試視窗。
- 先查看現有分頁，再更新與驗收；完成後保留預覽並釋放滑鼠鎖定。

## 無頭瀏覽器測試不可鎖定滑鼠（2026-10-20）

- 問題：Playwright 無頭 Chromium 在 Windows 上點「開始」後，遊戲呼叫 `requestPointerLock()`，系統會把**使用者真實的滑鼠**限制在看不見的視窗裡（卡在螢幕左上角）。
- 做法：自動化測試在 `page.goto` 前加 `page.addInitScript(() => { Element.prototype.requestPointerLock = () => Promise.resolve(); })`。
- 萬一已經卡住：結束測試瀏覽器程序，並呼叫 `user32!ClipCursor(NULL)` 解除限制。

## 無頭瀏覽器很吃使用者電腦效能（2026-10-20）

- 問題：WebGL 遊戲在無頭 Chromium 只能用 CPU 軟體繪圖（swiftshader），每跑一次都把 CPU 吃滿數分鐘；使用者同時在玩或工作會明顯卡頓（「你開的無頭瀏覽器太吃性能了」）。
- 做法：優先用 `npx tsc --noEmit`、`npm test`、`npm run build` 這類便宜的檢查；真的需要看畫面時才開，一次一個、小視窗（如 640×360）、幾秒就關，不做長時間自動遊玩或反覆截圖。
