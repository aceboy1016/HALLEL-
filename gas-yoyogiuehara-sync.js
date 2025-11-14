/**
 * Google Apps Script用Gmail自動同期 - 代々木上原店専用
 * HALLEL予約システム
 *
 * 【店舗情報】
 * - 店舗: 代々木上原
 * - 最大枠数: 2枠（区別なし）
 * - データ送信先: Vercel (PostgreSQL)
 */

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  WEBHOOK_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',
  STORE_NAME: 'yoyogi-uehara',
  STORE_NAME_JP: '代々木上原店',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel 代々木上原',
  BATCH_SIZE: 50,
  MAX_EXECUTION_TIME: 300000, // 5分
  LABELS: {
    PROCESSED: 'HALLEL_YoyogiUehara/Processed',
    BOOKING: 'HALLEL_YoyogiUehara/Booking',
    CANCELLATION: 'HALLEL_YoyogiUehara/Cancellation',
    ERROR: 'HALLEL_YoyogiUehara/Error'
  }
};

// ============================================================
// 【管理機能】トリガー削除
// ============================================================
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
// 【管理機能】5分ごとのトリガー設定
// ============================================================
function setupFrequentTrigger() {
  console.log('⚡ 代々木上原店: 5分ごとのトリガーを設定します...');

  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'scheduledSync') {
      console.log('🗑️ 既存のscheduledSyncトリガーを削除');
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 新しいトリガーを作成（5分ごと）
  ScriptApp.newTrigger('scheduledSync')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('✅ 定期実行トリガー設定完了（5分ごと）');

  return {
    success: true,
    store: CONFIG.STORE_NAME_JP,
    interval: '5分ごと',
    message: `${CONFIG.STORE_NAME_JP}の新しいメールを5分ごとに自動チェック＆処理します`
  };
}

// ============================================================
// メイン機能
// ============================================================

/**
 * 定期実行用（トリガー設定）
 */
function scheduledSync() {
  console.log(`⏰ ${CONFIG.STORE_NAME_JP} 定期Gmail同期実行`);

  // 最近24時間のメールのみ処理
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const query = `${CONFIG.SEARCH_QUERY} after:${Utilities.formatDate(yesterday, 'JST', 'yyyy/MM/dd')}`;

  try {
    setupLabels();

    const threads = GmailApp.search(query, 0, 50);
    console.log(`📧 定期同期対象: ${threads.length}件のスレッド`);

    const reservations = [];

    for (const thread of threads) {
      const messages = thread.getMessages();

      for (const message of messages) {
        const reservation = processMessage(message);

        if (reservation) {
          reservations.push(reservation);
          applyLabels(message, reservation.is_cancellation);
          console.log(`✅ 予約処理: ${reservation.date} ${reservation.start}-${reservation.end} ${reservation.customer_name}`);
        }
      }
    }

    // Vercelに送信
    if (reservations.length > 0) {
      console.log(`📤 Vercel送信: ${reservations.length}件（${CONFIG.STORE_NAME_JP}）`);
      sendToVercel(reservations);
    } else {
      console.log(`ℹ️ ${CONFIG.STORE_NAME_JP}の新規予約なし`);
    }

    console.log(`✅ 定期同期完了: ${reservations.length}件`);
    return { success: true, processed: reservations.length };

  } catch (error) {
    console.error(`❌ 定期同期エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 手動実行用（全メール処理）
 */
function manualFullSync() {
  console.log(`🚀 ${CONFIG.STORE_NAME_JP} 全メール同期開始...`);

  try {
    setupLabels();

    const allMessages = searchAllMessages();
    console.log(`📧 全メール数: ${allMessages.length}件`);

    const reservations = [];
    let processedCount = 0;

    for (let i = 0; i < allMessages.length; i++) {
      const message = allMessages[i];

      try {
        const reservation = processMessage(message);

        if (reservation) {
          reservations.push(reservation);
          applyLabels(message, reservation.is_cancellation);
          processedCount++;
          console.log(`✅ [${i + 1}/${allMessages.length}] ${reservation.date} ${reservation.start}-${reservation.end} ${reservation.customer_name}`);
        }

        // 進行状況表示
        if ((i + 1) % 10 === 0) {
          console.log(`📈 進行状況: ${i + 1}/${allMessages.length} (${Math.round((i + 1) / allMessages.length * 100)}%)`);
        }

      } catch (error) {
        console.error(`❌ メール処理エラー [${i + 1}]: ${error.message}`);
        continue;
      }
    }

    // Vercelに送信
    if (reservations.length > 0) {
      console.log(`📤 Vercel送信: ${reservations.length}件（${CONFIG.STORE_NAME_JP}）`);
      sendToVercel(reservations);
    }

    console.log(`✅ 全メール同期完了: ${processedCount}件処理`);
    return {
      success: true,
      total: allMessages.length,
      processed: processedCount
    };

  } catch (error) {
    console.error(`❌ 全メール同期エラー: ${error.message}`);
    return { success: false, error: error.message };
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
 * 全メール検索
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

      // 安全のため最大5,000件で停止
      if (start >= 5000) {
        console.log('⚠️ 安全のため検索を5,000件で停止');
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
 * メール処理（代々木上原店専用）
 */
function processMessage(message) {
  try {
    const subject = message.getSubject();
    const body = message.getPlainBody();

    // 代々木上原店のメールか確認
    if (!body.includes('代々木上原')) {
      console.log('⚠️ 代々木上原店のメールではありません');
      return null;
    }

    // キャンセルチェック
    const isCancellation = subject.includes('キャンセル') || subject.toLowerCase().includes('cancel');

    // 日付抽出
    const dateMatch = body.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (!dateMatch) {
      console.log('⚠️ 日付が見つかりません');
      return null;
    }

    const [, year, month, day] = dateMatch;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // 時間抽出
    const timeMatch = body.match(/(\d{1,2}):(\d{2})\s*[〜～~-]\s*(\d{1,2}):(\d{2})/);
    if (!timeMatch) {
      console.log('⚠️ 時間が見つかりません');
      return null;
    }

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
      store: CONFIG.STORE_NAME,
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
 * ラベル適用
 */
function applyLabels(message, isCancellation) {
  try {
    const labelsToApply = [CONFIG.LABELS.PROCESSED];

    if (isCancellation) {
      labelsToApply.push(CONFIG.LABELS.CANCELLATION);
    } else {
      labelsToApply.push(CONFIG.LABELS.BOOKING);
    }

    const messageId = message.getId();
    const labelIds = [];

    for (const labelName of labelsToApply) {
      const label = GmailApp.getUserLabelByName(labelName);
      if (label) {
        labelIds.push(label.getId());
      }
    }

    if (labelIds.length > 0) {
      Gmail.Users.Messages.modify(
        { addLabelIds: labelIds },
        'me',
        messageId
      );
    }

    console.log(`🏷️ ラベル適用: ${labelsToApply.join(', ')}`);

  } catch (error) {
    console.error(`❌ ラベル適用エラー: ${error.message}`);
  }
}

/**
 * Vercelに送信
 */
function sendToVercel(reservations) {
  try {
    const payload = {
      source: 'gas',
      store: CONFIG.STORE_NAME,
      timestamp: new Date().toISOString(),
      reservations: reservations
    };

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GAS-Secret': 'hallel_gas_2024'
      },
      payload: JSON.stringify(payload)
    };

    const response = UrlFetchApp.fetch(CONFIG.WEBHOOK_URL, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200) {
      console.log(`✅ Vercel送信成功: ${reservations.length}件（${CONFIG.STORE_NAME_JP}）`);
      return { success: true };
    } else {
      console.error(`❌ Vercel送信失敗: ${responseCode}`);
      return { success: false, code: responseCode };
    }

  } catch (error) {
    console.error(`❌ Vercel送信エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * テスト実行
 */
function testSync() {
  console.log(`🧪 ${CONFIG.STORE_NAME_JP} テスト実行開始...`);

  try {
    setupLabels();

    const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, 5);
    console.log(`📧 テスト対象: ${threads.length}件のスレッド`);

    const reservations = [];

    for (const thread of threads) {
      const messages = thread.getMessages();

      for (const message of messages) {
        const reservation = processMessage(message);

        if (reservation) {
          reservations.push(reservation);
          console.log(`✅ テスト: ${reservation.date} ${reservation.start}-${reservation.end} ${reservation.customer_name}`);
        }
      }
    }

    console.log(`📊 テスト結果: ${reservations.length}件の予約を検出`);

    if (reservations.length > 0) {
      console.log('🔍 サンプル:', reservations[0]);
    }

    return {
      success: true,
      found: reservations.length,
      sample: reservations[0] || null
    };

  } catch (error) {
    console.error(`❌ テストエラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}
