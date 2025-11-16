/**
 * HALLEL半蔵門店 - Google Calendar同期スクリプト
 *
 * Gmail予約メールをGoogle Calendarに自動同期
 * カレンダーID: light@topform.jp
 */

function manageHallelReservations() {
  const calendarId = 'light@topform.jp';
  const labelName = "Processed";
  const label = GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);

  // noreply@em.hacomono.jpからのメールを受信日時順に取得
  const threads = GmailApp.search('from:noreply@em.hacomono.jp -label:Processed');
  threads.sort((a, b) => a.getLastMessageDate() - b.getLastMessageDate()); // 受信日時が古い順にソート

  for (let thread of threads) {
    const messages = thread.getMessages();
    for (let message of messages) {
      const subject = message.getSubject();
      if (subject.includes("hallel 予約完了メール")) {
        handleReservationComplete(message, calendarId);
      } else if (subject.includes("hallel 予約キャンセル")) {
        handleReservationCancel(message, calendarId);
      }
      // スレッドに「Processed」ラベルを追加
      thread.addLabel(label);
    }
  }
}

function handleReservationComplete(message, calendarId) {
  const body = message.getBody();
  const fullName = extractFullName(body);
  const eventTime = extractEventTime(body);
  const eventTitle = `${fullName} - HALLEL`;

  // 開始時刻と終了時刻が正しいか確認
  if (eventTime.startTime && eventTime.endTime && eventTime.startTime < eventTime.endTime) {
    const calendar = CalendarApp.getCalendarById(calendarId);

    // 既存のイベントを削除
    const existingEvents = calendar.getEvents(eventTime.startTime, eventTime.endTime, { search: fullName });
    for (let event of existingEvents) {
      if (event.getTitle().includes(fullName)) {
        event.deleteEvent();
      }
    }

    // 新しいイベントを作成
    calendar.createEvent(eventTitle, eventTime.startTime, eventTime.endTime);
  } else {
    Logger.log(`Invalid event time for: ${fullName}`);
  }
}

function handleReservationCancel(message, calendarId) {
  const body = message.getBody();
  const fullName = extractFullName(body);
  const eventTime = extractEventTime(body);

  // 開始時刻と終了時刻が正しいか確認
  if (eventTime.startTime && eventTime.endTime && eventTime.startTime < eventTime.endTime) {
    const calendar = CalendarApp.getCalendarById(calendarId);
    const events = calendar.getEvents(eventTime.startTime, eventTime.endTime, { search: fullName });

    // 予約をキャンセルするイベントを削除
    for (let event of events) {
      if (event.getTitle().includes(fullName)) {
        event.deleteEvent();
      }
    }
  } else {
    Logger.log(`Invalid event time for: ${fullName}`);
  }
}

function extractFullName(body) {
  const nameMatch = body.match(/([^\s]+ [^\s]+) 様/);
  return nameMatch ? nameMatch[1] : "Unknown";
}

function extractEventTime(body) {
  const dateTimeMatch = body.match(/日時：(\d{4}年\d{2}月\d{2}日).+(\d{2}:\d{2})~(\d{2}:\d{2})/);
  if (dateTimeMatch) {
    const startDate = new Date(`${dateTimeMatch[1].replace(/年|月/g, '/').replace(/日/, '')} ${dateTimeMatch[2]}`);
    const endDate = new Date(`${dateTimeMatch[1].replace(/年|月/g, '/').replace(/日/, '')} ${dateTimeMatch[3]}`);
    return { startTime: startDate, endTime: endDate };
  }
  return { startTime: null, endTime: null };
}
