# 背景音樂：可以用什麼、不能用什麼

## ❌ 不能用：YouTube 上的「深度睡眠／放鬆音樂」影片

那些影片的音檔**有著作權**。標題寫「無廣告」指的是影片沒插廣告，不是作者放棄版權。
拿去用會發生：

1. **Content ID 自動比對** → 你的影片被下版權聲明，廣告收益全歸原作者，或整支被封鎖。
2. **累積 3 次版權警告** → 頻道直接關閉。
3. 商業用途（智生活是公司帳號）風險更高，可能被求償。

而且睡眠音樂是 60–70 BPM 的慢速氛圍樂，跟排錯短影音「快、準、乾脆」的節奏正好相反，
配上去只會讓觀眾滑掉。**短影音要的是 90–110 BPM 的輕快 lo-fi 或 corporate ambient。**

## ✅ 可以用：這四個來源

| 來源 | 授權 | 要不要標註 | 網址 |
|---|---|---|---|
| **YouTube 音效庫** | 平台自有授權 | 部分要 | studio.youtube.com → 音效庫 |
| **Pixabay Music** | Pixabay 授權（近似 CC0） | 不用 | pixabay.com/music |
| **Free Music Archive** | 篩選 CC0 / CC-BY | CC-BY 要 | freemusicarchive.org |
| **Incompetech**（Kevin MacLeod） | CC-BY 4.0 | 要 | incompetech.com |

搜尋關鍵字建議：`lo-fi tech`、`corporate ambient`、`minimal upbeat`、`tutorial background`。

**最安全的是 YouTube 音效庫**：直接在 YouTube Studio 裡下載，Content ID 不會誤判自家素材。
若三個平台都要發，Pixabay 最省事（不用標註、可商用）。

## 怎麼放進影片

把音樂檔放成 `assets/bgm.mp3`，然後：

```bash
./mix.sh ep01 assets/bgm.mp3
```

`mix.sh` 會把音樂壓到 -22dB，並且用 sidechain ducking 讓智寶一開口音樂就自動退到後面，
講完再回來 —— 不用手動剪。

> 我沒有替你下載任何音樂：這個容器的網路政策擋掉了所有音樂網站，
> 而且素材授權該由你這邊確認後再選，不該由我代決定。
