/**
 * Vercelの環境変数とGoogle Calendar API接続をテスト
 */
function checkCalendarEnvironment() {
  Logger.log('='.repeat(80));
  Logger.log('【Vercel環境変数とカレンダーAPI接続チェック】');
  Logger.log('='.repeat(80));

  const url = 'https://hallel-shibuya.vercel.app/api/test-calendar-env';

  const options = {
    method: 'get',
    headers: {
      'X-API-Key': 'Wh00k@2025!Secure$Token#ABC123XYZ'
    },
    muteHttpExceptions: true
  };

  Logger.log('Vercel APIにリクエスト送信中...\n');

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log('ステータスコード: ' + statusCode);
    Logger.log('レスポンス:\n' + responseText + '\n');

    if (statusCode >= 200 && statusCode < 300) {
      const result = JSON.parse(responseText);

      Logger.log('='.repeat(80));
      Logger.log('【環境変数】');
      Logger.log('='.repeat(80));
      Logger.log('GOOGLE_SERVICE_ACCOUNT_JSON: ' + (result.env.has_service_account_json ? '✓ 設定済み' : '✗ 未設定'));
      Logger.log('EBISU_CALENDAR_ID: ' + (result.env.ebisu_calendar_id || 'デフォルト値'));
      Logger.log('HANZOMON_CALENDAR_ID: ' + (result.env.hanzomon_calendar_id || 'デフォルト値'));

      Logger.log('\n' + '='.repeat(80));
      Logger.log('【Google Calendar API】');
      Logger.log('='.repeat(80));
      Logger.log('接続状態: ' + (result.calendar_api.connected ? '✓ 成功' : '✗ 失敗'));

      if (result.calendar_api.accessible_calendars) {
        Logger.log('アクセス可能なカレンダー: ' + result.calendar_api.accessible_calendars.length + '件');
        result.calendar_api.accessible_calendars.forEach(function(cal) {
          Logger.log('  - ' + cal);
        });
      }

      if (result.calendar_api.ebisu_calendar_accessible) {
        Logger.log('\n✓ 恵比寿店カレンダーにアクセス可能');
      } else {
        Logger.log('\n✗ 恵比寿店カレンダーにアクセスできません');
      }

      if (result.error) {
        Logger.log('\n❌ エラー: ' + result.error);
      }

    } else {
      Logger.log('❌ エラー: HTTP ' + statusCode);
      Logger.log('詳細: ' + responseText);
    }

  } catch (error) {
    Logger.log('❌ エラー: ' + error.message);
    Logger.log(error.stack);
  }
}
