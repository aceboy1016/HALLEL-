/**
 * 12/2のキャンセルされていない予約を調査
 * - 下山 晴太　10:00 - 11:00
 * - 直井 桃花　11:30 - 12:30
 * - 戸田 淳也　15:00 - 16:30
 */
function investigateDec2Reservations() {
  Logger.log('='.repeat(80));
  Logger.log('【12/2 キャンセル未反映予約の調査】');
  Logger.log('='.repeat(80));
  Logger.log('');

  const targets = [
    { name: '下山 晴太', date: '2025-12-02', start: '10:00', end: '11:00' },
    { name: '直井 桃花', date: '2025-12-02', start: '11:30', end: '12:30' },
    { name: '戸田 淳也', date: '2025-12-02', start: '15:00', end: '16:30' }
  ];

  const label = GmailApp.getUserLabelByName('HALLEL/Processed');
  if (!label) {
    Logger.log('❌ HALLEL/Processedラベルが見つかりません');
    return;
  }

  targets.forEach(target => {
    Logger.log(`\n${'='.repeat(80)}`);
    Logger.log(`顧客: ${target.name} | ${target.date} ${target.start}-${target.end}`);
    Logger.log('='.repeat(80));

    const query = `label:HALLEL/Processed "${target.name}" "${target.date}"`;
    const threads = GmailApp.search(query);

    Logger.log(`検索結果: ${threads.length}件のスレッド\n`);

    const allMessages = [];

    threads.forEach(thread => {
      const messages = thread.getMessages();
      messages.forEach(message => {
        const subject = message.getSubject();
        const body = message.getPlainBody();
        const date = message.getDate();

        // この時間枠の予約かチェック
        if (body.includes(target.start) && body.includes(target.end)) {
          const isCancellation = subject.includes('キャンセル');

          allMessages.push({
            date: date,
            subject: subject,
            isCancellation: isCancellation,
            snippet: body.substring(0, 200)
          });
        }
      });
    });

    // 日付順にソート
    allMessages.sort((a, b) => a.date - b.date);

    if (allMessages.length === 0) {
      Logger.log('⚠️ この時間枠のメールが見つかりません\n');
      return;
    }

    Logger.log(`見つかったメール: ${allMessages.length}件\n`);

    allMessages.forEach((msg, index) => {
      const type = msg.isCancellation ? '❌ キャンセル' : '✅ 予約';
      Logger.log(`[${index + 1}] ${Utilities.formatDate(msg.date, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')}`);
      Logger.log(`    ${type} - ${msg.subject}`);
    });

    const latest = allMessages[allMessages.length - 1];
    Logger.log('\n【最新メール】');
    if (latest.isCancellation) {
      Logger.log('🔴 最新 = キャンセル → サイトに表示されるべきではない');
    } else {
      Logger.log('🟢 最新 = 予約 → サイトに表示されるべき');
    }
    Logger.log('');
  });

  Logger.log('\n' + '='.repeat(80));
  Logger.log('調査完了');
  Logger.log('='.repeat(80));
}
