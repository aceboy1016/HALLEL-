/**
 * 【Google Apps ScriptからGmail予約を全削除】
 * Vercel APIの削除エンドポイントを呼び出す
 */
function clearAllGmailReservations() {
  Logger.log('='.repeat(80));
  Logger.log('【Gmail予約全削除】');
  Logger.log('='.repeat(80));

  const url = 'https://hallel-shibuya.vercel.app/api/gas/clear-gmail-reservations';

  const options = {
    method: 'delete',
    headers: {
      'X-API-Key': 'Wh00k@2025!Secure$Token#ABC123XYZ',
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  Logger.log('Vercel APIに削除リクエストを送信中...\n');

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log(`ステータスコード: ${statusCode}`);
    Logger.log(`レスポンス: ${responseText}\n`);

    if (statusCode >= 200 && statusCode < 300) {
      const result = JSON.parse(responseText);
      Logger.log('✅ 削除成功！');
      Logger.log(`削除件数: ${result.deleted_count}件`);
      Logger.log(`削除前: ${result.count_before}件`);
      Logger.log(`削除後: ${result.count_after}件`);
      Logger.log('\n' + '='.repeat(80));
      Logger.log('次のステップ:');
      Logger.log('processLatestReservationsOnly() を実行してください');
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
