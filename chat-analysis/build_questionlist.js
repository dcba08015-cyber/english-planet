const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageOrientation,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require('docx');

const S = '/tmp/claude-0/-home-user-english-planet/a30b5b56-fd7b-5bd7-990f-5869e7ed4aa0/scratchpad';
const FONT = '微軟正黑體';
const INK = '1A1A1A', MUTED = '5A6975', ACCENT = '0D6B78', WARN = 'B26A00';
const HEAD_BG = 'FCE4D6', GROUP_BG = 'F2F2F2', RULE = '9A9A9A';

const COLS = [900, 2900, 900, 800, 4300, 4800];
const TABLE_W = COLS.reduce((a, b) => a + b, 0);

const run = (t, o = {}) => new TextRun({
  text: t, font: FONT, size: o.size || 17, bold: !!o.bold, color: o.color || INK,
});
const lines = (arr, o = {}) => arr.map((t, i) => new Paragraph({
  spacing: { after: i === arr.length - 1 ? 0 : 50, line: 240 },
  alignment: o.align, children: [run(t, o)],
}));
const cell = (t, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg, color: 'auto' } : undefined,
  margins: { top: 60, bottom: 60, left: 80, right: 80 },
  verticalAlign: o.middle ? 'center' : 'top',
  columnSpan: o.span,
  children: lines(Array.isArray(t) ? t : [t], o),
});

const b = { style: BorderStyle.SINGLE, size: 4, color: RULE };
const BORDERS = { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
const HEADERS = ['代碼', '問題類型', '每月件數', '佔比', '原文範例', '建議處理方向'];

// 2026 Q3（7–9月）實測，共 2,059 則，每月約 686 則
const GROUPS = [
  {
    title: '一、完工回報請求結案確認　　每月約 609 件（88.7%）',
    note: '工程完成作業後貼回報，等客服查系統確認後結案。這一整塊是同一個流程，解法也是同一個。',
    rows: [
      {
        code: 'A1', name: '設備更換／維修完工回報', perMonth: '243', share: '35.5%',
        ex: ['皇苑創世紀 nat異常 更換後正常 幫確認謝謝',
             '大東家樸園 13Fgsw故障不過電 已更換幫確認',
             '興希望，排插接頭鬆脫造成SW不過電，已重新接回，幫確認'],
        fix: ['改為結構化回報：社區代號、設備類型、處理動作、結果，',
              '四個欄位用表單或固定格式送出，系統自動比對掛單後結案。',
              '這一類判斷單純、格式已接近固定，自動化可行性最高。'],
      },
      {
        code: 'A2', name: '線路切換／制式變更完工回報', perMonth: '158', share: '23.1%',
        ex: ['凱旋天下 拆除254-1，原254-2改至254-1，幫確認。',
             '天青硯 拆除254-1中華 改大大幫確認',
             '大睦仁愛匯 拆撥接改固定 幫確認'],
        fix: ['同 A1，但這類更適合優先做：有 54 件是逐字相同的樣板',
              '（「拆除254-1，原254-2改至254-1，幫確認。」），',
              '屬於批次遷移專案，可整批建單、整批結案，不需逐件回報。'],
      },
      {
        code: 'A0', name: '完工回報但未說明處理內容', perMonth: '101', share: '14.7%',
        ex: ['幫確認', '好了幫確認一下', '弄好了 幫確認'],
        fix: ['這一類客服收到後無從判斷要確認什麼，只能回問或自行猜測。',
              '改善方式是回報表單設必填欄位，沒填社區與處理內容就送不出去。',
              '不需要系統開發也能先做：約定回報格式並請主管帶頭遵守。'],
        warn: true,
      },
      {
        code: 'A4', name: '外線／主幹／光纖處理完工回報', perMonth: '53', share: '7.8%',
        ex: ['新竹 市中秧透天區 E0光纖機房端冷接頭斷掉 -70 重作後恢復 幫確認',
             '我把主幹預防性全部重做了一遍 幫確認',
             '竹科潤隆 主SW PORT23流量過高分流到PORT24完成，幫確認'],
        fix: ['同 A1。這類描述較長且技術細節多，', '結構化時需保留自由文字欄位記錄現場判斷。'],
      },
      {
        code: 'A3', name: '新增／上線／架設完工回報', perMonth: '53', share: '7.7%',
        ex: ['博克萊 上線254大大 幫確認', '豐邑生活館 測通大大幫確認感謝',
             '允將康城 補架設EPON 2.5GSW，1分32汰換1分64分光器完成幫確認'],
        fix: ['同 A1。新上線案件本身已有開通流程，', '可考慮直接併入該流程的完工節點，不另外在群組回報。'],
      },
    ],
  },
  {
    title: '二、查詢系統狀態　　每月約 44 件（6.4%）',
    note: '工程需要知道系統裡的狀態，但沒有查詢權限，只能問客服。',
    rows: [
      {
        code: 'B1', name: '查詢有無掛單／報修', perMonth: '16', share: '2.3%',
        ex: ['采舍新世界 … 幫確認有無掛單', '昭揚君逸 補換電控 在幫確認有無掛單 感謝',
             '@廖麗惠(技術客服) 您好 可否幫看掛單 感恩'],
        fix: ['開放工程端唯讀查詢掛單狀態。最輕的形式是 Chat 機器人，',
              '輸入社區名回覆掛單狀態；若系統已有網頁介面，開放唯讀帳號即可。',
              '資料來源就是客服現在正在查的同一個系統。'],
      },
      {
        code: 'B5', name: '請求查看但未說明查什麼', perMonth: '11', share: '1.6%',
        ex: ['@陳貴賢(技術客服) 貴哥 幫看一下', '@吳維修(技術客服) 幫我看一下',
             '@林彥廷(技術客服) 幫看看一下 謝謝'],
        fix: ['與 A0 同源，都是資訊不足。', '可準備固定回覆範本請對方補充社區與問題描述，', '避免客服自行猜測後做白工。'],
      },
      {
        code: 'B2', name: '查詢是否恢復／是否正常', perMonth: '7', share: '1.0%',
        ex: ['台北 台信京湛 幫確認恢復了沒', '請問此社區內網GSW還有在失聯嗎？幫確認',
             '南區sw失聯確認一下有沒有回復'],
        fix: ['同 B1，開放監控狀態唯讀查詢即可自助。'],
      },
      {
        code: 'B4', name: '查詢速度／降速／效能', perMonth: '6', share: '0.9%',
        ex: ['台南 陞發秀泰幫確認是否有外線降速的問題 目前在客戶家 上傳不到70 下載有300',
             '幫確認外線是不是有被限速',
             'To CC 月影國際會館 外線是不是不夠用了 目前254.253 下載最高只有150~250M'],
        fix: ['開放測速與 QOS 設定的唯讀查詢。', '量雖小，但現場人員在客戶家時最需要即時答案。'],
      },
      {
        code: 'B3', name: '查詢系統資料／後台資訊', perMonth: '4', share: '0.6%',
        ex: ['@陳貴賢(技術客服) 幫看下資訊表能進嗎', '高鐵1匯 幫我確認一下A097027還在嗎',
             '幫我確認一下鉅虹森美館的密碼'],
        fix: ['同 B1，併入唯讀查詢範圍。'],
      },
    ],
  },
  {
    title: '三、請客服代為操作　　每月約 15 件（2.1%）',
    note: '工程沒有權限或不方便操作，請客服代勞。量小但多半有時效性。',
    rows: [
      {
        code: 'D1', name: '請求聯繫／回電用戶', perMonth: '6', share: '0.8%',
        ex: ['To cc，有立單，不知道為啥台中客戶打來我公務機，煩請去電協助',
             '可以幫我連繫戒指在不在家嗎 或是有沒有電話 我去家中看',
             '@陳景翔(技術客服) 再麻煩您留電話時留意一下正確性'],
        fix: ['保留人工。與客戶溝通本來就是客服職能，不建議自動化。'],
      },
      {
        code: 'C1', name: '請求派工／補派', perMonth: '2', share: '0.3%',
        ex: ['to CC大大，派遣外出維修，煩請協助派工 請幫我派 W1150903065',
             '@陳弘哲(技術客服) 無法上網，D+1無能量可排，再麻煩協調謝謝'],
        fix: ['保留人工。涉及排程判斷與資源協調。'],
      },
      {
        code: 'C2', name: '請求改約／延後／調整時段', perMonth: '2', share: '0.3%',
        ex: ['8/25這筆，請麻煩再跟用戶延後時間，此筆在五股，工程師早依前往超距須補一小時車程'],
        fix: ['保留人工。需與客戶協調時間。'],
      },
      {
        code: 'C4', name: '派工內容更正／備註', perMonth: '2', share: '0.2%',
        ex: ['這件的加購ap應該是第二台了吧，品項是不是選錯了',
             '資料庫和派工內容幫忙先改一下，固定制是42Y411240，資料庫反了'],
        fix: ['量小但反映建單品質。可追蹤是否集中於特定品項或建單來源。'],
      },
      {
        code: 'C3', name: '請求竣工／結單／假派', perMonth: '1', share: '0.1%',
        ex: ['丟假派 @王皓平(技術客服) 在幫我一下 我電話上',
             '若無其他異常再麻煩假派竣工'],
        fix: ['若 A 類自動結案上線，這一類會一併消失。'],
      },
      {
        code: 'D2', name: '請求發簡訊／公告', perMonth: '1', share: '0.1%',
        ex: ['長谷新樂章的機房維修簡訊，可以幫發延長到1400嗎',
             'To CC 十里靜安 SW失聯點位過高 現場無法單人作業 麻煩直接公告社區網路異常'],
        fix: ['保留人工，或提供工程端自助發送常用公告範本。'],
      },
    ],
  },
  {
    title: '四、需要人判斷的事項　　每月約 5 件（0.8%）',
    note: '量最小，但這才是技術客服真正的專業價值所在。',
    rows: [
      {
        code: 'C5', name: '質疑派工判斷', perMonth: '2', share: '0.3%',
        ex: ['這維修不能線上調整253網段IP就行嗎，一定需要派工嗎?',
             '該工程師為有機房端職能，為何約工該工程師，有確認到工程師職能問題嗎 ?',
             'TO CC 這筆還要繼續掛派工嗎？ 兩天了 看起來也沒有進線'],
        fix: ['保留人工，但值得個別檢視：每一件都在指出派工規則可能有誤，',
              '累積起來可以回饋修正派工條件。'],
      },
      {
        code: 'E1', name: '技術諮詢／請求判斷', perMonth: '2', share: '0.3%',
        ex: ['這社區好像因為NAT效能問題測速不足 工程師說昨天最高只能到350 除了換掉有其他解嗎?',
             '新竹 東城100 光SW4沒網路 有抓到轟炸戶 我要直接拔掉 還是光A隔離 幫確認'],
        fix: ['保留人工。可將問答累積成知識庫，降低重複詢問。'],
      },
      {
        code: 'F1', name: '流程反映／跨單位協調', perMonth: '1', share: '0.2%',
        ex: ['好像講蠻多次了，大台中沒有機子，所以電控不會有down/up問題，你們內部要不要再確認一下',
             '此案件與網路問題無關，再麻煩通知用戶'],
        fix: ['保留人工。這類訊息常指出跨單位認知落差，值得逐件追。'],
      },
    ],
  },
];

const rows = [
  new TableRow({
    tableHeader: true,
    children: HEADERS.map((h, i) =>
      cell(h, COLS[i], { bg: HEAD_BG, bold: true, middle: true, align: AlignmentType.CENTER })),
  }),
];

for (const g of GROUPS) {
  rows.push(new TableRow({
    children: [cell([g.title, g.note], TABLE_W,
                    { span: 6, bg: GROUP_BG, bold: true, color: ACCENT })],
  }));
  for (const r of g.rows) {
    rows.push(new TableRow({
      children: [
        cell(r.code, COLS[0], { bold: true, align: AlignmentType.CENTER, middle: true }),
        cell(r.name, COLS[1], { bold: true, color: r.warn ? WARN : INK }),
        cell(r.perMonth, COLS[2], { align: AlignmentType.CENTER, bold: true }),
        cell(r.share, COLS[3], { align: AlignmentType.CENTER, color: MUTED }),
        cell(r.ex.map(e => '・' + e), COLS[4], { color: MUTED }),
        cell(r.fix, COLS[5]),
      ],
    }));
  }
}

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 17, color: INK } } } },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 900, right: 800, bottom: 900, left: 800 },
      },
    },
    children: [
      new Paragraph({
        spacing: { after: 80 },
        children: [run('工程單位向技術客服提出的問題清單', { size: 26, bold: true })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [run(
          '【協作】技術客服與全區工程　2026-07-01 ~ 2026-09-30　共 29,263 則訊息',
          { size: 17, color: MUTED })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [run(
          '其中由工程指名技術客服處理的 2,059 則（每月約 686 則），依實際內容歸類如下。' +
          '分類經閱讀 205 則樣本後歸納，再套用至全部訊息，歸類率 98.0%。',
          { size: 17, color: MUTED })],
      }),
      new Table({ width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: COLS,
                  borders: BORDERS, rows }),
      new Paragraph({
        spacing: { before: 240 },
        children: [run(
          '結論：工程丟給客服的訊息有 88.7% 是完工回報請求結案，不是技術問題。' +
          '真正需要人判斷的只佔 0.8%。',
          { size: 18, bold: true, color: ACCENT })],
      }),
      new Paragraph({
        spacing: { before: 120 },
        children: [run(
          '備註：每月件數為 7–9 月平均。附件 classified.csv 含每則訊息的分類，可人工校對；' +
          'summary.csv 為本表的試算表版本，含「目前怎麼處理」與「建議解法」空欄可自行填寫。',
          { size: 16, color: MUTED })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = `${S}/工程向客服提問-問題清單.docx`;
  fs.writeFileSync(out, buf);
  console.log('已產生:', out, `(${(buf.length / 1024).toFixed(1)} KB)`);
});
