/**
 * 直接向 Google Chat 抓取某個空間的訊息，不經過 Takeout。
 *
 * 這一版改用 Apps Script 的「進階服務」呼叫 Chat API，而不是自己發 HTTP 請求。
 * 差別在於：進階服務可以直接從 Apps Script 編輯器的「服務」面板加入，
 * 不需要進 Google Cloud Console。公司把 Cloud Console 權限鎖住時，
 * 這是唯一可能繞過去的路。
 *
 * ── 使用步驟 ────────────────────────────────────────────────
 *  1. 用公司帳號登入 https://script.google.com ，開啟你的專案
 *  2. 把這整個檔案的內容貼進去，取代原本的程式碼
 *  3. 左側「服務」旁邊按「+」，找到「Google Chat API」，
 *     識別碼保持預設的 Chat，按「新增」            ← 最關鍵的一步
 *  4. 上方函式選單選 listSpaces，按「執行」，先確認能不能讀到空間清單
 *  5. 成功的話再選 fetchMessages 執行，抓訊息
 *  6. 檔案會存到雲端硬碟根目錄，檔名 chat-messages-<日期>.json
 *
 * ── 要改的地方 ──────────────────────────────────────────────
 *  SPACE_ID  你要抓的空間代號
 *  SINCE     只抓這個時間之後的訊息；設成 null 就抓全部
 */

// 【協作】技術客服與全區工程
var SPACE_ID = 'AAAATAvSIeE';

// 只抓這天之後的訊息。Takeout 已經有 2025-02-26 之前的，所以從那天接續。
// 想抓全部就改成： var SINCE = null;
var SINCE = '2025-02-26T00:00:00Z';

var PAGE_SIZE = 1000;


/**
 * 先跑這個。能列出空間清單，就代表 Chat API 通了。
 */
function listSpaces() {
  try {
    var out = [];
    var pageToken = null;
    do {
      var res = Chat.Spaces.list({ pageSize: 1000, pageToken: pageToken });
      (res.spaces || []).forEach(function (s) {
        out.push({
          id: String(s.name || '').replace('spaces/', ''),
          name: s.displayName || '(未命名)'
        });
      });
      pageToken = res.nextPageToken || null;
    } while (pageToken);

    Logger.log('讀到 ' + out.length + ' 個空間：');
    Logger.log('');
    out.forEach(function (s) {
      Logger.log('  ' + s.id + '   ' + s.name);
    });
    Logger.log('');
    Logger.log('Chat API 正常，可以執行 fetchMessages 了。');
  } catch (e) {
    explainError(e);
  }
}


/**
 * 抓訊息，存成跟 Takeout 相同格式的 JSON 到雲端硬碟。
 */
function fetchMessages() {
  var all = [];
  var pageToken = null;
  var page = 0;

  try {
    do {
      var params = { pageSize: PAGE_SIZE };
      if (SINCE) {
        params.filter = 'createTime > "' + SINCE + '"';
      }
      if (pageToken) {
        params.pageToken = pageToken;
      }

      var res = Chat.Spaces.Messages.list('spaces/' + SPACE_ID, params);
      var msgs = res.messages || [];
      all = all.concat(msgs);
      pageToken = res.nextPageToken || null;
      page++;
      Logger.log('第 ' + page + ' 頁：取得 ' + msgs.length + ' 則，累計 ' + all.length);
    } while (pageToken && page < 200);
  } catch (e) {
    explainError(e);
    return;
  }

  if (all.length === 0) {
    Logger.log('');
    Logger.log('==========================================');
    Logger.log('  ' + SINCE + ' 之後沒有任何訊息。');
    Logger.log('');
    Logger.log('  代表這段期間的訊息確實不在 Google 端，');
    Logger.log('  任何匯出方式都拿不到 —— 資料本身已經沒有了。');
    Logger.log('  最可能的原因是這個空間的「訊息紀錄」被關閉。');
    Logger.log('==========================================');
    return;
  }

  // 轉成跟 Takeout 的 messages.json 一樣的格式，既有分析程式不用改就能吃。
  var converted = all.map(function (m) {
    var sender = m.sender || {};
    return {
      creator: {
        name: sender.displayName || sender.name || '(unknown)',
        email: '',
        user_type: sender.type === 'BOT' ? 'Bot' : 'Human'
      },
      created_date: m.createTime || '',
      text: m.text || '',
      topic_id: m.thread ? m.thread.name : '',
      message_id: m.name || ''
    };
  });

  converted.sort(function (a, b) {
    return a.created_date < b.created_date ? -1 : 1;
  });

  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmm');
  var filename = 'chat-messages-' + stamp + '.json';
  var file = DriveApp.createFile(
    filename,
    JSON.stringify({ messages: converted }),
    MimeType.PLAIN_TEXT
  );

  Logger.log('');
  Logger.log('==========================================');
  Logger.log('  抓到 ' + converted.length + ' 則訊息');
  Logger.log('  最早：' + converted[0].created_date);
  Logger.log('  最新：' + converted[converted.length - 1].created_date);
  Logger.log('  已存到雲端硬碟：' + filename);
  Logger.log('  網址：' + file.getUrl());
  Logger.log('==========================================');
}


function explainError(e) {
  var msg = String((e && e.message) || e);
  Logger.log('執行失敗：' + msg);
  Logger.log('');

  if (msg.indexOf('Chat') !== -1 && msg.indexOf('not defined') !== -1) {
    Logger.log('沒有加入 Chat 進階服務。');
    Logger.log('左側「服務」旁按「+」，選「Google Chat API」，識別碼保持 Chat。');
  } else if (msg.indexOf('403') !== -1 || msg.indexOf('PERMISSION_DENIED') !== -1) {
    Logger.log('權限被擋。你的公司限制了這個專案能用哪些 API，');
    Logger.log('需要 Workspace 管理員協助啟用 Google Chat API。');
  } else if (msg.indexOf('404') !== -1 || msg.indexOf('NOT_FOUND') !== -1) {
    Logger.log('找不到這個空間。可能是 SPACE_ID 打錯，');
    Logger.log('或你的帳號目前不在這個空間裡。先跑 listSpaces 確認。');
  }
}


/* ────────────────────────────────────────────────────────────
   appsscript.json 請改成這樣：

   {
     "timeZone": "Asia/Taipei",
     "dependencies": {
       "enabledAdvancedServices": [
         {
           "userSymbol": "Chat",
           "serviceId": "chat",
           "version": "v1"
         }
       ]
     },
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": [
       "https://www.googleapis.com/auth/chat.messages.readonly",
       "https://www.googleapis.com/auth/chat.spaces.readonly",
       "https://www.googleapis.com/auth/drive.file"
     ]
   }

   （用編輯器的「服務」面板加入 Chat 之後，dependencies 那段會自動出現，
     你只要確認 oauthScopes 有那三行就好。）
   ──────────────────────────────────────────────────────────── */
