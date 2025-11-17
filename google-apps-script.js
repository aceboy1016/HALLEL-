/**
 * HALLEL予約システム - Google Apps Script版
 * Gmail連携（メール数過多対策版）
 *
 * セットアップ手順:
 * 1. https://script.google.com/ にアクセス
 * 2. 新しいプロジェクトを作成
 * 3. このコードを貼り付け
 * 4. FLASK_API_URL を実際のURLに変更
 * 5. トリガーを設定（例：10分ごとに実行）
 */

// === 設定 ===
const CONFIG = {
  FLASK_API_URL: 'https://your-domain.com/api/process_email',  // ★要変更★
  WEBHOOK_API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',         // ★Webhook認証キー★
  MAX_EMAILS_PER_RUN: 50,      // 一度に処理する最大メール数
  DAYS_TO_SEARCH: 7,           // 過去何日分を検索するか
  SEARCH_KEYWORDS: ['予約', 'キャンセル', 'HALLEL', '渋谷店', '恵比寿店', '半蔵門店', '代々木上原店', '中目黒店']
};

// === スクリプトプロパティのキー ===
const PROP_LAST_PROCESSED_TIME = 'lastProcessedTime';

/**
 * メイン処理関数（トリガーから実行）
 */
function processHallelBookingEmails() {
  Logger.log('='.repeat(60));
  Logger.log('HALLEL Gmail連携 - 予約同期開始');
  Logger.log('='.repeat(60));

  try {
    const query = buildSearchQuery();
    Logger.log(`検索クエリ: ${query}`);

    // Gmail検索（件数制限付き）
    const threads = GmailApp.search(query, 0, CONFIG.MAX_EMAILS_PER_RUN);

    if (threads.length === 0) {
      Logger.log('処理対象のメールはありません。');
      return;
    }

    Logger.log(`処理対象スレッド数: ${threads.length}`);
    Logger.log('-'.repeat(60));

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    threads.forEach((thread, index) => {
      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1]; // 最新のメッセージを取得

      // 未読メッセージのみ処理
      if (latestMessage.isUnread()) {
        Logger.log(`\n[${index + 1}/${threads.length}] 件名: ${latestMessage.getSubject()}`);

        const body = latestMessage.getPlainBody();
        const bookingInfo = parseEmailBody(body);

        if (bookingInfo) {
          Logger.log(`  アクション: ${bookingInfo.action_type}`);
          Logger.log(`  日付: ${bookingInfo.date}`);
          Logger.log(`  開始: ${bookingInfo.start_time}`);
          if (bookingInfo.end_time) {
            Logger.log(`  終了: ${bookingInfo.end_time}`);
          }

          // Flask APIに送信
          const result = sendToFlaskAPI(bookingInfo);

          if (result.success) {
            Logger.log(`  ✓ APIに送信成功`);
            latestMessage.markRead();  // 既読にする
            successCount++;
          } else {
            Logger.log(`  ✗ APIエラー: ${result.error}`);
            errorCount++;
          }
        } else {
          Logger.log(`  - 予約情報が見つかりません（スキップ）`);
          latestMessage.markRead();  // 既読にして再処理を防ぐ
          skippedCount++;
        }
      }
    });

    Logger.log('\n' + '='.repeat(60));
    Logger.log('処理完了');
    Logger.log(`成功: ${successCount}件 / エラー: ${errorCount}件 / スキップ: ${skippedCount}件`);
    Logger.log('='.repeat(60));

    // 最終処理時刻を保存
    saveLastProcessedTime();

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Gmail検索クエリを構築
 */
function buildSearchQuery() {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - CONFIG.DAYS_TO_SEARCH);
  const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  // キーワードをOR条件で結合
  const keywordQuery = CONFIG.SEARCH_KEYWORDS
    .map(kw => `subject:${kw}`)
    .join(' OR ');

  // 最終クエリ
  return `is:unread after:${dateStr} (${keywordQuery})`;
}

/**
 * メール本文から店舗名を抽出
 */
function extractStore(body) {
  // 店舗名マッピング
  const storeMap = {
    '渋谷店': 'shibuya',
    '恵比寿店': 'ebisu',
    '半蔵門店': 'hanzomon',
    '代々木上原店': 'yoyogi-uehara',
    '中目黒店': 'nakameguro'
  };

  // メール本文から店舗名を検索
  for (const [storeName, storeId] of Object.entries(storeMap)) {
    if (body.includes(storeName)) {
      return storeId;
    }
  }

  // デフォルトは渋谷店
  return 'shibuya';
}

/**
 * メール本文から予約情報を抽出
 */
function parseEmailBody(body) {
  // 店舗名を抽出
  const store = extractStore(body);

  // 予約パターン: 予約: 2025-08-05 14:00-15:30
  const bookingPattern = /予約[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-~〜ー]\s*(\d{1,2}:\d{2})/;
  const bookingMatch = body.match(bookingPattern);

  if (bookingMatch) {
    return {
      action_type: 'booking',
      date: bookingMatch[1],
      start_time: formatTime(bookingMatch[2]),
      end_time: formatTime(bookingMatch[3]),
      store: store
    };
  }

  // キャンセルパターン: キャンセル: 2025-08-05 14:00
  const cancelPattern = /キャンセル[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/;
  const cancelMatch = body.match(cancelPattern);

  if (cancelMatch) {
    return {
      action_type: 'cancellation',
      date: cancelMatch[1],
      start_time: formatTime(cancelMatch[2]),
      store: store
    };
  }

  return null;
}

/**
 * 時刻をHH:MM形式に整形
 */
function formatTime(time) {
  const parts = time.split(':');
  const hours = parts[0].padStart(2, '0');
  const minutes = parts[1].padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Flask APIに予約データを送信
 */
function sendToFlaskAPI(bookingData) {
  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-API-Key': CONFIG.WEBHOOK_API_KEY
      },
      payload: JSON.stringify(bookingData),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(CONFIG.FLASK_API_URL, options);
    const statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, data: JSON.parse(response.getContentText()) };
    } else {
      return {
        success: false,
        error: `HTTP ${statusCode}: ${response.getContentText()}`
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 最終処理時刻を保存
 */
function saveLastProcessedTime() {
  const now = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(PROP_LAST_PROCESSED_TIME, now);
}

/**
 * 最終処理時刻を取得
 */
function getLastProcessedTime() {
  return PropertiesService.getScriptProperties().getProperty(PROP_LAST_PROCESSED_TIME) || 'なし';
}

/**
 * テスト用関数: 設定を確認
 */
function testConfig() {
  Logger.log('=== 設定確認 ===');
  Logger.log(`Flask API URL: ${CONFIG.FLASK_API_URL}`);
  Logger.log(`最大処理件数: ${CONFIG.MAX_EMAILS_PER_RUN}`);
  Logger.log(`検索日数: ${CONFIG.DAYS_TO_SEARCH}日`);
  Logger.log(`検索キーワード: ${CONFIG.SEARCH_KEYWORDS.join(', ')}`);
  Logger.log(`検索クエリ: ${buildSearchQuery()}`);
  Logger.log(`最終処理時刻: ${getLastProcessedTime()}`);
}

/**
 * テスト用関数: 予約情報の抽出をテスト（全店舗対応）
 */
function testParsing() {
  const testEmails = [
    '渋谷店\n予約: 2025-08-05 14:00-15:30\nお客様名: 田中太郎',
    '恵比寿店\nキャンセル: 2025-08-05 14:00\nお客様名: 佐藤花子',
    '半蔵門店\n予約：2025-08-06 10:30〜12:00',
    '代々木上原店\n予約: 2025-08-07 09:00-10:30\nお客様名: 鈴木一郎',
    '中目黒店\nキャンセル: 2025-08-08 15:00',
    '予約: 2025-08-09 11:00-12:00\nお客様名: 山田花子',  // 店舗名なし（デフォルト: 渋谷店）
    '通常のメール本文'
  ];

  Logger.log('='.repeat(60));
  Logger.log('全店舗対応テスト - 予約情報抽出');
  Logger.log('='.repeat(60));

  testEmails.forEach((body, i) => {
    Logger.log(`\n--- テスト ${i + 1} ---`);
    Logger.log(`本文:\n${body}`);
    const result = parseEmailBody(body);
    if (result) {
      Logger.log(`✓ 抽出成功:`);
      Logger.log(`  店舗: ${result.store}`);
      Logger.log(`  アクション: ${result.action_type}`);
      Logger.log(`  日付: ${result.date}`);
      Logger.log(`  開始: ${result.start_time}`);
      if (result.end_time) {
        Logger.log(`  終了: ${result.end_time}`);
      }
    } else {
      Logger.log(`✗ 抽出失敗（予約情報なし）`);
    }
  });

  Logger.log('\n' + '='.repeat(60));
  Logger.log('テスト完了');
  Logger.log('='.repeat(60));
}

/**
 * テスト用関数: 店舗名抽出のみをテスト
 */
function testStoreExtraction() {
  const testBodies = [
    '渋谷店での予約です',
    '恵比寿店にて予約希望',
    '半蔵門店のキャンセル',
    '代々木上原店で利用',
    '中目黒店の予約',
    '店舗名なしの本文'
  ];

  Logger.log('='.repeat(60));
  Logger.log('店舗名抽出テスト');
  Logger.log('='.repeat(60));

  testBodies.forEach((body, i) => {
    const store = extractStore(body);
    Logger.log(`テスト ${i + 1}: "${body}" → ${store}`);
  });

  Logger.log('='.repeat(60));
}
