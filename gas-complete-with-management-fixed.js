/**
 * Google Apps Script用Gmail自動同期 - 完全統合版（全店舗対応・店舗判定改善版）
 * HALLEL予約システム - 全メール確認対応
 *
 * 【管理機能追加版】
 * - トリガー管理
 * - ラベルクリーンアップ
 * - 明日朝の自動実行設定
 *
 * 【特徴】
 * - 全5店舗を1つのGASで処理：渋谷、代々木上原、中目黒、恵比寿、半蔵門
 * - 全店舗のデータをVercel PostgreSQLに送信
 * - 店舗判定ロジック改善：「店舗：」フィールドを優先的に検出
 */

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  WEBHOOK_URL: 'https://hallel.vercel.app/api/gas/webhook',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel',
  BATCH_SIZE: 50, // バッチサイズ（実行時間制限回避）
  MAX_EXECUTION_TIME: 300000, // 5分（ミリ秒）
  LABELS: {
    PROCESSED: 'HALLEL/Processed',
    BOOKING: 'HALLEL/Booking',
    CANCELLATION: 'HALLEL/Cancellation',
    SHIBUYA: 'HALLEL/Shibuya',
    YOYOGI_UEHARA: 'HALLEL/YoyogiUehara',
    NAKAMEGURO: 'HALLEL/Nakameguro',
    EBISU: 'HALLEL/Ebisu',
    HANZOMON: 'HALLEL/Hanzomon',
    BATCH_PROGRESS: 'HALLEL/BatchProgress'
  }
};

// ============================================================
// 【管理機能】トリガー削除
// ============================================================
/**
 * 全てのトリガーを削除
 * 使い方: GASエディタで関数を選択して実行ボタン（▶️）をクリック
 */
function deleteAllTriggers() {
  console.log('🧹 全トリガーを削除します...');

  const triggers = ScriptApp.getProjectTriggers();
  console.log(`📊 現在のトリガー数: ${triggers.length}個`);

  triggers.forEach(trigger => {
    const handlerFunction = trigger.getHandlerFunction();
    console.log(`🗑️ 削除: ${handlerFunction}`);
    ScriptApp.deleteTrigger(trigger);
  });

  console.log(`✅ 完了: ${triggers.length}個のトリガーを削除しました`);
  return { success: true, deleted: triggers.length };
}

// ============================================================
// 【管理機能】ラベルクリーンアップ
// ============================================================
/**
 * HALLEL関連の全ラベルを削除
 * 使い方: GASエディタで関数を選択して実行ボタン（▶️）をクリック
 * 注意: この操作は元に戻せません！
 */
function fullCleanupHallelLabels() {
  console.log('🧹 HALLELラベルのクリーンアップを開始します...');

  const allLabels = GmailApp.getUserLabels();
  const hallelLabels = allLabels.filter(label => label.getName().startsWith('HALLEL/'));

  console.log(`📊 削除対象: ${hallelLabels.length}個のHALLELラベル`);

  hallelLabels.forEach(label => {
    const labelName = label.getName();
    console.log(`🗑️ 削除中: ${labelName}`);
    label.deleteLabel();
  });

  console.log(`✅ 完了: ${hallelLabels.length}個のラベルを削除しました`);
  return { success: true, deleted: hallelLabels.length };
}

// ============================================================
// 【管理機能】明日朝の自動実行設定
// ============================================================
/**
 * 明日の朝6時に forceFullSync() を実行するトリガーを設定
 * 使い方: GASエディタで関数を選択して実行ボタン（▶️）をクリック
 */
function setupTomorrowMorningSync() {
  console.log('📅 明日朝6時の自動実行を設定します...');

  // 既存の forceFullSync トリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'forceFullSync') {
      console.log('🗑️ 既存のforceFullSyncトリガーを削除');
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 明日の朝6時を計算
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(6, 0, 0, 0);

  // トリガーを作成
  ScriptApp.newTrigger('forceFullSync')
    .timeBased()
    .at(tomorrow)
    .create();

  const formattedDate = Utilities.formatDate(tomorrow, 'JST', 'yyyy/MM/dd HH:mm');
  console.log(`✅ 設定完了: ${formattedDate} に forceFullSync() を実行します`);

  return {
    success: true,
    scheduledTime: formattedDate,
    message: `明日の朝6時 (${formattedDate}) に全メール同期を実行します`
  };
}

// ============================================================
// メイン機能
// ============================================================

/**
 * メイン実行関数（バッチ処理対応）
 */
function syncGmailReservations() {
  console.log('📧 Gmail予約同期開始...');
  return processBatchEmails(0);
}

/**
 * バッチ処理でメールを処理（実行時間制限回避）
 */
function processBatchEmails(startIndex = 0) {
  const startTime = Date.now();
  console.log(`📧 バッチ処理開始 - インデックス: ${startIndex}`);

  try {
    // ラベルを作成/取得
    setupLabels();

    // 全メールを検索（一度だけ）
    const allMessages = searchAllMessages();
    console.log(`📊 全メール数: ${allMessages.length}件`);

    if (startIndex >= allMessages.length) {
      console.log('✅ 全メール処理完了');
      return { success: true, message: '全メール処理完了', totalProcessed: allMessages.length };
    }

    // 現在のバッチを取得
    const endIndex = Math.min(startIndex + CONFIG.BATCH_SIZE, allMessages.length);
    const batch = allMessages.slice(startIndex, endIndex);

    console.log(`📦 バッチ処理: ${startIndex + 1}〜${endIndex}件目 (${batch.length}件)`);

    const reservations = [];
    let processedCount = 0;

    for (let i = 0; i < batch.length; i++) {
      // 実行時間チェック
      if (Date.now() - startTime > CONFIG.MAX_EXECUTION_TIME) {
        console.log('⏰ 実行時間制限に近づいたため、次のバッチをスケジュール');
        scheduleNextBatch(startIndex + i);
        break;
      }

      try {
        const message = batch[i];
        const globalIndex = startIndex + i;
        console.log(`⏳ 処理中... (${globalIndex + 1}/${allMessages.length})`);

        const reservation = processMessage(message);

        if (reservation) {
          reservations.push(reservation);
          applyLabels(message, reservation.is_cancellation, reservation.store);
          processedCount++;
          console.log(`✅ 予約処理: [${reservation.store}] ${reservation.date} ${reservation.start}-${reservation.end} ${reservation.customer_name}`);
        }

        // 進行状況を表示
        if ((globalIndex + 1) % 10 === 0) {
          console.log(`📈 進行状況: ${globalIndex + 1}/${allMessages.length} (${Math.round((globalIndex + 1)/allMessages.length*100)}%)`);
        }

      } catch (error) {
        console.error(`❌ メール処理エラー: ${error.message}`);
        continue;
      }
    }

    // Vercelにデータを送信（全店舗）
    if (reservations.length > 0) {
      console.log(`📤 Vercel送信: ${reservations.length}件（全店舗統合）`);
      sendToVercel(reservations);
    }

    // 次のバッチがある場合はスケジュール
    const nextIndex = startIndex + batch.length;
    if (nextIndex < allMessages.length) {
      console.log(`📅 次のバッチをスケジュール: ${nextIndex}〜`);
      scheduleNextBatch(nextIndex);
      return {
        success: true,
        message: `バッチ処理完了 (${startIndex + 1}〜${endIndex}件目)`,
        processed: processedCount,
        nextBatch: nextIndex
      };
    } else {
      console.log(`✅ 全バッチ処理完了: ${processedCount}件の予約を処理`);
      return {
        success: true,
        message: '全バッチ処理完了',
        processed: processedCount,
        total: allMessages.length
      };
    }

  } catch (error) {
    console.error(`❌ バッチ処理エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 定期実行用（トリガー設定）
 */
function scheduledSync() {
  console.log('⏰ 定期Gmail同期実行');

  // 最近24時間のメールのみ処理
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const query = `${CONFIG.SEARCH_QUERY} after:${Utilities.formatDate(yesterday, 'JST', 'yyyy/MM/dd')}`;

  try {
    const messages = GmailApp.search(query, 0, 50);
    console.log(`📧 定期同期対象: ${messages.length}件`);

    // 処理ロジックは同じ
    const reservations = [];
    for (const thread of messages) {
      const msgs = thread.getMessages();
      for (const msg of msgs) {
        const reservation = processGmailMessage(msg);
        if (reservation) {
          reservations.push(reservation);
          applyLabelsToMessage(msg, reservation.is_cancellation, reservation.store);
        }
      }
    }

    if (reservations.length > 0) {
      console.log(`📤 Vercel送信: ${reservations.length}件（全店舗統合）`);
      sendToVercel(reservations);
    }

    console.log(`✅ 定期同期完了: ${reservations.length}件（全店舗）`);

  } catch (error) {
    console.error(`❌ 定期同期エラー: ${error.message}`);
  }
}

/**
 * ラベルセットアップ
 */
function setupLabels() {
  const labelNames = Object.values(CONFIG.LABELS);

  for (const labelName of labelNames) {
    try {
      let label = GmailApp.getUserLabelByName(labelName);
      if (!label) {
        label = GmailApp.createLabel(labelName);
        console.log(`🏷️ ラベル作成: ${labelName}`);
      }
    } catch (error) {
      console.error(`❌ ラベル作成エラー (${labelName}): ${error.message}`);
    }
  }
}

/**
 * 全メール検索（制限なし）
 */
function searchAllMessages() {
  try {
    const messages = [];
    let start = 0;
    const batchSize = 100;

    while (true) {
      console.log(`🔍 メール検索中... (${start}〜)`);
      const threads = GmailApp.search(CONFIG.SEARCH_QUERY, start, batchSize);

      if (threads.length === 0) {
        break;
      }

      for (const thread of threads) {
        const msgs = thread.getMessages();
        for (const msg of msgs) {
          messages.push(msg);
        }
      }

      start += batchSize;

      // 安全のため最大10,000件で停止
      if (start >= 10000) {
        console.log('⚠️ 安全のため検索を10,000件で停止');
        break;
      }
    }

    // 新しい順にソート
    messages.sort((a, b) => b.getDate() - a.getDate());

    console.log(`📧 検索完了: ${messages.length}件のメールを発見`);
    return messages;

  } catch (error) {
    console.error(`❌ メール検索エラー: ${error.message}`);
    return [];
  }
}

/**
 * 従来のメール検索（互換性維持）
 */
function searchMessages() {
  return searchAllMessages().slice(0, 200);
}

/**
 * メール処理（店舗判定ロジック改善版）
 */
function processMessage(message) {
  try {
    const subject = message.getSubject();
    const body = message.getPlainBody();

    // 店舗判定（改善版：「店舗：」フィールドを優先）
    let detectedStore = null;

    // まず「店舗：」フィールドから正確に検出
    const storeFieldMatch = body.match(/店舗[：:]\s*HALLEL\s*([^\s\n]+)/);

    if (storeFieldMatch) {
      const storeName = storeFieldMatch[1];
      console.log(`🏪 店舗フィールド検出: ${storeName}`);

      if (storeName.includes('代々木上原')) {
        detectedStore = 'yoyogi-uehara';
      } else if (storeName.includes('中目黒')) {
        detectedStore = 'nakameguro';
      } else if (storeName.includes('恵比寿')) {
        detectedStore = 'ebisu';
      } else if (storeName.includes('半蔵門')) {
        detectedStore = 'hanzomon';
      } else if (storeName.includes('渋谷')) {
        detectedStore = 'shibuya';
      }
    }

    // 「店舗：」フィールドで検出できなかった場合のフォールバック
    if (!detectedStore) {
      console.log('⚠️ 店舗フィールド未検出、本文全体から検索');

      // 日本語店舗名で検索（優先順序）
      if (body.includes('代々木上原')) {
        detectedStore = 'yoyogi-uehara';
      } else if (body.includes('中目黒')) {
        detectedStore = 'nakameguro';
      } else if (body.includes('恵比寿')) {
        detectedStore = 'ebisu';
      } else if (body.includes('半蔵門')) {
        detectedStore = 'hanzomon';
      } else if (body.includes('渋谷')) {
        detectedStore = 'shibuya';
      } else {
        // 英語店舗名で検索（フォールバック）
        const bodyLower = body.toLowerCase();
        if (bodyLower.includes('yoyogi')) {
          detectedStore = 'yoyogi-uehara';
        } else if (bodyLower.includes('nakameguro')) {
          detectedStore = 'nakameguro';
        } else if (bodyLower.includes('ebisu')) {
          detectedStore = 'ebisu';
        } else if (bodyLower.includes('hanzomon')) {
          detectedStore = 'hanzomon';
        } else if (bodyLower.includes('shibuya')) {
          detectedStore = 'shibuya';
        }
      }
    }

    // HALLELメールでない場合はスキップ
    if (!detectedStore) {
      console.log('⚠️ 店舗を検出できませんでした');
      return null;
    }

    console.log(`✅ 検出された店舗: ${detectedStore}`);

    // キャンセルチェック
    const isCancellation = subject.includes('キャンセル') || subject.toLowerCase().includes('cancel');

    // 日付抽出
    const dateMatch = body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (!dateMatch) return null;

    const [, year, month, day] = dateMatch;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // 時間抽出
    const timeMatch = body.match(/(\d{1,2}):(\d{2})\s*[〜～~-]\s*(\d{1,2}):(\d{2})/);
    if (!timeMatch) return null;

    const [, startH, startM, endH, endM] = timeMatch;
    const start = `${startH.padStart(2, '0')}:${startM}`;
    const end = `${endH.padStart(2, '0')}:${endM}`;

    // 顧客名抽出
    const customerMatch = body.match(/^([^\n\r]+)\s*様/m);
    const customerName = customerMatch ? customerMatch[1].trim() : 'N/A';

    return {
      date: date,
      start: start,
      end: end,
      customer_name: customerName,
      store: detectedStore,
      type: 'gmail',
      is_cancellation: isCancellation,
      source: 'gas_sync',
      email_id: message.getId(),
      email_subject: subject,
      email_date: message.getDate().toISOString()
    };

  } catch (error) {
    console.error(`❌ メール解析エラー: ${error.message}`);
    return null;
  }
}

/**
 * GmailMessageオブジェクト用の処理（定期実行用）
 */
function processGmailMessage(message) {
  // processMessage と同じロジック
  return processMessage(message);
}

/**
 * ラベル適用
 */
function applyLabels(message, isCancellation, store = 'shibuya') {
  try {
    const storeLabels = {
      'shibuya': CONFIG.LABELS.SHIBUYA,
      'yoyogi-uehara': CONFIG.LABELS.YOYOGI_UEHARA,
      'nakameguro': CONFIG.LABELS.NAKAMEGURO,
      'ebisu': CONFIG.LABELS.EBISU,
      'hanzomon': CONFIG.LABELS.HANZOMON
    };

    const labelsToApply = [
      CONFIG.LABELS.PROCESSED,
      storeLabels[store] || CONFIG.LABELS.SHIBUYA
    ];

    if (isCancellation) {
      labelsToApply.push(CONFIG.LABELS.CANCELLATION);
    } else {
      labelsToApply.push(CONFIG.LABELS.BOOKING);
    }

    for (const labelName of labelsToApply) {
      const label = GmailApp.getUserLabelByName(labelName);
      if (label) {
        const thread = message.getThread();
        thread.addLabel(label);
      }
    }

    console.log(`🏷️ ラベル適用: ${labelsToApply.join(', ')}`);

  } catch (error) {
    console.error(`❌ ラベル適用エラー: ${error.message}`);
  }
}

/**
 * GmailMessageオブジェクト用のラベル適用
 */
function applyLabelsToMessage(message, isCancellation, store = 'shibuya') {
  applyLabels(message, isCancellation, store);
}

/**
 * Vercelに送信
 */
function sendToVercel(reservations) {
  try {
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: reservations
    };

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GAS-Secret': 'hallel_gas_2024' // 簡易認証
      },
      payload: JSON.stringify(payload)
    };

    const response = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200) {
      console.log(`✅ Vercel送信成功: ${reservations.length}件`);
    } else {
      console.error(`❌ Vercel送信失敗: ${responseCode}`);
    }

  } catch (error) {
    console.error(`❌ Vercel送信エラー: ${error.message}`);
  }
}

/**
 * 次のバッチをスケジュールする
 */
function scheduleNextBatch(startIndex) {
  try {
    // 1分後に次のバッチを実行
    const trigger = ScriptApp.newTrigger('continueProcessing')
      .timeBased()
      .after(60000) // 1分後
      .create();

    // 実行する関数にパラメータを渡すため、PropertiesServiceを使用
    PropertiesService.getScriptProperties().setProperty('NEXT_BATCH_INDEX', startIndex.toString());

    console.log(`📅 次のバッチをスケジュール: インデックス ${startIndex} を1分後に実行`);

  } catch (error) {
    console.error(`❌ バッチスケジュールエラー: ${error.message}`);
  }
}

/**
 * バッチ処理続行用トリガー関数
 */
function continueProcessing() {
  try {
    const startIndex = parseInt(PropertiesService.getScriptProperties().getProperty('NEXT_BATCH_INDEX') || '0');

    console.log(`🔄 バッチ処理続行: インデックス ${startIndex} から`);

    // バッチ処理を続行
    const result = processBatchEmails(startIndex);

    console.log('📊 バッチ処理結果:', result);

    // トリガーを削除（使い捨て）
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'continueProcessing') {
        ScriptApp.deleteTrigger(trigger);
      }
    });

  } catch (error) {
    console.error(`❌ バッチ処理続行エラー: ${error.message}`);
  }
}

/**
 * 定期実行トリガーを設定
 */
function setupTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'scheduledSync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 新しいトリガーを作成（1時間ごと）
  ScriptApp.newTrigger('scheduledSync')
    .timeBased()
    .everyHours(1)
    .create();

  console.log('✅ 定期実行トリガー設定完了（1時間ごと）');
}

/**
 * 進行状況確認
 */
function checkProgress() {
  const currentIndex = PropertiesService.getScriptProperties().getProperty('NEXT_BATCH_INDEX');

  if (currentIndex) {
    console.log(`📊 現在の進行状況: インデックス ${currentIndex} から処理予定`);
    return { currentIndex: parseInt(currentIndex) };
  } else {
    console.log('📊 進行中のバッチ処理なし');
    return { message: '進行中のバッチ処理なし' };
  }
}

/**
 * バッチ処理をリセット
 */
function resetBatchProgress() {
  PropertiesService.getScriptProperties().deleteProperty('NEXT_BATCH_INDEX');

  // 全てのcontinueProcessingトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'continueProcessing') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  console.log('🔄 バッチ処理リセット完了');
  return { message: 'バッチ処理リセット完了' };
}

/**
 * テスト実行（小さなバッチ）
 */
function testSync() {
  console.log('🧪 テスト実行開始...');

  // テスト用に小さなバッチサイズを設定
  const originalBatchSize = CONFIG.BATCH_SIZE;
  CONFIG.BATCH_SIZE = 10;

  const result = processBatchEmails(0);
  console.log('📊 テスト結果:', result);

  // バッチサイズを元に戻す
  CONFIG.BATCH_SIZE = originalBatchSize;

  return result;
}

/**
 * 強制全件処理（手動実行用）
 */
function forceFullSync() {
  console.log('🚀 強制全件処理開始...');

  // バッチ処理をリセット
  resetBatchProgress();

  // 大きなバッチサイズで実行
  const originalBatchSize = CONFIG.BATCH_SIZE;
  CONFIG.BATCH_SIZE = 100;

  const result = syncGmailReservations();

  // バッチサイズを元に戻す
  CONFIG.BATCH_SIZE = originalBatchSize;

  console.log('📊 強制全件処理結果:', result);
  return result;
}
