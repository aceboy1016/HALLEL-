/**
 * HALLEL半蔵門店 - GASスクリプト
 *
 * hallel-hanzomon@gmail.com のGASにコピペするだけで動作します！
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
  STORE_NAME: 'hanzomon',
  STORE_KEYWORD: '半蔵門',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel',
  INCLUDE_KEYWORD: '半蔵門店',  // この店舗のメールのみ処理
  EXCLUDE_KEYWORDS: ['渋谷店', '恵比寿店', '中目黒店', '代々木上原店'],  // 他店舗を確実に除外
  DEFAULT_ROOM: '個室B',
  API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',
  API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',
  // カレンダー同期あり
  CALENDAR_ID: 'light@topform.jp',
  // 処理済みラベル
  LABEL_NAME: 'HALLEL_処理済み_半蔵門',
};

/**
 * 【店舗固有】部屋名を抽出（半蔵門店: STUDIO B ①②③、個室A/B）
 */
function extractStudio(body) {
  // パターン1: 「設備： 半蔵門店 STUDIO B ③ (1)」形式
  const equipMatch = body.match(/設備[：:]\s*半蔵門店\s*(STUDIO B [①②③]|個室[AB])/);
  if (equipMatch) return equipMatch[1];

  // パターン2: 「ルーム： 【STUDIO B ①】」形式
  const roomMatch = body.match(/ルーム[：:]\s*【(STUDIO B [①②③])】/);
  if (roomMatch) return roomMatch[1];

  // パターン3: 本文中のキーワード
  if (body.includes('STUDIO B ①') || body.includes('STUDIO B①')) return 'STUDIO B ①';
  if (body.includes('STUDIO B ②') || body.includes('STUDIO B②')) return 'STUDIO B ②';
  if (body.includes('STUDIO B ③') || body.includes('STUDIO B③')) return 'STUDIO B ③';

  // パターン4: 個室
  const roomMatch2 = body.match(/ルーム[：:]\s*【(個室[AB])】/);
  if (roomMatch2) return roomMatch2[1];

  // パターン5: STUDIO A/B → 個室A/B変換
  const studioMatch = body.match(/ルーム[：:]\s*【(STUDIO [AB])】/);
  if (studioMatch) return studioMatch[1] === 'STUDIO A' ? '個室A' : '個室B';

  if (body.includes('個室A')) return '個室A';
  if (body.includes('個室B')) return '個室B';
  if (body.includes('STUDIO A')) return '個室A';
  if (body.includes('STUDIO B')) return '個室B';

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

        // この店舗のメールかチェック（超厳密：店舗名の抽出・完全一致）
        // 「店舗： HALLEL 半蔵門店」の行を特定して判定する
        const storeMatch = body.match(/店舗：\s*(.+)/);
        const actualStoreName = storeMatch ? storeMatch[1].trim() : '';

        // 半蔵門店でなければスキップ
        if (actualStoreName !== 'HALLEL 半蔵門店') continue;

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

    // 重複チェック・旧形式削除
    let exists = false;
    for (const e of events) {
      const eTitle = e.getTitle();
      if (eTitle.includes(r.fullName) && eTitle.includes('HALLEL') &&
        Math.abs(e.getStartTime().getTime() - r.startTime.getTime()) < 60000) {
        if (eTitle === title) {
          exists = true;
        } else {
          e.deleteEvent();  // 旧形式削除
        }
      }
    }

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

      // この店舗のメールかチェック（厳密に）
      const isThisStore = body.includes('店舗： HALLEL 半蔵門店') ||
        body.includes('店舗：HALLEL 半蔵門店') ||
        body.includes('設備： 半蔵門店') ||
        body.includes('設備：半蔵門店');
      if (!isThisStore) continue;

      // 他店舗除外
      if (CONFIG.EXCLUDE_KEYWORDS.some(k => body.includes(k))) continue;

      const data = parseEmail(msg.getSubject(), body, msg.getDate(), msg.getId());
      if (data) allEmails.push(data);
    }
  }

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
    '設備： 半蔵門店 STUDIO B ① (1)',
    '設備： 半蔵門店 STUDIO B ③ (1)',
    '設備： 半蔵門店 個室A (1)',
    'ルーム： 【STUDIO B ②】',
    'ルーム： 【個室B】',
    '不明なルーム'
  ];
  Logger.log('部屋名抽出テスト:');
  tests.forEach(t => Logger.log(`"${t}" → "${extractStudio(t)}"`));
}

function checkCalendarStatus() {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!calendar) {
    Logger.log(`カレンダー未設定: ${CONFIG.CALENDAR_ID}`);
    return;
  }

  const now = new Date();
  const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const events = calendar.getEvents(now, later);

  Logger.log(`今後30日間の予約: ${events.length}件`);

  const counts = { 'STUDIO B ①': 0, 'STUDIO B ②': 0, 'STUDIO B ③': 0, '個室A': 0, '個室B': 0, '【貸切】': 0 };
  for (const e of events) {
    const t = e.getTitle();
    for (const k of Object.keys(counts)) {
      if (t.includes(`HALLEL-${k}`)) counts[k]++;
    }
  }

  Logger.log('部屋別: ' + JSON.stringify(counts));
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
