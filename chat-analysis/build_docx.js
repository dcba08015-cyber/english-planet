const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, PageBreak,
} = require('docx');

const S = '/tmp/claude-0/-home-user-english-planet/a30b5b56-fd7b-5bd7-990f-5869e7ed4aa0/scratchpad';
const R = '/home/user/english-planet/chat-analysis';

const stats = JSON.parse(fs.readFileSync(`${S}/y2026-out/stats.json`, 'utf8'));
const findings = fs.readFileSync(`${R}/findings.2026.md`, 'utf8');

// 中文字型：Word 用微軟正黑體，LibreOffice 預覽時退回文泉驛正黑
const FONT = '微軟正黑體';
const INK = '1A1A1A';
const MUTED = '5A6975';
const ACCENT = '0D6B78';
const RULE = 'D7DEE4';
const HEAD_BG = 'EEF1F4';

const TABLE_W = 9000;

function txt(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: opts.size || 21, bold: !!opts.bold,
                       color: opts.color || INK, italics: !!opts.italics });
}

function para(text, opts = {}) {
  return new Paragraph({
    children: Array.isArray(text) ? text : [txt(text, opts)],
    spacing: { after: opts.after === undefined ? 120 : opts.after,
               before: opts.before || 0, line: 300 },
    alignment: opts.align,
    indent: opts.indent,
    border: opts.border,
  });
}

function heading(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 360 : 260, after: 140 },
    children: [new TextRun({ text, font: FONT, bold: true,
                             size: level === HeadingLevel.HEADING_1 ? 30 : 24,
                             color: level === HeadingLevel.HEADING_1 ? INK : ACCENT })],
  });
}

function cell(children, width, opts = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: opts.bg ? { type: ShadingType.CLEAR, fill: opts.bg, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: Array.isArray(children) ? children : [children],
  });
}

function tableCell(text, width, opts = {}) {
  return cell(new Paragraph({
    alignment: opts.align,
    spacing: { after: 0, line: 260 },
    children: [txt(String(text), { bold: opts.bold, color: opts.color, size: 20 })],
  }), width, opts);
}

function makeTable(headers, rows, widths) {
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  };
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA },
    columnWidths: widths,
    borders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          tableCell(h, widths[i], { bold: true, bg: HEAD_BG, color: MUTED,
                                    align: i === 0 ? undefined : AlignmentType.RIGHT })),
      }),
      ...rows.map(r => new TableRow({
        children: r.map((c, i) =>
          tableCell(c, widths[i], { align: i === 0 ? undefined : AlignmentType.RIGHT })),
      })),
    ],
  });
}

// ---- 把 findings.md 轉成段落 ----------------------------------------
function inlineRuns(line) {
  const runs = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) runs.push(txt(line.slice(last, m.index)));
    runs.push(txt(m[1], { bold: true }));
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push(txt(line.slice(last)));
  return runs.length ? runs : [txt(line)];
}

function renderFindings(md) {
  const out = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      out.push(heading(line.slice(3), HeadingLevel.HEADING_2));
    } else if (line.startsWith('> ')) {
      out.push(new Paragraph({
        children: inlineRuns(line.slice(2)),
        spacing: { after: 100, line: 280 },
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
      }));
    } else if (line.startsWith('- ')) {
      out.push(new Paragraph({
        children: inlineRuns(line.slice(2)),
        bullet: { level: 0 },
        spacing: { after: 60, line: 280 },
      }));
    } else {
      out.push(para(inlineRuns(line), { after: 140 }));
    }
  }
  return out;
}

// ---- 組裝文件 --------------------------------------------------------
const t = stats.totals;
const dr = stats.date_range;
const kinds = t.by_kind || {};

const children = [];

children.push(new Paragraph({
  spacing: { after: 60 },
  children: [txt('GOOGLE CHAT 群組分析', { size: 17, color: MUTED, bold: true })],
}));
children.push(new Paragraph({
  spacing: { after: 100 },
  children: [txt(t.spaces.join('、'), { size: 34, bold: true })],
}));
children.push(new Paragraph({
  spacing: { after: 300 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
  children: [txt(`${dr.start} 至 ${dr.end}　·　${t.participants} 位成員　·　產生於 ${stats.generated_at}`,
                 { size: 19, color: MUTED })],
}));

children.push(makeTable(
  ['資料規模', '數量'],
  [
    ['總訊息', t.messages.toLocaleString()],
    ['需要有人回應的訊息', t.questions.toLocaleString()],
    ['　其中：提問', (kinds['問題'] || 0).toLocaleString()],
    ['　其中：請求協助', (kinds['請求'] || 0).toLocaleString()],
  ],
  [6000, 3000],
));

children.push(heading('重點發現', HeadingLevel.HEADING_1));
children.push(...renderFindings(findings));

children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(heading('訊息丟給誰處理', HeadingLevel.HEADING_1));
children.push(para('群組裡用 @姓名(單位) 點名該由誰處理，括號裡就是對方的單位。這一段只計入有點名的訊息，因此直接反映各單位實際被交辦的工作型態。一則訊息可同時屬於多個類型，佔比加總會超過 100%。',
                   { color: MUTED, size: 19, after: 200 }));

for (const [name, data] of Object.entries(stats.by_target)) {
  children.push(heading(`@${name}　（${data.total.toLocaleString()} 則）`, HeadingLevel.HEADING_2));
  children.push(makeTable(
    ['類型', '則數', '佔比'],
    data.categories.filter(c => c.name !== '未分類').slice(0, 8)
      .map(c => [c.name, c.count.toLocaleString(), (c.share * 100).toFixed(1) + '%']),
    [5000, 2000, 2000],
  ));
  children.push(para('', { after: 120 }));
}

children.push(heading('問題類型排名（全體）', HeadingLevel.HEADING_1));
children.push(makeTable(
  ['類型', '則數', '佔比'],
  stats.categories.map(c => [c.name, c.count.toLocaleString(), (c.share * 100).toFixed(1) + '%']),
  [5000, 2000, 2000],
));

if (stats.compare) {
  const prev = stats.compare;
  children.push(heading('與前一期比較', HeadingLevel.HEADING_1));
  children.push(para(`前期為 ${prev.range.start} 至 ${prev.range.end}。數字是各類型佔「需回應訊息」的比例，看的是同一類型在兩期之間的消長。`,
                     { color: MUTED, size: 19, after: 200 }));
  const rows = stats.categories
    .filter(c => c.name !== '未分類')
    .map(c => {
      const before = prev.shares[c.name] || 0;
      const delta = (c.share - before) * 100;
      const mark = delta > 2 ? '▲' : (delta < -2 ? '▼' : '·');
      return [c.name, (before * 100).toFixed(1) + '%', (c.share * 100).toFixed(1) + '%',
              `${mark} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pt`];
    });
  children.push(makeTable(['類型', '前期', '本期', '變化'], rows, [3600, 1800, 1800, 1800]));
}

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(heading('各類型的實際原文', HeadingLevel.HEADING_1));
children.push(para('用來檢查分類準不準。每個類型列出幾則代表性訊息。',
                   { color: MUTED, size: 19, after: 200 }));

for (const c of stats.categories) {
  if (!c.examples.length || c.name === '未分類') continue;
  children.push(heading(`${c.name}　（${c.count.toLocaleString()} 則）`, HeadingLevel.HEADING_2));
  for (const e of c.examples) {
    children.push(new Paragraph({
      spacing: { after: 40, line: 260 },
      children: [txt(`${e.date}`, { size: 17, color: MUTED })],
    }));
    children.push(new Paragraph({
      spacing: { after: 140, line: 280 },
      indent: { left: 360 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 8 } },
      children: [txt(e.text, { size: 20 })],
    }));
  }
}

const doc = new Document({
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•',
                 alignment: AlignmentType.LEFT,
                 style: { paragraph: { indent: { left: 420, hanging: 220 } } } }],
    }],
  },
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: INK } },
    },
  },
  sections: [{
    properties: { page: { margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = `${S}/技術客服與全區工程-群組問題分析.docx`;
  fs.writeFileSync(out, buf);
  console.log('已產生:', out, `(${(buf.length / 1024).toFixed(1)} KB)`);
});
