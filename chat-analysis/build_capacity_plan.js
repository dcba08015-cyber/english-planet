const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageOrientation,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require('docx');

const S = '/tmp/claude-0/-home-user-english-planet/a30b5b56-fd7b-5bd7-990f-5869e7ed4aa0/scratchpad';
const FONT = '微軟正黑體';
const INK = '1A1A1A', MUTED = '5A6975', WARN = 'B26A00';
const HEAD_BG = 'FCE4D6', RULE = '9A9A9A';

const COLS = [2250, 3350, 1250, 1050, 1050, 4500, 1150];
const TABLE_W = COLS.reduce((a, b) => a + b, 0);

const run = (t, o = {}) => new TextRun({
  text: t, font: FONT, size: o.size || 18, bold: !!o.bold, color: o.color || INK,
});

const lines = (arr, o = {}) => arr.map((t, i) => new Paragraph({
  spacing: { after: i === arr.length - 1 ? 0 : 60, line: 240 },
  alignment: o.align, children: [run(t, o)],
}));

const cell = (t, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg, color: 'auto' } : undefined,
  margins: { top: 70, bottom: 70, left: 90, right: 90 },
  verticalAlign: o.middle ? 'center' : 'top',
  children: lines(Array.isArray(t) ? t : [t], o),
});

const b = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const BORDERS = { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
const HEADERS = ['重要工作要項', '目標與關鍵績效指標', '預計完成時間',
                 '完成時間', '負責人', '細項工作進度', '狀態'];

const ROWS = [
  {
    title: ['一、確認約工表是否', '　　留有歷史狀態'],
    kpi: [
      '確定調查方式：回溯比對或前瞻蒐集。',
      '這一步決定後續全部做法，必須先做。',
      '',
      'KPI：取得明確答覆——約工表能否',
      '　　查詢任一過去日期當下顯示的',
      '　　可約時段',
    ],
    due: '啟動後 3 日',
    steps: [
      '1. 向系統維護單位確認約工表是否保留歷史快照',
      '2. 若有：可直接回溯比對本表 1,476 件',
      '3. 若無：改為前瞻蒐集，於新案件發生當下',
      '　 截圖或匯出約工表狀態，約 3 週可累積 150 件',
      '',
      '＊ 這是整個調查的最大風險。多數排程系統只存',
      '　 現況不存歷史，先確認可避免白做。',
    ],
    status: '未開始',
  },
  {
    title: ['二、備妥例外案件清單'],
    kpi: [
      '建立可逐件比對的工作底稿。',
      '',
      'KPI：清單涵蓋期間內全部例外案件，',
      '　　並含案件時間、原始請求、',
      '　　後續對話、首次回應時間',
    ],
    due: '啟動後 3 日',
    steps: [
      '1. 使用已產出的「約工表無能量-例外案件清單.csv」',
      '　 共 1,476 件，D+1 佔 69.2%，帶急迫性 18.4%',
      '2. 依調查方式決定取樣：回溯則全量或分層抽樣，',
      '　 前瞻則以此表作為格式範本',
      '3. 分派承辦人與填寫規則',
      '',
      '＊ 清單中「初步研判」欄僅供參考，62.5% 為待判讀，',
      '　 因群組訊息交錯導致程式無法確認結果，以系統端為準。',
    ],
    status: '未開始',
  },
  {
    title: ['三、逐件比對並', '　　歸類落差原因'],
    kpi: [
      '找出被系統忽略的能量來源。',
      '',
      'KPI 1：完成至少 100 件比對',
      'KPI 2：每件填入約工表當下狀態、',
      '　　　最終排入時段、落差原因',
      'KPI 3：產出原因分布統計，',
      '　　　前三大原因合計佔比 ≥ 70%',
    ],
    due: '啟動後 3 週',
    steps: [
      '1. 逐件填入「約工表當下狀態」與「最終排入時段」',
      '2. 依下列選項歸類落差原因：',
      '　 ・保留緩衝過大　・順工機會未計入',
      '　 ・資料更新延遲　・跨區支援未列為可用能量',
      '　 ・外包能量未計入　・特殊技能或料件限制',
      '　 ・實際確無能量（系統判斷正確）　・其他',
      '3. 統計原因分布，找出主要成因',
      '',
      '＊ 「實際確無能量」這一類要特別記錄——若佔比高，',
      '　 代表問題不在系統而在產能，結論會完全不同。',
    ],
    status: '未開始',
  },
  {
    title: ['四、針對主要成因', '　　提出規則調整方案'],
    kpi: [
      '將發現轉為可執行的系統或制度調整。',
      '',
      'KPI 1：針對前三大原因各提出一項',
      '　　　具體調整方案',
      'KPI 2：每項方案標註影響範圍、',
      '　　　風險與所需工時',
      'KPI 3：取得系統維護單位與工程',
      '　　　主管核可',
    ],
    due: '啟動後 5 週',
    steps: [
      '1. 就每項主要成因設計調整方案',
      '2. 評估調整後的副作用，特別是',
      '　 放寬緩衝是否造成現場超載',
      '3. 估算開發或制度變更所需工時',
      '4. 提報並取得核可',
    ],
    status: '未開始',
  },
  {
    title: ['五、調整上線並', '　　追蹤驗證成效'],
    kpi: [
      '確認調整確實減少人工協調。',
      '',
      'KPI 1：「無能量」類訊息月量',
      '　　　由 197 則降至 100 則以下',
      'KPI 2：帶急迫性的受阻案件比率',
      '　　　由 18.4% 降至 10% 以下',
      'KPI 3：現場無因放寬緩衝而超載',
    ],
    due: '啟動後 13 週',
    steps: [
      '1. 分批上線，先試行單一區域',
      '2. 每週統計「無能量」類訊息量',
      '3. 同步監看現場實際完工率與延遲件數，',
      '　 確認沒有為了消化案件而超收',
      '4. 確認成效後全區推行',
      '5. 將月量納入例行報表持續追蹤',
      '',
      '＊ 量測可用既有分析腳本重跑，不需另建機制。',
    ],
    status: '未開始',
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
      cell(r.status, COLS[6], { align: AlignmentType.CENTER, color: MUTED, bold: true }),
    ],
  })),
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
    children: [
      new Paragraph({
        spacing: { after: 80 },
        children: [run('約工表 D+1 能量落差調查　工作事項與進度', { size: 26, bold: true })],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [run(
          '問題：約工表顯示隔日無可約能量，但經人工協調後多半排得進去，' +
          '中位僅 3 分鐘。每月約 197 次，五個月成長 67%。',
          { size: 17, color: MUTED })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [run(
          '要回答的是：被系統忽略的能量從哪裡來。',
          { size: 17, color: WARN, bold: true })],
      }),
      new Table({ width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: COLS,
                  borders: BORDERS, rows }),
      new Paragraph({
        spacing: { before: 240 },
        children: [run(
          '備註：負責人與完成時間待填；預計完成時間以相對週次表示，請依實際啟動日換算。' +
          '第一項的答案會改變第二、三項的做法，務必先完成。',
          { size: 17, color: MUTED })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = `${S}/約工表能量落差調查-工作事項表.docx`;
  fs.writeFileSync(out, buf);
  console.log('已產生:', out, `(${(buf.length / 1024).toFixed(1)} KB)`);
});
