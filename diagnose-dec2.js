/**
 * 12/2の予約状況を詳細診断
 */
function diagnoseDec2() {
  Logger.log('='.repeat(80));
  Logger.log('【12/2 予約診断】渋谷店');
  Logger.log('='.repeat(80));

  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    Logger.log('❌ HALLEL/Processedラベルが見つかりません');
    return;
  }

  // 12/2のメールを検索
  const threads = label.getThreads();
  const dec2Reservations = [];

  Logger.log('全メールから12/2の予約を検索中...\n');

  threads.forEach(thread => {
    const messages = thread.getMessages();

    messages.forEach(message => {
      const body = message.getPlainBody();
      const bookingInfo = parseEmailBody(body);

      if (bookingInfo && bookingInfo.date === '2025-12-02' && bookingInfo.store === 'shibuya') {
        dec2Reservations.push({
          emailDate: message.getDate(),
          subject: message.getSubject(),
          customer: bookingInfo.customer_name,
          start: bookingInfo.start_time,
          end: bookingInfo.end_time,
          type: bookingInfo.action_type,
          messageId: message.getId()
        });
      }
    });
  });

  // 時刻順にソート
  dec2Reservations.sort((a, b) => {
    if (a.start !== b.start) return a.start.localeCompare(b.start);
    return a.emailDate - b.emailDate;
  });

  Logger.log(`12/2の予約メール: ${dec2Reservations.length}件\n`);
  Logger.log('='.repeat(80));

  // 時間枠ごとにグループ化
  const bySlot = {};
  dec2Reservations.forEach(res => {
    const key = `${res.start}-${res.end} ${res.customer}`;
    if (!bySlot[key]) {
      bySlot[key] = [];
    }
    bySlot[key].push(res);
  });

  Logger.log(`時間枠の数: ${Object.keys(bySlot).length}件\n`);

  Object.keys(bySlot).sort().forEach(key => {
    const slots = bySlot[key];
    Logger.log(`【${key}】 ${slots.length}件`);

    slots.forEach((slot, index) => {
      const type = slot.type === 'cancellation' ? '❌ キャンセル' : '✅ 予約';
      Logger.log(`  [${index + 1}] ${Utilities.formatDate(slot.emailDate, 'Asia/Tokyo', 'MM/dd HH:mm')} ${type}`);
    });

    const latest = slots[slots.length - 1];
    if (latest.type === 'cancellation') {
      Logger.log(`  → 最新: キャンセル（サイトに表示されるべきでない）`);
    } else {
      Logger.log(`  → 最新: 予約（サイトに表示される）`);
    }
    Logger.log('');
  });

  // 最新状態の集計
  let shouldShow = 0;
  let shouldNotShow = 0;

  Object.keys(bySlot).forEach(key => {
    const slots = bySlot[key];
    const latest = slots[slots.length - 1];

    if (latest.type === 'cancellation') {
      shouldNotShow++;
    } else {
      shouldShow++;
    }
  });

  Logger.log('='.repeat(80));
  Logger.log('【最新状態の集計】');
  Logger.log(`表示されるべき予約: ${shouldShow}件`);
  Logger.log(`表示されるべきでない（キャンセル済み）: ${shouldNotShow}件`);
  Logger.log(`合計: ${shouldShow + shouldNotShow}件`);
  Logger.log('='.repeat(80));

  if (shouldShow === 45) {
    Logger.log('\n✅ 正解！45件です');
  } else {
    Logger.log(`\n⚠️ 現在${shouldShow}件（正解は45件）`);
  }
}

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

function formatTime(time) {
  const parts = time.split(':');
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1].padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseEmailBody(body) {
  const store = extractStore(body);

  if (!store) {
    return null;
  }

  const customerName = extractCustomerName(body);
  const isCancellation = body.includes('キャンセル') || body.includes('cancel');

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
