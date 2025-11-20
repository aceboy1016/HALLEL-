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
        if (emailData && emailData.actionType === 'reservation') {
          newReservations.push(emailData);
          Logger.log(`📧 新規予約: ${emailData.fullName} (${emailData.studio}) ${formatDateTime(emailData.startTime)}`);
        }
      }
    }

    Logger.log(`\n📤 送信対象: ${newReservations.length}件`);

    if (newReservations.length === 0) {
      Logger.log('⏭️ 送信対象の予約がありません');
      return;
    }

    // Vercel APIに送信
    const result = sendBatchToVercelAPI(newReservations);

    if (result.success) {
      Logger.log(`✅ Vercel API送信成功: ${result.count}件`);

      // カレンダーにも追加
      const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
      if (calendar) {
        let calendarSuccess = 0;
        for (let res of newReservations) {
          const addResult = addReservationToCalendar(calendar, res);
          if (addResult.success) {
            calendarSuccess++;
          }
        }
        Logger.log(`✅ カレンダー追加成功: ${calendarSuccess}件`);
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
