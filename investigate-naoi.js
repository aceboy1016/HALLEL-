/**
 * 【直井 桃花様のメール調査】
 * 12月1日の予約とキャンセルを全て確認
 */
function investigateNaoiReservations() {
  Logger.log('='.repeat(80));
  Logger.log('【直井 桃花様のメール調査】');
  Logger.log('='.repeat(80));

  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    Logger.log('ラベルが見つかりません');
    return;
  }

  const allReservations = [];
  let start = 0;
  const batchSize = 100;

  Logger.log('メール検索中...\n');

  // 全ラベル付きメールを検索
  while (true) {
    const threads = label.getThreads(start, batchSize);

    if (threads.length === 0) {
      break;
    }

    threads.forEach(thread => {
      const messages = thread.getMessages();

      messages.forEach(message => {
        const body = message.getPlainBody();

        // 直井 桃花様のメールのみ抽出
        if (body.includes('直井 桃花')) {
          const bookingInfo = parseEmailBody(body);

          if (bookingInfo) {
            allReservations.push({
              messageId: message.getId(),
              date: message.getDate(),
              subject: message.getSubject(),
              reservationDate: bookingInfo.date,
              startTime: bookingInfo.start_time,
              endTime: bookingInfo.end_time,
              customerName: bookingInfo.customer_name,
              store: bookingInfo.store,
              actionType: bookingInfo.action_type,
              isCancellation: bookingInfo.action_type === 'cancellation',
              body: body
            });
          }
        }
      });
    });

    if (threads.length < batchSize) {
      break;
    }

    start += batchSize;
    Utilities.sleep(500);
  }

  Logger.log(`【検出件数】 ${allReservations.length}件\n`);

  // 12月1日の予約のみフィルター
  const dec01 = allReservations.filter(r => r.reservationDate === '2025-12-01');

  Logger.log('='.repeat(80));
  Logger.log('【12月1日の予約・キャンセル一覧】');
  Logger.log('='.repeat(80));

  if (dec01.length === 0) {
    Logger.log('12月1日の予約は見つかりませんでした');
  } else {
    // 時間順にソート
    dec01.sort((a, b) => {
      if (a.startTime < b.startTime) return -1;
      if (a.startTime > b.startTime) return 1;
      return 0;
    });

    dec01.forEach((r, index) => {
      Logger.log(`\n[${index + 1}] ${r.isCancellation ? '❌ キャンセル' : '✅ 予約'}`);
      Logger.log(`メール受信日時: ${r.date}`);
      Logger.log(`メールID: ${r.messageId}`);
      Logger.log(`予約日: ${r.reservationDate}`);
      Logger.log(`時間: ${r.startTime} - ${r.endTime}`);
      Logger.log(`店舗: ${r.store}`);
      Logger.log(`action_type: ${r.actionType}`);

      // メール本文の一部を表示
      const bodyPreview = r.body.substring(0, 300).replace(/\n/g, ' ');
      Logger.log(`本文プレビュー: ${bodyPreview}...`);
    });
  }

  // 全予約も表示（参考用）
  Logger.log('\n' + '='.repeat(80));
  Logger.log('【全期間の予約・キャンセル】');
  Logger.log('='.repeat(80));

  allReservations.sort((a, b) => {
    if (a.reservationDate < b.reservationDate) return -1;
    if (a.reservationDate > b.reservationDate) return 1;
    if (a.startTime < b.startTime) return -1;
    if (a.startTime > b.startTime) return 1;
    return 0;
  });

  allReservations.forEach((r, index) => {
    Logger.log(`[${index + 1}] ${r.isCancellation ? 'キャンセル' : '予約'} | ${r.reservationDate} ${r.startTime}-${r.endTime} | メール: ${r.date.toISOString().substring(0, 16)}`);
  });

  Logger.log('\n' + '='.repeat(80));
  Logger.log('【分析】');
  Logger.log('='.repeat(80));

  // 重複チェック
  const duplicates = {};
  allReservations.forEach(r => {
    const key = `${r.reservationDate}_${r.startTime}_${r.endTime}`;
    if (!duplicates[key]) {
      duplicates[key] = [];
    }
    duplicates[key].push(r);
  });

  Logger.log('\n【重複・複数メール】');
  Object.keys(duplicates).forEach(key => {
    const items = duplicates[key];
    if (items.length > 1) {
      Logger.log(`\n${key}:`);
      items.forEach((item, idx) => {
        Logger.log(`  [${idx + 1}] ${item.isCancellation ? 'キャンセル' : '予約'} (${item.messageId}) - ${item.date.toISOString()}`);
      });
    }
  });

  Logger.log('\n' + '='.repeat(80));
}

/**
 * 【特定メールの詳細確認】
 * メールIDを指定して詳細を確認
 */
function checkSpecificEmail(emailId) {
  Logger.log('='.repeat(80));
  Logger.log(`【メール詳細】 ID: ${emailId}`);
  Logger.log('='.repeat(80));

  try {
    const message = GmailApp.getMessageById(emailId);

    if (!message) {
      Logger.log('メールが見つかりません');
      return;
    }

    const body = message.getPlainBody();
    const bookingInfo = parseEmailBody(body);

    Logger.log(`件名: ${message.getSubject()}`);
    Logger.log(`受信日時: ${message.getDate()}`);
    Logger.log(`\n【本文】`);
    Logger.log(body);
    Logger.log(`\n【パース結果】`);
    Logger.log(JSON.stringify(bookingInfo, null, 2));

    Logger.log('='.repeat(80));
  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
  }
}
