/**
 * 直接向 Google Chat API 抓取某個空間的訊息，不經過 Takeout。
 *
 * 為什麼要這個：Takeout 匯出會把群組裡分享過的圖片影片全部打包（動輒數十 GB），
 * 而且這次的匯出在 2025-02-26 就中斷了。這支腳本直接跟 Chat 要訊息文字，
 * 幾秒鐘就跑完，而且能立刻看出某個日期之後到底還有沒有資料。
 *
 * 執行環境：script.google.com，瀏覽器裡就能跑，不用安裝任何東西。
 *
 * ── 使用步驟 ────────────────────────────────────────────────
 *  1. 用公司帳號登入 https://script.google.com ，建立新專案
 *  2. 把這整個檔案的內容貼進去，取代原本的 myFunction
 *  3. 左邊齒輪「專案設定」→ 勾選「顯示 appsscript.json 資訊清單檔案」
 *  4. 打開 appsscript.json，把 oauthScopes 換成檔案最下方註解裡那段
 *  5. 上方函式選單選 fetchMessages，按「執行」，第一次會要求授權，同意即可
 *  6. 看下方「執行記錄」：會顯示抓到幾則、最早與最新的日期
 *  7. 檔案會存到你的雲端硬碟根目錄，檔名 chat-messages-<日期>.json
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


function fetchMessages() {
  var token = ScriptApp.getOAuthToken();
  var base = 'https://chat.googleapis.com/v1/spaces/' + SPACE_ID + '/messages';

  var all = [];
  var pageToken = null;
  var page = 0;

  do {
    var url = base + '?pageSize=' + PAGE_SIZE;
    if (SINCE) {
      url += '&filter=' + encodeURIComponent('createTime > "' + SINCE + '"');
    }
    if (pageToken) {
      url += '&pageToken=' + encodeURIComponent(pageToken);
    }

    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var body = res.getContentText();

    if (code !== 200) {
      Logger.log('API 回傳錯誤 ' + code);
      Logger.log(body);
      Logger.log('');
      Logger.log('常見原因：');
      Logger.log(' 403 → Chat API 沒啟用，或 appsscript.json 的權限範圍沒設對');
      Logger.log(' 404 → SPACE_ID 不對，或你的帳號不在這個空間裡');
      return;
    }

    var data = JSON.parse(body);
    var msgs = data.messages || [];
    all = all.concat(msgs);
    pageToken = data.nextPageToken || null;
    page++;
    Logger.log('第 ' + page + ' 頁：取得 ' + msgs.length + ' 則，累計 ' + all.length);
  } while (pageToken && page < 200);

  if (all.length === 0) {
    Logger.log('');
    Logger.log('==========================================');
    Logger.log(SINCE + ' 之後沒有任何訊息。');
    Logger.log('代表這段期間的訊息確實不存在於 Google 端，');
    Logger.log('任何匯出方式都拿不到 —— 資料本身已經沒有了。');
    Logger.log('==========================================');
    return;
  }

  // 轉成跟 Takeout 的 messages.json 一樣的格式，
  // 這樣既有的分析程式不用改就能直接吃。
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


/**
 * 列出你所在的所有空間及其代號，用來確認 SPACE_ID 對不對。
 */
function listSpaces() {
  var token = ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch('https://chat.googleapis.com/v1/spaces?pageSize=1000', {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('錯誤 ' + res.getResponseCode() + '：' + res.getContentText());
    return;
  }

  var spaces = JSON.parse(res.getContentText()).spaces || [];
  Logger.log('共 ' + spaces.length + ' 個空間：');
  spaces.forEach(function (s) {
    var id = String(s.name || '').replace('spaces/', '');
    Logger.log('  ' + id + '   ' + (s.displayName || '(未命名)'));
  });
}


/* ────────────────────────────────────────────────────────────
   appsscript.json 請改成這樣（保留原本的 timeZone 等欄位即可）：

   {
     "timeZone": "Asia/Taipei",
     "exceptionLogging": "STACKDRIVER",
     "runtimeVersion": "V8",
     "oauthScopes": [
       "https://www.googleapis.com/auth/chat.messages.readonly",
       "https://www.googleapis.com/auth/chat.spaces.readonly",
       "https://www.googleapis.com/auth/script.external_request",
       "https://www.googleapis.com/auth/drive.file"
     ]
   }
   ──────────────────────────────────────────────────────────── */
