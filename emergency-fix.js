/**
 * 【緊急修正】トリガー停止 + データ再クリーン
 */
function emergencyFix() {
  Logger.log('='.repeat(80));
  Logger.log('【緊急修正】トリガー停止 + データクリーンアップ');
  Logger.log('='.repeat(80));

  // ステップ1: トリガーを停止
  Logger.log('\n【ステップ1】トリガー停止');
  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processNewHallelEmails') {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  Logger.log(`✓ ${deletedCount}件のトリガーを削除`);

  // ステップ2: HALLEL/Synced ラベルを全削除
  Logger.log('\n【ステップ2】HALLEL/Syncedラベルを全削除');
  const syncedLabel = GmailApp.getUserLabelByName('HALLEL/Synced');

  if (syncedLabel) {
    const threads = syncedLabel.getThreads();
    Logger.log(`${threads.length}件のスレッドからラベルを削除中...`);

    threads.forEach(thread => {
      thread.removeLabel(syncedLabel);
    });

    GmailApp.deleteLabel(syncedLabel);
    Logger.log('✓ HALLEL/Syncedラベルを削除');
  } else {
    Logger.log('HALLEL/Syncedラベルは存在しません');
  }

  Logger.log('\n' + '='.repeat(80));
  Logger.log('【次のステップ】');
  Logger.log('1. clearAllGmailReservations() を実行');
  Logger.log('2. processLatestReservationsOnly() を実行');
  Logger.log('3. markAllProcessedAsSynced() を実行');
  Logger.log('4. setupAutoProcessTrigger() でトリガー再設定');
  Logger.log('='.repeat(80));
}

/**
 * 【全メールに HALLEL/Synced 付与】重複処理を防ぐ
 */
function markAllProcessedAsSynced() {
  Logger.log('='.repeat(80));
  Logger.log('【全メールに HALLEL/Synced 付与】');
  Logger.log('='.repeat(80));

  const processedLabel = GmailApp.getUserLabelByName('HALLEL/Processed');
  const syncedLabel = GmailApp.getUserLabelByName('HALLEL/Synced') ||
                      GmailApp.createLabel('HALLEL/Synced');

  if (!processedLabel) {
    Logger.log('❌ HALLEL/Processedラベルが見つかりません');
    return;
  }

  const threads = processedLabel.getThreads();
  Logger.log(`処理対象: ${threads.length}件のスレッド\n`);

  let count = 0;
  threads.forEach((thread, index) => {
    thread.addLabel(syncedLabel);
    count++;

    if ((index + 1) % 100 === 0) {
      Logger.log(`進捗: ${index + 1}/${threads.length}`);
      Utilities.sleep(100);
    }
  });

  Logger.log(`\n✅ ${count}件のスレッドに HALLEL/Synced ラベルを付与`);
  Logger.log('これで processNewHallelEmails() が再処理しなくなります');
  Logger.log('='.repeat(80));
}
