/**
 * データベースマイグレーション実行（GASから）
 *
 * 使い方：
 * 1. Google Apps Scriptエディタで開く
 * 2. runMigration() を実行
 */
function runMigration() {
  Logger.log('='.repeat(80));
  Logger.log('【データベースマイグレーション実行】');
  Logger.log('='.repeat(80));

  const url = 'https://hallel-shibuya.vercel.app/api/admin/run-migration';

  const payload = {
    migration: '002_add_room_name'
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-API-Key': 'Wh00k@2025!Secure$Token#ABC123XYZ'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  Logger.log('マイグレーション実行中...\n');

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log(`ステータスコード: ${statusCode}`);
    Logger.log(`レスポンス: ${responseText}\n`);

    if (statusCode >= 200 && statusCode < 300) {
      const result = JSON.parse(responseText);
      Logger.log('✅ マイグレーション成功！');
      Logger.log(`メッセージ: ${result.message}`);
      Logger.log(`マイグレーション名: ${result.migration_name}`);
      Logger.log('\n' + '='.repeat(80));
      Logger.log('これでroom_nameカラムが追加されました！');
      Logger.log('次のステップ: processLatestReservationsOnly() を実行');
      Logger.log('='.repeat(80));
    } else {
      Logger.log(`❌ エラー: HTTP ${statusCode}`);
      Logger.log(`詳細: ${responseText}`);
    }

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}
