/**
 * Google Chat 對話紀錄擷取工具（試算表控制台版）
 *
 * 為什麼做成這樣：第一次抓是為了分析，之後每次抓是為了追蹤改善有沒有效。
 * 既然要重複使用，就不該每次都改程式碼——設定填在儲存格，執行點選單，
 * 結果直接寫進試算表。
 *
 * ── 安裝（只需做一次）────────────────────────────────────────
 *  1. 到 sheets.new 建立一份新的 Google 試算表，命名隨意
 *  2. 上方選單「擴充功能」→「Apps Script」
 *  3. 把這整個檔案的內容貼進去，取代原本的程式碼，按 Ctrl+S 存檔
 *  4. 左側「服務」旁按「+」，選「Google Chat API」，識別碼保持 Chat，按新增
 *  5. 左側齒輪「專案設定」→ 勾選「顯示 appsscript.json 資訊清單檔案」
 *  6. 打開 appsscript.json，把 oauthScopes 換成檔案最下方註解裡那段，存檔
 *  7. 回到試算表，重新整理頁面，上方會出現「Chat 工具」選單
 *
 * ── 每次使用 ────────────────────────────────────────────────
 *  1. 在「設定」工作表填入空間代號與起訖月份
 *  2. 點選單「Chat 工具」→「抓取訊息」
 *  3. 若提示時間不足，再點一次，會從中斷處接續
 *  4. 完成後「訊息」工作表就是完整紀錄，可直接下載或分享
 *
 * 不知道空間代號？點「Chat 工具」→「列出我的群組」，會寫到「群組清單」工作表。
 */

var SHEET_CONFIG = '設定';
var SHEET_MESSAGES = '訊息';
var SHEET_SPACES = '群組清單';
var SHEET_SUMMARY = '每月統計';

var PAGE_SIZE = 500;
var TIME_BUDGET_MS = 4.5 * 60 * 1000;   // 單次執行上限 6 分鐘，留安全餘裕
var WRITE_CHUNK = 2000;                 // 每次寫入試算表的列數

var CFG = {
  spaceId:    { row: 2, label: '空間代號',   hint: '例如 AAAATAvSIeE，不含 spaces/ 前綴' },
  startMonth: { row: 3, label: '起始月份',   hint: '格式 YYYY-MM，例如 2026-07' },
  endMonth:   { row: 4, label: '結束月份',   hint: '格式 YYYY-MM，留空代表抓到本月' },
  spaceName:  { row: 5, label: '群組名稱',   hint: '自動填入，供核對用' },
  status:     { row: 6, label: '執行狀態',   hint: '自動更新' },
};


// ── 選單 ─────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Chat 工具')
    .addItem('抓取訊息', 'fetchMessages')
    .addItem('列出我的群組', 'listSpaces')
    .addSeparator()
    .addItem('清除進度（重新抓取）', 'resetProgress')
    .addItem('建立／修復設定表', 'setupSheets')
    .addToUi();
}


function setupSheets() {
  var ss = SpreadsheetApp.getActive();
  var cfg = ss.getSheetByName(SHEET_CONFIG) || ss.insertSheet(SHEET_CONFIG, 0);
  cfg.clear();

  cfg.getRange('A1:C1').setValues([['項目', '內容', '說明']])
     .setFontWeight('bold').setBackground('#FCE4D6');

  var keys = ['spaceId', 'startMonth', 'endMonth', 'spaceName', 'status'];
  for (var i = 0; i < keys.length; i++) {
    var c = CFG[keys[i]];
    cfg.getRange(c.row, 1).setValue(c.label).setFontWeight('bold');
    cfg.getRange(c.row, 3).setValue(c.hint).setFontColor('#777777');
  }

  // 預設值：本次要抓的區間
  if (!cfg.getRange(CFG.startMonth.row, 2).getValue()) {
    cfg.getRange(CFG.startMonth.row, 2).setValue('2026-07');
  }
  if (!cfg.getRange(CFG.endMonth.row, 2).getValue()) {
    cfg.getRange(CFG.endMonth.row, 2).setValue('2026-09');
  }
  cfg.getRange(CFG.spaceId.row, 2).setNumberFormat('@');
  cfg.getRange(CFG.startMonth.row, 2).setNumberFormat('@');
  cfg.getRange(CFG.endMonth.row, 2).setNumberFormat('@');
  cfg.setColumnWidth(1, 110).setColumnWidth(2, 220).setColumnWidth(3, 420);

  ensureSheet(SHEET_MESSAGES, ['日期時間', '發話者ID', '訊息內容']);
  ensureSheet(SHEET_SUMMARY, ['月份', '訊息數', '抓取時間']);

  SpreadsheetApp.getUi().alert('設定表已建立。請在「設定」工作表填入空間代號。');
}


function ensureSheet(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#FCE4D6');
    sh.setFrozenRows(1);
  }
  return sh;
}


function readConfig() {
  var cfg = SpreadsheetApp.getActive().getSheetByName(SHEET_CONFIG);
  if (!cfg) {
    throw new Error('找不到「設定」工作表。請先執行選單的「建立／修復設定表」。');
  }
  var get = function (key) {
    return String(cfg.getRange(CFG[key].row, 2).getValue() || '').trim();
  };
  return {
    sheet: cfg,
    spaceId: get('spaceId').replace('spaces/', ''),
    startMonth: get('startMonth'),
    endMonth: get('endMonth'),
  };
}


function setStatus(cfgSheet, text) {
  cfgSheet.getRange(CFG.status.row, 2).setValue(text);
  SpreadsheetApp.flush();
}


// ── 主流程 ───────────────────────────────────────────────────
function fetchMessages() {
  var started = Date.now();
  var conf = readConfig();

  if (!conf.spaceId) {
    SpreadsheetApp.getUi().alert('請先在「設定」工作表填入空間代號。\n不知道代號請執行「列出我的群組」。');
    return;
  }
  if (!/^\d{4}-\d{2}$/.test(conf.startMonth)) {
    SpreadsheetApp.getUi().alert('起始月份格式錯誤，應為 YYYY-MM，例如 2026-07。');
    return;
  }

  var months = buildMonthList(conf.startMonth, conf.endMonth);
  if (months.length === 0) {
    SpreadsheetApp.getUi().alert('月份範圍有誤，請檢查起訖月份。');
    return;
  }

  var props = PropertiesService.getDocumentProperties();
  var progressKey = 'done_' + conf.spaceId;
  var done = {};
  try {
    done = JSON.parse(props.getProperty(progressKey) || '{}');
  } catch (e) {
    done = {};
  }

  var msgSheet = ensureSheet(SHEET_MESSAGES, ['日期時間', '發話者ID', '訊息內容']);
  var sumSheet = ensureSheet(SHEET_SUMMARY, ['月份', '訊息數', '抓取時間']);

  // 第一次執行時記下群組名稱，供核對
  try {
    var info = Chat.Spaces.get('spaces/' + conf.spaceId);
    conf.sheet.getRange(CFG.spaceName.row, 2).setValue(info.displayName || '(未命名)');
  } catch (e) { /* 取不到名稱不影響抓取 */ }

  var ranOut = false;
  var total = 0;

  for (var i = 0; i < months.length; i++) {
    var month = months[i];
    if (done[month]) {
      continue;
    }
    if (Date.now() - started > TIME_BUDGET_MS) {
      ranOut = true;
      break;
    }

    setStatus(conf.sheet, '抓取中：' + month + '（' + (i + 1) + '/' + months.length + '）');

    var rows;
    try {
      rows = fetchMonth(conf.spaceId, month);
    } catch (e) {
      setStatus(conf.sheet, '失敗：' + e.message);
      SpreadsheetApp.getUi().alert(explainError(e));
      return;
    }

    writeRows(msgSheet, rows);
    sumSheet.appendRow([month, rows.length,
                        Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm')]);
    total += rows.length;

    done[month] = true;
    props.setProperty(progressKey, JSON.stringify(done));
  }

  if (ranOut) {
    setStatus(conf.sheet, '時間不足，已暫停。請再點一次「抓取訊息」接續。');
    SpreadsheetApp.getUi().alert(
      '本次已抓取 ' + total + ' 則，尚未完成。\n\n請再點一次「Chat 工具 → 抓取訊息」，會從中斷處接續。');
  } else {
    setStatus(conf.sheet, '完成（' + months[0] + ' ~ ' + months[months.length - 1] + '）');
    SpreadsheetApp.getUi().alert(
      '全部完成。\n\n本次新增 ' + total + ' 則訊息。\n' +
      '「訊息」工作表即為完整紀錄，可直接下載或分享。');
  }
}


function fetchMonth(spaceId, month) {
  var from = month + '-01T00:00:00Z';
  var to = nextMonth(month) + '-01T00:00:00Z';
  var filter = 'createTime > "' + from + '" AND createTime < "' + to + '"';

  var out = [];
  var pageToken = null;
  var guard = 0;

  do {
    var params = { pageSize: PAGE_SIZE, filter: filter };
    if (pageToken) {
      params.pageToken = pageToken;
    }

    var res = listWithRetry('spaces/' + spaceId, params);
    var msgs = res.messages || [];

    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var text = m.text || '';
      if (!text) {
        continue;   // 純附件訊息對文字分析沒用
      }
      var sender = m.sender || {};
      if (sender.type === 'BOT') {
        continue;   // 機器人訊息不計入
      }
      out.push([
        toTaipei(m.createTime),
        String(sender.name || '').replace('users/', ''),
        text,
      ]);
    }

    pageToken = res.nextPageToken || null;
    guard++;
  } while (pageToken && guard < 500);

  out.sort(function (a, b) { return a < b ? -1 : 1; });
  return out;
}


/** Chat API 偶爾回伺服器端暫時性錯誤，等一下再打通常就過了。 */
function listWithRetry(parent, params) {
  var delay = 2000;
  for (var attempt = 1; attempt <= 5; attempt++) {
    try {
      return Chat.Spaces.Messages.list(parent, params);
    } catch (e) {
      var msg = String((e && e.message) || e);
      var transient =
        msg.indexOf('Internal error') !== -1 || msg.indexOf('backendError') !== -1 ||
        msg.indexOf('rateLimit') !== -1 || msg.indexOf('Rate Limit') !== -1 ||
        msg.indexOf('Try again') !== -1 || msg.indexOf('Retry') !== -1 ||
        msg.indexOf('503') !== -1 || msg.indexOf('500') !== -1 || msg.indexOf('429') !== -1;
      if (!transient || attempt === 5) {
        throw e;
      }
      Utilities.sleep(delay);
      delay *= 2;
    }
  }
}


/** 分批寫入，一次塞太多列會超過記憶體或逾時。 */
function writeRows(sheet, rows) {
  if (rows.length === 0) {
    return;
  }
  for (var i = 0; i < rows.length; i += WRITE_CHUNK) {
    var chunk = rows.slice(i, i + WRITE_CHUNK);
    sheet.getRange(sheet.getLastRow() + 1, 1, chunk.length, 3).setValues(chunk);
    SpreadsheetApp.flush();
  }
}


function listSpaces() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SPACES);
  if (sh) {
    sh.clear();
  } else {
    sh = SpreadsheetApp.getActive().insertSheet(SHEET_SPACES);
  }
  sh.getRange(1, 1, 1, 2).setValues([['空間代號', '群組名稱']])
    .setFontWeight('bold').setBackground('#FCE4D6');
  sh.setFrozenRows(1);

  var rows = [];
  var pageToken = null;
  try {
    do {
      var res = Chat.Spaces.list({ pageSize: 1000, pageToken: pageToken });
      (res.spaces || []).forEach(function (s) {
        rows.push([String(s.name || '').replace('spaces/', ''), s.displayName || '(未命名)']);
      });
      pageToken = res.nextPageToken || null;
    } while (pageToken);
  } catch (e) {
    SpreadsheetApp.getUi().alert(explainError(e));
    return;
  }

  rows.sort(function (a, b) { return a[1] < b[1] ? -1 : 1; });
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }
  sh.setColumnWidth(1, 160).setColumnWidth(2, 420);
  SpreadsheetApp.getUi().alert('已列出 ' + rows.length + ' 個群組，請見「群組清單」工作表。\n' +
                               '找到要抓的群組後，把左邊的代號填到「設定」工作表。');
}


function resetProgress() {
  var conf = readConfig();
  PropertiesService.getDocumentProperties().deleteProperty('done_' + conf.spaceId);
  setStatus(conf.sheet, '進度已清除');
  SpreadsheetApp.getUi().alert(
    '進度已清除，下次抓取會重跑所有月份。\n\n' +
    '注意：「訊息」工作表的既有資料不會自動刪除，若要重抓同一區間，' +
    '請先自行清空該工作表，否則會有重複。');
}


// ── 工具函式 ─────────────────────────────────────────────────
function toTaipei(iso) {
  if (!iso) {
    return '';
  }
  return Utilities.formatDate(new Date(iso), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
}

function buildMonthList(start, end) {
  if (!end) {
    end = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM');
  }
  var months = [];
  var cur = start;
  var guard = 0;
  while (cur <= end && guard < 240) {
    months.push(cur);
    cur = nextMonth(cur);
    guard++;
  }
  return months;
}

function nextMonth(month) {
  var y = parseInt(month.substring(0, 4), 10);
  var m = parseInt(month.substring(5, 7), 10) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + (m < 10 ? '0' + m : String(m));
}

function explainError(e) {
  var msg = String((e && e.message) || e);
  if (msg.indexOf('Chat') !== -1 && msg.indexOf('not defined') !== -1) {
    return '尚未加入 Chat 進階服務。\n左側「服務」旁按「+」，選「Google Chat API」，識別碼保持 Chat。';
  }
  if (msg.indexOf('403') !== -1 || msg.indexOf('PERMISSION_DENIED') !== -1) {
    return '權限被擋（403）。\n需請 Workspace 管理員啟用 Google Chat API，或確認 appsscript.json 的權限範圍是否正確。';
  }
  if (msg.indexOf('404') !== -1 || msg.indexOf('NOT_FOUND') !== -1) {
    return '找不到這個空間（404）。\n請確認空間代號，或執行「列出我的群組」重新查詢。';
  }
  return '執行失敗：' + msg;
}


/* ────────────────────────────────────────────────────────────
   appsscript.json 請改成這樣（dependencies 那段由「服務」面板自動產生，
   你只需確認 oauthScopes 有這五行）：

   {
     "timeZone": "Asia/Taipei",
     "dependencies": {
       "enabledAdvancedServices": [
         { "userSymbol": "Chat", "serviceId": "chat", "version": "v1" }
       ]
     },
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": [
       "https://www.googleapis.com/auth/chat.messages.readonly",
       "https://www.googleapis.com/auth/chat.spaces.readonly",
       "https://www.googleapis.com/auth/spreadsheets.currentonly",
       "https://www.googleapis.com/auth/script.container.ui"
     ]
   }

   若執行時出現權限相關錯誤，可以直接把整個 oauthScopes 區塊刪掉，
   讓 Apps Script 自動偵測所需權限，再重新執行一次並重新授權。
   ──────────────────────────────────────────────────────────── */
