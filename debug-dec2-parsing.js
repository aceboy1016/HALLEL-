/**
 * 12/2の3人のメールが正しく解析されているかテスト
 */
function debugDec2Parsing() {
  Logger.log('='.repeat(80));
  Logger.log('【12/2メール解析テスト】');
  Logger.log('='.repeat(80));

  // テストメール本文（下山様のキャンセルメール）
  const testBody = `hallel 予約キャンセル

下山 晴太 様

以下の予約をキャンセルいたしました。

--------------------------------------------------------------------

日時：2025年12月02日(火) 10:00~11:00

店舗： HALLEL 渋谷店

ルーム： 【STUDIO】利用 60分

設備： 渋谷店 STUDIO ④ (1)

スタッフ：

プログラム：【STUDIO】利用 60分

--------------------------------------------------------------------`;

  Logger.log('テストメール本文:');
  Logger.log(testBody);
  Logger.log('\n' + '='.repeat(80));

  const result = parseEmailBody(testBody);

  if (result) {
    Logger.log('✅ 解析成功！');
    Logger.log(`店舗: ${result.store}`);
    Logger.log(`顧客名: ${result.customer_name}`);
    Logger.log(`日付: ${result.date}`);
    Logger.log(`開始時刻: ${result.start_time}`);
    Logger.log(`終了時刻: ${result.end_time}`);
    Logger.log(`アクション: ${result.action_type}`);
    Logger.log('');

    if (result.action_type === 'cancellation') {
      Logger.log('🔴 キャンセルとして正しく認識されました');
      Logger.log('→ processLatestReservationsOnly() では送信されません');
    } else {
      Logger.log('🟢 予約として認識されました');
      Logger.log('→ processLatestReservationsOnly() で送信されます');
    }
  } else {
    Logger.log('❌ 解析失敗！parseEmailBody() が null を返しました');
  }

  Logger.log('\n' + '='.repeat(80));

  // 実際のGmailから下山様のメールを検索
  Logger.log('実際のGmailから下山様のメールを検索中...\n');

  const query = 'from:noreply@em.hacomono.jp "下山 晴太" "2025年12月02日"';
  const threads = GmailApp.search(query, 0, 5);

  Logger.log(`検索結果: ${threads.length}件のスレッド\n`);

  threads.forEach((thread, idx) => {
    const messages = thread.getMessages();
    Logger.log(`スレッド ${idx + 1}:`);

    messages.forEach((message, msgIdx) => {
      const subject = message.getSubject();
      const date = message.getDate();
      const body = message.getPlainBody();
      const labels = message.getThread().getLabels().map(l => l.getName()).join(', ');

      Logger.log(`  メッセージ ${msgIdx + 1}:`);
      Logger.log(`    日時: ${Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')}`);
      Logger.log(`    件名: ${subject}`);
      Logger.log(`    ラベル: ${labels || '(なし)'}`);

      const parsed = parseEmailBody(body);
      if (parsed) {
        Logger.log(`    解析結果: ${parsed.action_type} - ${parsed.date} ${parsed.start_time}-${parsed.end_time}`);
      } else {
        Logger.log(`    解析結果: ❌ 解析失敗`);
      }
      Logger.log('');
    });
  });

  Logger.log('='.repeat(80));
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
