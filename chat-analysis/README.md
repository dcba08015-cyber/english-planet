# Google Chat 群組常見問題統計

分析 Google Chat 群組的歷史訊息，找出**最常被問到的問題有哪些**。

輸出四樣東西：

| 檔案 | 內容 |
|---|---|
| 終端機輸出 | 分類排名、次數、佔比，一眼看完 |
| `report.html` | 視覺化報告：長條圖、每月趨勢、關鍵字、代表性原文 |
| `stats.json` | 完整統計，方便再加工 |
| `questions.csv` | 每一則被判定為問題的訊息＋它的分類，用來人工校對 |

只依賴 Python 3.9+ 標準函式庫。若環境有 `jieba`，中文斷詞會自動改用它；沒有的話走字元 n-gram，一樣能跑。

---

## 步驟一：從 Google Takeout 匯出聊天記錄

1. 開啟 [takeout.google.com](https://takeout.google.com)
2. 點「取消勾選全部」，然後只勾 **Google Chat**
3. 下一步 → 匯出一次 → 檔案類型 `.zip` → 建立匯出
4. 等 Google 寄信給你（資料量大時可能要數小時），下載 zip

解壓後的結構長這樣：

```
Takeout/
└── Google Chat/
    └── Groups/
        └── Space AAAAxxxx/
            ├── group_info.json   ← 群組名稱與成員
            └── messages.json     ← 訊息本體
```

## 步驟二：跑分析

zip 不用解壓，直接餵給它也可以：

```bash
python3 analyze_chat.py --input ~/Downloads/takeout-20260807.zip
```

或指向解壓後的資料夾：

```bash
python3 analyze_chat.py --input ~/Downloads/Takeout/
```

匯出裡通常會有很多個 space（含一對一私訊）。只分析特定群組：

```bash
python3 analyze_chat.py --input ~/Downloads/Takeout/ --space "英文星球"
```

跑完用瀏覽器打開 `output/report.html`。

## 步驟三：調整分類規則（重點）

**第一次跑完，先看「未分類問題裡的高頻關鍵字」那一段。** 那些是內建規則沒抓到的詞，也就是你這個群組真正在討論、但工具還不認識的主題。

把它們補進規則檔，再跑第二次，分類才會貼合你的群組：

```bash
cp rules.example.json my_rules.json
# 編輯 my_rules.json，加入你看到的關鍵字
python3 analyze_chat.py --input ~/Downloads/Takeout/ --rules my_rules.json
```

規則檔格式就是「分類名稱 → 關鍵字陣列」：

```json
{
  "帳號／登入": ["登入", "密碼", "login", "password"],
  "費用／付款": ["費用", "多少錢", "退費", "refund"]
}
```

- 訊息只要含**任一**關鍵字（不分大小寫）就算命中該分類
- 一則訊息可以同時屬於多個分類，所以**佔比加總可能超過 100%**
- 以底線 `_` 開頭的鍵會被忽略，可以拿來寫註解

規則跟資料是分開的，改規則不用重新匯出，重跑很快。抓個兩三輪通常就會收斂。

---

## 所有參數

| 參數 | 說明 |
|---|---|
| `--input` | **必填。** Takeout 的 zip、解壓後資料夾，或單一 `messages.json` |
| `--rules` | 分類規則 JSON；不給就用內建的起步規則 |
| `--space` | 只分析名稱含此字串的群組（子字串比對、不分大小寫） |
| `--out-dir` | 輸出目錄，預設 `output/` |
| `--examples` | 每個分類保留幾則原文範例，預設 5 |

## 判定邏輯

**哪些訊息算「問題」**：含 `?` / `？`，或含中文提問詞（請問、怎麼、如何、為什麼、有沒有、能不能、多少……），或含英文提問句型（how do、what is、can i、anyone know……）。

**會被略過的訊息**：沒有文字內容的（純圖片／檔案），以及 bot 發的（`user_type` 不是 `Human`）。

`questions.csv` 存在就是為了讓你檢查這套判定準不準——掃一遍，如果發現漏抓或誤抓，回頭調規則檔或提問詞清單。

## 已知限制

- **關鍵字比對不是語意理解。** 換句話問同一件事、但沒用到規則裡的詞，就會落到「未分類」。這也是為什麼要看未分類關鍵字、迭代規則。
- **沒有 jieba 時**，中文關鍵字用字元 n-gram 近似，偶爾會切出「裡下載呀」這種半個詞的碎片。想更準就 `pip install jieba`，腳本會自動偵測並改用它。
- **Takeout 的日期格式隨帳號語系變動。** 已支援中文（2025年6月5日）、英文（June 5, 2025 / 5 June 2025）與 ISO 格式；如果趨勢圖大量落在 `unknown`，代表日期沒解析成功，把 `stats.json` 裡的 `raw_date` 樣本回報一下就能補上格式。
- **Takeout 匯出的是「你看得到的」訊息。** 你加入群組之前的歷史、或已被刪除的訊息不會在裡面。
