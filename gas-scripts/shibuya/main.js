/**
 * HALLEL渋谷店 - GASスクリプト
 *
 * hallel-shibuya@gmail.com のGASにコピペするだけで動作します！
 *
 * 使い方:
 * 1. このコードをGASにコピペ
 * 2. setupTrigger10min() を実行
 * 3. 以降は自動で10分ごとに実行されます
 */

// ============================================================
// 【店舗固有の設定】 - ここだけ変更すればOK
// ============================================================
const CONFIG = {
  STORE_NAME: 'shibuya',
  STORE_KEYWORD: '渋谷',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel',
  INCLUDE_KEYWORD: '渋谷店',  // この店舗のメールのみ処理
  EXCLUDE_KEYWORDS: ['恵比寿店', '半蔵門店', '代々木上原店', '中目黒店'],  // 他店舗を確実に除外
  DEFAULT_ROOM: '渋谷店',
  API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',
  API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',
  // カレンダー同期（null = 同期しない）
  CALENDAR_ID: null,
  // 処理済みラベル
  LABEL_NAME: 'HALLEL_処理済み_渋谷',
};

/**
 * 【店舗固有】部屋名を抽出（渋谷店: STUDIO ①~⑦）
 */
function extractStudio(body) {
  // パターン1: 「設備： 渋谷店 STUDIO ⑦ (1)」形式
  const match = body.match(/設備[：:]\s*渋谷店\s*STUDIO\s*([①②③④⑤⑥⑦])/);
  if (match) return `STUDIO ${match[1]}`;

  // パターン2: 本文中に「STUDIO ①」などが含まれている
  const nums = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
  for (const n of nums) {
    if (body.includes(`STUDIO ${n}`) || body.includes(`STUDIO${n}`)) {
      return `STUDIO ${n}`;
    }
  }

  return CONFIG.DEFAULT_ROOM;
}

// ============================================================
// 【共通コード】 以下は全店舗で共通
// ============================================================

function setupTrigger10min() {
  deleteAllTriggers();
  ScriptApp.newTrigger('processNewReservations').timeBased().everyMinutes(10).create();
  Logger.log(`トリガー設定完了: 10分ごと (${CONFIG.STORE_KEYWORD}店)`);
}

function setupTrigger1hour() {
  deleteAllTriggers();
  ScriptApp.newTrigger('processNewReservations').timeBased().everyHours(1).create();
  Logger.log(`トリガー設定完了: 1時間ごと (${CONFIG.STORE_KEYWORD}店)`);
}

function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log(`トリガー削除: ${triggers.length}件`);
}

function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`現在のトリガー: ${triggers.length}件`);
  triggers.forEach((t, i) => Logger.log(`${i + 1}. ${t.getHandlerFunction()}`));
}

function processNewReservations() {
  Logger.log('='.repeat(60));
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：処理開始】${new Date().toLocaleString('ja-JP')}`);

  try {
    // ラベル取得/作成
    const label = GmailApp.getUserLabelByName(CONFIG.LABEL_NAME) ||
      GmailApp.createLabel(CONFIG.LABEL_NAME);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const query = `${CONFIG.SEARCH_QUERY} -label:${CONFIG.LABEL_NAME} after:${Math.floor(oneHourAgo.getTime() / 1000)}`;
    const threads = GmailApp.search(query);

    Logger.log(`未処理スレッド: ${threads.length}件`);
    if (threads.length === 0) return { success: true, processed: 0 };

    const reservations = [];
    const cancellations = [];
    const processedThreads = [];

    for (const thread of threads) {
      let hasValidData = false;

      for (const msg of thread.getMessages()) {
        if (msg.getDate() < oneHourAgo) continue;

        const body = msg.getPlainBody();

        // この店舗のメールかチェック（最強ロジック：行単位で解析）
        const lines = body.split(/\r\n|\r|\n/);
        const storeLine = lines.find(line => line.trim().match(/^店舗[：:]/));

        // 「店舗：」行が見つからない、またはその行に「HALLEL 渋谷店」が含まれていない場合はスキップ
        if (!storeLine || !storeLine.includes('HALLEL 渋谷店')) continue;

        // 他店舗除外
        if (CONFIG.EXCLUDE_KEYWORDS.some(k => body.includes(k))) continue;

        const data = parseEmail(msg.getSubject(), body, msg.getDate(), msg.getId());
        if (data) {
          (data.actionType === 'reservation' ? reservations : cancellations).push(data);
          const labelText = data.isCharter ? '【貸切】' : '';
          Logger.log(`${data.actionType === 'reservation' ? '予約' : 'キャンセル'}: ${data.fullName} (${data.studio}) ${labelText}`);
          hasValidData = true;
        }
      }

      if (hasValidData) {
        processedThreads.push(thread);
      }
    }

    const allData = [...reservations, ...cancellations];
    Logger.log(`送信対象: ${allData.length}件`);

    if (allData.length === 0) return { success: true, processed: 0 };

    const result = sendToAPI(allData);
    Logger.log(result.success ? `API送信成功: ${result.count}件` : `API送信失敗: ${result.error}`);

    // API送信成功時のみラベル追加
    if (result.success) {
      processedThreads.forEach(t => t.addLabel(label));
      Logger.log(`ラベル追加: ${processedThreads.length}スレッド`);
    }

    // カレンダー同期（設定されている場合のみ）
    if (CONFIG.CALENDAR_ID) {
      syncToCalendar(reservations, cancellations);
    }

    Logger.log('【処理完了】');
    return { success: true, processed: allData.length };

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function parseEmail(subject, body, emailDate, messageId) {
  try {
    const fullName = (body.match(/(.+?) 様/) || [])[1]?.trim() || 'Unknown';
    const timeMatch = body.match(/日時[：:]\s*([\d]{4}年[\d]{1,2}月[\d]{1,2}日)[^\d]*(\d{1,2}:\d{2})\s*[〜～~-]\s*(\d{1,2}:\d{2})/);

    if (!timeMatch) return null;

    const dateStr = timeMatch[1].replace(/年/g, '/').replace(/月/g, '/').replace(/日/g, '');
    const startTime = new Date(`${dateStr} ${timeMatch[2]}`);
    const endTime = new Date(`${dateStr} ${timeMatch[3]}`);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return null;

    const isReservation = subject.includes('予約完了');
    const isCancellation = subject.includes('キャンセル');
    if (!isReservation && !isCancellation) return null;

    const studio = extractStudio(body);
    const isCharter = body.includes('貸切利用') || body.includes('貸切');

    return {
      fullName, startTime, endTime, studio, isCharter,
      actionType: isReservation ? 'reservation' : 'cancellation',
      emailDate, messageId,
      key: `${fullName}|${startTime.getTime()}|${endTime.getTime()}|${studio}`
    };
  } catch (e) {
    Logger.log(`解析エラー: ${e.message}`);
    return null;
  }
}

function sendToAPI(reservations) {
  try {
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: reservations.map(r => ({
        date: Utilities.formatDate(r.startTime, 'JST', 'yyyy-MM-dd'),
        start: Utilities.formatDate(r.startTime, 'JST', 'HH:mm'),
        end: Utilities.formatDate(r.endTime, 'JST', 'HH:mm'),
        customer_name: r.fullName,
        room_name: r.studio,
        store: CONFIG.STORE_NAME,
        type: r.isCharter ? 'charter' : 'gmail',
        is_cancellation: r.actionType === 'cancellation',
        is_charter: r.isCharter || false,
        source: 'gas_sync',
        email_id: r.messageId,
        email_date: r.emailDate.toISOString()
      }))
    };

    const res = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-Key': CONFIG.API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    return code >= 200 && code < 300
      ? { success: true, count: reservations.length }
      : { success: false, error: `HTTP ${code}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function syncToCalendar(reservations, cancellations) {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!calendar) {
    Logger.log(`カレンダー未設定: ${CONFIG.CALENDAR_ID}`);
    return;
  }

  let added = 0, deleted = 0;

  for (const r of reservations) {
    const title = r.isCharter ? `${r.fullName} - HALLEL-【貸切】` : `${r.fullName} - HALLEL-${r.studio}`;
    const events = calendar.getEvents(
      new Date(r.startTime.getTime() - 60000),
      new Date(r.endTime.getTime() + 60000)
    );

    const exists = events.some(e =>
      e.getTitle() === title &&
      Math.abs(e.getStartTime().getTime() - r.startTime.getTime()) < 60000
    );

    if (!exists) {
      calendar.createEvent(title, r.startTime, r.endTime);
      added++;
    }
  }

  for (const r of cancellations) {
    const events = calendar.getEvents(
      new Date(r.startTime.getTime() - 300000),
      new Date(r.endTime.getTime() + 300000)
    );

    for (const e of events) {
      if (e.getTitle().includes(r.fullName) && e.getTitle().includes('HALLEL')) {
        e.deleteEvent();
        deleted++;
      }
    }
  }

  Logger.log(`カレンダー: 追加${added}件, 削除${deleted}件`);
}

function syncAllToAPI() {
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：全データ同期】`);

  const threads = GmailApp.search(CONFIG.SEARCH_QUERY);
  const allEmails = [];

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const body = msg.getPlainBody();

      // この店舗のメールかチェック（最強ロジック：行単位で解析）
      const lines = body.split(/\r\n|\r|\n/);
      const storeLine = lines.find(line => line.trim().match(/^店舗[：:]/));

      if (!storeLine || !storeLine.includes('HALLEL 渋谷店')) continue;

      // 他店舗除外
      if (CONFIG.EXCLUDE_KEYWORDS.some(k => body.includes(k))) continue;

      const data = parseEmail(msg.getSubject(), body, msg.getDate(), msg.getId());
      if (data) allEmails.push(data);
    }
  }

  // 最新のみ抽出
  const grouped = {};
  for (const e of allEmails) {
    if (!grouped[e.key]) grouped[e.key] = [];
    grouped[e.key].push(e);
  }

  const latest = Object.values(grouped).map(arr => {
    arr.sort((a, b) => a.emailDate.getTime() - b.emailDate.getTime());
    return arr[arr.length - 1];
  }).filter(r => r.actionType === 'reservation');

  Logger.log(`送信対象: ${latest.length}件`);

  // バッチ送信
  let success = 0, failed = 0;
  for (let i = 0; i < latest.length; i += 50) {
    const batch = latest.slice(i, i + 50);
    const result = sendToAPI(batch);
    if (result.success) success += result.count;
    else failed += batch.length;
    if (i + 50 < latest.length) Utilities.sleep(1000);
  }

  Logger.log(`完了: 成功${success}件, 失敗${failed}件`);
  return { success: true, total: success, failed };
}

function testExtractStudio() {
  const tests = [
    '設備： 渋谷店 STUDIO ① (1)',
    '設備： 渋谷店 STUDIO ⑦ (1)',
    'STUDIO ③ での予約',
    '不明なルーム'
  ];
  Logger.log('部屋名抽出テスト:');
  tests.forEach(t => Logger.log(`"${t}" → "${extractStudio(t)}"`));
}

/**
 * 全ての処理済みラベルを削除（全店舗分）
 * 古い誤ったラベルをリセットする時に使用
 */
function removeAllProcessedLabels() {
  const allLabels = [
    'HALLEL_処理済み_半蔵門',
    'HALLEL_処理済み_渋谷',
    'HALLEL_処理済み_恵比寿',
    'HALLEL_処理済み_中目黒',
    'HALLEL_処理済み_代々木上原'
  ];

  Logger.log('='.repeat(60));
  Logger.log('【ラベル削除開始】全店舗の処理済みラベルを削除します');

  let totalRemoved = 0;
  for (const labelName of allLabels) {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      const threads = label.getThreads();
      Logger.log(`${labelName}: ${threads.length}スレッド`);

      // 全スレッドからラベルを削除
      for (const thread of threads) {
        thread.removeLabel(label);
      }

      totalRemoved += threads.length;
    } else {
      Logger.log(`${labelName}: ラベルなし`);
    }
  }

  Logger.log(`合計 ${totalRemoved}スレッドからラベルを削除しました`);
  Logger.log('【削除完了】最新のコードで processNewReservations を実行してください');
}
