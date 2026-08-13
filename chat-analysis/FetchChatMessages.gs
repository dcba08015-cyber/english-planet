/**
 * 直接向 Google Chat 抓取某個空間的訊息，不經過 Takeout。
 *
 * 這一版按「月」分批抓取，每抓完一個月就立刻寫成檔案並釋放記憶體。
 * 一次把好幾個月全部堆在記憶體裡會觸發 Apps Script 的 Out of memory。
 *
 * 另外內建續跑機制：Apps Script 單次執行上限 6 分鐘，跑不完會自動記住
 * 進度並提示你再按一次執行，已經完成的月份不會重抓。
 *
 * ── 使用步驟 ────────────────────────────────────────────────
 *  1. 把這整個檔案的內容貼進 Apps Script，取代原本的程式碼
 *  2. 確認左側「服務」裡已經有「Google Chat API」（識別碼 Chat）
 *  3. 選 fetchMessages 執行
 *  4. 如果記錄最後說「請再按一次執行」，就再按一次，直到顯示全部完成
 *  5. 檔案會存在雲端硬碟根目錄，一個月一個：chat-2026-01.json、chat-2026-02.json…
 *
 * ── 其他函式 ────────────────────────────────────────────────
 *  listSpaces()   列出你所在的所有空間與代號
 *  resetProgress() 清除進度紀錄，讓下次執行從頭重抓
 *
 * ── appsscript.json 需要的權限 ──────────────────────────────
 *   https://www.googleapis.com/auth/chat.messages.readonly
 *   https://www.googleapis.com/auth/chat.spaces.readonly
 *   https://www.googleapis.com/auth/drive
 *
 *   最後一項不能換成 drive.file —— DriveApp 的寫入一律要完整 drive 權限。
 */

// 【協作】技術客服與全區工程
var SPACE_ID = 'AAAATAvSIeE';

// 抓取範圍：從哪個月開始、到哪個月結束（含）。格式 'YYYY-MM'。
var START_MONTH = '2026-01';
var END_MONTH = '';          // 留空 = 抓到這個月為止

var PAGE_SIZE = 500;         // 每頁筆數。記憶體不足時可再調小
var TIME_BUDGET_MS = 4.5 * 60 * 1000;   // 留安全餘裕，避免被 6 分鐘硬砍
                                        // 實測一個月約需 60 秒，所以一次大約
                                        // 跑 4~5 個月，要按兩次執行才會跑完

var PROGRESS_KEY = 'chatFetchDone_' + SPACE_ID;


function fetchMessages() {
  var started = Date.now();
  var props = PropertiesService.getUserProperties();
  var done = {};
  try {
    done = JSON.parse(props.getProperty(PROGRESS_KEY) || '{}');
  } catch (e) {
    done = {};
  }

  var months = buildMonthList(START_MONTH, END_MONTH);
  if (months.length === 0) {
    Logger.log('月份範圍設定有誤，請檢查 START_MONTH 與 END_MONTH。');
    return;
  }

  Logger.log('預計處理 ' + months.length + ' 個月：' + months[0] + ' ~ ' + months[months.length - 1]);
  Logger.log('');

  var ranOut = false;

  for (var i = 0; i < months.length; i++) {
    var month = months[i];

    if (done[month]) {
      Logger.log(month + '  已完成，略過');
      continue;
    }

    if (Date.now() - started > TIME_BUDGET_MS) {
      ranOut = true;
      break;
    }

    var result;
    try {
      result = fetchOneMonth(month);
    } catch (e) {
      explainError(e);
      return;
    }

    if (result.count === 0) {
      Logger.log(month + '  沒有訊息');
    } else {
      Logger.log(month + '  ' + result.count + ' 則  ->  ' + result.filename);
    }

    done[month] = true;
    props.setProperty(PROGRESS_KEY, JSON.stringify(done));
  }

  Logger.log('');
  if (ranOut) {
    Logger.log('==========================================');
    Logger.log('  時間快到了，先停在這裡。');
    Logger.log('  請「再按一次執行」，會從沒做完的月份接續。');
    Logger.log('==========================================');
  } else {
    Logger.log('==========================================');
    Logger.log('  全部完成。');
    Logger.log('  檔案在雲端硬碟根目錄，檔名開頭 chat-' + START_MONTH.substring(0, 4));
    Logger.log('  把這些 json 檔一起傳出去即可。');
    Logger.log('==========================================');
  }
}


/**
 * 抓單一個月，寫成一個檔案。回傳 {count, filename}。
 */
function fetchOneMonth(month) {
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

    var res = listWithRetry('spaces/' + SPACE_ID, params);
    var msgs = res.messages || [];

    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var text = m.text || '';
      if (!text) {
        continue;   // 純附件訊息對文字分析沒用，直接丟掉省記憶體
      }
      var sender = m.sender || {};
      out.push({
        creator: {
          name: sender.displayName || sender.name || '(unknown)',
          email: '',
          user_type: sender.type === 'BOT' ? 'Bot' : 'Human'
        },
        created_date: m.createTime || '',
        text: text
      });
    }

    pageToken = res.nextPageToken || null;
    guard++;
  } while (pageToken && guard < 500);

  if (out.length === 0) {
    return { count: 0, filename: '' };
  }

  out.sort(function (a, b) {
    return a.created_date < b.created_date ? -1 : 1;
  });

  var filename = 'chat-' + month + '.json';
  var payload = JSON.stringify({ messages: out });

  // DriveApp 的任何寫入都需要完整的 drive 權限，drive.file 對它不夠用
  // （drive.file 只適用於 Drive 進階服務／REST API，不適用 DriveApp）。
  // 這裡不另外查詢同名舊檔：重跑前請自行把舊的 chat-*.json 刪掉。
  DriveApp.createFile(filename, payload, MimeType.PLAIN_TEXT);

  var count = out.length;
  out = null;
  payload = null;
  return { count: count, filename: filename };
}


/**
 * 包一層重試。Chat API 偶爾回「Internal error. Retry the request later.」
 * 這類伺服器端的暫時性故障，等一下再打通常就過了，不該讓整批中斷。
 * 每次等待時間加倍，最多重試 4 次（2+4+8+16 秒）。
 */
function listWithRetry(parent, params) {
  var delay = 2000;

  for (var attempt = 1; attempt <= 5; attempt++) {
    try {
      return Chat.Spaces.Messages.list(parent, params);
    } catch (e) {
      var msg = String((e && e.message) || e);
      var transient =
        msg.indexOf('Internal error') !== -1 ||
        msg.indexOf('backendError') !== -1 ||
        msg.indexOf('rateLimit') !== -1 ||
        msg.indexOf('Rate Limit') !== -1 ||
        msg.indexOf('Quota') !== -1 ||
        msg.indexOf('try again') !== -1 ||
        msg.indexOf('Try again') !== -1 ||
        msg.indexOf('Retry') !== -1 ||
        msg.indexOf('503') !== -1 ||
        msg.indexOf('500') !== -1 ||
        msg.indexOf('429') !== -1;

      if (!transient || attempt === 5) {
        throw e;
      }

      Logger.log('    伺服器暫時性錯誤，' + (delay / 1000) + ' 秒後重試（第 ' +
                 attempt + ' 次）');
      Utilities.sleep(delay);
      delay *= 2;
    }
  }
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
  var m = parseInt(month.substring(5, 7), 10);
  m++;
  if (m > 12) {
    m = 1;
    y++;
  }
  return y + '-' + (m < 10 ? '0' + m : String(m));
}


/**
 * 清除進度，下次執行從頭重抓。
 */
function resetProgress() {
  PropertiesService.getUserProperties().deleteProperty(PROGRESS_KEY);
  Logger.log('進度已清除，下次執行會重抓所有月份。');
}


/**
 * 列出你所在的所有空間與代號。
 */
function listSpaces() {
  try {
    var pageToken = null;
    var n = 0;
    do {
      var res = Chat.Spaces.list({ pageSize: 1000, pageToken: pageToken });
      (res.spaces || []).forEach(function (s) {
        Logger.log('  ' + String(s.name || '').replace('spaces/', '') +
                   '   ' + (s.displayName || '(未命名)'));
        n++;
      });
      pageToken = res.nextPageToken || null;
    } while (pageToken);
    Logger.log('');
    Logger.log('共 ' + n + ' 個空間。Chat API 正常。');
  } catch (e) {
    explainError(e);
  }
}


function explainError(e) {
  var msg = String((e && e.message) || e);
  Logger.log('執行失敗：' + msg);
  Logger.log('');

  if (msg.indexOf('memory') !== -1 || msg.indexOf('Out of') !== -1) {
    Logger.log('記憶體不足。把 PAGE_SIZE 調小（例如 200），再執行一次。');
    Logger.log('已完成的月份不會重抓。');
  } else if (msg.indexOf('Chat') !== -1 && msg.indexOf('not defined') !== -1) {
    Logger.log('沒有加入 Chat 進階服務。');
    Logger.log('左側「服務」旁按「+」，選「Google Chat API」，識別碼保持 Chat。');
  } else if (msg.indexOf('403') !== -1 || msg.indexOf('PERMISSION_DENIED') !== -1) {
    Logger.log('權限被擋，需要 Workspace 管理員啟用 Google Chat API。');
  } else if (msg.indexOf('404') !== -1 || msg.indexOf('NOT_FOUND') !== -1) {
    Logger.log('找不到這個空間。先跑 listSpaces 確認 SPACE_ID。');
  }
}
