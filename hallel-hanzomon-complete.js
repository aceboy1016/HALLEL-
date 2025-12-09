/**
 * HALLEL半蔵門店 - 完全統合版GASスクリプト
 *
 * このファイルをGASにコピペするだけで全機能が動作します！
 *
 * 機能:
 * - 10分ごとの自動トリガー
 * - Gmailから予約メール取得
 * - 部屋名（STUDIO B ①②③、個室A/B）抽出
 * - 貸切対応
 * - Vercel API送信
 * - Google Calendar同期
 * - キャンセル処理
 *
 * 使い方:
 * 1. このコードをGASにコピペ
 * 2. setupTrigger10min() を実行（トリガー設定）
 * 3. 以降は自動で10分ごとに実行されます
 */

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  CALENDAR_ID: 'light@topform.jp',
  STORE_NAME: 'hanzomon',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp', // 件名にhallelが含まれない場合があるため、送信元のみで検索
  STORE_KEYWORD: '半蔵門',
  API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',
  API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',
  BATCH_SIZE: 5,
  WAIT_TIME_MS: 3000,
};

// ============================================================
// トリガー設定関数
// ============================================================

/**
 * トリガーを設定（10分ごと）- 推奨
 */
function setupTrigger10min() {
  deleteAllTriggers();

  ScriptApp.newTrigger('processNewReservations')
    .timeBased()
    .everyMinutes(10)
    .create();

  Logger.log('✅ トリガー設定完了: 10分ごとに新規メールを処理');
  Logger.log('📋 実行される関数: processNewReservations()');
}

/**
 * トリガーを設定（1時間ごと）
 */
function setupTrigger1hour() {
  deleteAllTriggers();

  ScriptApp.newTrigger('processNewReservations')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('✅ トリガー設定完了: 1時間ごとに新規メールを処理');
}

/**
 * 既存のトリガーをすべて削除
 */
function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  Logger.log(`🗑️ 既存のトリガーを削除: ${triggers.length}件`);
}

/**
 * 現在のトリガー一覧を表示
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  Logger.log('📋 現在のトリガー一覧:');
  Logger.log('='.repeat(60));

  if (triggers.length === 0) {
    Logger.log('⚠️ トリガーが設定されていません');
    Logger.log('👉 setupTrigger10min() を実行してください');
    return;
  }

  triggers.forEach((trigger, index) => {
    Logger.log(`${index + 1}. ${trigger.getHandlerFunction()}`);
    Logger.log(`   種類: ${trigger.getEventType()}`);
  });
}

// ============================================================
// メイン処理：新規予約メールを処理（トリガーから呼ばれる）
// ============================================================

/**
 * 新規予約メールを処理してVercel APIとカレンダーに反映
 * この関数がトリガーから呼ばれます
 */
function processNewReservations() {
  Logger.log('='.repeat(60));
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：新規メール処理開始】`);
  Logger.log(`実行時刻: ${new Date().toLocaleString('ja-JP')}`);
  Logger.log('='.repeat(60));

  try {
    // 過去1時間のメールを取得
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const searchQuery = `${CONFIG.SEARCH_QUERY} after:${Math.floor(oneHourAgo.getTime() / 1000)}`;
    const threads = GmailApp.search(searchQuery);

    Logger.log(`📬 検索クエリ: ${searchQuery}`);
    Logger.log(`📬 新規スレッド: ${threads.length}件`);

    if (threads.length === 0) {
      Logger.log('⏭️ 新しいメールがありません');
      Logger.log('='.repeat(60));
      return { success: true, processed: 0 };
    }

    const newReservations = [];
    const newCancellations = [];

    for (let thread of threads) {
      const messages = thread.getMessages();

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getPlainBody();
        const emailDate = message.getDate();
        const messageId = message.getId();

        // 過去1時間以内のメールのみ処理
        if (emailDate < oneHourAgo) continue;

        // 半蔵門店のメールかチェック（半蔵門に限定しない - 他店舗除外で対応）
        // 恵比寿店のメールは除外
        if (body.includes('恵比寿')) continue;

        const emailData = parseReservationEmail(subject, body, emailDate, messageId);
        if (emailData) {
          if (emailData.actionType === 'reservation') {
            newReservations.push(emailData);
            const charterLabel = emailData.isCharter ? '【貸切】' : '';
            Logger.log(`📧 予約: ${emailData.fullName} (${emailData.studio}) ${charterLabel} ${formatDateTime(emailData.startTime)}`);
          } else if (emailData.actionType === 'cancellation') {
            newCancellations.push(emailData);
            Logger.log(`🗑️ キャンセル: ${emailData.fullName} (${emailData.studio}) ${formatDateTime(emailData.startTime)}`);
          }
        }
      }
    }

    // 予約とキャンセルを結合
    const allData = [...newReservations, ...newCancellations];
    Logger.log(`\n📤 送信対象: ${allData.length}件（予約: ${newReservations.length}件, キャンセル: ${newCancellations.length}件）`);

    if (allData.length === 0) {
      Logger.log('⏭️ 送信対象のデータがありません');
      Logger.log('='.repeat(60));
      return { success: true, processed: 0 };
    }

    // Vercel APIに送信
    const apiResult = sendBatchToVercelAPI(allData);

    if (apiResult.success) {
      Logger.log(`✅ Vercel API送信成功: ${apiResult.count}件`);
    } else {
      Logger.log(`❌ Vercel API送信失敗: ${apiResult.error}`);
    }

    // カレンダーにも反映
    const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
    if (calendar) {
      let calendarAddSuccess = 0;
      let calendarDeleteSuccess = 0;

      // 予約をカレンダーに追加
      for (let res of newReservations) {
        const addResult = addReservationToCalendar(calendar, res);
        if (addResult.success) {
          calendarAddSuccess++;
        }
      }

      // キャンセルをカレンダーから削除
      for (let res of newCancellations) {
        const deleted = deleteReservationFromCalendar(calendar, res);
        if (deleted > 0) {
          calendarDeleteSuccess++;
        }
      }

      Logger.log(`📅 カレンダー追加: ${calendarAddSuccess}件`);
      Logger.log(`🗑️ カレンダー削除: ${calendarDeleteSuccess}件`);
    } else {
      Logger.log(`⚠️ カレンダーが見つかりません: ${CONFIG.CALENDAR_ID}`);
    }

    Logger.log('\n' + '='.repeat(60));
    Logger.log('【処理完了】');
    Logger.log('='.repeat(60));

    return {
      success: true,
      processed: allData.length,
      reservations: newReservations.length,
      cancellations: newCancellations.length
    };

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
    return { success: false, error: error.message };
  }
}

// ============================================================
// データ抽出関数
// ============================================================

/**
 * メールから予約情報を抽出
 */
function parseReservationEmail(subject, body, emailDate, messageId) {
  try {
    const fullName = extractFullName(body);
    const eventTime = extractEventTime(body);
    const studio = extractStudio(body);

    if (!eventTime.startTime || !eventTime.endTime) {
      return null;
    }

    // 予約 or キャンセル
    const isReservation = subject.includes('予約完了');
    const isCancellation = subject.includes('キャンセル');

    if (!isReservation && !isCancellation) {
      return null;
    }

    // 貸切判定
    const isCharter = body.includes('貸切利用') || body.includes('貸切');

    return {
      fullName: fullName,
      startTime: eventTime.startTime,
      endTime: eventTime.endTime,
      studio: studio,
      isCharter: isCharter,
      actionType: isReservation ? 'reservation' : 'cancellation',
      emailDate: emailDate,
      messageId: messageId || '',
      key: `${fullName}|${eventTime.startTime.getTime()}|${eventTime.endTime.getTime()}`
    };

  } catch (error) {
    Logger.log(`⚠️ メール解析エラー: ${error.message}`);
    return null;
  }
}

/**
 * 氏名を抽出
 */
function extractFullName(body) {
  const nameMatch = body.match(/(.+?) 様/);
  return nameMatch ? nameMatch[1].trim() : 'Unknown';
}

/**
 * 日時を抽出
 */
function extractEventTime(body) {
  const match = body.match(/日時[：:]\s*([\d]{4}年[\d]{1,2}月[\d]{1,2}日)[^\d]*(\d{1,2}:\d{2})\s*[〜～~-]\s*(\d{1,2}:\d{2})/);

  if (match) {
    const dateStr = match[1].replace(/年/g, '/').replace(/月/g, '/').replace(/日/g, '');
    const start = new Date(`${dateStr} ${match[2]}`);
    const end = new Date(`${dateStr} ${match[3]}`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { startTime: null, endTime: null };
    }

    return { startTime: start, endTime: end };
  }

  return { startTime: null, endTime: null };
}

/**
 * 部屋名を抽出（半蔵門店: STUDIO B ①②③、個室A/B）
 */
function extractStudio(body) {
  // パターン1: 「ルーム： 【STUDIO B ①】」「【STUDIO B ②】」「【STUDIO B ③】」
  const studioB123Match = body.match(/ルーム[：:]\s*【(STUDIO B [①②③])】/);
  if (studioB123Match) {
    return studioB123Match[1];
  }

  // パターン2: 本文中に「STUDIO B ①」などが含まれている（スペースあり・なし両対応）
  if (body.includes('STUDIO B ①') || body.includes('STUDIO B①')) return 'STUDIO B ①';
  if (body.includes('STUDIO B ②') || body.includes('STUDIO B②')) return 'STUDIO B ②';
  if (body.includes('STUDIO B ③') || body.includes('STUDIO B③')) return 'STUDIO B ③';

  // パターン3: 「ルーム： 【個室A】」「【個室B】」形式
  const roomMatch1 = body.match(/ルーム[：:]\s*【(個室[AB])】/);
  if (roomMatch1) {
    return roomMatch1[1];
  }

  // パターン4: 「ルーム： 【STUDIO A】」形式（恵比寿店形式互換）
  const roomMatch2 = body.match(/ルーム[：:]\s*【(STUDIO [AB])】/);
  if (roomMatch2) {
    return roomMatch2[1] === 'STUDIO A' ? '個室A' : '個室B';
  }

  // パターン5: 本文中に「個室A」「個室B」が含まれている
  if (body.includes('個室A')) return '個室A';
  if (body.includes('個室B')) return '個室B';

  // パターン6: STUDIO A/B
  if (body.includes('STUDIO A')) return '個室A';
  if (body.includes('STUDIO B')) return '個室B';

  // デフォルト
  return '個室B';
}

// ============================================================
// カレンダー操作関数
// ============================================================

/**
 * カレンダーに予約を追加（重複チェック付き）
 */
function addReservationToCalendar(calendar, res) {
  try {
    // 貸切の場合はタイトルに「【貸切】」を追加
    const eventTitle = res.isCharter
      ? `${res.fullName} - HALLEL-【貸切】`
      : `${res.fullName} - HALLEL-${res.studio}`;

    // 重複チェック
    const searchStart = new Date(res.startTime.getTime() - 60000);
    const searchEnd = new Date(res.endTime.getTime() + 60000);

    const existingEvents = calendar.getEvents(searchStart, searchEnd);
    let alreadyExists = false;

    for (let event of existingEvents) {
      const title = event.getTitle();
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();

      const nameMatch = title.includes(res.fullName);
      const isHallelEvent = title.includes('HALLEL');
      const startMatch = Math.abs(eventStart.getTime() - res.startTime.getTime()) < 60000;
      const endMatch = Math.abs(eventEnd.getTime() - res.endTime.getTime()) < 60000;

      if (nameMatch && isHallelEvent && startMatch && endMatch) {
        if (title === eventTitle) {
          alreadyExists = true;
        } else {
          // 旧形式の重複を削除
          event.deleteEvent();
          Logger.log(`  🔄 旧イベント削除: ${title}`);
        }
      }
    }

    if (alreadyExists) {
      return { success: false, reason: '既に存在' };
    }

    // イベント作成
    calendar.createEvent(eventTitle, res.startTime, res.endTime);
    return { success: true };

  } catch (error) {
    Logger.log(`⚠️ カレンダー追加エラー: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

/**
 * カレンダーから予約を削除
 */
function deleteReservationFromCalendar(calendar, res) {
  try {
    const searchStart = new Date(res.startTime.getTime() - 5 * 60000);
    const searchEnd = new Date(res.endTime.getTime() + 5 * 60000);

    const events = calendar.getEvents(searchStart, searchEnd);
    let deletedCount = 0;

    for (let event of events) {
      const title = event.getTitle();
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();

      const nameMatch = title.includes(res.fullName);
      const isHallelEvent = title.includes('HALLEL');
      const startMatch = Math.abs(eventStart.getTime() - res.startTime.getTime()) < 60000;
      const endMatch = Math.abs(eventEnd.getTime() - res.endTime.getTime()) < 60000;

      if (nameMatch && isHallelEvent && startMatch && endMatch) {
        event.deleteEvent();
        deletedCount++;
        Logger.log(`  🗑️ イベント削除: ${title}`);
      }
    }

    return deletedCount;

  } catch (error) {
    Logger.log(`⚠️ カレンダー削除エラー: ${error.message}`);
    return 0;
  }
}

// ============================================================
// Vercel API送信関数
// ============================================================

/**
 * バッチデータをVercel APIに送信
 */
function sendBatchToVercelAPI(reservations) {
  try {
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: reservations.map(r => ({
        date: formatDate(r.startTime),
        start: formatTimeOnly(r.startTime),
        end: formatTimeOnly(r.endTime),
        customer_name: r.fullName || 'N/A',
        room_name: r.studio || '個室B',
        store: CONFIG.STORE_NAME,
        type: r.isCharter ? 'charter' : 'gmail',
        is_cancellation: r.actionType === 'cancellation',
        is_charter: r.isCharter || false,
        source: 'gas_sync',
        email_id: r.messageId || '',
        email_subject: '',
        email_date: r.emailDate.toISOString()
      }))
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-API-Key': CONFIG.API_KEY
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(CONFIG.API_URL, options);
    const statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, count: reservations.length };
    } else {
      return {
        success: false,
        error: `HTTP ${statusCode}: ${response.getContentText().substring(0, 200)}`
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * Date を YYYY-MM-DD 形式に変換
 */
function formatDate(date) {
  return Utilities.formatDate(date, 'JST', 'yyyy-MM-dd');
}

/**
 * Date を HH:mm 形式に変換
 */
function formatTimeOnly(date) {
  return Utilities.formatDate(date, 'JST', 'HH:mm');
}

/**
 * Date を yyyy/MM/dd HH:mm 形式に変換
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, 'JST', 'yyyy/MM/dd HH:mm');
}

// ============================================================
// 一括同期関数（初回セットアップ用）
// ============================================================

/**
 * 過去の全メールから最新状態をVercel APIに一括送信
 * ※ 初回セットアップ時のみ使用
 */
function syncAllToAPI() {
  Logger.log('='.repeat(60));
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：全データ一括同期】`);
  Logger.log('='.repeat(60));

  try {
    // 2025/11/03以降のメールを取得
    Logger.log('\n📧 2025/11/03以降のメールを取得中...');
    const threads = GmailApp.search(`${CONFIG.SEARCH_QUERY} after:2025/11/03`);
    Logger.log(`📬 スレッド数: ${threads.length}件`);

    const allEmails = [];

    for (let thread of threads) {
      const messages = thread.getMessages();

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getPlainBody();
        const emailDate = message.getDate();
        const messageId = message.getId();

        // 恵比寿店のメールは除外
        if (body.includes('恵比寿')) continue;

        const emailData = parseReservationEmail(subject, body, emailDate, messageId);
        if (emailData) {
          allEmails.push(emailData);
        }
      }
    }

    Logger.log(`✅ 取得完了: ${allEmails.length}件`);

    // 日時・時間枠ごとに最新のメールのみを選択
    const groupedByKey = {};
    for (let email of allEmails) {
      if (!groupedByKey[email.key]) {
        groupedByKey[email.key] = [];
      }
      groupedByKey[email.key].push(email);
    }

    const latestOnly = [];
    for (let key in groupedByKey) {
      const emails = groupedByKey[key];
      emails.sort((a, b) => a.emailDate.getTime() - b.emailDate.getTime());
      latestOnly.push(emails[emails.length - 1]);
    }

    Logger.log(`🔍 最新状態: ${latestOnly.length}件`);

    // 予約のみをフィルタ（キャンセルは除外）
    const reservationsOnly = latestOnly.filter(r => r.actionType === 'reservation');
    Logger.log(`📤 送信対象（予約のみ）: ${reservationsOnly.length}件`);

    // Vercel APIに送信
    const BATCH_SIZE = 50;
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < reservationsOnly.length; i += BATCH_SIZE) {
      const batch = reservationsOnly.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(reservationsOnly.length / BATCH_SIZE);

      Logger.log(`\n【バッチ ${batchNum}/${totalBatches}】 ${batch.length}件を送信中...`);

      const result = sendBatchToVercelAPI(batch);

      if (result.success) {
        Logger.log(`✓ 成功: ${result.count}件`);
        totalSuccess += result.count;
      } else {
        Logger.log(`✗ 失敗: ${result.error}`);
        totalFailed += batch.length;
      }

      if (i + BATCH_SIZE < reservationsOnly.length) {
        Utilities.sleep(1000);
      }
    }

    Logger.log('\n' + '='.repeat(60));
    Logger.log(`【処理完了】`);
    Logger.log(`全メール: ${allEmails.length}件`);
    Logger.log(`最新状態: ${latestOnly.length}件`);
    Logger.log(`送信対象: ${reservationsOnly.length}件`);
    Logger.log(`成功: ${totalSuccess}件`);
    Logger.log(`失敗: ${totalFailed}件`);
    Logger.log('='.repeat(60));

    return { success: true, total: totalSuccess, failed: totalFailed };

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
    return { success: false, error: error.message };
  }
}

// ============================================================
// テスト・デバッグ関数
// ============================================================

/**
 * 手動テスト: processNewReservations を直接実行
 */
function testProcessNewReservations() {
  Logger.log('🧪 テスト実行: processNewReservations()');
  const result = processNewReservations();
  Logger.log('\n📋 結果:');
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * 部屋名抽出のテスト
 */
function testExtractStudio() {
  const testCases = [
    'ルーム： 【STUDIO B ①】',
    'ルーム： 【STUDIO B ②】',
    'ルーム： 【STUDIO B ③】',
    'ルーム：【STUDIO B①】',
    'STUDIO B ① での予約',
    'ルーム： 【個室A】',
    'ルーム： 【個室B】',
    'ルーム： 【STUDIO A】',
    '個室B での予約',
    '不明なルーム'
  ];

  Logger.log('🧪 部屋名抽出テスト:');
  Logger.log('='.repeat(60));

  testCases.forEach(body => {
    const room = extractStudio(body);
    Logger.log(`"${body}" → "${room}"`);
  });
}

/**
 * カレンダー状況確認
 */
function checkCalendarStatus() {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);

  if (!calendar) {
    Logger.log(`❌ カレンダーが見つかりません: ${CONFIG.CALENDAR_ID}`);
    return;
  }

  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const events = calendar.getEvents(now, thirtyDaysLater);

  Logger.log(`📅 今後30日間の予約: ${events.length}件`);
  Logger.log('='.repeat(60));

  const roomCounts = {
    'STUDIO B ①': 0,
    'STUDIO B ②': 0,
    'STUDIO B ③': 0,
    '個室A': 0,
    '個室B': 0,
    '【貸切】': 0,
    'Unknown': 0,
    'その他': 0
  };

  for (let event of events) {
    const title = event.getTitle();
    if (title.includes('HALLEL-STUDIO B ①')) roomCounts['STUDIO B ①']++;
    else if (title.includes('HALLEL-STUDIO B ②')) roomCounts['STUDIO B ②']++;
    else if (title.includes('HALLEL-STUDIO B ③')) roomCounts['STUDIO B ③']++;
    else if (title.includes('HALLEL-【貸切】')) roomCounts['【貸切】']++;
    else if (title.includes('HALLEL-個室A')) roomCounts['個室A']++;
    else if (title.includes('HALLEL-個室B')) roomCounts['個室B']++;
    else if (title.includes('HALLEL-Unknown')) roomCounts['Unknown']++;
    else if (title.includes('HALLEL')) roomCounts['その他']++;
  }

  Logger.log('部屋名別集計:');
  Logger.log(`  STUDIO B ①: ${roomCounts['STUDIO B ①']}件`);
  Logger.log(`  STUDIO B ②: ${roomCounts['STUDIO B ②']}件`);
  Logger.log(`  STUDIO B ③: ${roomCounts['STUDIO B ③']}件`);
  Logger.log(`  個室A: ${roomCounts['個室A']}件`);
  Logger.log(`  個室B: ${roomCounts['個室B']}件`);
  Logger.log(`  【貸切】: ${roomCounts['【貸切】']}件`);
  Logger.log(`  Unknown: ${roomCounts['Unknown']}件`);
  Logger.log(`  その他: ${roomCounts['その他']}件`);

  return { total: events.length, roomCounts: roomCounts };
}
