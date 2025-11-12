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

// ============================================================
// マイグレーション関数
// ============================================================

/**
 * 古い「Processed」ラベルから新しい「HALLEL_Ebisu/Processed」ラベルへ移行
 * 使い方: GASエディタで関数を選択して実行ボタン（▶️）をクリック
 */
function migrateOldProcessedLabel() {
  console.log('🔄 ラベル移行開始: Processed → HALLEL_Ebisu/Processed');

  try {
    const oldLabel = GmailApp.getUserLabelByName('Processed');
    const newLabel = GmailApp.getUserLabelByName(CONFIG_EBISU.LABEL_PROCESSED);

    if (!oldLabel) {
      console.log('⚠️ 古い「Processed」ラベルが見つかりません');
      return { success: false, message: '古いラベルが存在しません' };
    }

    if (!newLabel) {
      console.log('📝 新しいラベルを作成します...');
      GmailApp.createLabel(CONFIG_EBISU.LABEL_PROCESSED);
    }

    // 古いラベルが付いているスレッドを検索
    const threads = oldLabel.getThreads();
    console.log(`📧 移行対象: ${threads.length}件のスレッド`);

    let migratedCount = 0;
    const batchSize = 100;

    for (let i = 0; i < threads.length; i += batchSize) {
      const batch = threads.slice(i, Math.min(i + batchSize, threads.length));

      for (let thread of batch) {
        // 恵比寿店のメールかチェック
        const messages = thread.getMessages();
        let isEbisuThread = false;

        for (let message of messages) {
          const body = message.getPlainBody();
          if (body.includes('恵比寿')) {
            isEbisuThread = true;
            break;
          }
        }

        if (isEbisuThread) {
          // 新しいラベルを追加
          const newLabelObj = GmailApp.getUserLabelByName(CONFIG_EBISU.LABEL_PROCESSED);
          thread.addLabel(newLabelObj);
          migratedCount++;

          console.log(`✅ 移行完了: ${thread.getFirstMessageSubject()}`);
        }
      }

      // 進行状況を表示
      console.log(`📈 進行状況: ${Math.min(i + batchSize, threads.length)}/${threads.length}`);
    }

    console.log(`\n✅ 移行完了: ${migratedCount}件を新しいラベルに移行しました`);
    console.log(`ℹ️ 古い「Processed」ラベルは残っています（手動で削除してください）`);

    return {
      success: true,
      migrated: migratedCount,
      total: threads.length,
      message: `${migratedCount}件のスレッドを移行しました`
    };

  } catch (error) {
    console.error(`❌ 移行エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 古い「Processed」ラベルを削除
 * 使い方: migrateOldProcessedLabel()を実行した後に使用
 * 注意: この操作は元に戻せません！
 */
function deleteOldProcessedLabel() {
  console.log('🗑️ 古い「Processed」ラベルを削除します...');

  try {
    const oldLabel = GmailApp.getUserLabelByName('Processed');

    if (!oldLabel) {
      console.log('⚠️ 古い「Processed」ラベルが見つかりません（既に削除済み）');
      return { success: false, message: 'ラベルが存在しません' };
    }

    // ラベルが付いているスレッド数を確認
    const threads = oldLabel.getThreads();
    console.log(`⚠️ このラベルは ${threads.length}件のスレッドに付いています`);

    // 確認
    console.log('📝 ラベルを削除します（スレッド自体は削除されません）');
    oldLabel.deleteLabel();

    console.log('✅ 古い「Processed」ラベルを削除しました');

    return {
      success: true,
      message: '古いラベルを削除しました'
    };

  } catch (error) {
    console.error(`❌ 削除エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * ラベル状況を確認
 */
function checkLabelStatus() {
  console.log('📊 ラベル状況を確認中...\n');

  const oldLabel = GmailApp.getUserLabelByName('Processed');
  const newLabel = GmailApp.getUserLabelByName(CONFIG_EBISU.LABEL_PROCESSED);

  console.log('=== 古いラベル「Processed」 ===');
  if (oldLabel) {
    const oldThreads = oldLabel.getThreads();
    console.log(`✅ 存在する: ${oldThreads.length}件のスレッドに付与`);
  } else {
    console.log('❌ 存在しない');
  }

  console.log('\n=== 新しいラベル「HALLEL_Ebisu/Processed」 ===');
  if (newLabel) {
    const newThreads = newLabel.getThreads();
    console.log(`✅ 存在する: ${newThreads.length}件のスレッドに付与`);
  } else {
    console.log('❌ 存在しない');
  }

  return {
    oldLabel: oldLabel ? oldLabel.getThreads().length : 0,
    newLabel: newLabel ? newLabel.getThreads().length : 0
  };
}

// ============================================================
// カレンダー全削除＆再処理機能
// ============================================================

/**
 * カレンダーの全HALLEL予約を削除（レート制限対応版）
 * 使い方: GASエディタで関数を選択して実行ボタン（▶️）をクリック
 * 注意: この操作は元に戻せません！
 */
function clearAllEbisuCalendarEvents() {
  console.log('🗑️ カレンダーの全HALLEL予約を削除します...');

  try {
    const calendar = CalendarApp.getCalendarById(CONFIG_EBISU.CALENDAR_ID);

    if (!calendar) {
      console.error('❌ カレンダーが見つかりません');
      return { success: false, error: 'Calendar not found' };
    }

    // 2024年11月〜2026年1月の範囲で削除（重要な期間のみ）
    const startDate = new Date('2024-11-01');
    const endDate = new Date('2026-01-31');

    console.log(`📅 削除範囲: ${startDate.toLocaleDateString('ja-JP')} 〜 ${endDate.toLocaleDateString('ja-JP')}`);

    const events = calendar.getEvents(startDate, endDate);

    console.log(`📊 削除対象: ${events.length}件のイベント`);

    let deletedCount = 0;
    const batchSize = 5; // 5件ずつ処理（レート制限対策）

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const title = event.getTitle();

      // HALLEL予約のみ削除（他のイベントは残す）
      if (title.includes('HALLEL-')) {
        console.log(`🗑️ 削除: ${title} [${formatDateTime(event.getStartTime())}]`);

        try {
          event.deleteEvent();
          deletedCount++;

          // 5件ごとに3秒待機（レート制限回避）
          if (deletedCount % batchSize === 0) {
            console.log(`⏸️ ${deletedCount}件削除完了。3秒待機中...`);
            Utilities.sleep(3000);
          }
        } catch (error) {
          console.error(`❌ 削除エラー (${title}): ${error.message}`);

          // レート制限エラーの場合は処理を中断
          if (error.message.includes('too many')) {
            console.log(`⚠️ レート制限に達しました。${deletedCount}件削除済み。`);
            console.log(`💡 数時間後に再度 resetAndReprocessAll() を実行してください。`);

            return {
              success: false,
              deleted: deletedCount,
              total: events.length,
              remaining: events.length - i - 1,
              error: 'レート制限エラー',
              message: `${deletedCount}件削除済み。残り約${events.length - i - 1}件。数時間後に再実行してください。`
            };
          }

          // その他のエラーは続行
          continue;
        }
      }
    }

    console.log(`✅ 削除完了: ${deletedCount}件のHALLEL予約を削除しました`);

    return {
      success: true,
      deleted: deletedCount,
      total: events.length,
      message: `${deletedCount}件のHALLEL予約を削除しました`
    };

  } catch (error) {
    console.error(`❌ 削除エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 全ての処理済みラベルを外す
 * 使い方: GASエディタで関数を選択して実行ボタン（▶️）をクリック
 */
function removeAllProcessedLabels() {
  console.log('🔄 全ての処理済みラベルを外します...');

  try {
    const label = GmailApp.getUserLabelByName(CONFIG_EBISU.LABEL_PROCESSED);

    if (!label) {
      console.log('⚠️ 処理済みラベルが見つかりません');
      return { success: false, message: 'ラベルが存在しません' };
    }

    const threads = label.getThreads();
    console.log(`📧 対象: ${threads.length}件のスレッド`);

    // バッチ処理（100件ずつ）
    const batchSize = 100;
    let removedCount = 0;

    for (let i = 0; i < threads.length; i += batchSize) {
      const batch = threads.slice(i, Math.min(i + batchSize, threads.length));

      for (let thread of batch) {
        thread.removeLabel(label);
        removedCount++;
      }

      console.log(`📈 進行状況: ${Math.min(i + batchSize, threads.length)}/${threads.length}`);
    }

    console.log(`✅ 完了: ${removedCount}件のスレッドからラベルを外しました`);

    return {
      success: true,
      removed: removedCount,
      message: `${removedCount}件のスレッドからラベルを外しました`
    };

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 処理済みメッセージの記録を全削除
 */
function clearProcessedMessagesRecord() {
  console.log('🗑️ 処理済みメッセージの記録を削除します...');

  try {
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();

    let deletedCount = 0;

    for (let key in allProps) {
      if (key.startsWith('processed_')) {
        props.deleteProperty(key);
        deletedCount++;
      }
    }

    console.log(`✅ 完了: ${deletedCount}件の記録を削除しました`);

    return {
      success: true,
      deleted: deletedCount,
      message: `${deletedCount}件の記録を削除しました`
    };

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 【統合関数】カレンダークリア＆全メール再処理
 * 使い方: GASエディタで関数を選択して実行ボタン（▶️）をクリック
 * 注意: カレンダーの全HALLEL予約が削除されます！
 */
function resetAndReprocessAll() {
  console.log('🔄 カレンダーリセット＆全メール再処理を開始します...\n');

  try {
    // ステップ1: カレンダーの全HALLEL予約を削除
    console.log('=== ステップ1: カレンダー削除 ===');
    const clearResult = clearAllEbisuCalendarEvents();
    console.log(`結果: ${clearResult.message}\n`);

    // ステップ2: ラベルを外す
    console.log('=== ステップ2: ラベル削除 ===');
    const labelResult = removeAllProcessedLabels();
    console.log(`結果: ${labelResult.message}\n`);

    // ステップ3: 処理済み記録をクリア
    console.log('=== ステップ3: 処理済み記録クリア ===');
    const recordResult = clearProcessedMessagesRecord();
    console.log(`結果: ${recordResult.message}\n`);

    // ステップ4: 全メール再処理
    console.log('=== ステップ4: 全メール再処理 ===');
    console.log('5秒待機してから再処理を開始します...');
    Utilities.sleep(5000);

    const processResult = manageHallelReservations();
    console.log(`結果: 成功 ${processResult.processed}件 / エラー ${processResult.errors}件\n`);

    console.log('✅ 全処理完了！');

    return {
      success: true,
      calendarCleared: clearResult.deleted,
      labelsRemoved: labelResult.removed,
      recordsCleared: recordResult.deleted,
      reprocessed: processResult.processed,
      errors: processResult.errors,
      message: 'カレンダーリセット＆再処理が完了しました'
    };

  } catch (error) {
    console.error(`❌ 統合処理エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}
