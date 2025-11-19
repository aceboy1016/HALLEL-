/**
 * 【アカウント確認】GASが実際にどのアカウントで動いているか確認
 */
function checkAccount() {
  Logger.log('='.repeat(80));
  Logger.log('【アカウント確認】');
  Logger.log('='.repeat(80));

  // 1. 現在のユーザーのメールアドレス
  const userEmail = Session.getActiveUser().getEmail();
  Logger.log(`GASが動いているアカウント: ${userEmail}`);

  // 2. ラベルの確認
  Logger.log('\n【ラベル確認】');
  const labelName = 'HALLEL/Processed';
  const label = GmailApp.getUserLabelByName(labelName);

  if (label) {
    const threads = label.getThreads();
    Logger.log(`ラベル名: ${labelName}`);
    Logger.log(`ラベル付きメール: ${threads.length}件`);

    // 最初の10件の送信元を確認
    Logger.log('\n最初の10件の送信元を確認:');
    const first10 = threads.slice(0, 10);
    first10.forEach((thread, index) => {
      const message = thread.getMessages()[0];
      const from = message.getFrom();
      const subject = message.getSubject();
      const date = message.getDate();
      Logger.log(`[${index + 1}] ${from}`);
      Logger.log(`    件名: ${subject}`);
      Logger.log(`    日付: ${date}`);
    });
  } else {
    Logger.log(`ラベル "${labelName}" が見つかりません`);
  }

  // 3. 全ラベルを表示
  Logger.log('\n【全ラベル一覧】');
  const allLabels = GmailApp.getUserLabels();
  Logger.log(`ラベル総数: ${allLabels.length}件\n`);

  allLabels.forEach((lbl, index) => {
    const name = lbl.getName();
    const count = lbl.getThreads().length;
    if (name.includes('HALLEL') || name.includes('Processed')) {
      Logger.log(`[${index + 1}] ${name}: ${count}件 ← HALLEL関連`);
    }
  });

  Logger.log('\n' + '='.repeat(80));
}
