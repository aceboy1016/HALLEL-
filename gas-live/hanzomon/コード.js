/**
 * HALLEL半蔵門店 - Google Calendar同期スクリプト（部屋名対応版）
 *
 * 更新内容:
 * - メール本文から「STUDIO B ①」「STUDIO B ②」「STUDIO B ③」を抽出（新形式）
 * - 旧形式「個室A」「個室B」にも互換対応
 * - カレンダーに「{顧客名} - HALLEL-{部屋名}」として表示
 * - 重複予約の自動削除
 */

function manageHallelReservations() {
  const calendarId = 'light@topform.jp';
  const labelName = "Processed";
  const label = GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);

  // noreply@em.hacomono.jpからのメールを受信日時順に取得
  const threads = GmailApp.search('from:noreply@em.hacomono.jp -label:Processed');
  threads.sort((a, b) => a.getLastMessageDate() - b.getLastMessageDate()); // 受信日時が古い順にソート

  Logger.log(`📧 未処理メール: ${threads.length}件`);

  for (let thread of threads) {
    const messages = thread.getMessages();
    for (let message of messages) {
      const subject = message.getSubject();
      const body = message.getPlainBody(); // HTMLではなくプレーンテキストを取得

      if (subject.includes("hallel 予約完了メール")) {
        handleReservationComplete(message, calendarId, body);
      } else if (subject.includes("hallel 予約キャンセル")) {
        handleReservationCancel(message, calendarId, body);
      }
      // スレッドに「Processed」ラベルを追加
      thread.addLabel(label);
    }
  }

  // HALLEL予定に付いた不要なゲストを外す（新着メールの有無に関係なく毎回実行）
  try {
    removeUnwantedGuests(calendarId);
  } catch (e) {
    Logger.log(`❌ ゲスト削除エラー: ${e.message}`);
  }

  Logger.log('✅ 処理完了');
}

/**
 * HALLEL予定から外すゲスト
 * （j.ishiharaのアカウントで作成・編集するとGoogleが自動でゲストに追加し、
 *   j.ishihara@topform.jp のカレンダーにも表示されてしまうため）
 */
const REMOVE_GUESTS = ['j.ishihara@topform.jp'];

/**
 * HALLEL予定から REMOVE_GUESTS のゲストを外す（7日前〜90日後）
 */
function removeUnwantedGuests(calendarId) {
  const calendar = CalendarApp.getCalendarById(calendarId || 'light@topform.jp');
  const now = new Date();
  const events = calendar.getEvents(
    new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
  );

  let removedCount = 0;
  for (let event of events) {
    if (!event.getTitle().includes('HALLEL')) continue;

    for (let guest of event.getGuestList()) {
      const email = guest.getEmail().toLowerCase();
      if (REMOVE_GUESTS.includes(email)) {
        event.removeGuest(email);
        removedCount++;
        Logger.log(`👤 ゲスト削除: ${event.getTitle()} [${formatDateTime(event.getStartTime())}] - ${email}`);
      }
    }
  }

  if (removedCount > 0) {
    Logger.log(`✅ ゲスト削除: ${removedCount}件`);
  }
}

/**
 * 予約完了処理（部屋名対応版）
 */
function handleReservationComplete(message, calendarId, body) {
  const fullName = extractFullName(body);
  const eventTime = extractEventTime(body);
  const studio = extractStudio(body); // 部屋名を抽出
  const eventTitle = `${fullName} - HALLEL-${studio}`; // 部屋名を含める

  // 開始時刻と終了時刻が正しいか確認
  if (eventTime.startTime && eventTime.endTime && eventTime.startTime < eventTime.endTime) {
    const calendar = CalendarApp.getCalendarById(calendarId);

    // 同じ人の同じ時間帯の既存イベントを全て削除（部屋名が違っても削除）
    removeDuplicateReservation(calendar, fullName, eventTime);

    // 新しいイベントを作成
    calendar.createEvent(eventTitle, eventTime.startTime, eventTime.endTime);
    Logger.log(`✅ 予約完了: ${fullName} (${studio}) ${formatDateTime(eventTime.startTime)} - ${formatTime(eventTime.endTime)}`);
  } else {
    Logger.log(`❌ 無効な時間: ${fullName}`);
  }
}

/**
 * 予約キャンセル処理（部屋名対応版）
 */
function handleReservationCancel(message, calendarId, body) {
  const fullName = extractFullName(body);
  const eventTime = extractEventTime(body);

  // 開始時刻と終了時刻が正しいか確認
  if (eventTime.startTime && eventTime.endTime && eventTime.startTime < eventTime.endTime) {
    const calendar = CalendarApp.getCalendarById(calendarId);

    // 時間範囲を少し広げて検索（±5分）
    const searchStart = new Date(eventTime.startTime.getTime() - 5 * 60000);
    const searchEnd = new Date(eventTime.endTime.getTime() + 5 * 60000);

    const events = calendar.getEvents(searchStart, searchEnd);
    let deletedCount = 0;

    // 予約をキャンセルするイベントを削除（部屋名に関わらず）
    for (let event of events) {
      const eventTitle = event.getTitle();
      const eventStart = event.getStartTime();
      const eventEnd = event.getEndTime();

      // 名前が一致し、HALLELイベントであるかチェック
      const nameMatch = eventTitle.includes(fullName);
      const isHallelEvent = eventTitle.includes('HALLEL-');

      // 時間の一致（±1分の許容範囲）
      const startMatch = Math.abs(eventStart.getTime() - eventTime.startTime.getTime()) < 60000;
      const endMatch = Math.abs(eventEnd.getTime() - eventTime.endTime.getTime()) < 60000;

      if (nameMatch && isHallelEvent && startMatch && endMatch) {
        Logger.log(`🗑️ キャンセル削除: ${eventTitle} [${formatDateTime(eventStart)}]`);
        event.deleteEvent();
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      Logger.log(`✅ キャンセル完了: ${fullName} - ${deletedCount}件削除`);
    } else {
      Logger.log(`⚠️ キャンセル対象が見つかりません: ${fullName}`);
    }
  } else {
    Logger.log(`❌ 無効な時間: ${fullName}`);
  }
}

/**
 * 重複予約を削除（部屋名に関わらず、同じ人・同じ時間の予約を全て削除）
 */
function removeDuplicateReservation(calendar, fullName, eventTime) {
  // 時間範囲を少し広げて検索（±1分）
  const searchStart = new Date(eventTime.startTime.getTime() - 60000);
  const searchEnd = new Date(eventTime.endTime.getTime() + 60000);

  const events = calendar.getEvents(searchStart, searchEnd);

  for (let event of events) {
    const eventTitle = event.getTitle();
    const eventStart = event.getStartTime();
    const eventEnd = event.getEndTime();

    // 名前が一致し、HALLELイベントであるかチェック
    const nameMatch = eventTitle.includes(fullName);
    const isHallelEvent = eventTitle.includes('HALLEL-');

    // 時間の一致（±1分の許容範囲）
    const startMatch = Math.abs(eventStart.getTime() - eventTime.startTime.getTime()) < 60000;
    const endMatch = Math.abs(eventEnd.getTime() - eventTime.endTime.getTime()) < 60000;

    if (nameMatch && isHallelEvent && startMatch && endMatch) {
      Logger.log(`🔄 重複削除: ${eventTitle} [${formatDateTime(eventStart)}]`);
      event.deleteEvent();
    }
  }
}

/**
 * 顧客名を抽出
 */
function extractFullName(body) {
  const nameMatch = body.match(/(.+?) 様/);
  return nameMatch ? nameMatch[1].trim() : 'Unknown';
}

/**
 * 日時を抽出
 */
function extractEventTime(body) {
  // "日時：2025年01月15日（水）13:00~14:00" のような形式に対応
  const match = body.match(/日時[：:]\s*([\d]{4}年[\d]{1,2}月[\d]{1,2}日)[^\d]*(\d{1,2}:\d{2})\s*[〜～~-]\s*(\d{1,2}:\d{2})/);

  if (match) {
    const dateStr = match[1].replace(/年/g, '/').replace(/月/g, '/').replace(/日/g, '');
    const start = new Date(`${dateStr} ${match[2]}`);
    const end = new Date(`${dateStr} ${match[3]}`);

    // 日付が有効かチェック
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      Logger.log(`❌ 無効な日付: ${dateStr} ${match[2]} - ${match[3]}`);
      return { startTime: null, endTime: null };
    }

    return { startTime: start, endTime: end };
  }

  Logger.log(`❌ 日時の抽出失敗`);
  return { startTime: null, endTime: null };
}

/**
 * 部屋名を抽出
 *
 * 対応パターン:
 * - 半蔵門店（新形式）: 「STUDIO B ①」「STUDIO B ②」「STUDIO B ③」
 * - 半蔵門店（旧形式）: 「個室A」「個室B」
 * - 恵比寿店: 「STUDIO A」「STUDIO B」（念のため対応）
 */
function extractStudio(body) {
  // パターン1: 「ルーム： 【STUDIO B ①】」など（半蔵門店新形式）
  const studioB123Match = body.match(/ルーム[：:]\s*【(STUDIO B [①②③])】/);
  if (studioB123Match) {
    return studioB123Match[1]; // 「STUDIO B ①」「STUDIO B ②」「STUDIO B ③」
  }

  // パターン2: 本文中に「STUDIO B ①」「STUDIO B ②」「STUDIO B ③」が含まれている
  if (body.includes('STUDIO B ①') || body.includes('STUDIO B①')) return 'STUDIO B ①';
  if (body.includes('STUDIO B ②') || body.includes('STUDIO B②')) return 'STUDIO B ②';
  if (body.includes('STUDIO B ③') || body.includes('STUDIO B③')) return 'STUDIO B ③';

  // 旧形式互換: 「ルーム： 【個室A】」
  const roomMatch1 = body.match(/ルーム[：:]\s*【(個室[AB])】/);
  if (roomMatch1) {
    return roomMatch1[1]; // 「個室A」または「個室B」
  }

  // 旧形式互換: 「ルーム： 【STUDIO A】」（恵比寿店形式）
  const roomMatch2 = body.match(/ルーム[：:]\s*【(STUDIO [AB])】/);
  if (roomMatch2) {
    // STUDIO A → 個室A、STUDIO B → 個室B に変換
    return roomMatch2[1] === 'STUDIO A' ? '個室A' : '個室B';
  }

  // 旧形式互換: 本文中に「個室A」「個室B」が含まれている
  if (body.includes('個室A')) return '個室A';
  if (body.includes('個室B')) return '個室B';

  // デフォルト
  return 'Unknown';
}

/**
 * 日時をフォーマット
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, 'JST', 'yyyy/MM/dd HH:mm');
}

/**
 * 時刻のみをフォーマット
 */
function formatTime(date) {
  return Utilities.formatDate(date, 'JST', 'HH:mm');
}

/**
 * テスト実行（最新5件のみ処理）
 */
function testHanzomonSync() {
  Logger.log('🧪 半蔵門店同期テスト開始...');

  const calendarId = 'light@topform.jp';
  const threads = GmailApp.search('from:noreply@em.hacomono.jp', 0, 5);

  Logger.log(`📧 テスト対象: ${threads.length}件`);

  for (let thread of threads) {
    const messages = thread.getMessages();
    for (let message of messages) {
      const subject = message.getSubject();
      const body = message.getPlainBody();

      Logger.log(`\n--- テストメール ---`);
      Logger.log(`件名: ${subject}`);

      if (subject.includes('予約完了')) {
        handleReservationComplete(message, calendarId, body);
      } else if (subject.includes('キャンセル')) {
        handleReservationCancel(message, calendarId, body);
      }
    }
  }

  Logger.log('\n✅ テスト完了');
}

/**
 * カレンダーの予約状況を確認
 */
function checkHanzomonReservations() {
  const calendar = CalendarApp.getCalendarById('light@topform.jp');

  // 今日から7日間の予約を取得
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const events = calendar.getEvents(now, sevenDaysLater);

  Logger.log(`📅 今後7日間の予約: ${events.length}件\n`);

  // 部屋名別の集計（新形式 STUDIO B ①〜③ 対応）
  const roomCounts = {
    'STUDIO B ①': 0,
    'STUDIO B ②': 0,
    'STUDIO B ③': 0,
    '個室A': 0,
    '個室B': 0,
    'Unknown': 0,
    '旧形式': 0
  };

  for (let event of events) {
    const title = event.getTitle();
    Logger.log(`${formatDateTime(event.getStartTime())} - ${formatTime(event.getEndTime())}: ${title}`);

    if (title.includes('HALLEL-STUDIO B ①')) roomCounts['STUDIO B ①']++;
    else if (title.includes('HALLEL-STUDIO B ②')) roomCounts['STUDIO B ②']++;
    else if (title.includes('HALLEL-STUDIO B ③')) roomCounts['STUDIO B ③']++;
    else if (title.includes('HALLEL-個室A')) roomCounts['個室A']++;
    else if (title.includes('HALLEL-個室B')) roomCounts['個室B']++;
    else if (title.includes('HALLEL-Unknown')) roomCounts['Unknown']++;
    else if (title.includes('HALLEL') && !title.includes('-')) roomCounts['旧形式']++;
  }

  Logger.log(`\n部屋名別の集計:`);
  Logger.log(`  STUDIO B ①: ${roomCounts['STUDIO B ①']}件`);
  Logger.log(`  STUDIO B ②: ${roomCounts['STUDIO B ②']}件`);
  Logger.log(`  STUDIO B ③: ${roomCounts['STUDIO B ③']}件`);
  Logger.log(`  個室A（旧形式）: ${roomCounts['個室A']}件`);
  Logger.log(`  個室B（旧形式）: ${roomCounts['個室B']}件`);
  Logger.log(`  Unknown: ${roomCounts['Unknown']}件`);
  Logger.log(`  旧形式（部屋名なし）: ${roomCounts['旧形式']}件`);

  return { totalEvents: events.length, roomCounts: roomCounts };
}