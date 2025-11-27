/**
 * 明日朝の全件同期トリガー設定
 */

/**
 * 明日の朝6時に全件同期を実行するトリガーを設定
 */
function setupTomorrowMorningSync() {
  console.log('⏰ 明日朝の全件同期トリガー設定');
  console.log('='.repeat(60));

  try {
    // 既存のforceFullSyncトリガーを削除
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'forceFullSync') {
        console.log('既存のforceFullSyncトリガーを削除...');
        ScriptApp.deleteTrigger(trigger);
      }
    });

    // 明日の朝6時を計算
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(6, 0, 0, 0);

    // トリガーを作成
    ScriptApp.newTrigger('forceFullSync')
      .timeBased()
      .at(tomorrow)
      .create();

    const jstTime = Utilities.formatDate(tomorrow, 'JST', 'yyyy年MM月dd日 HH:mm');

    console.log('✅ トリガー設定完了');
    console.log(`実行予定: ${jstTime}`);
    console.log('関数: forceFullSync');
    console.log('\n💡 明日の朝6時に自動的に全件同期が開始されます');

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
  }
}

/**
 * カスタム時刻で全件同期トリガーを設定
 * @param {number} hoursLater - 何時間後に実行するか
 */
function setupCustomTimeSync(hoursLater = 12) {
  console.log(`⏰ ${hoursLater}時間後に全件同期トリガー設定`);
  console.log('='.repeat(60));

  try {
    // 既存のforceFullSyncトリガーを削除
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'forceFullSync') {
        console.log('既存のforceFullSyncトリガーを削除...');
        ScriptApp.deleteTrigger(trigger);
      }
    });

    // 指定時間後を計算
    const executeTime = new Date();
    executeTime.setHours(executeTime.getHours() + hoursLater);

    // トリガーを作成
    ScriptApp.newTrigger('forceFullSync')
      .timeBased()
      .at(executeTime)
      .create();

    const jstTime = Utilities.formatDate(executeTime, 'JST', 'yyyy年MM月dd日 HH:mm');

    console.log('✅ トリガー設定完了');
    console.log(`実行予定: ${jstTime}`);
    console.log('関数: forceFullSync');

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
  }
}

/**
 * 設定済みトリガーの確認
 */
function checkScheduledTriggers() {
  console.log('📋 設定済みトリガー確認');
  console.log('='.repeat(60));

  const triggers = ScriptApp.getProjectTriggers();
  const scheduledTriggers = triggers.filter(t =>
    t.getHandlerFunction() === 'forceFullSync'
  );

  if (scheduledTriggers.length === 0) {
    console.log('⚠️ forceFullSync のトリガーは設定されていません');
    return;
  }

  scheduledTriggers.forEach((trigger, index) => {
    console.log(`\n${index + 1}. forceFullSync`);
    console.log(`   イベント: ${trigger.getEventType()}`);
    console.log(`   トリガーID: ${trigger.getUniqueId()}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(`合計: ${scheduledTriggers.length}個のトリガー`);
}

/**
 * forceFullSync トリガーを削除
 */
function cancelTomorrowSync() {
  console.log('❌ 明日の同期トリガーをキャンセル');
  console.log('='.repeat(60));

  const triggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;

  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'forceFullSync') {
      console.log(`削除: ${trigger.getUniqueId()}`);
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });

  if (deletedCount > 0) {
    console.log(`✅ ${deletedCount}個のトリガーを削除しました`);
  } else {
    console.log('削除するトリガーはありませんでした');
  }
}
