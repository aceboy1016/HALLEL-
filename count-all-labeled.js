/**
 * 【真の件数確認】ラベル付きメールを全件カウント
 * getThreads()は100件までしか返さないので、ページネーションで全件取得
 */
function countAllLabeledThreads() {
  Logger.log('='.repeat(80));
  Logger.log('【ラベル付きメール全件カウント】');
  Logger.log('='.repeat(80));

  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    Logger.log(`ラベル "${labelName}" が見つかりません`);
    return 0;
  }

  let totalCount = 0;
  let start = 0;
  const batchSize = 100; // getThreads()は最大100件ずつ

  while (true) {
    const threads = label.getThreads(start, batchSize);

    if (threads.length === 0) {
      break;
    }

    totalCount += threads.length;
    Logger.log(`取得中... ${totalCount}件`);

    if (threads.length < batchSize) {
      // 最後のバッチ
      break;
    }

    start += batchSize;
    Utilities.sleep(500); // レート制限対策
  }

  Logger.log('='.repeat(80));
  Logger.log(`【結果】ラベル付きメール総数: ${totalCount}件`);
  Logger.log('='.repeat(80));

  return totalCount;
}

/**
 * 【全ラベル付きメール処理】2809件全てをVercel APIに送信
 * - ラベルが既についているメールを処理
 * - API送信のみ実行（ラベルは既にあるので付けない）
 */
function processAllLabeledEmails() {
  Logger.log('='.repeat(80));
  Logger.log('【全ラベル付きメール処理】Vercel APIに送信');
  Logger.log('='.repeat(80));

  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    Logger.log(`ラベル "${labelName}" が見つかりません`);
    return;
  }

  const BATCH_SIZE = 50; // API送信バッチサイズ
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let start = 0;
  const threadBatchSize = 100;

  Logger.log('ラベル付きメールを取得中...\n');

  // ステップ1: 全てのラベル付きスレッドを取得
  const allReservations = [];

  while (true) {
    const threads = label.getThreads(start, threadBatchSize);

    if (threads.length === 0) {
      break;
    }

    Logger.log(`スレッド取得: ${start + 1}～${start + threads.length}件目`);

    threads.forEach((thread, index) => {
      const message = thread.getMessages()[0];
      const body = message.getPlainBody();

      // パース試行
      const bookingInfo = parseEmailBody(body);

      if (bookingInfo) {
        // メールメタデータ追加
        bookingInfo.email_id = message.getId();
        bookingInfo.email_subject = message.getSubject();
        bookingInfo.email_date = message.getDate().toISOString();

        allReservations.push(bookingInfo);
      }
    });

    totalProcessed += threads.length;

    if (threads.length < threadBatchSize) {
      break;
    }

    start += threadBatchSize;
    Utilities.sleep(500);
  }

  Logger.log('\n' + '='.repeat(80));
  Logger.log(`取得完了: ${totalProcessed}件のスレッド`);
  Logger.log(`HALLEL関連: ${allReservations.length}件`);
  Logger.log('='.repeat(80));

  if (allReservations.length === 0) {
    Logger.log('\n処理対象のHALLEL関連メールがありません。');
    return;
  }

  // ステップ2: API送信（50件ごと）
  Logger.log('\nVercel APIに送信中...\n');

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
  Logger.log(`総スレッド数: ${totalProcessed}件`);
  Logger.log(`HALLEL関連: ${allReservations.length}件`);
  Logger.log(`API送信成功: ${totalSuccess}件`);
  Logger.log(`API送信失敗: ${totalFailed}件`);
  Logger.log('='.repeat(80));

  if (totalSuccess === allReservations.length) {
    Logger.log('\n✅ 全てのラベル付きメールをVercel APIに送信完了！');
  } else if (totalFailed > 0) {
    Logger.log('\n⚠️ 一部のメールでAPI送信が失敗しました。');
    Logger.log('ログを確認してエラー原因を調査してください。');
  }
}
