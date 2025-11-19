/**
 * 【全メッセージ処理】ラベル付きスレッド内の全メッセージをVercel APIに送信
 * - 各スレッドの最新メッセージだけでなく、全メッセージを処理
 * - 3396件全てのメッセージを処理
 * - HALLEL関連のみAPI送信
 */
function processAllMessagesInLabeledThreads() {
  Logger.log('='.repeat(80));
  Logger.log('【全メッセージ処理】ラベル付きスレッド内の全メッセージを処理');
  Logger.log('='.repeat(80));

  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    Logger.log(`ラベル "${labelName}" が見つかりません`);
    return;
  }

  const BATCH_SIZE = 50; // API送信バッチサイズ
  let totalThreads = 0;
  let totalMessages = 0;
  let start = 0;
  const threadBatchSize = 100;

  const allReservations = [];

  Logger.log('スレッド内の全メッセージを取得中...\n');

  // ステップ1: 全スレッドを取得し、各スレッド内の全メッセージを処理
  while (true) {
    const threads = label.getThreads(start, threadBatchSize);

    if (threads.length === 0) {
      break;
    }

    totalThreads += threads.length;

    threads.forEach((thread, threadIndex) => {
      const messages = thread.getMessages(); // スレッド内の全メッセージ
      totalMessages += messages.length;

      Logger.log(`\nスレッド ${start + threadIndex + 1}: ${messages.length}件のメッセージ`);

      // 各メッセージを個別に処理
      messages.forEach((message, msgIndex) => {
        const body = message.getPlainBody();
        const subject = message.getSubject();

        // パース試行
        const bookingInfo = parseEmailBody(body);

        if (bookingInfo) {
          // メールメタデータ追加
          bookingInfo.email_id = message.getId();
          bookingInfo.email_subject = subject;
          bookingInfo.email_date = message.getDate().toISOString();

          allReservations.push(bookingInfo);

          Logger.log(`  [${msgIndex + 1}/${messages.length}] HALLEL関連: ${bookingInfo.store} / ${bookingInfo.customer_name} / ${bookingInfo.date}`);
        } else {
          Logger.log(`  [${msgIndex + 1}/${messages.length}] スキップ（HALLEL関連外）`);
        }
      });
    });

    Logger.log(`\n進捗: ${totalThreads}スレッド / ${totalMessages}メッセージ処理済み`);

    if (threads.length < threadBatchSize) {
      break;
    }

    start += threadBatchSize;
    Utilities.sleep(500);
  }

  Logger.log('\n' + '='.repeat(80));
  Logger.log(`【収集完了】`);
  Logger.log(`総スレッド数: ${totalThreads}件`);
  Logger.log(`総メッセージ数: ${totalMessages}件`);
  Logger.log(`HALLEL関連メッセージ: ${allReservations.length}件`);
  Logger.log('='.repeat(80));

  if (allReservations.length === 0) {
    Logger.log('\n処理対象のHALLEL関連メッセージがありません。');
    return;
  }

  // ステップ2: API送信（50件ごと）
  Logger.log('\nVercel APIに送信中...\n');

  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < allReservations.length; i += BATCH_SIZE) {
    const batch = allReservations.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allReservations.length / BATCH_SIZE);

    Logger.log(`【バッチ ${batchNum}/${totalBatches}】 ${batch.length}件を送信中...`);

    const result = sendBatchToAPI(batch);

    if (result.success) {
      Logger.log(`✓ 成功: ${result.count}件`);
      totalSuccess += result.count;
    } else {
      Logger.log(`✗ 失敗: ${result.error}`);
      totalFailed += batch.length;
    }

    // レート制限対策
    if (i + BATCH_SIZE < allReservations.length) {
      Utilities.sleep(1000);
    }
  }

  // 最終結果
  Logger.log('\n' + '='.repeat(80));
  Logger.log('【処理完了】');
  Logger.log(`総スレッド数: ${totalThreads}件`);
  Logger.log(`総メッセージ数: ${totalMessages}件`);
  Logger.log(`HALLEL関連メッセージ: ${allReservations.length}件`);
  Logger.log(`API送信成功: ${totalSuccess}件`);
  Logger.log(`API送信失敗: ${totalFailed}件`);
  Logger.log('='.repeat(80));

  if (totalSuccess === allReservations.length) {
    Logger.log('\n✅ 全てのメッセージをVercel APIに送信完了！');
    Logger.log(`${totalMessages}件のメッセージのうち、${totalSuccess}件のHALLEL関連メッセージを処理しました。`);
  } else if (totalFailed > 0) {
    Logger.log('\n⚠️ 一部のメッセージでAPI送信が失敗しました。');
    Logger.log('ログを確認してエラー原因を調査してください。');
  }
}

/**
 * 【確認用】各スレッドのメッセージ数を表示
 */
function showThreadMessageCounts() {
  Logger.log('='.repeat(80));
  Logger.log('【スレッドごとのメッセージ数】');
  Logger.log('='.repeat(80));

  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    Logger.log(`ラベル "${labelName}" が見つかりません`);
    return;
  }

  let start = 0;
  const batchSize = 100;
  let threadNum = 1;

  while (true) {
    const threads = label.getThreads(start, batchSize);

    if (threads.length === 0) {
      break;
    }

    threads.forEach(thread => {
      const messages = thread.getMessages();
      const firstMessage = messages[0];
      const subject = firstMessage.getSubject();

      Logger.log(`[${threadNum}] ${messages.length}件のメッセージ - 件名: ${subject}`);
      threadNum++;
    });

    if (threads.length < batchSize) {
      break;
    }

    start += batchSize;
    Utilities.sleep(500);
  }

  Logger.log('='.repeat(80));
}
