/**
 * トリガー管理ツール
 */

/**
 * 現在のトリガー一覧を表示
 */
function listAllTriggers() {
  console.log('📋 現在のトリガー一覧');
  console.log('='.repeat(60));

  const triggers = ScriptApp.getProjectTriggers();

  if (triggers.length === 0) {
    console.log('トリガーはありません');
    return;
  }

  triggers.forEach((trigger, index) => {
    console.log(`\n${index + 1}. ${trigger.getHandlerFunction()}`);
    console.log(`   イベント: ${trigger.getEventType()}`);

    // 時間ベースのトリガーの場合
    if (trigger.getEventType() === ScriptApp.EventType.CLOCK) {
      const triggerSource = trigger.getTriggerSource();
      if (triggerSource === ScriptApp.TriggerSource.CLOCK) {
        console.log(`   種類: 時間ベース`);
      }
    }

    console.log(`   一意のID: ${trigger.getUniqueId()}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(`合計: ${triggers.length}個のトリガー`);
}

/**
 * 全てのトリガーを削除
 */
function deleteAllTriggers() {
  console.log('🗑️ 全トリガー削除開始...');

  const triggers = ScriptApp.getProjectTriggers();

  if (triggers.length === 0) {
    console.log('削除するトリガーはありません');
    return;
  }

  let deletedCount = 0;

  triggers.forEach(trigger => {
    console.log(`削除中: ${trigger.getHandlerFunction()}`);
    ScriptApp.deleteTrigger(trigger);
    deletedCount++;
  });

  console.log(`\n✅ ${deletedCount}個のトリガーを削除しました`);
}

/**
 * scheduledSync トリガーのみ削除
 */
function deleteScheduledSyncTriggers() {
  console.log('🗑️ scheduledSync トリガー削除中...');

  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'scheduledSync') {
      console.log(`削除: ${trigger.getHandlerFunction()}`);
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  console.log(`✅ ${deletedCount}個の scheduledSync トリガーを削除しました`);
}

/**
 * continueProcessing トリガーのみ削除（バッチ処理用）
 */
function deleteContinueProcessingTriggers() {
  console.log('🗑️ continueProcessing トリガー削除中...');

  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'continueProcessing') {
      console.log(`削除: ${trigger.getHandlerFunction()}`);
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  console.log(`✅ ${deletedCount}個の continueProcessing トリガーを削除しました`);
}
