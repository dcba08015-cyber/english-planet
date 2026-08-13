#!/usr/bin/env python3
"""Google Chat 群組常見問題統計工具。

讀取 Google Takeout 匯出的 Google Chat 資料，找出群組裡最常被問到的問題，
輸出：
  - 終端機的統計表（分類排名、次數、佔比）
  - stats.json      機器可讀的完整統計
  - questions.csv   所有被判定為「問題」的訊息，含分類，方便人工校對
  - report.html     可直接用瀏覽器開啟的視覺化報告

用法：
    python3 analyze_chat.py --input ~/Downloads/takeout.zip
    python3 analyze_chat.py --input ~/Downloads/Takeout/ --rules my_rules.json
    python3 analyze_chat.py --input ... --space "英文星球"

只用標準函式庫。若環境有安裝 jieba，中文斷詞會自動改用 jieba，
沒有的話會退回字元 n-gram，兩者都能跑出可用的關鍵字排名。
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

try:  # 選用相依，沒有也不影響執行
    import jieba  # type: ignore

    HAS_JIEBA = True
except ImportError:  # pragma: no cover
    jieba = None  # type: ignore
    HAS_JIEBA = False


# --------------------------------------------------------------------------
# 讀取 Takeout 資料
# --------------------------------------------------------------------------

MESSAGES_FILENAME = "messages.json"
GROUP_INFO_FILENAME = "group_info.json"


class Message:
    """一則聊天訊息。"""

    __slots__ = ("space", "author", "email", "text", "dt", "raw_date")

    def __init__(
        self,
        space: str,
        author: str,
        email: str,
        text: str,
        dt: datetime | None,
        raw_date: str,
    ) -> None:
        self.space = space
        self.author = author
        self.email = email
        self.text = text
        self.dt = dt
        self.raw_date = raw_date


def _iter_takeout_files(root: Path) -> Iterable[tuple[str, bytes]]:
    """走訪 Takeout 目錄或 zip，吐出 (相對路徑, 檔案內容)。"""
    if root.is_file() and root.suffix.lower() == ".zip":
        with zipfile.ZipFile(root) as zf:
            for info in zf.infolist():
                name = os.path.basename(info.filename)
                if name in (MESSAGES_FILENAME, GROUP_INFO_FILENAME):
                    yield info.filename, zf.read(info)
        return

    if root.is_file():
        # 直接指到單一 messages.json
        yield str(root), root.read_bytes()
        return

    for path in sorted(root.rglob("*.json")):
        if path.name in (MESSAGES_FILENAME, GROUP_INFO_FILENAME):
            yield str(path.relative_to(root)), path.read_bytes()


# Takeout 的日期字串會隨帳號語系改變，所以準備多套解析策略。
_MONTHS = {
    m.lower(): i
    for i, m in enumerate(
        [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ],
        start=1,
    )
}
_MONTHS.update({m[:3]: i for m, i in list(_MONTHS.items())})

_CJK_DATE_RE = re.compile(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_EN_DATE_RE = re.compile(
    r"([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})"
)
_ISO_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_TIME_RE = re.compile(r"(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?")


def parse_date(raw: str) -> datetime | None:
    """盡力從 Takeout 的日期字串解析出 datetime，失敗回傳 None。"""
    if not raw:
        return None

    year = month = day = None

    m = _ISO_DATE_RE.search(raw)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year is None:
        m = _CJK_DATE_RE.search(raw)
        if m:
            year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year is None:
        m = _EN_DATE_RE.search(raw)
        if m:
            if m.group(1):
                month = _MONTHS.get(m.group(1).lower())
                day, year = int(m.group(2)), int(m.group(3))
            else:
                day = int(m.group(4))
                month = _MONTHS.get(m.group(5).lower())
                year = int(m.group(6))
    if year is None or month is None or day is None:
        return None

    hour = minute = second = 0
    tm = _TIME_RE.search(raw)
    if tm:
        hour, minute = int(tm.group(1)), int(tm.group(2))
        second = int(tm.group(3) or 0)
        ampm = (tm.group(4) or "").lower()
        # 中文語系的 Takeout 用「凌晨/清晨/上午/中午/下午/晚上」代替 AM/PM。
        # 注意「凌晨12:38」是 00:38，不是 12:38。
        if any(mark in raw for mark in ("下午", "晚上", "傍晚")):
            ampm = ampm or "pm"
        elif any(mark in raw for mark in ("凌晨", "清晨", "上午", "早上")):
            ampm = ampm or "am"
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0
    try:
        return datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None


def load_messages(input_path: Path, space_filter: str | None = None) -> list[Message]:
    """從 Takeout 載入所有訊息。space_filter 會比對群組名稱（子字串、不分大小寫）。"""
    space_names: dict[str, str] = {}
    message_payloads: list[tuple[str, Any]] = []

    for rel_path, data in _iter_takeout_files(input_path):
        try:
            payload = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            print(f"[warn] 略過無法解析的檔案 {rel_path}: {exc}", file=sys.stderr)
            continue

        folder = os.path.dirname(rel_path)
        if os.path.basename(rel_path) == GROUP_INFO_FILENAME:
            name = payload.get("name") or os.path.basename(folder)
            space_names[folder] = name
        else:
            message_payloads.append((folder, payload))

    messages: list[Message] = []
    for folder, payload in message_payloads:
        space = space_names.get(folder) or os.path.basename(folder) or "(unknown)"
        if space_filter and space_filter.lower() not in space.lower():
            continue
        for item in payload.get("messages", []):
            text = (item.get("text") or "").strip()
            if not text:
                continue  # 純圖片／檔案訊息對問題統計沒幫助
            creator = item.get("creator") or {}
            if (creator.get("user_type") or "Human") != "Human":
                continue  # 略過 bot
            raw_date = item.get("created_date") or ""
            messages.append(
                Message(
                    space=space,
                    author=creator.get("name") or "(unknown)",
                    email=creator.get("email") or "",
                    text=text,
                    dt=parse_date(raw_date),
                    raw_date=raw_date,
                )
            )
    return messages


# --------------------------------------------------------------------------
# 問題判定
# --------------------------------------------------------------------------

_QUESTION_MARKS = ("?", "？")

_ZH_QUESTION_PATTERNS = [
    "請問", "怎麼", "怎樣", "怎么", "如何", "為什麼", "為何", "为什么",
    "什麼", "甚麼", "什么", "哪裡", "哪里", "哪個", "哪一", "是不是",
    "有沒有", "有没有", "能不能", "可不可以", "要不要", "可以嗎", "行嗎",
    "多少", "幾點", "几点", "誰知道", "谁知道", "求助", "幫忙看", "教學",
    "怎麼辦", "怎么办", "是否",
]

_EN_QUESTION_PATTERNS = [
    "how do", "how to", "how can", "how does", "how much", "how many",
    "what is", "what's", "what are", "why is", "why does", "why do",
    "when is", "when do", "where is", "where can", "which one",
    "who knows", "anyone know", "any idea", "can i", "can you", "could you",
    "should i", "is there", "are there", "do you know", "does anyone",
    "need help", "please help",
]


# 不是疑問句、但同樣需要別人回應的「請求」。工作群組裡這類訊息往往比問句還多，
# 例如工程完工後回報「…已更換數據機 幫確認」，就必須有人接手確認結案。
_REQUEST_PATTERNS = [
    "麻煩", "煩請", "請協助", "請幫", "幫忙", "幫我", "幫確認", "幫查", "幫看",
    "協助確認", "協助查", "協助處理", "再請", "需要協助", "拜託", "請支援",
    "please help", "pls help", "help me", "could you", "can you",
]


def is_question(text: str) -> bool:
    """判斷一則訊息是否算是「在問問題」。"""
    if any(mark in text for mark in _QUESTION_MARKS):
        return True
    lowered = text.lower()
    if any(p in text for p in _ZH_QUESTION_PATTERNS):
        return True
    if any(p in lowered for p in _EN_QUESTION_PATTERNS):
        return True
    return False


def is_request(text: str) -> bool:
    """判斷是否為請求他人協助的訊息（非疑問句）。"""
    lowered = text.lower()
    return any(p in text or p in lowered for p in _REQUEST_PATTERNS)


def classify_kind(text: str) -> str | None:
    """回傳 '問題'、'請求'，或 None（不需要回應的一般訊息）。"""
    if is_question(text):
        return "問題"
    if is_request(text):
        return "請求"
    return None


# --------------------------------------------------------------------------
# 分類規則
# --------------------------------------------------------------------------

# 起步用的通用規則。跑第一次之後，看「自動發現的關鍵字」再回頭補這份規則，
# 或用 --rules 指定自己的 JSON 檔（格式相同）。
DEFAULT_RULES: dict[str, list[str]] = {
    "帳號／登入問題": ["登入", "登陆", "帳號", "账号", "密碼", "密码", "註冊", "注册",
                       "驗證", "验证", "login", "sign in", "signup", "password", "account"],
    "費用／付款": ["費用", "费用", "價格", "价格", "多少錢", "多少钱", "付款", "刷卡",
                   "退費", "退费", "發票", "发票", "訂閱", "订阅", "price", "cost",
                   "payment", "refund", "invoice", "subscription"],
    "課程／內容": ["課程", "课程", "教材", "講義", "讲义", "影片", "视频", "作業", "作业",
                   "進度", "进度", "course", "lesson", "material", "homework", "video"],
    "時間／排程": ["時間", "时间", "什麼時候", "什么时候", "幾點", "几点", "日期", "改期",
                   "請假", "请假", "排課", "排课", "schedule", "when is", "reschedule"],
    "技術／操作問題": ["當機", "当机", "壞掉", "坏掉", "打不開", "打不开", "錯誤", "错误",
                       "無法", "无法", "連不上", "连不上", "跑不動", "跑不动", "bug",
                       "error", "crash", "not working", "broken", "can't open"],
    "使用教學": ["怎麼用", "怎么用", "如何使用", "教學", "教学", "步驟", "步骤", "設定",
                 "设定", "how to use", "tutorial", "setup", "how do i"],
}


def load_rules(path: Path | None) -> dict[str, list[str]]:
    if path is None:
        return DEFAULT_RULES
    with path.open(encoding="utf-8") as fh:
        rules = json.load(fh)
    if not isinstance(rules, dict):
        raise ValueError("規則檔必須是 {分類名稱: [關鍵字, ...]} 的 JSON 物件")
    cleaned = {}
    for name, keywords in rules.items():
        if name.startswith("_"):
            continue  # 底線開頭的鍵當作註解
        if not isinstance(keywords, list):
            raise ValueError(f"分類「{name}」的值必須是關鍵字陣列，實際是 {type(keywords).__name__}")
        cleaned[name] = [str(x) for x in keywords]
    return cleaned


UNCATEGORIZED = "未分類"


def categorize(text: str, rules: dict[str, list[str]]) -> list[str]:
    """回傳這則訊息命中的所有分類；沒命中則回傳 [UNCATEGORIZED]。"""
    lowered = text.lower()
    hits = [
        category
        for category, keywords in rules.items()
        if any(kw.lower() in lowered for kw in keywords)
    ]
    return hits or [UNCATEGORIZED]


# --------------------------------------------------------------------------
# 關鍵字自動發現
# --------------------------------------------------------------------------

_CJK_RUN_RE = re.compile(r"[一-鿿]+")
_EN_WORD_RE = re.compile(r"[a-z][a-z'\-]{1,}")

_ZH_STOPWORDS = set(
    "的了是我你他她它們我们你们他们這这那有在和跟與与就都也很不沒没要會会可以"
    "請请問问一個个之後后前面上下大小多少為为什麼么麼嗎吗呢啊喔唷欸吧啦哦嘿"
    "還还再又才但而且或如果因為因为所以然後然后現在现在時候时候可能應該应该"
    "謝謝谢谢感恩大家老師老师同學同学各位好嗨"
)

# 虛詞：出現在 n-gram 內部就代表這個 gram 跨越了詞界，例如「課程的教」「教材要去」。
# 只用在無 jieba 的字元 n-gram 路徑，刻意保持精簡，避免誤殺「費用」這類含常用字的實詞。
_ZH_PARTICLES = set("的了地得是在和跟與与就都也很不沒没要會会有我你他她它這这那之而且或把被給给讓让對对從从到呀嗎吗呢啊吧喔麼么嘛")

_EN_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "so", "to", "of",
    "in", "on", "at", "for", "with", "about", "from", "by", "is", "are", "was",
    "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
    "my", "your", "his", "its", "our", "their", "this", "that", "these", "those",
    "what", "which", "who", "whom", "when", "where", "why", "how", "can", "could",
    "should", "would", "will", "just", "not", "no", "yes", "please", "thanks",
    "thank", "hi", "hello", "hey", "any", "some", "all", "one", "there", "here",
    "get", "got", "know", "like", "want", "need", "more", "very", "much", "also",
}


def _tokenize_english(text: str) -> list[str]:
    return [w for w in _EN_WORD_RE.findall(text.lower()) if w not in _EN_STOPWORDS]


def _tokenize_chinese(text: str) -> list[str]:
    """中文詞彙候選。有 jieba 用 jieba，否則用 2~4 字元 n-gram。"""
    if HAS_JIEBA:
        tokens = []
        for run in _CJK_RUN_RE.findall(text):
            tokens.extend(
                t for t in jieba.cut(run) if len(t) >= 2 and not set(t) <= _ZH_STOPWORDS
            )
        return tokens

    grams: list[str] = []
    for run in _CJK_RUN_RE.findall(text):
        for n in (2, 3, 4):
            for i in range(len(run) - n + 1):
                gram = run[i : i + n]
                if gram[0] in _ZH_STOPWORDS or gram[-1] in _ZH_STOPWORDS:
                    continue
                if set(gram) <= _ZH_STOPWORDS:
                    continue
                # 內部出現虛詞 = 這段字跨過了詞的邊界，不是一個真的詞
                if n >= 3 and any(ch in _ZH_PARTICLES for ch in gram[1:-1]):
                    continue
                grams.append(gram)
    return grams


def discover_keywords(texts: list[str], top_n: int = 30) -> list[tuple[str, int]]:
    """從一批文字裡找出高頻詞。每則訊息同一個詞只算一次，避免單則洗版。"""
    counter: Counter[str] = Counter()
    for text in texts:
        tokens = set(_tokenize_chinese(text)) | set(_tokenize_english(text))
        counter.update(tokens)

    candidates = [(w, c) for w, c in counter.items() if c >= 2]
    # 長詞優先：若短詞幾乎都出現在某個長詞裡面，就把短詞吸收掉。
    candidates.sort(key=lambda x: (-len(x[0]), -x[1]))
    kept: list[tuple[str, int]] = []
    for word, count in candidates:
        absorbed = any(
            word != longer and word in longer and longer_count >= count * 0.8
            for longer, longer_count in kept
        )
        if not absorbed:
            kept.append((word, count))
    kept.sort(key=lambda x: -x[1])
    return kept[:top_n]


# --------------------------------------------------------------------------
# 統計
# --------------------------------------------------------------------------


OTHER_ROLE = "其他／未標註"

# 群組裡用 @姓名(單位) 的方式點名，例如「@廖麗惠(技術客服)」「@張智鈞(台中工程)」。
# 括號裡就是對方的單位，據此可以判斷一則訊息是丟給誰處理的。
_MENTION_RE = re.compile(r"@([^\s@()（）]{1,12})[（(]([^)）]{1,14})[)）]")


def load_targets(path: Path | None) -> dict[str, list[str]]:
    """讀取收件單位對照表：{單位: [會出現在括號裡的字串, ...]}。"""
    if path is None:
        return {}
    with path.open(encoding="utf-8") as fh:
        targets = json.load(fh)
    return {k: [str(x) for x in v] for k, v in targets.items() if not k.startswith("_")}


def mention_targets(text: str, target_map: dict[str, list[str]]) -> list[str]:
    """回傳這則訊息點名了哪些單位；沒點名任何人回傳空 list。"""
    if not target_map:
        return []
    hits: set[str] = set()
    for _name, unit in _MENTION_RE.findall(text):
        for target, markers in target_map.items():
            if any(marker in unit for marker in markers):
                hits.add(target)
                break  # 對照表由上而下，第一個命中的優先
    return sorted(hits)


def load_roles(path: Path | None) -> dict[str, list[str]]:
    """讀取角色對照表：{角色名稱: [會出現在發話者名字裡的字串, ...]}。"""
    if path is None:
        return {}
    with path.open(encoding="utf-8") as fh:
        roles = json.load(fh)
    return {k: [str(x) for x in v] for k, v in roles.items() if not k.startswith("_")}


def role_of(author: str, roles: dict[str, list[str]]) -> str:
    for role, markers in roles.items():
        if any(marker in author for marker in markers):
            return role
    return OTHER_ROLE


def build_stats(
    messages: list[Message],
    rules: dict[str, list[str]],
    examples_per_category: int = 5,
    roles: dict[str, list[str]] | None = None,
    targets: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    roles = roles or {}
    targets = targets or {}
    questions = [m for m in messages if classify_kind(m.text)]

    category_counts: Counter[str] = Counter()
    category_examples: dict[str, list[dict[str, str]]] = defaultdict(list)
    monthly: Counter[str] = Counter()
    monthly_by_category: dict[str, Counter[str]] = defaultdict(Counter)
    askers: Counter[str] = Counter()
    kind_counts: Counter[str] = Counter()
    role_counts: Counter[str] = Counter()
    role_category: dict[str, Counter[str]] = defaultdict(Counter)
    target_counts: Counter[str] = Counter()
    target_category: dict[str, Counter[str]] = defaultdict(Counter)
    target_examples: dict[str, list[dict[str, str]]] = defaultdict(list)

    for msg in questions:
        cats = categorize(msg.text, rules)
        month = msg.dt.strftime("%Y-%m") if msg.dt else "unknown"
        monthly[month] += 1
        askers[msg.author] += 1
        kind_counts[classify_kind(msg.text) or "?"] += 1
        r = role_of(msg.author, roles)
        role_counts[r] += 1
        for cat in cats:
            role_category[r][cat] += 1
        for tgt in mention_targets(msg.text, targets):
            target_counts[tgt] += 1
            for cat in cats:
                target_category[tgt][cat] += 1
            if len(target_examples[tgt]) < examples_per_category:
                target_examples[tgt].append({
                    "author": msg.author,
                    "date": msg.dt.strftime("%Y-%m-%d") if msg.dt else msg.raw_date,
                    "text": msg.text[:300],
                })
        for cat in cats:
            category_counts[cat] += 1
            monthly_by_category[cat][month] += 1
            if len(category_examples[cat]) < examples_per_category:
                category_examples[cat].append(
                    {
                        "author": msg.author,
                        "date": msg.dt.strftime("%Y-%m-%d") if msg.dt else msg.raw_date,
                        "text": msg.text[:300],
                    }
                )

    total_q = len(questions)
    uncategorized_texts = [
        m.text for m in questions if categorize(m.text, rules) == [UNCATEGORIZED]
    ]
    role_breakdown = {
        r: {
            "total": role_counts[r],
            "categories": [
                {"name": c, "count": n, "share": round(n / role_counts[r], 4)}
                for c, n in role_category[r].most_common()
            ],
        }
        for r in sorted(role_counts, key=lambda x: -role_counts[x])
    }

    dated = [m.dt for m in messages if m.dt]
    date_range = (
        {
            "start": min(dated).strftime("%Y-%m-%d"),
            "end": max(dated).strftime("%Y-%m-%d"),
        }
        if dated
        else {"start": None, "end": None}
    )

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "tokenizer": "jieba" if HAS_JIEBA else "char-ngram",
        "totals": {
            "messages": len(messages),
            "questions": total_q,
            "question_ratio": round(total_q / len(messages), 4) if messages else 0.0,
            "participants": len({m.author for m in messages}),
            "spaces": sorted({m.space for m in messages}),
            "by_kind": dict(kind_counts),
        },
        "by_role": role_breakdown,
        "by_target": {
            t: {
                "total": target_counts[t],
                "categories": [
                    {"name": c, "count": n, "share": round(n / target_counts[t], 4)}
                    for c, n in target_category[t].most_common()
                ],
                "examples": target_examples[t],
            }
            for t in sorted(target_counts, key=lambda x: -target_counts[x])
        },
        "date_range": date_range,
        "categories": [
            {
                "name": name,
                "count": count,
                "share": round(count / total_q, 4) if total_q else 0.0,
                "examples": category_examples[name],
            }
            for name, count in category_counts.most_common()
        ],
        "monthly": [{"month": m, "count": c} for m, c in sorted(monthly.items())],
        "monthly_by_category": {
            cat: dict(sorted(counts.items())) for cat, counts in monthly_by_category.items()
        },
        "top_askers": [
            {"author": a, "count": c} for a, c in askers.most_common(15)
        ],
        "discovered_keywords_all": [
            {"keyword": w, "count": c}
            for w, c in discover_keywords([m.text for m in questions], top_n=40)
        ],
        "discovered_keywords_uncategorized": [
            {"keyword": w, "count": c}
            for w, c in discover_keywords(uncategorized_texts, top_n=30)
        ],
    }


# --------------------------------------------------------------------------
# 輸出
# --------------------------------------------------------------------------


def _pad(text: str, width: int) -> str:
    """靠左補到指定顯示寬度。中日韓字元算兩格，否則終端機的欄位會歪掉。"""
    from unicodedata import east_asian_width

    shown = sum(2 if east_asian_width(ch) in ("W", "F") else 1 for ch in text)
    return text + " " * max(0, width - shown)


def print_report(stats: dict[str, Any]) -> None:
    t = stats["totals"]
    dr = stats["date_range"]
    print()
    print("=" * 62)
    print("  Google Chat 群組問題統計")
    print("=" * 62)
    print(f"  群組       : {', '.join(t['spaces']) or '(none)'}")
    print(f"  期間       : {dr['start'] or '?'} ~ {dr['end'] or '?'}")
    print(f"  總訊息數   : {t['messages']:,}")
    print(f"  需回應訊息 : {t['questions']:,} ({t['question_ratio']:.1%})")
    kinds = t.get("by_kind") or {}
    if kinds:
        detail = "、".join(f"{k} {v:,}" for k, v in sorted(kinds.items()))
        print(f"               └ {detail}")
    print(f"  參與人數   : {t['participants']:,}")
    print(f"  中文斷詞   : {stats['tokenizer']}")
    print()

    print("── 問題分類排名 " + "─" * 45)
    if not stats["categories"]:
        print("  (沒有偵測到問題)")
    max_share = max((c["share"] for c in stats["categories"]), default=0)
    for i, cat in enumerate(stats["categories"], 1):
        bar = "█" * max(1, round(cat["share"] / max_share * 32)) if max_share else ""
        print(
            f"  {i:2}. {_pad(cat['name'], 20)} {cat['count']:>5}  "
            f"{cat['share']:>6.1%}  {bar}"
        )
    print("      註：一則訊息可同時命中多個分類，故佔比加總可能超過 100%。")
    print()

    def print_chips(keywords: list[dict[str, Any]]) -> None:
        for i in range(0, len(keywords), 4):
            row = keywords[i : i + 4]
            print("  " + "".join(_pad(f"{k['keyword']}({k['count']})", 20) for k in row))

    print("── 自動發現的高頻關鍵字（全部問題） " + "─" * 26)
    print_chips(stats["discovered_keywords_all"][:20])
    print()

    if stats["discovered_keywords_uncategorized"]:
        print("── 未分類問題裡的高頻關鍵字（建議加進規則檔） " + "─" * 16)
        print_chips(stats["discovered_keywords_uncategorized"][:20])
        print()

    by_role = stats.get("by_role") or {}
    if by_role:
        print("── 依發話單位拆分（各單位問最多的前 5 類） " + "─" * 18)
        for role, data in by_role.items():
            print(f"  ▸ {role}（{data['total']:,} 則）")
            for c in data["categories"][:5]:
                print(f"      {_pad(c['name'], 22)} {c['count']:>5}  {c['share']:>6.1%}")
            print()

    print("── 最常發問的人 " + "─" * 45)
    for i, a in enumerate(stats["top_askers"][:10], 1):
        print(f"  {i:2}. {_pad(a['author'], 26)} {a['count']:>5}")
    print()

REPORT_CSS = """
:root {
  --ground:    #eef1f4;
  --surface:   #ffffff;
  --surface-2: #f6f8fa;
  --ink:       #101820;
  --muted:     #5a6975;
  --rule:      #d7dee4;
  --grid:      #e5eaee;
  --eng:       #a85820;
  --sup:       #0d6b78;
  --neutral:   #7b8996;
  --accent:    #0d6b78;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:    #0e1418;
    --surface:   #161e24;
    --surface-2: #1b242b;
    --ink:       #e6ecf0;
    --muted:     #8fa0ad;
    --rule:      #2a353e;
    --grid:      #212c34;
    --eng:       #d9884a;
    --sup:       #4bb3c0;
    --neutral:   #6e7f8c;
    --accent:    #4bb3c0;
  }
}
:root[data-theme="dark"] {
  --ground:    #0e1418;
  --surface:   #161e24;
  --surface-2: #1b242b;
  --ink:       #e6ecf0;
  --muted:     #8fa0ad;
  --rule:      #2a353e;
  --grid:      #212c34;
  --eng:       #d9884a;
  --sup:       #4bb3c0;
  --neutral:   #6e7f8c;
  --accent:    #4bb3c0;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 2.5rem 1.25rem 6rem;
  background: var(--ground);
  color: var(--ink);
  font-family: "PingFang TC", "Noto Sans TC", "Microsoft JhengHei",
               -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

.wrap { max-width: 1000px; margin: 0 auto; display: flex; flex-direction: column; gap: 3rem; }

.num, .stat-n, td.num, .chip b {
  font-family: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

/* --- header --- */
header { display: flex; flex-direction: column; gap: .5rem; }
.eyebrow {
  font-size: .7rem; letter-spacing: .16em; text-transform: uppercase;
  color: var(--muted); font-weight: 600;
}
h1 { font-size: 1.75rem; line-height: 1.25; margin: 0; text-wrap: balance; letter-spacing: -.015em; }
.meta {
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: .8rem; color: var(--muted); font-variant-numeric: tabular-nums;
}

h2 {
  font-size: 1.05rem; margin: 0 0 .25rem; letter-spacing: -.01em;
  padding-bottom: .5rem; border-bottom: 2px solid var(--ink);
}
h3 { font-size: .9rem; margin: 0; font-weight: 650; }
section { display: flex; flex-direction: column; gap: .9rem; }
.lede { margin: 0; color: var(--muted); font-size: .88rem; max-width: 64ch; }

/* --- stat strip --- */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px;
         background: var(--rule); border: 1px solid var(--rule); }
.stat { background: var(--surface); padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: .15rem; }
.stat-n { font-size: 1.55rem; font-weight: 600; line-height: 1.1; letter-spacing: -.02em; }
.stat-l { font-size: .72rem; color: var(--muted); letter-spacing: .05em; }

/* --- role comparison: the centrepiece --- */
.roles { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.25rem; }
.role {
  background: var(--surface); border: 1px solid var(--rule);
  border-top: 3px solid var(--role-color, var(--neutral));
  padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: .85rem;
}
.role-head { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; }
.role-head .count { font-size: .78rem; color: var(--muted); }
.role-answer {
  font-size: .74rem; color: var(--muted); padding: .35rem .6rem;
  background: var(--surface-2); border-left: 2px solid var(--role-color, var(--neutral));
}
.rowlist { display: flex; flex-direction: column; gap: .55rem; }
.row { display: grid; grid-template-columns: 1fr auto; gap: .15rem .75rem; align-items: baseline; }
.row .label { font-size: .85rem; }
.row .val { font-size: .78rem; color: var(--muted); }
.track { grid-column: 1 / -1; height: 6px; background: var(--grid); }
.fill { height: 100%; background: var(--role-color, var(--accent)); }

/* --- tables --- */
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .88rem; background: var(--surface); }
th {
  text-align: left; font-size: .7rem; color: var(--muted); font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase; padding: .6rem .7rem;
  border-bottom: 1px solid var(--ink); white-space: nowrap;
}
td { padding: .55rem .7rem; border-bottom: 1px solid var(--grid); }
td.num { text-align: right; white-space: nowrap; }
td.rank { color: var(--muted); width: 2.2rem; font-family: ui-monospace, Consolas, monospace; }
.barcell { width: 40%; min-width: 130px; }
.bartrack { height: 7px; background: var(--grid); }
.bar { height: 100%; background: var(--accent); }

/* --- keyword chips --- */
.chips { display: flex; flex-wrap: wrap; gap: .4rem; }
.chip {
  background: var(--surface); border: 1px solid var(--rule);
  padding: .3rem .65rem; font-size: .82rem; display: inline-flex; gap: .45rem;
}
.chip b { color: var(--accent); font-weight: 600; font-size: .78rem; }

/* --- examples --- */
details { background: var(--surface); border: 1px solid var(--rule); }
details + details { border-top: none; }
summary {
  cursor: pointer; padding: .7rem .9rem; font-size: .88rem; font-weight: 600;
  display: flex; justify-content: space-between; gap: 1rem;
}
summary::-webkit-details-marker { display: none; }
summary .c { color: var(--muted); font-weight: 400; font-size: .8rem;
             font-family: ui-monospace, Consolas, monospace; }
summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.quotes { padding: 0 .9rem .9rem; display: flex; flex-direction: column; gap: .6rem; }
blockquote {
  margin: 0; padding: .5rem .75rem; background: var(--surface-2);
  border-left: 2px solid var(--rule); font-size: .85rem;
}
blockquote .who {
  display: block; font-size: .7rem; color: var(--muted); margin-bottom: .2rem;
  font-family: ui-monospace, Consolas, monospace;
}

td.delta { font-weight: 600; }
td.delta.up { color: var(--eng); }
td.delta.down { color: var(--sup); }
td.delta.flat { color: var(--muted); font-weight: 400; }

.note {
  background: var(--surface); border: 1px solid var(--rule);
  border-left: 3px solid var(--accent); padding: .8rem 1rem;
  font-size: .85rem; color: var(--muted);
}
.note b { color: var(--ink); }
svg { display: block; max-width: 100%; }
"""


def _role_color(role: str) -> str:
    if "技術客服" in role or "技客" in role:
        return "var(--sup)"
    if "工程" in role:
        return "var(--eng)"
    return "var(--neutral)"


def _role_answers(role: str) -> str:
    """這個單位提出的事，通常由誰接手回覆。"""
    if "技術客服" in role or "技客" in role:
        return "多半需要 工程 回覆"
    if "工程" in role:
        return "多半需要 技術客服 回覆"
    return ""


def _bar_row(rank: int, label: str, count: int, share: float, max_share: float) -> str:
    width = (share / max_share * 100) if max_share else 0
    return (
        f"<tr><td class='rank'>{rank}</td>"
        f"<td>{html.escape(label)}</td>"
        f"<td class='num'>{count:,}</td>"
        f"<td class='num'>{share:.1%}</td>"
        f"<td class='barcell'><div class='bartrack'>"
        f"<div class='bar' style='width:{width:.1f}%'></div></div></td></tr>"
    )


def _trend_svg(monthly: list[dict[str, Any]]) -> str:
    points = [m for m in monthly if m["month"] != "unknown"]
    if len(points) < 2:
        return "<p class='lede'>資料期間不足，略過趨勢圖。</p>"

    w, h, pad_l, pad_b, pad_t = 940, 210, 44, 32, 10
    max_c = max(p["count"] for p in points) or 1
    n = len(points)
    slot = (w - pad_l - 12) / n
    bar_w = max(3.0, slot * 0.58)

    bars, labels = [], []
    label_every = max(1, n // 14)
    for i, p in enumerate(points):
        bh = (p["count"] / max_c) * (h - pad_b - pad_t)
        x = pad_l + i * slot + (slot - bar_w) / 2
        y = h - pad_b - bh
        bars.append(
            f"<rect x='{x:.1f}' y='{y:.1f}' width='{bar_w:.1f}' height='{bh:.1f}' "
            f"fill='var(--accent)'><title>{html.escape(p['month'])}: {p['count']}</title></rect>"
        )
        if i % label_every == 0:
            labels.append(
                f"<text x='{x + bar_w / 2:.1f}' y='{h - pad_b + 14:.0f}' font-size='9.5' "
                f"fill='var(--muted)' text-anchor='middle' "
                f"font-family='ui-monospace, Consolas, monospace'>"
                f"{html.escape(p['month'])}</text>"
            )

    grid = []
    for frac in (0, 0.5, 1.0):
        y = h - pad_b - frac * (h - pad_b - pad_t)
        grid.append(
            f"<line x1='{pad_l}' y1='{y:.1f}' x2='{w - 12}' y2='{y:.1f}' "
            f"stroke='var(--grid)' stroke-width='1'/>"
            f"<text x='{pad_l - 7}' y='{y + 3.5:.1f}' font-size='9.5' fill='var(--muted)' "
            f"text-anchor='end' font-family='ui-monospace, Consolas, monospace'>"
            f"{round(max_c * frac)}</text>"
        )

    return (
        f"<div class='scroll'><svg viewBox='0 0 {w} {h}' width='{w}' "
        f"role='img' aria-label='每月需回應訊息數趨勢'>"
        + "".join(grid) + "".join(bars) + "".join(labels) + "</svg></div>"
    )


def _role_cards(by_role: dict[str, Any], min_total: int = 20) -> str:
    cards = []
    for role, data in by_role.items():
        if data["total"] < min_total:
            continue
        top = [c for c in data["categories"] if c["name"] != UNCATEGORIZED][:6]
        peak = max((c["share"] for c in top), default=0)
        rows = "".join(
            f"<div class='row'>"
            f"<span class='label'>{html.escape(c['name'])}</span>"
            f"<span class='val'>{c['count']:,} · {c['share']:.0%}</span>"
            f"<span class='track'><span class='fill' "
            f"style='width:{(c['share'] / peak * 100) if peak else 0:.1f}%'></span></span>"
            f"</div>"
            for c in top
        )
        answer = _role_answers(role)
        answer_html = f"<p class='role-answer'>{html.escape(answer)}</p>" if answer else ""
        cards.append(
            f"<article class='role' style='--role-color: {_role_color(role)}'>"
            f"<div class='role-head'><h3>{html.escape(role)}</h3>"
            f"<span class='count num'>{data['total']:,} 則</span></div>"
            f"{answer_html}<div class='rowlist'>{rows}</div></article>"
        )
    return f"<div class='roles'>{''.join(cards)}</div>" if cards else ""


def _compare_section(stats: dict[str, Any]) -> str:
    """把這一期與前一期的分類佔比並列，標出增減幅度。"""
    cmp = stats.get("compare")
    if not cmp:
        return ""

    prev_shares = cmp.get("shares") or {}
    cur = {c["name"]: c for c in stats["categories"] if c["name"] != UNCATEGORIZED}
    names = sorted(cur, key=lambda n: -cur[n]["share"])
    if not names:
        return ""

    rows = []
    for name in names:
        now = cur[name]["share"]
        before = prev_shares.get(name, 0.0)
        delta = (now - before) * 100
        if delta > 2:
            cls, mark = "up", "▲"
        elif delta < -2:
            cls, mark = "down", "▼"
        else:
            cls, mark = "flat", "·"
        rows.append(
            f"<tr><td>{html.escape(name)}</td>"
            f"<td class='num'>{before:.1%}</td>"
            f"<td class='num'>{now:.1%}</td>"
            f"<td class='num delta {cls}'>{mark} {delta:+.1f}pt</td></tr>"
        )

    pr = cmp.get("range") or {}
    prev_label = f"{pr.get('start', '?')} ~ {pr.get('end', '?')}"
    dr = stats["date_range"]
    cur_label = f"{dr.get('start', '?')} ~ {dr.get('end', '?')}"

    return f"""
  <section>
    <h2>與前一期比較</h2>
    <p class="lede">每個類型佔「需回應訊息」的比例。因為一則訊息可命中多個類型，
       各欄加總都會超過 100%，所以看的是同一類型在兩期之間的消長。</p>
    <div class="scroll"><table>
      <thead><tr><th>類型</th>
        <th class="num">{html.escape(prev_label)}</th>
        <th class="num">{html.escape(cur_label)}</th>
        <th class="num">變化</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table></div>
  </section>"""


def render_html(stats: dict[str, Any]) -> str:
    t = stats["totals"]
    dr = stats["date_range"]
    cats = stats["categories"]
    kinds = t.get("by_kind") or {}
    max_share = max((c["share"] for c in cats), default=0)

    cat_rows = "".join(
        _bar_row(i, c["name"], c["count"], c["share"], max_share)
        for i, c in enumerate(cats, 1)
    ) or "<tr><td colspan='5'>沒有偵測到需回應的訊息。</td></tr>"

    def chips(items: list[dict[str, Any]]) -> str:
        if not items:
            return "<p class='lede'>—</p>"
        return "<div class='chips'>" + "".join(
            f"<span class='chip'>{html.escape(k['keyword'])}<b>{k['count']:,}</b></span>"
            for k in items
        ) + "</div>"

    example_blocks = []
    for c in cats:
        if not c["examples"] or c["name"] == UNCATEGORIZED:
            continue
        quotes = "".join(
            f"<blockquote><span class='who'>{html.escape(e['date'])} · "
            f"{html.escape(e['author'])}</span>{html.escape(e['text'])}</blockquote>"
            for e in c["examples"]
        )
        example_blocks.append(
            f"<details><summary>{html.escape(c['name'])}"
            f"<span class='c'>{c['count']:,}</span></summary>"
            f"<div class='quotes'>{quotes}</div></details>"
        )

    uncat = next((c for c in cats if c["name"] == UNCATEGORIZED), None)
    uncat_note = ""
    if uncat and uncat["share"] > 0.2:
        uncat_note = (
            f"<p class='note'>「未分類」佔 <b>{uncat['share']:.0%}</b>。其中大部分是"
            f"「幫確認」「再麻煩你」這類沒有主題的純回應請求，本來就無從歸類；"
            f"其餘可從下方關鍵字挑詞補進規則檔再跑一次。</p>"
        )

    target_section = ""
    tcards = _role_cards(stats.get("by_target") or {}, min_total=50)
    if tcards:
        target_section = f"""
  <section>
    <h2>訊息丟給誰處理</h2>
    <p class="lede">群組裡用 @姓名(單位) 點名，括號裡就是對方的單位。
       這一段只看有點名的訊息，因此直接反映各單位實際被交辦的工作型態。
       已排除「未分類」。</p>
    {tcards}
  </section>"""

    compare_section = _compare_section(stats)

    role_section = ""
    cards = _role_cards(stats.get("by_role") or {})
    if cards:
        role_section = f"""
  <section>
    <h2>誰在問，誰要回</h2>
    <p class="lede">依發話者所屬單位拆分。一個單位提出的事，通常由對方單位接手處理，
       所以這張對照表就是各單位實際承接的工作型態。已排除「未分類」。</p>
    {cards}
  </section>"""

    return f"""<title>技術客服與工程協作分析</title>
<style>{REPORT_CSS}</style>
<div class="wrap">

  <header>
    <span class="eyebrow">Google Chat 群組分析</span>
    <h1>{html.escape(', '.join(t['spaces']) or '未知群組')}</h1>
    <span class="meta">{dr['start'] or '?'} — {dr['end'] or '?'} ·
      {t['participants']} 位成員 · 產生於 {stats['generated_at']}</span>
  </header>

  <section>
    <div class="stats">
      <div class="stat"><span class="stat-n">{t['messages']:,}</span>
        <span class="stat-l">總訊息</span></div>
      <div class="stat"><span class="stat-n">{t['questions']:,}</span>
        <span class="stat-l">需要有人回應</span></div>
      <div class="stat"><span class="stat-n">{kinds.get('問題', 0):,}</span>
        <span class="stat-l">其中：提問</span></div>
      <div class="stat"><span class="stat-n">{kinds.get('請求', 0):,}</span>
        <span class="stat-l">其中：請求協助</span></div>
    </div>
  </section>
{target_section}
{role_section}

  <section>
    <h2>問題類型排名</h2>
    <p class="lede">一則訊息可同時命中多個類型，因此佔比加總會超過 100%。</p>
    {uncat_note}
    <div class="scroll"><table>
      <thead><tr><th></th><th>類型</th><th class="num">則數</th>
        <th class="num">佔比</th><th></th></tr></thead>
      <tbody>{cat_rows}</tbody>
    </table></div>
  </section>

  <section>
    <h2>每月需回應訊息量</h2>
    {_trend_svg(stats['monthly'])}
  </section>
{compare_section}

  <section>
    <h2>高頻詞</h2>
    <p class="lede">從需回應的訊息裡自動抽出，每則訊息同一個詞只計一次。</p>
    {chips(stats['discovered_keywords_all'][:32])}
  </section>

  <section>
    <h2>各類型的實際原文</h2>
    <p class="lede">用來檢查分類準不準。點開看該類型的代表性訊息。</p>
    {''.join(example_blocks) or "<p class='lede'>—</p>"}
  </section>

</div>
"""
def write_questions_csv(
    messages: list[Message],
    rules: dict[str, list[str]],
    path: Path,
    roles: dict[str, list[str]] | None = None,
) -> int:
    roles = roles or {}
    rows = 0
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow(["date", "space", "author", "role", "kind", "categories", "text"])
        for msg in messages:
            kind = classify_kind(msg.text)
            if not kind:
                continue
            writer.writerow(
                [
                    msg.dt.strftime("%Y-%m-%d %H:%M") if msg.dt else msg.raw_date,
                    msg.space,
                    msg.author,
                    role_of(msg.author, roles),
                    kind,
                    "|".join(categorize(msg.text, rules)),
                    msg.text.replace("\n", " "),
                ]
            )
            rows += 1
    return rows


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="分析 Google Chat 群組最常見的問題",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--input", required=True,
        help="Takeout 的 zip 檔、解壓後的資料夾，或單一 messages.json",
    )
    parser.add_argument("--rules", help="分類規則 JSON 檔；不給就用內建的起步規則")
    parser.add_argument(
        "--roles",
        help="角色對照表 JSON：{角色: [出現在發話者名字裡的字串]}，用來拆分不同單位的提問",
    )
    parser.add_argument(
        "--compare",
        help="先前一次執行的 stats.json，用來在報告裡並列兩期的分類佔比變化",
    )
    parser.add_argument(
        "--targets",
        help="收件單位對照表 JSON：{單位: [出現在 @姓名(單位) 括號裡的字串]}，"
             "用來統計訊息是丟給哪個單位處理的",
    )
    parser.add_argument("--space", help="只分析名稱含此字串的群組")
    parser.add_argument("--out-dir", default="output", help="輸出目錄（預設 output/）")
    parser.add_argument(
        "--examples", type=int, default=5, help="每個分類保留幾則原文範例（預設 5）"
    )
    args = parser.parse_args()

    input_path = Path(args.input).expanduser()
    if not input_path.exists():
        print(f"[error] 找不到輸入路徑：{input_path}", file=sys.stderr)
        return 1

    rules = load_rules(Path(args.rules).expanduser() if args.rules else None)
    roles = load_roles(Path(args.roles).expanduser() if args.roles else None)
    targets = load_targets(Path(args.targets).expanduser() if args.targets else None)

    print(f"[1/4] 讀取 {input_path} ...", file=sys.stderr)
    messages = load_messages(input_path, args.space)
    if not messages:
        print(
            "[error] 沒讀到任何訊息。請確認路徑指向 Takeout 的 Google Chat 資料"
            "（裡面應該有 Groups/<空間>/messages.json）。",
            file=sys.stderr,
        )
        return 1
    print(f"        讀到 {len(messages):,} 則訊息", file=sys.stderr)

    print("[2/4] 判定問題／請求並分類 ...", file=sys.stderr)
    stats = build_stats(messages, rules, args.examples, roles, targets)

    if args.compare:
        with Path(args.compare).expanduser().open(encoding="utf-8") as fh:
            prev = json.load(fh)
        stats["compare"] = {
            "range": prev.get("date_range", {}),
            "questions": prev.get("totals", {}).get("questions", 0),
            "shares": {c["name"]: c["share"] for c in prev.get("categories", [])},
            "counts": {c["name"]: c["count"] for c in prev.get("categories", [])},
        }

    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[3/4] 寫出檔案 ...", file=sys.stderr)
    (out_dir / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    n_csv = write_questions_csv(messages, rules, out_dir / "questions.csv", roles)
    (out_dir / "report.html").write_text(render_html(stats), encoding="utf-8")

    print("[4/4] 完成", file=sys.stderr)
    print_report(stats)
    print(f"  輸出：{out_dir / 'report.html'}  （用瀏覽器開啟）")
    print(f"        {out_dir / 'stats.json'}")
    print(f"        {out_dir / 'questions.csv'}  （{n_csv:,} 列，可人工校對分類）")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
