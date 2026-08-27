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

## 配音

旁白文字與時間點放在 `episodes/<ep>.json` 的 `narration`，一句一個時間點。

```bash
pip install edge-tts
python3 voice.py ep01              # → out/ep01-vo.wav（台灣女聲，免費、免金鑰）
./mix.sh ep01                      # 旁白混進影片
./mix.sh ep01 assets/bgm.mp3       # 旁白 + 背景音樂（自動 ducking）
```

`voice.py` 會印出每一句的實際長度，並**警告哪一句會蓋到下一句**——
超出就把那句話改短，不要硬擠。這是對稿最快的方式。

引擎可切換：

| `--engine` | 說明 |
|---|---|
| `edge`（預設） | Edge Neural TTS，`zh-TW-HsiaoChenNeural`。免費、不用金鑰，需連 `speech.platform.bing.com` |
| `piper` | 完全離線。需 `--model xxx.onnx`，目前只有 zh-CN 低品質模型，僅適合對時間軸用 |

要換成 Azure / ElevenLabs 只要在 `voice.py` 加一個 `synth_xxx()` 函式。

## 背景音樂

見 `assets/BGM-授權說明.md`。**不要抓 YouTube 上的音樂**，會被 Content ID 下架。

## 還沒做的（下一步）

- **批次**：`episodes/*.json` + 迴圈跑 render/encode，一次產十集。
- **字幕自動對齊**：現在 `timeline.js` 的字幕秒數是手填的，可以改由 TTS 的
  word boundary 時間軸反推。
- **題庫接線**：`episodes/topics.json` 有 115 個選題，還沒接上自動生腳本。

## 題庫

`episodes/topics.json`：115 個選題，依「症狀 × 環境 × OSI 層級」矩陣展開，分九個系列。
每筆有 `id / series / title / symptom / env / layer / cmd / difficulty / verdict / tags / status`，
`status` 走 `idea → scripted → rendered → published`，可以直接當排程表用。
