/**
 * 【広範囲調査】実際にどんなメールがあるのか調べる
 */
function investigateAllMails() {
  Logger.log('='.repeat(80));
  Logger.log('【広範囲メール調査】実際にどんなメールがあるか調べる');
  Logger.log('='.repeat(80));

  // 1. 送信元でのみ検索（subject:hallelを外す）
  Logger.log('\n【1. 送信元でのみ検索（180日）】');
  const dateLimit180 = new Date();
  dateLimit180.setDate(dateLimit180.getDate() - 180);
  const dateStr180 = Utilities.formatDate(dateLimit180, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  const query180 = `from:noreply@em.hacomono.jp after:${dateStr180}`;
  Logger.log(`クエリ: ${query180}`);

  let total180 = 0;
  let offset = 0;
  while (true) {
    const threads = GmailApp.search(query180, offset, 500);
    if (threads.length === 0) break;

    total180 += threads.length;
    offset += threads.length;

    Logger.log(`  取得中... ${total180}件`);

    if (threads.length < 500) break;
    Utilities.sleep(500);
  }

  Logger.log(`結果: ${total180}件\n`);

  // 2. 過去365日で検索
  Logger.log('【2. 送信元でのみ検索（365日）】');
  const dateLimit365 = new Date();
  dateLimit365.setDate(dateLimit365.getDate() - 365);
  const dateStr365 = Utilities.formatDate(dateLimit365, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  const query365 = `from:noreply@em.hacomono.jp after:${dateStr365}`;
  Logger.log(`クエリ: ${query365}`);

  let total365 = 0;
  offset = 0;
  while (true) {
    const threads = GmailApp.search(query365, offset, 500);
    if (threads.length === 0) break;

    total365 += threads.length;
    offset += threads.length;

    Logger.log(`  取得中... ${total365}件`);

    if (threads.length < 500) break;
    Utilities.sleep(500);
  }

  Logger.log(`結果: ${total365}件\n`);

  // 3. 日付制限なしで検索
  Logger.log('【3. 送信元でのみ検索（日付制限なし）】');
  const queryAll = `from:noreply@em.hacomono.jp`;
  Logger.log(`クエリ: ${queryAll}`);

  let totalAll = 0;
  offset = 0;
  let loopCount = 0;
  while (loopCount < 10) { // 最大5000件まで
    const threads = GmailApp.search(queryAll, offset, 500);
    if (threads.length === 0) break;

    totalAll += threads.length;
    offset += threads.length;

    Logger.log(`  取得中... ${totalAll}件`);

    if (threads.length < 500) break;
    loopCount++;
    Utilities.sleep(500);
  }

  Logger.log(`結果: ${totalAll}件${loopCount >= 10 ? '以上' : ''}\n`);

  // 4. 実際のメールの件名を調べる（最新50件）
  Logger.log('【4. 最新50件のメール件名を調査】');
  const recentThreads = GmailApp.search(`from:noreply@em.hacomono.jp`, 0, 50);
  Logger.log(`取得: ${recentThreads.length}件\n`);

  const subjectCounts = {};

  recentThreads.forEach((thread, index) => {
    const message = thread.getMessages()[0];
    const subject = message.getSubject();

    // 件名のパターンを抽出（最初の単語）
    const firstWord = subject.split(' ')[0];

    if (!subjectCounts[firstWord]) {
      subjectCounts[firstWord] = 0;
    }
    subjectCounts[firstWord]++;

    if (index < 10) {
      Logger.log(`[${index + 1}] ${subject}`);
    }
  });

  Logger.log('\n【件名パターン集計（最初の単語）】');
  const sorted = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([word, count]) => {
    Logger.log(`  "${word}": ${count}件`);
  });

  // 5. HALLELを含む件名と含まない件名を分類
  Logger.log('\n【5. HALLEL関連の判定】');
  let hallelSubject = 0;
  let noHallelSubject = 0;

  const hallelKeywords = ['hallel', 'HALLEL', 'ハレル'];
  const storeKeywords = ['渋谷店', '恵比寿店', '半蔵門店', '代々木上原店', '中目黒店'];

  recentThreads.forEach(thread => {
    const message = thread.getMessages()[0];
    const subject = message.getSubject();
    const body = message.getPlainBody();

    const hasHallelInSubject = hallelKeywords.some(kw => subject.includes(kw));
    const hasHallelInBody = storeKeywords.some(kw => body.includes(kw));

    if (hasHallelInSubject) {
      hallelSubject++;
    } else if (hasHallelInBody) {
      noHallelSubject++;
    }
  });

  Logger.log(`件名に"hallel"を含む: ${hallelSubject}件`);
  Logger.log(`件名に"hallel"なし、本文にHALLEL店舗あり: ${noHallelSubject}件`);

  // まとめ
  Logger.log('\n' + '='.repeat(80));
  Logger.log('【まとめ】');
  Logger.log(`過去180日のHacomonoメール: ${total180}件`);
  Logger.log(`過去365日のHacomonoメール: ${total365}件`);
  Logger.log(`全期間のHacomonoメール: ${totalAll}件${loopCount >= 10 ? '以上' : ''}`);
  Logger.log(`\n最新50件のうち:`);
  Logger.log(`  - 件名に"hallel"を含む: ${hallelSubject}件`);
  Logger.log(`  - 件名になし、本文にHALLEL店舗あり: ${noHallelSubject}件`);
  Logger.log('='.repeat(80));

  Logger.log('\n【推奨事項】');
  if (noHallelSubject > 0) {
    Logger.log('⚠️ 件名に"hallel"がないHALLEL関連メールが存在します');
    Logger.log('   検索クエリを変更する必要があります');
    Logger.log('   → subject:hallel を外して、本文で判定するべき');
  }

  if (total180 !== 38) {
    Logger.log(`⚠️ 過去180日に${total180}件のメールがありますが、subject:hallelでは38件しかヒットしません`);
    Logger.log('   → 件名に"hallel"が含まれないメールが多数存在します');
  }
}
