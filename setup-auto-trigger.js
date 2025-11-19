/**
 * 【トリガー設定】新着メール自動処理
 *
 * 1分ごとに新しいHALLELメールをチェックして処理
 */
function setupAutoProcessTrigger() {
  Logger.log('='.repeat(80));
  Logger.log('【トリガー設定】新着メール自動処理');
  Logger.log('='.repeat(80));

  // 既存のトリガーを削除
  const existingTriggers = ScriptApp.getProjectTriggers();
  existingTriggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processNewHallelEmails') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('既存のトリガーを削除しました');
    }
  });

  // 新しいトリガーを作成（1分ごと）
  ScriptApp.newTrigger('processNewHallelEmails')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('✅ トリガー設定完了！');
  Logger.log('');
  Logger.log('processNewHallelEmails() が1分ごとに自動実行されます');
  Logger.log('新着メールを自動的にVercel APIに送信します');
  Logger.log('='.repeat(80));
}

/**
 * 【新着メール処理】HALLEL/Processed ラベルの新しいメールを処理
 */
function processNewHallelEmails() {
  const labelName = 'HALLEL/Processed';
  const processedLabelName = 'HALLEL/Synced'; // 処理済みマーク用

  const label = GmailApp.getUserLabelByName(labelName);
  const processedLabel = GmailApp.getUserLabelByName(processedLabelName) ||
                         GmailApp.createLabel(processedLabelName);

  if (!label) {
    Logger.log('HALLEL/Processedラベルが見つかりません');
    return;
  }

  // HALLEL/Processed があるが HALLEL/Synced がないメールを取得
  const query = `label:${labelName} -label:${processedLabelName}`;
  const threads = GmailApp.search(query, 0, 50);

  if (threads.length === 0) {
    Logger.log('新着メールなし');
    return;
  }

  Logger.log(`新着メール: ${threads.length}件のスレッド`);

  const reservationsToSend = [];
  const threadsToMark = [];

  threads.forEach(thread => {
    const messages = thread.getMessages();

    messages.forEach(message => {
      // HALLEL/Synced がすでに付いている場合はスキップ
      const labels = message.getThread().getLabels().map(l => l.getName());
      if (labels.includes(processedLabelName)) {
        return;
      }

      const body = message.getPlainBody();
      const subject = message.getSubject();
      const emailDate = message.getDate();
      const messageId = message.getId();

      const bookingInfo = parseEmailBody(body);

      if (bookingInfo) {
        bookingInfo.email_id = messageId;
        bookingInfo.email_subject = subject;
        bookingInfo.email_date = emailDate.toISOString();

        reservationsToSend.push(bookingInfo);
        threadsToMark.push(thread);

        Logger.log(`処理: ${bookingInfo.action_type} - ${bookingInfo.date} ${bookingInfo.start_time} ${bookingInfo.customer_name}`);
      }
    });
  });

  if (reservationsToSend.length === 0) {
    Logger.log('処理対象のメールなし');
    return;
  }

  // Vercel APIに送信
  Logger.log(`\nVercel APIに${reservationsToSend.length}件送信中...`);

  const result = sendBatchToAPI(reservationsToSend);

  if (result.success) {
    Logger.log(`✅ 送信成功: ${result.count}件`);

    // 処理済みラベルを付ける
    threadsToMark.forEach(thread => {
      thread.addLabel(processedLabel);
    });

    Logger.log(`HALLEL/Syncedラベルを${threadsToMark.length}件に付与`);
  } else {
    Logger.log(`❌ 送信失敗: ${result.error}`);
  }
}

/**
 * メール本文から店舗を抽出
 */
function extractStore(body) {
  const storeMap = {
    '恵比寿店': 'ebisu',
    '半蔵門店': 'hanzomon',
    '代々木上原店': 'yoyogi-uehara',
    '中目黒店': 'nakameguro',
    '渋谷店': 'shibuya'
  };

  for (const [storeName, storeId] of Object.entries(storeMap)) {
    if (body.includes(storeName)) {
      return storeId;
    }
  }

  return null;
}

/**
 * メール本文から顧客名を抽出
 */
function extractCustomerName(body) {
  const pattern1 = /^(.+?)様/m;
  const match1 = body.match(pattern1);
  if (match1) {
    return match1[1].trim();
  }

  const pattern2 = /お客様名[：:]\s*(.+?)[\n\r]/;
  const match2 = body.match(pattern2);
  if (match2) {
    return match2[1].trim();
  }

  return 'N/A';
}

/**
 * 時刻をHH:MM形式に整形
 */
function formatTime(time) {
  const parts = time.split(':');
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1].padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * メール本文から予約情報を抽出（Coubic＋Hacomono両対応）
 */
function parseEmailBody(body) {
  const store = extractStore(body);

  if (!store) {
    return null;
  }

  const customerName = extractCustomerName(body);
  const isCancellation = body.includes('キャンセル') || body.includes('cancel');

  // Hacomonoメール形式: 日時：2025年12月31日(水) 02:00~03:00
  const hacomonoPattern = /日時[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^)]*\)\s*(\d{1,2}:\d{2})[~〜～](\d{1,2}:\d{2})/;
  const hacomonoMatch = body.match(hacomonoPattern);

  if (hacomonoMatch) {
    const [, year, month, day, startTime, endTime] = hacomonoMatch;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    return {
      action_type: isCancellation ? 'cancellation' : 'booking',
      date: date,
      start_time: formatTime(startTime),
      end_time: formatTime(endTime),
      customer_name: customerName,
      store: store
    };
  }

  // 旧形式（後方互換性のため残す）
  const bookingPattern = /予約[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-~〜ー]\s*(\d{1,2}:\d{2})/;
  const bookingMatch = body.match(bookingPattern);

  if (bookingMatch) {
    return {
      action_type: 'booking',
      date: bookingMatch[1],
      start_time: formatTime(bookingMatch[2]),
      end_time: formatTime(bookingMatch[3]),
      customer_name: customerName,
      store: store
    };
  }

  const cancelPattern = /キャンセル[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/;
  const cancelMatch = body.match(cancelPattern);

  if (cancelMatch) {
    return {
      action_type: 'cancellation',
      date: cancelMatch[1],
      start_time: formatTime(cancelMatch[2]),
      customer_name: customerName,
      store: store
    };
  }

  return null;
}

/**
 * 【バッチAPI送信】複数の予約を一度に送信
 */
function sendBatchToAPI(reservations) {
  try {
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: reservations.map(r => ({
        date: r.date,
        start: r.start_time,
        end: r.end_time || r.start_time,
        customer_name: r.customer_name || 'N/A',
        store: r.store || 'shibuya',
        type: 'gmail',
        is_cancellation: r.action_type === 'cancellation',
        source: 'gas_sync',
        email_id: r.email_id || '',
        email_subject: r.email_subject || '',
        email_date: r.email_date || new Date().toISOString()
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
 * 【トリガー削除】自動処理を停止
 */
function removeAutoProcessTrigger() {
  Logger.log('トリガーを削除中...');

  const existingTriggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  existingTriggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processNewHallelEmails') {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  Logger.log(`✅ ${deletedCount}件のトリガーを削除しました`);
  Logger.log('自動処理が停止されました');
}
