/**
 * 恵比寿店の予約を今すぐGoogleカレンダーに同期
 */
function syncEbisuCalendar() {
  Logger.log('='.repeat(80));
  Logger.log('【恵比寿店 → Googleカレンダー同期】');
  Logger.log('='.repeat(80));

  const url = 'https://hallel-shibuya.vercel.app/api/sync-ebisu-calendar';

  const options = {
    method: 'post',
    headers: {
      'X-API-Key': 'Wh00k@2025!Secure$Token#ABC123XYZ',
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  Logger.log('Vercel APIに同期リクエストを送信中...\n');

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log(`ステータスコード: ${statusCode}`);
    Logger.log(`レスポンス: ${responseText}\n`);

    if (statusCode >= 200 && statusCode < 300) {
      const result = JSON.parse(responseText);
      Logger.log('✅ 同期成功！');
      Logger.log(`対象予約: ${result.total_count}件`);
      Logger.log(`同期成功: ${result.synced_count}件`);
      Logger.log(`同期失敗: ${result.error_count}件`);

      if (result.errors && result.errors.length > 0) {
        Logger.log('\nエラー詳細:');
        result.errors.forEach((err, index) => {
          Logger.log(`  ${index + 1}. ${err}`);
        });
      }

      Logger.log('\n' + '='.repeat(80));
      Logger.log('恵比寿店のGoogleカレンダー同期が完了しました！');
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
