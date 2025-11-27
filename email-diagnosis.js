/**
 * 【診断】実際のメール本文を調査して問題を特定
 *
 * 1. 実際のメールを取得
 * 2. 本文を表示
 * 3. parseEmailBody()でパースしてみる
 * 4. どこが失敗しているか特定
 */
function diagnoseActualEmails() {
  Logger.log('='.repeat(80));
  Logger.log('【メール本文診断】実際のメールを調査');
  Logger.log('='.repeat(80));

  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - 180);
  const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  // HALLEL関連メールを検索（ラベルが付いていないメールのみ）
  const query = `from:noreply@em.hacomono.jp after:${dateStr} subject:hallel -label:HALLEL/Processed`;
  Logger.log(`検索クエリ: ${query}\n`);

  const threads = GmailApp.search(query, 0, 5); // 最初の5件だけ
  Logger.log(`検索結果: ${threads.length}件\n`);

  threads.forEach((thread, index) => {
    const message = thread.getMessages()[0];
    const subject = message.getSubject();
    const body = message.getPlainBody();
    const date = message.getDate();

    Logger.log('='.repeat(80));
    Logger.log(`【メール ${index + 1}】`);
    Logger.log(`件名: ${subject}`);
    Logger.log(`送信日時: ${date}`);
    Logger.log(`メールID: ${message.getId()}`);
    Logger.log('-'.repeat(80));
    Logger.log('【本文】');
    Logger.log(body.substring(0, 1000)); // 最初の1000文字
    Logger.log('-'.repeat(80));

    // 店舗を抽出してみる
    const storeResult = extractStoreDebug(body);
    Logger.log(`店舗抽出: ${storeResult}`);

    // 顧客名を抽出してみる
    const customerResult = extractCustomerNameDebug(body);
    Logger.log(`顧客名抽出: ${customerResult}`);

    // 日時を抽出してみる
    const dateTimeResult = extractDateTimeDebug(body);
    Logger.log(`日時抽出: ${dateTimeResult}`);

    // parseEmailBody()で解析
    Logger.log('-'.repeat(80));
    const bookingInfo = parseEmailBody(body);
    if (bookingInfo) {
      Logger.log('【parseEmailBody() 成功】');
      Logger.log(JSON.stringify(bookingInfo, null, 2));
    } else {
      Logger.log('【parseEmailBody() 失敗】');
      Logger.log('⚠️ このメールは解析できませんでした');
    }
    Logger.log('='.repeat(80));
    Logger.log('\n');
  });
}

/**
 * デバッグ用：店舗抽出
 */
function extractStoreDebug(body) {
  const storeMap = {
    '恵比寿店': 'ebisu',
    '半蔵門店': 'hanzomon',
    '代々木上原店': 'yoyogi-uehara',
    '中目黒店': 'nakameguro',
    '渋谷店': 'shibuya'
  };

  for (const [storeName, storeId] of Object.entries(storeMap)) {
    if (body.includes(storeName)) {
      return `"${storeName}" → ${storeId}`;
    }
  }

  return 'なし（HALLEL店舗が見つかりません）';
}

/**
 * デバッグ用：顧客名抽出
 */
function extractCustomerNameDebug(body) {
  // パターン1: [顧客名]様
  const pattern1 = /^(.+?)様/m;
  const match1 = body.match(pattern1);
  if (match1) {
    return `パターン1: "${match1[1]}"`;
  }

  // パターン2: お客様名：[顧客名]
  const pattern2 = /お客様名[：:]\s*(.+?)[\n\r]/;
  const match2 = body.match(pattern2);
  if (match2) {
    return `パターン2: "${match2[1]}"`;
  }

  return 'なし';
}

/**
 * デバッグ用：日時抽出
 */
function extractDateTimeDebug(body) {
  // Hacomonoメール形式: 日時：2025年12月31日(水) 02:00~03:00
  const hacomonoPattern = /日時[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^)]*\)\s*(\d{1,2}:\d{2})[~〜～](\d{1,2}:\d{2})/;
  const hacomonoMatch = body.match(hacomonoPattern);

  if (hacomonoMatch) {
    const [, year, month, day, startTime, endTime] = hacomonoMatch;
    return `Hacomono形式: ${year}年${month}月${day}日 ${startTime}~${endTime}`;
  }

  // 旧形式: 予約: 2025-08-05 14:00-15:30
  const bookingPattern = /予約[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-~〜ー]\s*(\d{1,2}:\d{2})/;
  const bookingMatch = body.match(bookingPattern);

  if (bookingMatch) {
    return `旧形式: ${bookingMatch[1]} ${bookingMatch[2]}-${bookingMatch[3]}`;
  }

  // キャンセルパターン
  const cancelPattern = /キャンセル[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/;
  const cancelMatch = body.match(cancelPattern);

  if (cancelMatch) {
    return `キャンセル形式: ${cancelMatch[1]} ${cancelMatch[2]}`;
  }

  return 'なし（日時パターンにマッチしません）';
}

/**
 * 【診断】ラベルが付いているメールを調査
 */
function diagnoseLabeledEmails() {
  Logger.log('='.repeat(80));
  Logger.log('【ラベル付きメール診断】');
  Logger.log('='.repeat(80));

  const label = GmailApp.getUserLabelByName('HALLEL/Processed');

  if (!label) {
    Logger.log('ラベルが存在しません。');
    return;
  }

  const threads = label.getThreads(0, 10); // 最初の10件

  Logger.log(`ラベル付きメール: ${threads.length}件\n`);

  threads.forEach((thread, index) => {
    const message = thread.getMessages()[0];
    const subject = message.getSubject();
    const body = message.getPlainBody();

    Logger.log('='.repeat(80));
    Logger.log(`【ラベル付きメール ${index + 1}】`);
    Logger.log(`件名: ${subject}`);
    Logger.log(`送信日時: ${message.getDate()}`);
    Logger.log('-'.repeat(80));

    // parseEmailBody()で解析
    const bookingInfo = parseEmailBody(body);

    if (bookingInfo) {
      Logger.log('【解析成功】');
      Logger.log(`店舗: ${bookingInfo.store}`);
      Logger.log(`顧客: ${bookingInfo.customer_name}`);
      Logger.log(`日付: ${bookingInfo.date}`);
      Logger.log(`時間: ${bookingInfo.start_time} - ${bookingInfo.end_time}`);
      Logger.log(`タイプ: ${bookingInfo.action_type}`);
    } else {
      Logger.log('【解析失敗】');
      Logger.log('⚠️ このメールは解析できません（HALLEL関連外の可能性）');
      Logger.log('\n本文プレビュー:');
      Logger.log(body.substring(0, 500));
    }
    Logger.log('='.repeat(80));
    Logger.log('\n');
  });
}

/**
 * 【診断】特定のメールIDを詳しく調査
 */
function diagnoseSpecificEmail(emailId) {
  if (!emailId) {
    Logger.log('使い方: diagnoseSpecificEmail("メールID")');
    return;
  }

  Logger.log('='.repeat(80));
  Logger.log('【特定メール詳細診断】');
  Logger.log('='.repeat(80));

  try {
    const message = GmailApp.getMessageById(emailId);
    const body = message.getPlainBody();

    Logger.log(`件名: ${message.getSubject()}`);
    Logger.log(`送信日時: ${message.getDate()}`);
    Logger.log(`送信元: ${message.getFrom()}`);
    Logger.log('='.repeat(80));
    Logger.log('【完全な本文】');
    Logger.log(body);
    Logger.log('='.repeat(80));

    // 解析
    const bookingInfo = parseEmailBody(body);
    if (bookingInfo) {
      Logger.log('\n【解析結果】');
      Logger.log(JSON.stringify(bookingInfo, null, 2));

      // API送信をテスト
      Logger.log('\n【API送信テスト】');
      bookingInfo.email_id = emailId;
      bookingInfo.email_subject = message.getSubject();
      bookingInfo.email_date = message.getDate().toISOString();

      const result = sendToFlaskAPI(bookingInfo);
      Logger.log(`送信結果: ${result.success ? '成功' : '失敗'}`);
      if (!result.success) {
        Logger.log(`エラー: ${result.error}`);
      } else {
        Logger.log('レスポンス:');
        Logger.log(JSON.stringify(result.data, null, 2));
      }
    } else {
      Logger.log('\n【解析失敗】');
    }

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
  }
}
