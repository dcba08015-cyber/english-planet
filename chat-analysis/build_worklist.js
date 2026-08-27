const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageOrientation,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require('docx');

const S = '/tmp/claude-0/-home-user-english-planet/a30b5b56-fd7b-5bd7-990f-5869e7ed4aa0/scratchpad';
const FONT = '微軟正黑體';
const INK = '1A1A1A';
const MUTED = '5A6975';
const HEAD_BG = 'FCE4D6';   // 比照你原表格的淺橘表頭
const RULE = '9A9A9A';

// A4 橫向，左右各留 1000 DXA
const COLS = [2100, 3300, 1250, 1050, 1050, 4700, 1150];
const TABLE_W = COLS.reduce((a, b) => a + b, 0);

function run(text, o = {}) {
  return new TextRun({
    text, font: FONT, size: o.size || 18, bold: !!o.bold,
    color: o.color || INK,
  });
}

function lines(arr, o = {}) {
  return arr.map((t, i) => new Paragraph({
    spacing: { after: i === arr.length - 1 ? 0 : 60, line: 240 },
    alignment: o.align,
    children: [run(t, o)],
  }));
}

function cell(text, width, o = {}) {
  const arr = Array.isArray(text) ? text : [text];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg, color: 'auto' } : undefined,
    margins: { top: 70, bottom: 70, left: 90, right: 90 },
    verticalAlign: o.middle ? 'center' : 'top',
    children: lines(arr, o),
  });
}

const border = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const BORDERS = {
  top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border,
};

const HEADERS = ['重要工作要項', '目標與關鍵績效指標', '預計完成時間',
                 '完成時間', '負責人', '細項工作進度', '狀態'];

// ── 內容 ─────────────────────────────────────────────────────────────
const ROWS = [
  {
    title: ['一、開放工程端', '自助查詢掛單狀態'],
    kpi: [
      '消除完工回報後的人工查詢往返。',
      '',
      'KPI 1：撤單類訊息月量',
      '　　　394 則 → 100 則以下',
      'KPI 2：確認循環總訊息量',
      '　　　1,133 則/月 → 300 則以下',
      'KPI 3：工程自助查詢使用率',
      '　　　達完工回報件數 80%',
    ],
    due: '2026/10/31',
    steps: [
      '1. 盤點客服目前查詢掛單所用的系統與欄位　（1 週）',
      '2. 確認唯讀權限開放範圍與資安規範　（1 週）',
      '3. 建置查詢介面：Chat 機器人輸入社區名回覆掛單狀態，',
      '　 或開放現有系統唯讀帳號　（3 週）',
      '4. 台中區試辦，該區完工回報量最大　（2 週）',
      '5. 檢視試辦數據，調整欄位與回覆格式　（1 週）',
      '6. 全區推廣並公告新流程　（2 週）',
    ],
  },
  {
    title: ['二、查清約工表', '低估 D+1 能量的原因'],
    kpi: [
      '讓約工表反映真實可調度量，',
      '減少跨單位協調與急件延誤。',
      '',
      'KPI 1：無能量類訊息月量',
      '　　　197 則 → 100 則以下',
      'KPI 2：急件因排程受阻比率',
      '　　　由 19.2% 降至 10% 以下',
    ],
    due: '2026/11/30',
    steps: [
      '1. 抽取本年度 50 件「D+1 無能量」例外案件　（1 週）',
      '2. 逐件比對約工表當下狀態與人工最終排入時段　（2 週）',
      '3. 歸納落差成因：保留緩衝、順工機會未計、',
      '　 資料更新延遲、跨區支援未列為可用能量　（1 週）',
      '4. 提出排程規則調整方案並取得核可　（2 週）',
      '5. 調整後追蹤兩個月驗證成效　（8 週）',
    ],
  },
  {
    title: ['三、電控／機房／供電', '問題升溫追蹤'],
    kpi: [
      '釐清現場硬體問題成長原因，',
      '避免持續擴大。',
      '',
      'KPI：該類佔比停止上升',
      '　　（目前 18.9%，較前期 +8.1pt）',
    ],
    due: '2026/12/31',
    steps: [
      '1. 自工單系統取得結構化社區代號　（2 週）',
      '　 註：聊天記錄的社區名無固定寫法，無法可靠辨識',
      '2. 分析故障是否集中於少數社區或特定設備批次　（2 週）',
      '3. 若確認集中，提出優先改善名單　（2 週）',
      '4. 納入月度檢視　（持續）',
    ],
  },
  {
    title: ['四、補齊資料缺口', '（支援性工作）'],
    kpi: [
      '取得 2025-03～2025-12 訊息，',
      '建立不中斷的長期趨勢基準。',
      '',
      'KPI：資料涵蓋 2023-11 至今無斷點',
    ],
    due: '2026/09/30',
    steps: [
      '1. 以 Apps Script 將 START_MONTH 設為 2025-03 重跑抓取　（1 日）',
      '2. 併入既有分析，重建完整趨勢　（3 日）',
      '3. 確認前述三項 KPI 的基準值是否需修正　（2 日）',
    ],
  },
];

const rows = [
  new TableRow({
    tableHeader: true,
    children: HEADERS.map((h, i) =>
      cell(h, COLS[i], { bg: HEAD_BG, bold: true, middle: true, align: AlignmentType.CENTER })),
  }),
  ...ROWS.map(r => new TableRow({
    children: [
      cell(r.title, COLS[0], { bold: true }),
      cell(r.kpi, COLS[1]),
      cell(r.due, COLS[2], { align: AlignmentType.CENTER }),
      cell('', COLS[3]),
      cell('', COLS[4]),
      cell(r.steps, COLS[5]),
      cell('未開始', COLS[6], { align: AlignmentType.CENTER, color: MUTED }),
    ],
  })),
];

const children = [
  new Paragraph({
    spacing: { after: 80 },
    children: [run('【協作】技術客服與全區工程　群組分析　改善工作項目', { size: 26, bold: true })],
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: [run(
      '依據 2026 年 1–8 月 77,073 則群組訊息分析結果排定。' +
      'KPI 基準值取自該期間實測數據。', { size: 17, color: MUTED })],
  }),
  new Table({ width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: COLS, borders: BORDERS, rows }),
  new Paragraph({
    spacing: { before: 240 },
    children: [run(
      '備註：預計完成時間為建議值，請依實際排程調整；負責人與完成時間待填。' +
      '各項 KPI 均可用既有分析腳本重跑比對，量測方式已載於分析報告。',
      { size: 17, color: MUTED })],
  }),
];

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 18, color: INK } } } },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = `${S}/改善工作項目表.docx`;
  fs.writeFileSync(out, buf);
  console.log('已產生:', out, `(${(buf.length / 1024).toFixed(1)} KB)`);
});
