/**
 * HALLELラベルクリーンアップツール
 *
 * 使い方:
 * 1. このコードをGASエディタに貼り付け
 * 2. listAllHallelLabels() を実行して現在のラベルを確認
 * 3. deleteAllHallelLabels() を実行して全て削除（実行前に確認）
 */

/**
 * HALLEL関連ラベルを全てリスト表示
 */
function listAllHallelLabels() {
  Logger.log('=== HALLEL関連ラベル一覧 ===\n');

  const labels = GmailApp.getUserLabels();
  const hallelLabels = labels.filter(label =>
    label.getName().includes('HALLEL') ||
    label.getName().includes('hallel')
  );

  Logger.log(`見つかったラベル数: ${hallelLabels.length}件\n`);

  hallelLabels.forEach((label, index) => {
    const threadCount = label.getThreads(0, 1).length > 0 ? '使用中' : '未使用';
    Logger.log(`${index + 1}. ${label.getName()} - ${threadCount}`);
  });

  Logger.log('\n削除する場合は deleteAllHallelLabels() を実行してください');
}

/**
 * HALLEL関連ラベルを全て削除
 * ⚠️ 実行前に listAllHallelLabels() で確認してください
 */
function deleteAllHallelLabels() {
  const labels = GmailApp.getUserLabels();
  const hallelLabels = labels.filter(label =>
    label.getName().includes('HALLEL') ||
    label.getName().includes('hallel')
  );

  Logger.log(`削除対象: ${hallelLabels.length}件のラベル\n`);

  const confirmation = true; // 実行する場合はtrueのまま

  if (!confirmation) {
    Logger.log('⚠️ 削除がキャンセルされました');
    return;
  }

  let deletedCount = 0;

  hallelLabels.forEach(label => {
    try {
      const labelName = label.getName();
      label.deleteLabel();
      Logger.log(`✓ 削除: ${labelName}`);
      deletedCount++;
    } catch (error) {
      Logger.log(`✗ 削除失敗: ${label.getName()} - ${error.message}`);
    }
  });

  Logger.log(`\n完了: ${deletedCount}/${hallelLabels.length}件のラベルを削除しました`);
}

/**
 * 特定のラベルのみ削除（安全版）
 */
function deleteSafeLabels() {
  const labelsToDelete = [
    'HALLEL/Processed',
    'HALLEL/Booking',
    'HALLEL/Cancellation',
    'HALLEL/Shibuya',
    'HALLEL/YoyogiUehara',
    'HALLEL/Nakameguro',
    'HALLEL/Ebisu',
    'HALLEL/Hanzomon',
    'HALLEL/BatchProgress'
  ];

  Logger.log('=== 特定ラベルの削除 ===\n');

  let deletedCount = 0;

  labelsToDelete.forEach(labelName => {
    try {
      const label = GmailApp.getUserLabelByName(labelName);
      if (label) {
        label.deleteLabel();
        Logger.log(`✓ 削除: ${labelName}`);
        deletedCount++;
      } else {
        Logger.log(`- スキップ（存在しない）: ${labelName}`);
      }
    } catch (error) {
      Logger.log(`✗ 削除失敗: ${labelName} - ${error.message}`);
    }
  });

  Logger.log(`\n完了: ${deletedCount}件のラベルを削除しました`);
}

/**
 * メールからラベルを削除（メール自体は残す）
 */
function removeLabelsFromEmails() {
  Logger.log('=== メールからラベルを削除 ===\n');

  const labels = GmailApp.getUserLabels();
  const hallelLabels = labels.filter(label =>
    label.getName().includes('HALLEL') ||
    label.getName().includes('hallel')
  );

  let totalRemoved = 0;

  hallelLabels.forEach(label => {
    try {
      const threads = label.getThreads();
      if (threads.length > 0) {
        label.removeFromThreads(threads);
        Logger.log(`✓ ラベル削除: ${label.getName()} (${threads.length}件のメールから)`);
        totalRemoved += threads.length;
      }
    } catch (error) {
      Logger.log(`✗ エラー: ${label.getName()} - ${error.message}`);
    }
  });

  Logger.log(`\n完了: ${totalRemoved}件のメールからラベルを削除しました`);
  Logger.log('次に deleteAllHallelLabels() を実行してラベル自体を削除できます');
}
