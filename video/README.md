# 智寶網路急救室 — 短影音生成器

用程式碼產出 9:16 直式短影音（Reels / Shorts / TikTok）。畫面在瀏覽器裡用 HTML/SVG 畫，
再逐格截圖交給 ffmpeg 合成，所以**同一份腳本資料可以批次產出上百支**，這是 24 小時內容流的生產端。

## 檔案

| 檔案 | 作用 |
|---|---|
| `scene.html` | 版面與角色（智寶 SVG、終端機卡片、字幕、品牌列） |
| `timeline.js` | 時間軸。`setT(t)` 是純函式：同一個 `t` 永遠畫出同一格 |
| `render.mjs` | Playwright 逐格截圖 → `frames/*.png` |
| `encode.sh` | `frames/*.png` → `out/*.mp4`（H.264 + 靜音音軌） |

## 產出

```bash
npm i playwright          # 或用系統既有的 playwright
node render.mjs           # 約 1080 格 @30fps
./encode.sh zhibao-ep01
```

## 換一集內容

只要改 `timeline.js` 最上面的 `STEPS` 陣列：每一集就是「三個排錯步驟 + 一個解法」。

```js
{ s: 4.2, e: 13.4,               // 這一段的起訖秒數
  num: 'STEP 1', title: '先確認：你到分享器',
  cmd: 'ping 192.168.1.1',       // 終端機打字內容
  out: [['ok','回覆自 …']],       // 輸出行（dim / ok / err）
  bad: false, vico: '✅', vtxt: '通了 → …',   // 判讀卡
  caps: [[0.3, '字幕一'], [3.4, '字幕二']],   // [出現秒數, HTML]
  say: [1.0, 2.4, '先查最近的！'],            // 智寶對話泡泡 [起, 長, 文字]
  eye: 'normal' }                             // normal | alert
```

之後把 `STEPS` 抽成外部 `episodes/*.json`，就能接題庫批次跑。

## 角色素材

智寶是照官方形象用 **SVG 重畫**的向量版（白色圓身、小耳朵、黑豆眼、粉頰、薄荷綠菱形鼻、黑領結），
加上一個 WiFi 訊號小徽章當節目道具。表情有 normal / alert / happy 三種，會自動眨眼、身體上下浮動、雙手輕擺。

若要換成官方原始素材，把 `scene.html` 裡 `<svg id="char">` 整段換掉即可，
只要保留這些 id 讓 `drawChar()` 能驅動：
`eyeL` `eyeR`（眼睛，眨眼靠改 `ry`）、`eyeLh` `eyeRh`（開心時的彎眼）、`mouth`、
`emo`（驚嘆號徽章）、`w1` `w2`（訊號波）、`armL` `armR`（手）。

> 注意：智寶是智生活科技的商標角色，對外發佈前請先確認使用授權。

## 還沒做的（下一步）

- **配音**：目前是無聲片。接 TTS（Azure / ElevenLabs 中文）產 mp3 + 逐字時間軸，
  讓 `caps` 的秒數由語音時間軸自動生成，而不是手填。
- **背景音樂**：需自備有授權的素材。
- **批次**：`episodes/*.json` + 迴圈跑 render/encode。
