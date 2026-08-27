# 智生活短影音 — 專案落地交接文件

> 產出環境：Claude Code 雲端 session（Linux 容器，暫時性）
> 目標落地位置：`D:\智生活短影音`
> 本機環境前提：Windows 11、Python + uv + git、**沒有 Node/npm**、有 Office
> 最後更新：2026-08-27

---

## 0. 怎麼把檔案落地（先做這一步）

所有程式碼都已推上 GitHub。本機有 git，直接 clone 是最可靠的方式
（不要用複製貼上還原原始碼，`scene.html` 有 1 萬字元，貼錯一個字就壞）：

```powershell
cd D:\智生活短影音
git clone -b claude/24hr-continuous-short-video-stream-m0126j `
  https://github.com/dcba08015-cyber/english-planet.git
cd english-planet\video
```

沒有 git 或懶得裝：GitHub 該分支頁面 → **Code → Download ZIP** → 解壓到 `D:\智生活短影音`。

**注意**：`out/`（成品 mp4）和 `frames/`（1080 張 PNG）刻意沒進版控（太大，且可重新產生）。
成品影片是透過對話的檔案卡片傳給使用者的，需要的話另存。

---

## 1. 專案目標與整體架構

### 目標
建立「24 小時無間斷短影音流」，主題為**網路障礙排錯教學**，主持角色為智生活科技吉祥物**智寶**。

「24 小時」拆成兩件不同的事，兩者互補：

| | A. 高頻短影音流 | B. 24h 循環直播 |
|---|---|---|
| 形式 | 每天 8–15 支 30–60s 直式短片，發 Reels / Shorts / TikTok | YouTube Live 循環播放短片庫 |
| 目的 | 吃演算法推薦、擴散 | 佔住「24/7 網路排錯」長尾搜尋、當內容水庫 |
| 成本 | 生產成本高 | 一台小 VPS + ffmpeg，近乎零人力 |
| 現況 | **已完成生產端 v1** | 尚未開始 |

### 架構

```
episodes/topics.json        題庫（115 個選題）
        ↓ 選題
episodes/ep01.json          單集資料（旁白文字 + 時間點）
        ↓
scene.html + timeline.js    畫面：HTML/SVG 在瀏覽器裡畫，setT(t) 決定第 t 秒長什麼樣
        ↓ render.py（Playwright 逐格截圖）
frames/00000.png … 01079.png
        ↓ encode.py（ffmpeg）
out/zhibao-ep01.mp4         無聲成品
        ↓ voice.py / make_ep01.py（edge-tts）
out/ep01-vo.wav             對齊時間軸的旁白
        ↓ mix.sh / make_ep01.py（ffmpeg，含 ducking）
out/zhibao-ep01-voiced.mp4  最終成品
```

核心設計：**`setT(t)` 是純函式** —— 同一個 t 永遠畫出完全相同的一格。
所以渲染可中斷、可重跑、可平行化，也不會有動畫時序飄移。

---

## 2. 已拍板的設計決策與理由

| 決策 | 理由 |
|---|---|
| **不做「AI 分身」真人主持** | 網路排錯是技術信任型內容，AI 生成人臉被抓到會讓頻道權威歸零。改用吉祥物智寶，沒有 uncanny valley、沒有信任問題，還是品牌識別 |
| **用 HTML/SVG 畫影片，不用 AE / 剪輯軟體** | 內容主體是終端機畫面和拓樸圖，本來就是 HTML 的強項。而且能「用資料驅動」批次產出上百支，這是 24h 內容流的前提 |
| **一集 = 一份 JSON 資料** | 換一集只改 `STEPS` 陣列（指令、輸出、判讀、字幕、台詞），不動程式碼 |
| **固定 4 段模板**：鉤子 → 一行指令 → 判讀（兩分支）→ 解法 + 下集串聯 | 固定結構才能自動化，觀眾也會養成期待感 |
| **不抓 YouTube 的音樂當 BGM** | 有著作權，會被 Content ID 下架、收益轉走、累積 3 次警告關頻道。公司帳號風險更高 |
| **不用固定間隔發片** | 演算法與風控都認得固定節奏。要用 ±40% 隨機 jitter，並照作息加權 |
| **每天 8–15 支，不是每 20 分鐘一支** | 這是可持續且不觸發垃圾內容判定的甜蜜點。「不間斷」靠 B 方案（循環直播）達成 |
| **先手工驗證模板，再蓋自動化工廠** | 先蓋工廠再找產品是這類專案最常見的死法。建議先手工做 EP02–EP05 |
| **智寶用 SVG 重畫，不用點陣圖** | 要驅動表情（normal / alert / happy）、眨眼、浮動、手臂擺動，向量才能程式化控制 |

---

## 3. 技術選型

| 用途 | 選擇 | Windows 安裝 | 備註 |
|---|---|---|---|
| 畫面 | HTML + CSS + 內嵌 SVG | — | 字型用 Google Fonts 的 Noto Sans TC / JetBrains Mono |
| 逐格渲染 | **Playwright for Python** | `pip install playwright` + `playwright install chromium` | **本機沒有 Node，所以走 Python 版 `render.py`**。repo 裡的 `render.mjs` 是 Node 版，功能相同，本機用不到 |
| 影片編碼 | ffmpeg（libx264） | `pip install imageio-ffmpeg` | **不用另外裝 ffmpeg**，這個 pip 套件內含執行檔 |
| 中文配音 | **edge-tts**（Edge Neural TTS） | `pip install edge-tts` | 免費、不用 API 金鑰。語音 `zh-TW-HsiaoChenNeural`（女）／`zh-TW-YunJheNeural`（男）／`zh-TW-HsiaoYuNeural`（女，活潑） |
| 音訊混音 | ffmpeg `sidechaincompress` | 同上 | 智寶開口時 BGM 自動退到後面 |
| 版控 | git / GitHub | 已有 | 分支 `claude/24hr-continuous-short-video-stream-m0126j` |

**沒有用到任何付費 API。** 全部免費。

### 一次裝好（PowerShell）

```powershell
cd D:\智生活短影音\english-planet\video
pip install playwright imageio-ffmpeg edge-tts
playwright install chromium
```

用 uv 的話：`uv pip install playwright imageio-ffmpeg edge-tts`

---

## 4. 檔案清單（相對於 `english-planet/video/`）

### 主要程式

| 檔名 | 用途 | Windows 可跑 |
|---|---|---|
| `scene.html` | 版面 + 智寶 SVG + 終端機卡片 + 字幕 + 品牌列 | — |
| `timeline.js` | **時間軸。改這裡的 `STEPS` 陣列 = 換一集** | — |
| `render.py` | Playwright 逐格截圖 → `frames/`（Python 版） | ✅ |
| `encode.py` | `frames/` → `out/*.mp4`（Python 版） | ✅ |
| `voice.py` | 讀 `episodes/*.json` 產生對齊時間軸的旁白 wav | ✅ |
| `make_ep01.py` | **獨立單檔版**：不用整包程式碼，配音+合成一次做完 | ✅ |
| `render.mjs` | Node 版渲染器 | ❌ 本機無 Node |
| `encode.sh` / `mix.sh` | bash 版編碼與混音 | ❌ PowerShell 不認得 |

### 資料與文件

| 檔名 | 內容 |
|---|---|
| `episodes/topics.json` | **題庫：115 個選題**，九個系列 |
| `episodes/ep01.json` | EP01 的旁白文字與時間點 |
| `assets/BGM-授權說明.md` | 背景音樂能用什麼、不能用什麼 |
| `README.md` | 操作說明 |
| `HANDOVER.md` | 本文件 |

### Windows 完整操作流程

```powershell
cd D:\智生活短影音\english-planet\video

python render.py            # 渲染 1080 格（約 10 分鐘）
python encode.py ep01       # → out\zhibao-ep01.mp4（無聲）
python voice.py ep01        # → out\ep01-vo.wav（台灣女聲）
python make_ep01.py out\zhibao-ep01.mp4    # → 合成配音版
```

快速預覽（畫面對版用，30 秒渲完）：
```powershell
python render.py --scale 0.5 --fps 10
python encode.py preview --fps 10
```

---

## 5. 腳本／文案／素材清單

### EP01「WiFi 滿格卻上不了網？兇手 90% 是它」— 已完成

36 秒，1080×1920，30fps。結構：

```
0–4s    鉤子：WiFi 滿格 卻上不了網？／三行指令，三十秒抓出兇手
4–13s   STEP 1  ping 192.168.1.1      → 通了，你到分享器沒事
13–22s  STEP 2  ping 8.8.8.8          → 也通，對外線路沒事
22–31s  STEP 3  nslookup google.com   → Server failed，兇手是 DNS
31–36s  解法：DNS 改 1.1.1.1 / 8.8.8.8 + 追蹤 CTA
```

旁白 13 句（完整文字在 `episodes/ep01.json` 與 `make_ep01.py` 上方的 `NARRATION`）。

### 題庫：115 題，九個系列

| 系列 | 題數 | 定位 |
|---|---|---|
| A. 連得上但沒網路 | 15 | 流量最大的入門池 |
| B. 網路很慢 | 15 | 搜尋量高 |
| C. 斷斷續續 | 10 | 難度中等，留存好 |
| D. 特定服務壞掉 | 15 | 長尾 |
| E. 指令教學 | 15 | 工具型，收藏率高 |
| F. 觀念 | 15 | **分享率最高** |
| G. 資安 | 10 | 話題性 |
| H. 企業／辦公室 | 10 | 打 B2B，對智生活的客群有用 |
| I. 快問快答 | 10 | 15 秒超短片，衝發佈頻率 |

難度分布：零基礎 47、有概念 47、進階 21。
**建議前 30 支只發難度 1**，先養觀眾再上進階。

每筆欄位：`id / series / title / symptom / env / layer / cmd / difficulty / verdict / tags / status`
`status` 走 `idea → scripted → rendered → published`，可直接當排程表。

### 角色素材

智寶目前是**照官方形象用 SVG 重畫**的向量版（白色圓身、小耳朵、黑豆眼、粉頰、
薄荷綠菱形鼻、黑領結）＋ WiFi 訊號小徽章道具。
表情：`normal` / `alert`（皺眉＋紅色驚嘆號）/ `happy`（彎眼）。

要換成官方原始素材：把 `scene.html` 裡 `<svg id="char">` 整段換掉，保留這些 id 讓
`drawChar()` 能驅動：`eyeL` `eyeR` `eyeLh` `eyeRh` `mouth` `emo` `w1` `w2` `armL` `armR`。

### 還缺的素材

- **背景音樂**：一首 90–110 BPM 的 lo-fi tech / corporate ambient。
  來源見 `assets/BGM-授權說明.md`，建議 YouTube 音效庫或 Pixabay Music。
- **片頭／片尾 3 秒動態 logo**（選配）

---

## 6. 待辦事項與已知問題

### 待辦（依優先順序）

1. **本機跑出 EP01 配音版** — 雲端環境的 TTS 被擋，必須在本機做（見下方已知問題）
2. **手工做 EP02–EP05**，驗證模板在不同題型都站得住。建議挑：
   `A02 手機有網路電腦沒有` / `F01 IP 是門牌 DNS 是電話簿` / `I08 電梯為何沒訊號` / `B02 測速 300M 卻很卡`
3. **取得背景音樂**並確認授權
4. **確認智寶的商標使用授權**（對外發佈前必做）
5. 題庫接自動生腳本：`topics.json` → `episodes/*.json` 批次產出
6. 發佈自動化：YouTube Data API v3 / Instagram Graph API / TikTok Content Posting API
7. B 方案 24h 循環直播（VPS + ffmpeg + systemd + playlist 輪替 + watchdog）

### 已知問題

| 問題 | 影響 | 現況 |
|---|---|---|
| **雲端 session 的網路政策擋掉所有 TTS 服務**（`speech.platform.bing.com` 回 403） | 雲端無法產生台灣女聲配音 | 已改為在本機跑 `make_ep01.py`。本機網路正常，edge-tts 可直接用 |
| 同樣擋掉所有音樂網站（Pixabay / Incompetech / FMA 皆不可達） | 雲端無法下載 BGM | 需在本機自行下載並確認授權 |
| 本機沒有 Node/npm | `render.mjs`、`encode.sh`、`mix.sh` 用不到 | 已補 `render.py` / `encode.py` / `make_ep01.py`，全流程純 Python |
| 旁白有 2 句略超出時間格（各約 0.2 秒） | 些微重疊，不影響理解 | `voice.py` / `make_ep01.py` 會印出警告；改短那句文字即可 |
| 字幕秒數目前是手填的 | 換集要人工對時間 | 可改由 TTS 的 word boundary 時間軸反推（待辦） |
| 渲染 1080 格約需 10 分鐘 | 批次產出時是瓶頸 | 可用 `--scale 0.5 --fps 10` 快速預覽；正式輸出再全解析度 |
| 雲端容器是暫時性的，閒置會回收 | 未推上 GitHub 的檔案會消失 | 程式碼全部已推。`out/` 與 `frames/` 未進版控，需要就重新產生 |

### 給本機 session 的提醒

- 所有指令都在 `D:\智生活短影音\english-planet\video` 底下執行
- Windows 路徑用反斜線，但 Python 腳本內部已處理跨平台，直接跑即可
- `python render.py` 會**先刪掉整個 `frames/`** 再重建，中途不要放東西進去
- 手機端流程（**次要**）：只能透過對話的檔案卡片收發成品，無法執行渲染或編碼
