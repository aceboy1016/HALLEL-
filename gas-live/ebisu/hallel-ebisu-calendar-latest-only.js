/**
 * HALLEL恵比寿店 - 最新状態のみをカレンダーに反映
 *
 * 15000件のメールから最新状態のみを抽出してカレンダーに反映
 * API制限対策として、バッチ処理＋待機時間を設ける
 */

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  CALENDAR_ID: 'ebisu@topform.jp',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel 恵比寿',
  BATCH_SIZE: 5,        // 5件ごとに処理
  WAIT_TIME_MS: 3000,   // 3秒待機（API制限対策）
};

// ============================================================
// メイン処理：最新状態のみをカレンダーに反映
// ============================================================

/**
 * 最新状態のみをカレンダーに反映（API制限対策版）
 *
 * 処理フロー:
 * 1. 全メールを取得
 * 2. 日時・時間枠ごとに最新のメールのみを選択
 * 3. 最新がキャンセル → カレンダーから削除
 * 4. 最新が予約     → カレンダーに追加（重複削除）
 * 5. バッチ処理でAPI制限を回避
 */
function syncLatestReservationsToCalendar() {
  Logger.log('='.repeat(80));
  Logger.log('【恵比寿店：最新状態のみをカレンダーに反映】');
  Logger.log('='.repeat(80));

  try {
    const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
    if (!calendar) {
      Logger.log('❌ カレンダーが見つかりません');
      return { success: false, error: 'Calendar not found' };
    }

    // ステップ1: 全メールを取得
    Logger.log('\n📧 全メールを取得中...');
    const allEmails = getAllReservationEmails();
    Logger.log(`✅ 取得完了: ${allEmails.length}件\n`);

    // ステップ2: 日時・時間枠ごとに最新のメールのみを選択
    Logger.log('🔍 最新状態のみを抽出中...');
    const latestOnly = extractLatestReservations(allEmails);
    Logger.log(`✅ 抽出完了: ${latestOnly.length}件\n`);

    // ステップ3: カレンダーに反映（バッチ処理）
    Logger.log('📅 カレンダーに反映中...');
    const result = applyToCalendarWithRateLimit(calendar, latestOnly);

    Logger.log('\n' + '='.repeat(80));
    Logger.log('【処理完了】');
    Logger.log(`✅ 成功: ${result.success}件`);
    Logger.log(`⏭️ スキップ: ${result.skipped}件`);
    Logger.log(`❌ エラー: ${result.errors}件`);
    Logger.log('='.repeat(80));

    return result;

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
    return { success: false, error: error.message };
  }
}

// ============================================================
// ステップ1: 全メールを取得
// ============================================================

/**
 * 全予約メールを取得
 */
function getAllReservationEmails() {
  const threads = GmailApp.search(CONFIG.SEARCH_QUERY);
  Logger.log(`📬 スレッド数: ${threads.length}件`);

  const allEmails = [];
  let processedCount = 0;

  for (let thread of threads) {
    const messages = thread.getMessages();

    for (let message of messages) {
      const subject = message.getSubject();
      const body = message.getPlainBody();

      // 恵比寿店のメールかチェック
      if (!body.includes('恵比寿')) continue;

      const emailData = parseReservationEmail(subject, body, message.getDate());
      if (emailData) {
        allEmails.push(emailData);
      }
    }

    processedCount++;
    if (processedCount % 100 === 0) {
      Logger.log(`  処理中... ${processedCount}/${threads.length} スレッド`);
    }
  }

  return allEmails;
}

/**
 * メールから予約情報を抽出
 */
function parseReservationEmail(subject, body, emailDate) {
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

    return {
      fullName: fullName,
      startTime: eventTime.startTime,
      endTime: eventTime.endTime,
      studio: studio,
      actionType: isReservation ? 'reservation' : 'cancellation',
      emailDate: emailDate,
      // 一意のキー（同じ人、同じ日時、同じ時間枠）
      key: `${fullName}|${eventTime.startTime.getTime()}|${eventTime.endTime.getTime()}`
    };

  } catch (error) {
    return null;
  }
}

// ============================================================
// ステップ2: 最新状態のみを抽出
// ============================================================

/**
 * 日時・時間枠ごとに最新のメールのみを選択
 */
function extractLatestReservations(allEmails) {
  // キーごとにグループ化
  const groupedByKey = {};

  for (let email of allEmails) {
    if (!groupedByKey[email.key]) {
      groupedByKey[email.key] = [];
    }
    groupedByKey[email.key].push(email);
  }

  Logger.log(`  日時・時間枠の総数: ${Object.keys(groupedByKey).length}件`);

  // 各グループで最新のメールのみを選択
  const latestOnly = [];
  let duplicateCount = 0;

  for (let key in groupedByKey) {
    const emails = groupedByKey[key];

    // メール受信日時でソート（最新が最後）
    emails.sort((a, b) => a.emailDate.getTime() - b.emailDate.getTime());

    const latest = emails[emails.length - 1];

    if (emails.length > 1) {
      duplicateCount++;
      Logger.log(`  重複: ${latest.fullName} [${formatDateTime(latest.startTime)}] ${emails.length}件 → 最新: ${latest.actionType}`);
    }

    latestOnly.push(latest);
  }

  Logger.log(`  重複があった枠: ${duplicateCount}件`);

  return latestOnly;
}

// ============================================================
// ステップ3: カレンダーに反映（API制限対策）
// ============================================================

/**
 * カレンダーに反映（バッチ処理＋待機時間）
 */
function applyToCalendarWithRateLimit(calendar, latestReservations) {
  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < latestReservations.length; i++) {
    const res = latestReservations[i];

    try {
      if (res.actionType === 'reservation') {
        // 予約 → カレンダーに追加（重複削除）
        const result = addReservationToCalendar(calendar, res);
        if (result.success) {
          successCount++;
          Logger.log(`  ✅ [${i + 1}/${latestReservations.length}] 追加: ${res.fullName} (${res.studio}) ${formatDateTime(res.startTime)}`);
        } else {
          skippedCount++;
          Logger.log(`  ⏭️ [${i + 1}/${latestReservations.length}] スキップ: ${res.fullName} - ${result.reason}`);
        }
      } else {
        // キャンセル → カレンダーから削除
        const deleted = deleteReservationFromCalendar(calendar, res);
        if (deleted > 0) {
          successCount++;
          Logger.log(`  🗑️ [${i + 1}/${latestReservations.length}] 削除: ${res.fullName} (${deleted}件)`);
        } else {
          skippedCount++;
          Logger.log(`  ⏭️ [${i + 1}/${latestReservations.length}] 削除対象なし: ${res.fullName}`);
        }
      }

      // バッチ処理：5件ごとに3秒待機
      if ((i + 1) % CONFIG.BATCH_SIZE === 0) {
        Logger.log(`\n  ⏸️ ${i + 1}件処理完了。${CONFIG.WAIT_TIME_MS / 1000}秒待機中...\n`);
        Utilities.sleep(CONFIG.WAIT_TIME_MS);
      }

    } catch (error) {
      errorCount++;
      Logger.log(`  ❌ [${i + 1}/${latestReservations.length}] エラー: ${res.fullName} - ${error.message}`);

      // レート制限エラーの場合は処理を中断
      if (error.message && error.message.includes('too many')) {
        Logger.log(`\n⚠️ レート制限に達しました。${i + 1}件処理済み。`);
        Logger.log(`💡 数時間後に再度実行してください。`);
        break;
      }
    }
  }

  return {
    success: successCount,
    skipped: skippedCount,
    errors: errorCount,
    total: latestReservations.length
  };
}

/**
 * カレンダーに予約を追加（重複削除）
 */
function addReservationToCalendar(calendar, res) {
  try {
    const eventTitle = `${res.fullName} - HALLEL-${res.studio}`;

    // 重複チェック：同じ人、同じ時間帯のイベントを削除
    const searchStart = new Date(res.startTime.getTime() - 60000); // -1分
    const searchEnd = new Date(res.endTime.getTime() + 60000);     // +1分

    const existingEvents = calendar.getEvents(searchStart, searchEnd);
    let alreadyExists = false;

    for (let event of existingEvents) {
      const title = event.getTitle();
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();

      // 名前が一致し、HALLELイベントであるかチェック
      const nameMatch = title.includes(res.fullName);
      const isHallelEvent = title.includes('HALLEL-');

      // 時間の一致（±1分の許容範囲）
      const startMatch = Math.abs(eventStart.getTime() - res.startTime.getTime()) < 60000;
      const endMatch = Math.abs(eventEnd.getTime() - res.endTime.getTime()) < 60000;

      if (nameMatch && isHallelEvent && startMatch && endMatch) {
        if (title === eventTitle) {
          // 全く同じイベントが既に存在
          alreadyExists = true;
        } else {
          // 部屋名が違う重複イベントを削除
          event.deleteEvent();
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
    throw error;
  }
}

/**
 * カレンダーから予約を削除
 */
function deleteReservationFromCalendar(calendar, res) {
  try {
    const searchStart = new Date(res.startTime.getTime() - 5 * 60000); // -5分
    const searchEnd = new Date(res.endTime.getTime() + 5 * 60000);     // +5分

    const events = calendar.getEvents(searchStart, searchEnd);
    let deletedCount = 0;

    for (let event of events) {
      const title = event.getTitle();
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();

      // 名前が一致し、HALLELイベントであるかチェック
      const nameMatch = title.includes(res.fullName);
      const isHallelEvent = title.includes('HALLEL-');

      // 時間の一致（±1分の許容範囲）
      const startMatch = Math.abs(eventStart.getTime() - res.startTime.getTime()) < 60000;
      const endMatch = Math.abs(eventEnd.getTime() - res.endTime.getTime()) < 60000;

      if (nameMatch && isHallelEvent && startMatch && endMatch) {
        event.deleteEvent();
        deletedCount++;
      }
    }

    return deletedCount;

  } catch (error) {
    throw error;
  }
}

// ============================================================
// データ抽出関数（既存のスクリプトから）
// ============================================================

function extractFullName(body) {
  const nameMatch = body.match(/(.+?) 様/);
  return nameMatch ? nameMatch[1].trim() : 'Unknown';
}

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

function extractStudio(body) {
  const studioMatch = body.match(/ルーム[：:]\s*【(STUDIO [AB])】/);
  if (!studioMatch) return 'Unknown';

  switch (studioMatch[1]) {
    case 'STUDIO A':
      return '個室A';
    case 'STUDIO B':
      return '個室B';
    default:
      return 'Unknown';
  }
}

function formatDateTime(date) {
  return Utilities.formatDate(date, 'JST', 'yyyy/MM/dd HH:mm');
}

// ============================================================
// テスト・デバッグ関数
// ============================================================

/**
 * テスト実行（最新100件のみ）
 */
function testLatestSync() {
  Logger.log('🧪 テスト実行: 最新100件のみ処理');

  // CONFIG を一時的に変更
  const originalQuery = CONFIG.SEARCH_QUERY;
  CONFIG.SEARCH_QUERY = `${originalQuery} newer_than:7d`; // 過去7日間のみ

  const result = syncLatestReservationsToCalendar();

  // CONFIG を元に戻す
  CONFIG.SEARCH_QUERY = originalQuery;

  Logger.log('\n✅ テスト完了');
  Logger.log(JSON.stringify(result, null, 2));

  return result;
}

/**
 * 進捗確認
 */
function checkProgress() {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);

  // 今日から30日間の予約を取得
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const events = calendar.getEvents(now, thirtyDaysLater);

  Logger.log(`📅 今後30日間の予約: ${events.length}件\n`);

  // 部屋名別の集計
  const roomCounts = { '個室A': 0, '個室B': 0, 'Unknown': 0 };

  for (let event of events) {
    const title = event.getTitle();
    if (title.includes('HALLEL-個室A')) roomCounts['個室A']++;
    else if (title.includes('HALLEL-個室B')) roomCounts['個室B']++;
    else if (title.includes('HALLEL-Unknown')) roomCounts['Unknown']++;
  }

  Logger.log('部屋名別の集計:');
  Logger.log(`  個室A: ${roomCounts['個室A']}件`);
  Logger.log(`  個室B: ${roomCounts['個室B']}件`);
  Logger.log(`  Unknown: ${roomCounts['Unknown']}件`);

  return {
    totalEvents: events.length,
    roomCounts: roomCounts
  };
}

// ============================================================
// Vercel APIへのデータ送信
// ============================================================

/**
 * 最新状態のみをVercel APIに送信
 */
function syncLatestReservationsToAPI() {
  Logger.log('='.repeat(80));
  Logger.log('【恵比寿店：最新状態のみをVercel APIに送信】');
  Logger.log('='.repeat(80));

  try {
    // ステップ1: 全メールを取得
    Logger.log('\n📧 全メールを取得中...');
    const allEmails = getAllReservationEmails();
    Logger.log(`✅ 取得完了: ${allEmails.length}件\n`);

    // ステップ2: 日時・時間枠ごとに最新のメールのみを選択
    Logger.log('🔍 最新状態のみを抽出中...');
    const latestOnly = extractLatestReservations(allEmails);
    Logger.log(`✅ 抽出完了: ${latestOnly.length}件\n`);

    // ステップ3: 予約とキャンセルの両方を送信
    const reservationCount = latestOnly.filter(r => r.actionType === 'reservation').length;
    const cancellationCount = latestOnly.filter(r => r.actionType === 'cancellation').length;
    Logger.log(`📤 送信対象: ${latestOnly.length}件（予約: ${reservationCount}件, キャンセル: ${cancellationCount}件）\n`);

    // ステップ4: Vercel APIに送信
    Logger.log('='.repeat(80));
    Logger.log('Vercel APIに送信中...');
    Logger.log('='.repeat(80));

    const BATCH_SIZE = 50;
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < latestOnly.length; i += BATCH_SIZE) {
      const batch = latestOnly.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(latestOnly.length / BATCH_SIZE);

      Logger.log(`\n【バッチ ${batchNum}/${totalBatches}】 ${batch.length}件を送信中...`);

      const result = sendBatchToVercelAPI(batch);

      if (result.success) {
        Logger.log(`✓ 成功: ${result.count}件`);
        totalSuccess += result.count;
      } else {
        Logger.log(`✗ 失敗: ${result.error}`);
        totalFailed += batch.length;
      }

      if (i + BATCH_SIZE < latestOnly.length) {
        Utilities.sleep(1000);
      }
    }

    // 最終結果
    Logger.log('\n' + '='.repeat(80));
    Logger.log('【処理完了】');
    Logger.log(`全メール数: ${allEmails.length}件`);
    Logger.log(`最新状態: ${latestOnly.length}件`);
    Logger.log(`  - 予約: ${reservationCount}件`);
    Logger.log(`  - キャンセル: ${cancellationCount}件`);
    Logger.log(`API送信成功: ${totalSuccess}件`);
    Logger.log(`API送信失敗: ${totalFailed}件`);
    Logger.log('='.repeat(80));

    if (totalSuccess === latestOnly.length) {
      Logger.log('\n✅ 恵比寿店の最新状態をVercel APIに送信完了！');
    } else if (totalFailed > 0) {
      Logger.log('\n⚠️ 一部のメールでAPI送信が失敗しました。');
    }

    return {
      success: true,
      total: allEmails.length,
      latest: latestOnly.length,
      reservations: reservationCount,
      cancellations: cancellationCount,
      apiSuccess: totalSuccess,
      apiFailed: totalFailed
    };

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
    return { success: false, error: error.message };
  }
}

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
        store: 'ebisu',
        type: 'gmail',
        is_cancellation: r.actionType === 'cancellation',
        source: 'gas_sync',
        email_id: '',
        email_subject: '',
        email_date: r.emailDate.toISOString()
      }))
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-API-Key': 'Wh00k@2025!Secure$Token#ABC123XYZ'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch('https://hallel-shibuya.vercel.app/api/gas/webhook', options);
    const statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, count: reservations.length };
    } else {
      return {
        success: false,
        error: `HTTP ${statusCode}: ${response.getContentText()}`
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

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
 * 恵比寿店トリガー設定
 *
 * このスクリプトを実行すると、以下のトリガーが設定されます：
 * - 10分ごとに新しいメールをチェック＆Vercel APIに送信
 */

/**
 * トリガーを設定（10分ごと）
 */
function setupEbisuTrigger10min() {
  // 既存のトリガーを削除
  deleteAllTriggers();

  // 10分ごとのトリガーを作成
  ScriptApp.newTrigger('processNewReservations')
    .timeBased()
    .everyMinutes(10)
    .create();

  Logger.log('✅ トリガー設定完了: 10分ごとに新規メールを処理');
}

/**
 * トリガーを設定（1時間ごと）
 */
function setupEbisuTrigger1hour() {
  // 既存のトリガーを削除
  deleteAllTriggers();

  // 1時間ごとのトリガーを作成
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
 * 新規予約メールを処理してVercel APIに送信
 */
function processNewReservations() {
  Logger.log('='.repeat(80));
  Logger.log('【恵比寿店：新規メール処理開始】');
  Logger.log('='.repeat(80));

  // HALLEL予定に付いた不要なゲストを外す（新着メールの有無に関係なく毎回実行）
  try {
    removeUnwantedGuests();
  } catch (e) {
    Logger.log(`❌ ゲスト削除エラー: ${e.message}`);
  }

  try {
    // 過去1時間のメールを取得
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const threads = GmailApp.search(`from:noreply@em.hacomono.jp subject:hallel 恵比寿 after:${Math.floor(oneHourAgo.getTime() / 1000)}`);

    Logger.log(`📬 新規スレッド: ${threads.length}件`);

    if (threads.length === 0) {
      Logger.log('⏭️ 新しいメールがありません');
      return;
    }

    const newReservations = [];
    const newCancellations = [];

    for (let thread of threads) {
      const messages = thread.getMessages();

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getPlainBody();
        const emailDate = message.getDate();

        // 過去1時間以内のメールのみ処理
        if (emailDate < oneHourAgo) continue;

        // 恵比寿店のメールかチェック
        if (!body.includes('恵比寿')) continue;

        const emailData = parseReservationEmail(subject, body, emailDate);
        if (emailData) {
          if (emailData.actionType === 'reservation') {
            newReservations.push(emailData);
            Logger.log(`📧 新規予約: ${emailData.fullName} (${emailData.studio}) ${formatDateTime(emailData.startTime)}`);
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
      return;
    }

    // Vercel APIに送信（予約とキャンセル両方）
    const result = sendBatchToVercelAPI(allData);

    if (result.success) {
      Logger.log(`✅ Vercel API送信成功: ${result.count}件`);

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

        Logger.log(`✅ カレンダー追加成功: ${calendarAddSuccess}件`);
        Logger.log(`🗑️ カレンダー削除成功: ${calendarDeleteSuccess}件`);
      }
    } else {
      Logger.log(`❌ Vercel API送信失敗: ${result.error}`);
    }

    Logger.log('='.repeat(80));
    Logger.log('【処理完了】');
    Logger.log('='.repeat(80));

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * HALLEL予定から外すゲスト
 * （j.ishiharaのアカウントで作成・編集するとGoogleが自動でゲストに追加し、
 *   j.ishihara@topform.jp のカレンダーにも表示されてしまうため）
 */
const REMOVE_GUESTS = ['j.ishihara@topform.jp'];

/**
 * HALLEL予定から REMOVE_GUESTS のゲストを外す（7日前〜90日後）
 */
function removeUnwantedGuests() {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  const now = new Date();
  const events = calendar.getEvents(
    new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
  );

  let removedCount = 0;
  for (let event of events) {
    if (!event.getTitle().includes('HALLEL')) continue;

    for (let guest of event.getGuestList()) {
      const email = guest.getEmail().toLowerCase();
      if (REMOVE_GUESTS.includes(email)) {
        event.removeGuest(email);
        removedCount++;
        Logger.log(`👤 ゲスト削除: ${event.getTitle()} [${formatDateTime(event.getStartTime())}] - ${email}`);
      }
    }
  }

  if (removedCount > 0) {
    Logger.log(`✅ ゲスト削除: ${removedCount}件`);
  }
}

/**
 * 現在のトリガー一覧を表示
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  Logger.log('📋 現在のトリガー一覧:');
  Logger.log('='.repeat(80));

  if (triggers.length === 0) {
    Logger.log('トリガーが設定されていません');
    return;
  }

  triggers.forEach((trigger, index) => {
    Logger.log(`\n${index + 1}. ${trigger.getHandlerFunction()}`);
    Logger.log(`   種類: ${trigger.getEventType()}`);
    if (trigger.getEventType() === ScriptApp.EventType.CLOCK) {
      Logger.log(`   実行間隔: 定期実行`);
    }
  });

  Logger.log('='.repeat(80));
}