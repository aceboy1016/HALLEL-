/**
 * 【メール件数調査】全体像を把握する
 */
function countAllEmails() {
  Logger.log('='.repeat(80));
  Logger.log('【メール件数調査】全体像を把握');
  Logger.log('='.repeat(80));

  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - 180);
  const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  // 1. HALLEL関連メール全件（ラベル関係なし）
  const queryAll = `from:noreply@em.hacomono.jp after:${dateStr} subject:hallel`;
  const threadsAll = GmailApp.search(queryAll, 0, 500);

  Logger.log('\n【1. HALLEL関連メール全件】');
  Logger.log(`検索クエリ: ${queryAll}`);
  Logger.log(`結果: ${threadsAll.length}件`);
  if (threadsAll.length >= 500) {
    Logger.log('⚠️ 500件以上ある可能性があります');
  }

  // 2. ラベル付きメール
  const label = GmailApp.getUserLabelByName('HALLEL/Processed');
  let labeledCount = 0;
  if (label) {
    const labeledThreads = label.getThreads();
    labeledCount = labeledThreads.length;
    Logger.log(`\n【2. ラベル付きメール】`);
    Logger.log(`結果: ${labeledCount}件`);
  } else {
    Logger.log(`\n【2. ラベル付きメール】`);
    Logger.log(`結果: 0件（ラベルが存在しません）`);
  }

  // 3. ラベルなしメール（これから処理すべきメール）
  const queryUnlabeled = `from:noreply@em.hacomono.jp after:${dateStr} subject:hallel -label:HALLEL/Processed`;
  const threadsUnlabeled = GmailApp.search(queryUnlabeled, 0, 500);

  Logger.log(`\n【3. ラベルなしメール（処理待ち）】`);
  Logger.log(`検索クエリ: ${queryUnlabeled}`);
  Logger.log(`結果: ${threadsUnlabeled.length}件`);
  if (threadsUnlabeled.length >= 500) {
    Logger.log('⚠️ 500件以上ある可能性があります');
  }

  // 4. 計算が合っているか確認
  Logger.log('\n' + '='.repeat(80));
  Logger.log('【集計】');
  Logger.log(`HALLEL関連メール全件: ${threadsAll.length}件`);
  Logger.log(`  ├─ ラベル付き: ${labeledCount}件`);
  Logger.log(`  └─ ラベルなし: ${threadsUnlabeled.length}件`);

  const calculated = labeledCount + threadsUnlabeled.length;
  Logger.log(`\n計算: ${labeledCount} + ${threadsUnlabeled.length} = ${calculated}件`);

  if (calculated !== threadsAll.length) {
    Logger.log(`⚠️ 警告: 全件数(${threadsAll.length})と計算(${calculated})が一致しません`);
  } else {
    Logger.log(`✓ 全件数と計算が一致しています`);
  }

  // 5. 過去180日のHacomonoメール全件（HALLELに限定しない）
  const queryHacomono = `from:noreply@em.hacomono.jp after:${dateStr}`;
  Logger.log(`\n【参考】過去180日のHacomonoメール全件（HALLEL以外も含む）`);
  Logger.log(`検索クエリ: ${queryHacomono}`);

  // 500件ずつ取得して正確な件数を調べる
  let totalHacomono = 0;
  let offset = 0;
  while (true) {
    const batch = GmailApp.search(queryHacomono, offset, 500);
    if (batch.length === 0) break;

    totalHacomono += batch.length;
    offset += batch.length;

    Logger.log(`  取得中... ${totalHacomono}件`);

    if (batch.length < 500) break; // 最後のバッチ

    Utilities.sleep(500);
  }

  Logger.log(`結果: ${totalHacomono}件`);

  Logger.log('\n' + '='.repeat(80));
  Logger.log('【まとめ】');
  Logger.log(`処理すべきメール: ${threadsUnlabeled.length}件（ラベルなし）`);
  Logger.log(`既に処理済み: ${labeledCount}件（ラベル付き）`);
  Logger.log('='.repeat(80));
}

/**
 * 【簡易版】ラベルなしメール件数のみを調査
 */
function countUnlabeledEmails() {
  Logger.log('='.repeat(80));
  Logger.log('【ラベルなしメール件数調査】');
  Logger.log('='.repeat(80));

  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - 180);
  const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  const query = `from:noreply@em.hacomono.jp after:${dateStr} subject:hallel -label:HALLEL/Processed`;

  Logger.log(`検索クエリ: ${query}\n`);

  // 500件ずつ取得して正確な件数を調べる
  let total = 0;
  let offset = 0;

  while (true) {
    const threads = GmailApp.search(query, offset, 500);
    if (threads.length === 0) break;

    total += threads.length;
    offset += threads.length;

    Logger.log(`取得中... ${total}件`);

    if (threads.length < 500) break; // 最後のバッチ

    Utilities.sleep(500);
  }

  Logger.log('\n' + '='.repeat(80));
  Logger.log(`【結果】ラベルなしメール: ${total}件`);
  Logger.log('='.repeat(80));

  return total;
}
