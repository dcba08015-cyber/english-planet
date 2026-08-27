const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageOrientation,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require('docx');

const S = '/tmp/claude-0/-home-user-english-planet/a30b5b56-fd7b-5bd7-990f-5869e7ed4aa0/scratchpad';
const FONT = '微軟正黑體';
const INK = '1A1A1A';
const MUTED = '5A6975';
const DONE = '2E7D32';
const DOING = 'B26A00';
const HEAD_BG = 'FCE4D6';
const RULE = '9A9A9A';

const COLS = [2250, 3350, 1250, 1050, 1050, 4500, 1150];
const TABLE_W = COLS.reduce((a, b) => a + b, 0);

function run(text, o = {}) {
  return new TextRun({ text, font: FONT, size: o.size || 18,
                       bold: !!o.bold, color: o.color || INK });
}

function lines(arr, o = {}) {
  return arr.map((t, i) => new Paragraph({
    spacing: { after: i === arr.length - 1 ? 0 : 60, line: 240 },
    alignment: o.align,
    children: [run(t, o)],
  }));
}

function cell(text, width, o = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg, color: 'auto' } : undefined,
    margins: { top: 70, bottom: 70, left: 90, right: 90 },
    verticalAlign: o.middle ? 'center' : 'top',
    children: lines(Array.isArray(text) ? text : [text], o),
  });
}

const b = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const BORDERS = { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
const HEADERS = ['重要工作要項', '目標與關鍵績效指標', '預計完成時間',
                 '完成時間', '負責人', '細項工作進度', '狀態'];

const ROWS = [
  {
    title: ['一、蒐集工程轉向客服', '　　處理之案件基準'],
    kpi: [
      '建立回流案件的量化基準，',
      '作為後續改善的比較基礎。',
      '',
      'KPI：完成三項資料',
      '　1. 案件類型分類',
      '　2. 各類型件數',
      '　3. 客服處理工時',
    ],
    due: '2026/08/12',
    steps: [
      '1. 定義「回流案件」範圍與判定標準',
      '2. 蒐集期間內案件並依類型分類',
      '3. 統計各類型件數',
      '4. 記錄客服端實際處理工時',
      '5. 彙整為基準資料表',
    ],
    status: '已完成', color: DONE,
  },
  {
    title: ['二、回流案件分類排序，', '　　選定首項改善作業'],
    kpi: [
      '從基準資料中找出影響最大的',
      '項目，並收斂到單一改善標的。',
      '',
      'KPI 1：產出前三高項目清單',
      '　　　（件數、工時雙軸排序）',
      'KPI 2：完成首項選定並取得',
      '　　　相關單位共識',
    ],
    due: '2026/09/04',
    steps: [
      '1. 依類型彙總件數與工時',
      '2. 分別以件數、工時排序，取交集前三項',
      '3. 評估各項改善可行性與影響範圍',
      '4. 選定首項並取得客服與工程雙方共識',
      '',
      '＊ 可交叉驗證：群組訊息分析顯示，工程回流客服的',
      '　 最大宗為完工後「幫確認」結案，每月約 488 件，',
      '　 客服回覆中位時間 1.8 分鐘；其次為直接指名詢問',
      '　 每月約 49 件。可與實際工時記錄對照。',
    ],
    status: '進行中', color: DOING,
  },
  {
    title: ['三、釐清首項作業的', '　　回流原因與責任歸屬'],
    kpi: [
      '找出案件回流的根本原因，',
      '確定調整後由誰負責、怎麼處理。',
      '',
      'KPI 1：產出現行流程圖',
      'KPI 2：產出回流原因分析',
      'KPI 3：新責任歸屬經雙方單位',
      '　　　主管書面確認',
    ],
    due: '2026/09/13',
    steps: [
      '1. 訪談客服端與原責單位承辦人',
      '2. 繪製現行流程，標出回流發生點',
      '3. 分析回流原因：資訊不足、權限不足、',
      '　 職責未定義、或系統限制',
      '4. 確認調整後的責任歸屬與處理方式',
      '5. 取得雙方單位主管確認',
    ],
    status: '進行中', color: DOING,
  },
  {
    title: ['四、訂定首項作業的', '　　新分工與作業標準'],
    kpi: [
      '把新做法寫成可執行、可判定的',
      '規則，避免試行時各自解讀。',
      '',
      'KPI：完成四份文件',
      '　1. 新分工定義',
      '　2. 處理必要資訊清單',
      '　3. 退回條件',
      '　4. 完成標準',
    ],
    due: '2026/09/25',
    steps: [
      '1. 定義原責單位與客服的新分工界線',
      '2. 列出原責單位自行處理所需的必要資訊',
      '3. 訂定退回條件：什麼情況才可退回客服',
      '4. 訂定完成標準：做到什麼程度算結案',
      '5. 文件化並向相關人員公告',
    ],
    status: '未開始', color: MUTED,
  },
  {
    title: ['五、啟動新流程試行'],
    kpi: [
      '讓原責單位依新分工直接完成，',
      '並即時掌握執行狀況。',
      '',
      'KPI 1：新流程如期上線',
      'KPI 2：建立回流件數與異常的',
      '　　　每日追蹤機制',
    ],
    due: '2026/09/30（啟動）',
    steps: [
      '1. 對原責單位進行新流程說明與教育訓練',
      '2. 建立回流件數與異常事件的追蹤表單',
      '3. 正式啟動試行',
      '4. 每日追蹤異常，即時排除阻礙',
    ],
    status: '未開始', color: MUTED,
  },
  {
    title: ['六、完成兩週試行', '　　並驗證成效'],
    kpi: [
      '用數據確認改善是否真的發生。',
      '',
      'KPI 1：回流客服件數較基準下降',
      '　　　（目標值於第二項選題後訂定）',
      'KPI 2：客服處理工時較基準下降',
      'KPI 3：產出試行成效報告',
    ],
    due: '2026/10/14',
    steps: [
      '1. 收集兩週試行期間的完整數據',
      '2. 與第一項建立的基準值比較',
      '3. 分析未達標項目的原因',
      '4. 產出試行成效報告',
    ],
    status: '未開始', color: MUTED,
  },
  {
    title: ['七、跨單位協調與', '　　首項改善定案'],
    kpi: [
      '把試行中發現的問題收斂完畢，',
      '將新流程轉為正式作業。',
      '',
      'KPI 1：試行異常全數處理完畢',
      'KPI 2：修正後流程正式發布',
      'KPI 3：完成下一項改善標的排定',
    ],
    due: '2026/10/25',
    steps: [
      '1. 彙整試行期間的異常與跨單位爭議',
      '2. 召開跨單位協調會議取得共識',
      '3. 依協調結果修正流程文件',
      '4. 正式定案並發布',
      '5. 依第二項的排序，排定下一項改善標的',
    ],
    status: '未開始', color: MUTED,
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
      cell(r.status, COLS[6], { align: AlignmentType.CENTER, color: r.color, bold: true }),
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
        children: [run('回流案件改善專案　重要工作事項與進度', { size: 26, bold: true })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [run(
          '標的：工程群組轉向客服處理之回流案件。' +
          '自基準蒐集起，經排序選題、根因釐清、分工訂定、試行驗證，至首項改善定案。',
          { size: 17, color: MUTED })],
      }),
      new Table({ width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: COLS,
                  borders: BORDERS, rows }),
      new Paragraph({
        spacing: { before: 240 },
        children: [run(
          '備註：負責人與完成時間待填。第六項的下降目標須待第二項選定標的、' +
          '確認該項基準值後訂定，避免在標的未定前設定無依據的數字。',
          { size: 17, color: MUTED })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = `${S}/回流案件改善專案-工作事項表.docx`;
  fs.writeFileSync(out, buf);
  console.log('已產生:', out, `(${(buf.length / 1024).toFixed(1)} KB)`);
});
