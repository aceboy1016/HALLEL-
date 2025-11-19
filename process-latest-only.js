/**
 * 【最新状態のみ送信】各日時・時間枠の最新メールのみをVercel APIに送信
 *
 * 問題:
 * - 同じ日時・時間に予約→キャンセル→予約が複数回発生
 * - 全メールを送信すると重複して表示される
 *
 * 解決:
 * - 各日時・時間枠ごとに最新のメールのみを選択
 * - 最新がキャンセルなら送信しない
 * - 最新が予約なら送信する
 */
function processLatestReservationsOnly() {
  Logger.log('='.repeat(80));
  Logger.log('【最新状態のみ送信】各日時・時間枠の最新メールのみ処理');
  Logger.log('='.repeat(80));

  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    Logger.log('ラベルが見つかりません');
    return;
  }

  Logger.log('全メールを取得中...\n');

  // ステップ1: 全メールを取得
  const allEmails = [];
  let start = 0;
  const batchSize = 100;

  while (true) {
    const threads = label.getThreads(start, batchSize);

    if (threads.length === 0) {
      break;
    }

    threads.forEach(thread => {
      const messages = thread.getMessages();

      messages.forEach(message => {
        const body = message.getPlainBody();
        const bookingInfo = parseEmailBody(body);

        if (bookingInfo) {
          allEmails.push({
            messageId: message.getId(),
            emailDate: message.getDate(), // メール受信日時
            subject: message.getSubject(),
            reservationDate: bookingInfo.date,
            startTime: bookingInfo.start_time,
            endTime: bookingInfo.end_time,
            customerName: bookingInfo.customer_name,
            store: bookingInfo.store,
            actionType: bookingInfo.action_type,
            isCancellation: bookingInfo.action_type === 'cancellation',
            bookingInfo: bookingInfo
          });
        }
      });
    });

    Logger.log(`取得中... ${start + threads.length}スレッド処理済み`);

    if (threads.length < batchSize) {
      break;
    }

    start += batchSize;
    Utilities.sleep(500);
  }

  Logger.log(`\n全メール取得完了: ${allEmails.length}件\n`);

  // ステップ2: 日時・時間枠ごとにグループ化
  const groupedBySlot = {};

  allEmails.forEach(email => {
    const key = `${email.store}|${email.reservationDate}|${email.startTime}|${email.endTime}|${email.customerName}`;

    if (!groupedBySlot[key]) {
      groupedBySlot[key] = [];
    }

    groupedBySlot[key].push(email);
  });

  Logger.log(`日時・時間枠の総数: ${Object.keys(groupedBySlot).length}件\n`);

  // ステップ3: 各グループで最新のメールのみを選択
  const latestOnly = [];
  let cancelledCount = 0;
  let duplicateCount = 0;

  Object.keys(groupedBySlot).forEach(key => {
    const emails = groupedBySlot[key];

    // メール受信日時でソート（最新が最後）
    emails.sort((a, b) => a.emailDate - b.emailDate);

    const latest = emails[emails.length - 1];

    if (emails.length > 1) {
      duplicateCount++;
      Logger.log(`重複: ${key.split('|')[1]} ${key.split('|')[2]}-${key.split('|')[3]} ${key.split('|')[4]} (${emails.length}件 → 最新: ${latest.isCancellation ? 'キャンセル' : '予約'})`);
    }

    // 最新がキャンセルでない場合のみ追加
    if (!latest.isCancellation) {
      latestOnly.push(latest);
    } else {
      cancelledCount++;
    }
  });

  Logger.log(`\n重複があった枠: ${duplicateCount}件`);
  Logger.log(`最新がキャンセル: ${cancelledCount}件`);
  Logger.log(`送信対象の予約: ${latestOnly.length}件\n`);

  // ステップ4: API送信
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

    // バッチデータを準備
    const batchData = batch.map(email => {
      const info = email.bookingInfo;
      info.email_id = email.messageId;
      info.email_subject = email.subject;
      info.email_date = email.emailDate.toISOString();
      return info;
    });

    // API送信
    const result = sendBatchToAPI(batchData);

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
  Logger.log(`重複あり: ${duplicateCount}件`);
  Logger.log(`最新がキャンセル: ${cancelledCount}件`);
  Logger.log(`送信対象: ${latestOnly.length}件`);
  Logger.log(`API送信成功: ${totalSuccess}件`);
  Logger.log(`API送信失敗: ${totalFailed}件`);
  Logger.log('='.repeat(80));

  if (totalSuccess === latestOnly.length) {
    Logger.log('\n✅ 最新状態のみをVercel APIに送信完了！');
    Logger.log('重複と古い予約・キャンセルは除外されました。');
  } else if (totalFailed > 0) {
    Logger.log('\n⚠️ 一部のメールでAPI送信が失敗しました。');
  }
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
