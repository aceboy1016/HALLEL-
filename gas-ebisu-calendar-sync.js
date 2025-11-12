/**
 * HALLEL恵比寿店 - Google Calendar同期スクリプト（改善版）
 *
 * 改善点：
 * 1. キャンセル処理の精度向上（時間範囲検索、柔軟なマッチング）
 * 2. 2枠制限の実装（STUDIO A/B合わせて最大2枠）
 * 3. 重複予約チェックの強化
 * 4. メッセージ単位での処理済み管理
 */

// ============================================================
// 設定
// ============================================================
const CONFIG_EBISU = {
  CALENDAR_ID: 'ebisu@topform.jp',
  LABEL_PROCESSED: 'HALLEL_Ebisu/Processed',
  LABEL_ERROR: 'HALLEL_Ebisu/Error',
  MAX_SLOTS: 2, // 同時間帯の最大予約枠数
  TIME_TOLERANCE_MS: 60000, // 時間マッチングの許容範囲（1分）
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel 恵比寿'
};

// ============================================================
// メイン処理関数
// ============================================================

/**
 * 恵比寿店予約管理のメイン関数
 */
function manageHallelReservations() {
  console.log('🏪 HALLEL恵比寿店 - 予約同期開始');

  try {
    // ラベルを準備
    setupEbisuLabels();

    const calendar = CalendarApp.getCalendarById(CONFIG_EBISU.CALENDAR_ID);
    if (!calendar) {
      console.error('❌ カレンダーが見つかりません');
      return { success: false, error: 'Calendar not found' };
    }

    // 未処理メールを取得（古い順にソート）
    const threads = GmailApp.search(`${CONFIG_EBISU.SEARCH_QUERY} -label:${CONFIG_EBISU.LABEL_PROCESSED}`);
    threads.sort((a, b) => a.getLastMessageDate() - b.getLastMessageDate());

    console.log(`📧 未処理メール: ${threads.length}件`);

    const processedLabel = GmailApp.getUserLabelByName(CONFIG_EBISU.LABEL_PROCESSED);
    const errorLabel = GmailApp.getUserLabelByName(CONFIG_EBISU.LABEL_ERROR);

    let successCount = 0;
    let errorCount = 0;

    for (let thread of threads) {
      const messages = thread.getMessages();

      for (let message of messages) {
        // メッセージIDで処理済みチェック
        const messageId = message.getId();
        if (isMessageProcessed(messageId)) {
          console.log(`⏭️ スキップ: 既に処理済み (${messageId})`);
          continue;
        }

        try {
          const subject = message.getSubject();
          const body = message.getPlainBody();

          // 恵比寿店のメールかチェック
          if (!body.includes('恵比寿')) {
            console.log('⏭️ スキップ: 恵比寿店以外のメール');
            continue;
          }

          if (subject.includes('hallel 予約完了メール')) {
            const result = handleReservationComplete(body, calendar);
            if (result.success) {
              successCount++;
              markMessageAsProcessed(messageId);
              console.log(`✅ 予約完了: ${result.message}`);
            } else {
              errorCount++;
              thread.addLabel(errorLabel);
              console.error(`❌ 予約失敗: ${result.error}`);
            }
          } else if (subject.includes('hallel 予約キャンセル')) {
            const result = handleReservationCancel(body, calendar);
            if (result.success) {
              successCount++;
              markMessageAsProcessed(messageId);
              console.log(`✅ キャンセル完了: ${result.message}`);
            } else {
              errorCount++;
              thread.addLabel(errorLabel);
              console.error(`❌ キャンセル失敗: ${result.error}`);
            }
          }

        } catch (error) {
          console.error(`❌ メッセージ処理エラー: ${error.message}`);
          errorCount++;
          thread.addLabel(errorLabel);
        }
      }

      // スレッド全体に処理済みラベルを付ける
      thread.addLabel(processedLabel);
    }

    console.log(`✅ 処理完了: 成功 ${successCount}件 / エラー ${errorCount}件`);
    return {
      success: true,
      processed: successCount,
      errors: errorCount
    };

  } catch (error) {
    console.error(`❌ 処理エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 予約完了処理（改善版）
 */
function handleReservationComplete(body, calendar) {
  try {
    const fullName = extractFullName(body);
    const eventTime = extractEventTime(body);
    const studio = extractStudio(body);

    if (!eventTime.startTime || !eventTime.endTime || eventTime.startTime >= eventTime.endTime) {
      return { success: false, error: `無効な時間: ${fullName}` };
    }

    const eventTitle = `${fullName} - HALLEL-${studio}`;

    // 1. 同じ人の同じ時間帯の重複予約を削除
    removeDuplicateReservation(calendar, fullName, eventTime, studio);

    // 2. 枠数チェック（2枠制限）
    const slotCheck = checkAvailableSlots(calendar, eventTime, studio);
    if (!slotCheck.available) {
      console.warn(`⚠️ 予約枠超過: ${eventTitle} - ${slotCheck.message}`);
      return {
        success: false,
        error: `予約枠超過（最大${CONFIG_EBISU.MAX_SLOTS}枠）: ${slotCheck.existingReservations.join(', ')}`
      };
    }

    // 3. イベント作成
    try {
      calendar.createEvent(eventTitle, eventTime.startTime, eventTime.endTime);
      return {
        success: true,
        message: `${fullName} (${studio}) ${formatDateTime(eventTime.startTime)} - ${formatTime(eventTime.endTime)}`
      };
    } catch (error) {
      return { success: false, error: `イベント作成失敗: ${error.message}` };
    }

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 予約キャンセル処理（改善版）
 */
function handleReservationCancel(body, calendar) {
  try {
    const fullName = extractFullName(body);
    const eventTime = extractEventTime(body);
    const studio = extractStudio(body);

    if (!eventTime.startTime || !eventTime.endTime || eventTime.startTime >= eventTime.endTime) {
      return { success: false, error: `無効な時間: ${fullName}` };
    }

    // 時間範囲を少し広げて検索（±5分）
    const searchStart = new Date(eventTime.startTime.getTime() - 5 * 60000);
    const searchEnd = new Date(eventTime.endTime.getTime() + 5 * 60000);

    const events = calendar.getEvents(searchStart, searchEnd);
    let deletedCount = 0;

    for (let event of events) {
      const eventTitle = event.getTitle();
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();

      // マッチング条件を緩和
      const nameMatch = eventTitle.includes(fullName);
      const studioMatch = studio === 'Unknown' || eventTitle.includes(studio);

      // 時間の一致（±1分の許容範囲）
      const startMatch = Math.abs(eventStart.getTime() - eventTime.startTime.getTime()) < CONFIG_EBISU.TIME_TOLERANCE_MS;
      const endMatch = Math.abs(eventEnd.getTime() - eventTime.endTime.getTime()) < CONFIG_EBISU.TIME_TOLERANCE_MS;

      if (nameMatch && studioMatch && startMatch && endMatch) {
        try {
          console.log(`🗑️ 削除: ${eventTitle} [${formatDateTime(eventStart)} - ${formatTime(eventEnd)}]`);
          event.deleteEvent();
          deletedCount++;
        } catch (error) {
          console.error(`❌ イベント削除エラー: ${error.message}`);
        }
      }
    }

    if (deletedCount > 0) {
      return {
        success: true,
        message: `${fullName} (${studio}) - ${deletedCount}件削除`
      };
    } else {
      console.warn(`⚠️ キャンセル対象が見つかりません: ${fullName} (${studio})`);
      return {
        success: true,
        message: `${fullName} - 該当イベントなし（既に削除済みの可能性）`
      };
    }

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 重複予約を削除
 */
function removeDuplicateReservation(calendar, fullName, eventTime, studio) {
  const events = calendar.getEvents(eventTime.startTime, eventTime.endTime, { search: fullName });

  for (let event of events) {
    if (event.getTitle().includes(fullName) && event.getTitle().includes(studio)) {
      console.log(`🔄 重複削除: ${event.getTitle()}`);
      event.deleteEvent();
    }
  }
}

/**
 * 利用可能な枠数をチェック
 */
function checkAvailableSlots(calendar, eventTime, newStudio) {
  // 完全に重なる時間帯の予約を検索
  const events = calendar.getEvents(eventTime.startTime, eventTime.endTime);

  const existingReservations = [];

  for (let event of events) {
    const eventTitle = event.getTitle();
    const eventStart = event.getStartTime();
    const eventEnd = event.getEndTime();

    // HALLEL予約のみカウント
    if (!eventTitle.includes('HALLEL-')) {
      continue;
    }

    // 時間が重なっているかチェック
    const hasOverlap = checkTimeOverlap(
      eventStart, eventEnd,
      eventTime.startTime, eventTime.endTime
    );

    if (hasOverlap) {
      existingReservations.push(eventTitle);
    }
  }

  const currentSlots = existingReservations.length;
  const available = currentSlots < CONFIG_EBISU.MAX_SLOTS;

  return {
    available: available,
    currentSlots: currentSlots,
    maxSlots: CONFIG_EBISU.MAX_SLOTS,
    existingReservations: existingReservations,
    message: `現在 ${currentSlots}/${CONFIG_EBISU.MAX_SLOTS}枠使用中`
  };
}

/**
 * 時間の重なりをチェック
 */
function checkTimeOverlap(start1, end1, start2, end2) {
  // 開始時間が終了時間より前にある場合は重なりあり
  return start1 < end2 && start2 < end1;
}

// ============================================================
// データ抽出関数
// ============================================================

/**
 * 顧客名を抽出
 */
function extractFullName(body) {
  const nameMatch = body.match(/(.+?) 様/);
  return nameMatch ? nameMatch[1].trim() : 'Unknown';
}

/**
 * 日時を抽出
 */
function extractEventTime(body) {
  // "日時：2025年01月15日（水）13:00~14:00" のような形式に対応
  const match = body.match(/日時[：:]\s*([\d]{4}年[\d]{1,2}月[\d]{1,2}日)[^\d]*(\d{1,2}:\d{2})\s*[〜～~-]\s*(\d{1,2}:\d{2})/);

  if (match) {
    const dateStr = match[1].replace(/年/g, '/').replace(/月/g, '/').replace(/日/g, '');
    const start = new Date(`${dateStr} ${match[2]}`);
    const end = new Date(`${dateStr} ${match[3]}`);

    // 日付が有効かチェック
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      console.error(`❌ 無効な日付: ${dateStr} ${match[2]} - ${match[3]}`);
      return { startTime: null, endTime: null };
    }

    return { startTime: start, endTime: end };
  }

  console.error(`❌ 日時の抽出失敗`);
  return { startTime: null, endTime: null };
}

/**
 * スタジオを抽出
 */
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

// ============================================================
// 処理済み管理
// ============================================================

/**
 * メッセージが処理済みかチェック
 */
function isMessageProcessed(messageId) {
  const props = PropertiesService.getScriptProperties();
  const key = `processed_${messageId}`;
  return props.getProperty(key) !== null;
}

/**
 * メッセージを処理済みとしてマーク
 */
function markMessageAsProcessed(messageId) {
  const props = PropertiesService.getScriptProperties();
  const key = `processed_${messageId}`;
  props.setProperty(key, new Date().toISOString());
}

/**
 * 処理済みメッセージのクリーンアップ（30日以上前のものを削除）
 */
function cleanupProcessedMessages() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let deletedCount = 0;

  for (let key in allProps) {
    if (key.startsWith('processed_')) {
      const timestamp = new Date(allProps[key]);
      if (timestamp < thirtyDaysAgo) {
        props.deleteProperty(key);
        deletedCount++;
      }
    }
  }

  console.log(`🧹 クリーンアップ完了: ${deletedCount}件の古い記録を削除`);
  return { deleted: deletedCount };
}

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * ラベルをセットアップ
 */
function setupEbisuLabels() {
  const labels = [
    CONFIG_EBISU.LABEL_PROCESSED,
    CONFIG_EBISU.LABEL_ERROR
  ];

  for (let labelName of labels) {
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      label = GmailApp.createLabel(labelName);
      console.log(`🏷️ ラベル作成: ${labelName}`);
    }
  }
}

/**
 * 日時をフォーマット
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, 'JST', 'yyyy/MM/dd HH:mm');
}

/**
 * 時刻のみをフォーマット
 */
function formatTime(date) {
  return Utilities.formatDate(date, 'JST', 'HH:mm');
}

// ============================================================
// トリガー設定
// ============================================================

/**
 * 定期実行トリガーを設定（5分ごと）
 */
function setupEbisuTrigger() {
  console.log('⚡ 恵比寿店トリガーを設定します...');

  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'manageHallelReservations') {
      console.log('🗑️ 既存のトリガーを削除');
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 新しいトリガーを作成（5分ごと）
  ScriptApp.newTrigger('manageHallelReservations')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('✅ 定期実行トリガー設定完了（5分ごと）');

  return {
    success: true,
    interval: '5分ごと',
    message: '恵比寿店の予約を5分ごとに自動同期します'
  };
}

/**
 * トリガーを削除
 */
function deleteEbisuTriggers() {
  console.log('🗑️ 恵比寿店トリガーを削除します...');

  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'manageHallelReservations') {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  console.log(`✅ ${deletedCount}個のトリガーを削除しました`);
  return { success: true, deleted: deletedCount };
}

// ============================================================
// テスト・デバッグ関数
// ============================================================

/**
 * テスト実行（最新5件のみ処理）
 */
function testEbisuSync() {
  console.log('🧪 恵比寿店同期テスト開始...');

  const calendar = CalendarApp.getCalendarById(CONFIG_EBISU.CALENDAR_ID);
  const threads = GmailApp.search(`${CONFIG_EBISU.SEARCH_QUERY}`, 0, 5);

  console.log(`📧 テスト対象: ${threads.length}件`);

  for (let thread of threads) {
    const messages = thread.getMessages();
    for (let message of messages) {
      const subject = message.getSubject();
      const body = message.getPlainBody();

      console.log(`\n--- テストメール ---`);
      console.log(`件名: ${subject}`);

      if (subject.includes('予約完了')) {
        const result = handleReservationComplete(body, calendar);
        console.log(`結果:`, result);
      } else if (subject.includes('キャンセル')) {
        const result = handleReservationCancel(body, calendar);
        console.log(`結果:`, result);
      }
    }
  }

  console.log('\n✅ テスト完了');
}

/**
 * カレンダーの予約状況を確認
 */
function checkEbisuReservations() {
  const calendar = CalendarApp.getCalendarById(CONFIG_EBISU.CALENDAR_ID);

  // 今日から7日間の予約を取得
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const events = calendar.getEvents(now, sevenDaysLater);

  console.log(`📅 今後7日間の予約: ${events.length}件\n`);

  for (let event of events) {
    console.log(`${formatDateTime(event.getStartTime())} - ${formatTime(event.getEndTime())}: ${event.getTitle()}`);
  }

  return { totalEvents: events.length };
}
