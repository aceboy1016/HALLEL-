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
    { name: '下山 晴太', searchName: '下山', date: '2025-12-02', altDate: '12/02', start: '10:00', end: '11:00' },
    { name: '直井 桃花', searchName: '直井', date: '2025-12-02', altDate: '12/02', start: '11:30', end: '12:30' },
    { name: '戸田 淳也', searchName: '戸田', date: '2025-12-02', altDate: '12/02', start: '15:00', end: '16:30' }
  ];

  targets.forEach(target => {
    Logger.log(`\n${'='.repeat(80)}`);
    Logger.log(`顧客: ${target.name} | ${target.date} ${target.start}-${target.end}`);
    Logger.log('='.repeat(80));

    // まずラベルなしで全メール検索
    const query = `from:noreply@coubic.com "${target.searchName}"`;
    const threads = GmailApp.search(query, 0, 50);

    Logger.log(`全Gmail検索: ${threads.length}件のスレッド\n`);

    const allMessages = [];

    threads.forEach(thread => {
      const messages = thread.getMessages();
      messages.forEach(message => {
        const subject = message.getSubject();
        const body = message.getPlainBody();
        const date = message.getDate();

        // 12/2または2025-12-02を含むメールを探す
        if (body.includes(target.date) || body.includes(target.altDate) || body.includes('12月02日') || body.includes('12月2日')) {
          // この時間枠の予約かチェック
          if (body.includes(target.start)) {
            const isCancellation = subject.includes('キャンセル');
            const labels = message.getThread().getLabels().map(l => l.getName()).join(', ');

            allMessages.push({
              date: date,
              subject: subject,
              isCancellation: isCancellation,
              labels: labels || '(ラベルなし)',
              bodySnippet: body.substring(0, 300).replace(/\n/g, ' ')
            });
          }
        }
      });
    });

    // 日付順にソート
    allMessages.sort((a, b) => a.date - b.date);

    if (allMessages.length === 0) {
      Logger.log('⚠️ この時間枠のメールが見つかりません');
      Logger.log('→ メールが届いていないか、顧客名/日付が異なる可能性があります\n');
      return;
    }

    Logger.log(`見つかったメール: ${allMessages.length}件\n`);

    allMessages.forEach((msg, index) => {
      const type = msg.isCancellation ? '❌ キャンセル' : '✅ 予約';
      Logger.log(`[${index + 1}] ${Utilities.formatDate(msg.date, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')}`);
      Logger.log(`    ${type} - ${msg.subject}`);
      Logger.log(`    ラベル: ${msg.labels}`);
      Logger.log(`    本文抜粋: ${msg.bodySnippet.substring(0, 150)}...`);
      Logger.log('');
    });

    const latest = allMessages[allMessages.length - 1];
    Logger.log('【最新メール】');
    if (latest.isCancellation) {
      Logger.log('🔴 最新 = キャンセル → サイトに表示されるべきではない');
      if (!latest.labels.includes('HALLEL/Processed')) {
        Logger.log('⚠️ このメールにHALLEL/Processedラベルが付いていません！');
      }
    } else {
      Logger.log('🟢 最新 = 予約 → サイトに表示されるべき');
    }
    Logger.log('');
  });

  Logger.log('\n' + '='.repeat(80));
  Logger.log('調査完了');
  Logger.log('='.repeat(80));
}
