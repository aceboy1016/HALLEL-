/**
 * ラベル一括削除ツール
 * HALLELラベルを効率的に削除
 */

/**
 * HALLELラベル一覧を表示
 */
function listHallelLabels() {
  console.log('📋 HALLELラベル一覧');
  console.log('='.repeat(60));

  try {
    const labels = GmailApp.getUserLabels();
    const hallelLabels = labels.filter(label => label.getName().startsWith('HALLEL/'));

    if (hallelLabels.length === 0) {
      console.log('HALLELラベルはありません');
      return;
    }

    hallelLabels.forEach((label, index) => {
      const threadCount = label.getThreads(0, 1).length > 0 ? '多数' : '0';
      console.log(`${index + 1}. ${label.getName()} (スレッド数: ${threadCount})`);
    });

    console.log('\n' + '='.repeat(60));
    console.log(`合計: ${hallelLabels.length}個のHALLELラベル`);

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
  }
}

/**
 * HALLELラベルを全て削除
 * ⚠️ 注意: ラベルは削除されますが、メールは残ります
 */
function deleteAllHallelLabels() {
  console.log('🗑️ HALLELラベル一括削除開始...');
  console.log('⚠️ ラベルのみ削除されます。メールは削除されません。');
  console.log('='.repeat(60));

  try {
    const labels = GmailApp.getUserLabels();
    const hallelLabels = labels.filter(label => label.getName().startsWith('HALLEL/'));

    if (hallelLabels.length === 0) {
      console.log('削除するHALLELラベルはありません');
      return;
    }

    let deletedCount = 0;

    hallelLabels.forEach(label => {
      const labelName = label.getName();
      console.log(`削除中: ${labelName}`);

      try {
        label.deleteLabel();
        deletedCount++;
        console.log(`  ✅ 削除完了`);
      } catch (error) {
        console.error(`  ❌ 削除失敗: ${error.message}`);
      }
    });

    console.log('\n' + '='.repeat(60));
    console.log(`✅ ${deletedCount}個のラベルを削除しました`);

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
  }
}

/**
 * 特定のHALLELラベルのみ削除
 * @param {string} labelSuffix - ラベルの末尾（例: 'Processed', 'Booking'）
 */
function deleteSpecificHallelLabel(labelSuffix) {
  const labelName = `HALLEL/${labelSuffix}`;

  console.log(`🗑️ ラベル削除: ${labelName}`);

  try {
    const label = GmailApp.getUserLabelByName(labelName);

    if (!label) {
      console.log(`⚠️ ラベル "${labelName}" が見つかりません`);
      return;
    }

    label.deleteLabel();
    console.log(`✅ ラベル "${labelName}" を削除しました`);

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
  }
}

/**
 * ラベルからメールを削除（ラベルのみ解除）
 * メール自体は削除されません
 */
function removeLabelsFromAllEmails() {
  console.log('🏷️ 全メールからHALLELラベルを解除中...');
  console.log('⚠️ ラベルのみ解除されます。メールは削除されません。');
  console.log('='.repeat(60));

  try {
    const labels = GmailApp.getUserLabels();
    const hallelLabels = labels.filter(label => label.getName().startsWith('HALLEL/'));

    if (hallelLabels.length === 0) {
      console.log('HALLELラベルはありません');
      return;
    }

    let totalProcessed = 0;

    hallelLabels.forEach(label => {
      const labelName = label.getName();
      console.log(`\n処理中: ${labelName}`);

      let processedCount = 0;
      let threads = label.getThreads(0, 100); // 100件ずつ処理

      while (threads.length > 0) {
        threads.forEach(thread => {
          thread.removeLabel(label);
          processedCount++;
        });

        console.log(`  ${processedCount}件のスレッドからラベル解除...`);

        threads = label.getThreads(0, 100);
      }

      console.log(`  ✅ ${labelName}: ${processedCount}件処理完了`);
      totalProcessed += processedCount;
    });

    console.log('\n' + '='.repeat(60));
    console.log(`✅ 合計 ${totalProcessed}件のスレッドからラベルを解除しました`);

  } catch (error) {
    console.error(`❌ エラー: ${error.message}`);
  }
}

/**
 * 完全クリーンアップ（ラベル解除→ラベル削除）
 * 最も安全な方法
 */
function fullCleanupHallelLabels() {
  console.log('🧹 HALLEL完全クリーンアップ開始...');
  console.log('='.repeat(60));

  console.log('\nステップ1: メールからラベルを解除');
  removeLabelsFromAllEmails();

  console.log('\n' + '='.repeat(60));
  console.log('\nステップ2: ラベルを削除');
  deleteAllHallelLabels();

  console.log('\n' + '='.repeat(60));
  console.log('✅ 完全クリーンアップ完了');
}
