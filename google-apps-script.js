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
  FLASK_API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',  // ★Vercel本番URL★
  WEBHOOK_API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',         // ★Webhook認証キー★
  MAX_EMAILS_PER_RUN: 50,      // 一度に処理する最大メール数
  DAYS_TO_SEARCH: 7,           // 過去何日分を検索するか
  SEARCH_KEYWORDS: ['予約', 'キャンセル', 'HALLEL', '渋谷店', '代々木上原店', '中目黒店', '恵比寿店', '半蔵門店'],
  USE_LABEL: true,             // ラベルを使用するか
  LABEL_NAME: 'HALLEL/Processed'  // 処理済みラベル名
};

// === スクリプトプロパティのキー ===
const PROP_LAST_PROCESSED_TIME = 'lastProcessedTime';

/**
 * ラベルを取得または作成
 */
function getOrCreateLabel() {
  if (!CONFIG.USE_LABEL) return null;

  let label = GmailApp.getUserLabelByName(CONFIG.LABEL_NAME);
  if (!label) {
    Logger.log(`ラベルを作成: ${CONFIG.LABEL_NAME}`);
    label = GmailApp.createLabel(CONFIG.LABEL_NAME);
  }
  return label;
}

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

    // ラベルを取得
    const label = getOrCreateLabel();

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
          Logger.log(`  顧客名: ${bookingInfo.customer_name}`);
          Logger.log(`  店舗: ${bookingInfo.store}`);
          Logger.log(`  日付: ${bookingInfo.date}`);
          Logger.log(`  開始: ${bookingInfo.start_time}`);
          if (bookingInfo.end_time) {
            Logger.log(`  終了: ${bookingInfo.end_time}`);
          }

          // メールIDを追加（重複防止）
          bookingInfo.email_id = latestMessage.getId();
          bookingInfo.email_subject = latestMessage.getSubject();
          bookingInfo.email_date = latestMessage.getDate().toISOString();

          // Flask APIに送信
          const result = sendToFlaskAPI(bookingInfo);

          if (result.success) {
            Logger.log(`  ✓ APIに送信成功`);
            latestMessage.markRead();  // 既読にする

            // ラベルを付ける
            if (label) {
              thread.addLabel(label);
            }

            successCount++;
          } else {
            Logger.log(`  ✗ APIエラー: ${result.error}`);
            errorCount++;
          }
        } else {
          Logger.log(`  - 予約情報が見つかりません（スキップ）`);
          latestMessage.markRead();  // 既読にして再処理を防ぐ

          // スキップしたメールにもラベルを付ける
          if (label) {
            thread.addLabel(label);
          }

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
 * メール本文から店舗を抽出
 */
function extractStore(body) {
  const storeMap = {
    '恵比寿店': 'ebisu',
    '半蔵門店': 'hanzomon',
    '代々木上原店': 'yoyogi-uehara',
    '中目黒店': 'nakameguro',
    '渋谷店': 'shibuya'
  };

  for (const [storeName, storeId] of Object.entries(storeMap)) {
    if (body.includes(storeName)) {
      return storeId;
    }
  }

  // デフォルトは渋谷店
  return 'shibuya';
}

/**
 * メール本文から顧客名を抽出
 */
function extractCustomerName(body) {
  // パターン1: [顧客名]様
  const pattern1 = /^(.+?)様/m;
  const match1 = body.match(pattern1);
  if (match1) {
    return match1[1].trim();
  }

  // パターン2: お客様名：[顧客名]
  const pattern2 = /お客様名[：:]\s*(.+?)[\n\r]/;
  const match2 = body.match(pattern2);
  if (match2) {
    return match2[1].trim();
  }

  return 'N/A';
}

/**
 * メール本文から予約情報を抽出
 */
function parseEmailBody(body) {
  // 店舗を抽出
  const store = extractStore(body);

  // 顧客名を抽出
  const customerName = extractCustomerName(body);

  // キャンセルかどうかを判定（件名や本文に「キャンセル」が含まれる）
  const isCancellation = body.includes('キャンセル') || body.includes('cancel');

  // Hacomonoメール形式: 日時：2025年12月31日(水) 02:00~03:00
  const hacomonoPattern = /日時[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^)]*\)\s*(\d{1,2}:\d{2})[~〜～](\d{1,2}:\d{2})/;
  const hacomonoMatch = body.match(hacomonoPattern);

  if (hacomonoMatch) {
    const [, year, month, day, startTime, endTime] = hacomonoMatch;
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    return {
      action_type: isCancellation ? 'cancellation' : 'booking',
      date: date,
      start_time: formatTime(startTime),
      end_time: formatTime(endTime),
      customer_name: customerName,
      store: store
    };
  }

  // 旧形式（後方互換性のため残す）
  // 予約パターン: 予約: 2025-08-05 14:00-15:30
  const bookingPattern = /予約[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-~〜ー]\s*(\d{1,2}:\d{2})/;
  const bookingMatch = body.match(bookingPattern);

  if (bookingMatch) {
    return {
      action_type: 'booking',
      date: bookingMatch[1],
      start_time: formatTime(bookingMatch[2]),
      end_time: formatTime(bookingMatch[3]),
      customer_name: customerName,
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
      customer_name: customerName,
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
    // GAS Webhook形式に変換
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: [{
        date: bookingData.date,
        start: bookingData.start_time,
        end: bookingData.end_time || bookingData.start_time,
        customer_name: bookingData.customer_name || 'N/A',
        store: bookingData.store || 'shibuya',
        type: 'gmail',
        is_cancellation: bookingData.action_type === 'cancellation',
        source: 'gas_sync',
        email_id: bookingData.email_id || '',
        email_subject: bookingData.email_subject || '',
        email_date: bookingData.email_date || new Date().toISOString()
      }]
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-API-Key': CONFIG.WEBHOOK_API_KEY
      },
      payload: JSON.stringify(payload),
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
 * 一括処理関数（既読メールも処理）
 * ⚠️ 重複防止機能あり：同じメールを何度処理しても重複しない
 */
function processAllEmails() {
  processEmailsWithDays(CONFIG.DAYS_TO_SEARCH);
}

/**
 * 過去30日分を一括処理（既読含む）
 * ⚠️ 200件以上ある場合は複数回実行してください
 */
function processLast30Days() {
  processEmailsWithDays(30);
}

/**
 * 過去60日分を一括処理（既読含む）
 * ⚠️ 200件以上ある場合は複数回実行してください
 */
function processLast60Days() {
  processEmailsWithDays(60);
}

/**
 * 指定日数分のメールを処理（内部関数）
 */
function processEmailsWithDays(days) {
  Logger.log('='.repeat(60));
  Logger.log(`HALLEL Gmail連携 - 一括処理開始（過去${days}日分、既読含む）`);
  Logger.log('='.repeat(60));

  try {
    // ラベルを取得
    const label = getOrCreateLabel();

    // 検索クエリ（is:unread を削除して既読も含める）
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);
    const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

    const keywordQuery = CONFIG.SEARCH_KEYWORDS
      .map(kw => `subject:${kw}`)
      .join(' OR ');

    // ★ is:unread を外す
    const query = `after:${dateStr} (${keywordQuery})`;
    Logger.log(`検索クエリ: ${query}`);

    // 最大500件取得（GAS制限に注意）
    const threads = GmailApp.search(query, 0, 500);

    if (threads.length === 0) {
      Logger.log('処理対象のメールはありません。');
      return;
    }

    Logger.log(`処理対象スレッド数: ${threads.length}件`);

    // 500件以上ある場合の警告
    if (threads.length >= 500) {
      Logger.log('⚠️ 警告: メールが500件以上あります。全て処理するには複数回実行してください。');
    }

    Logger.log('-'.repeat(60));

    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    threads.forEach((thread, index) => {
      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1];

      // ★ 既読・未読に関わらず処理
      Logger.log(`\n[${index + 1}/${threads.length}] 件名: ${latestMessage.getSubject()}`);

      const body = latestMessage.getPlainBody();
      const bookingInfo = parseEmailBody(body);

      if (bookingInfo) {
        Logger.log(`  アクション: ${bookingInfo.action_type}`);
        Logger.log(`  顧客名: ${bookingInfo.customer_name}`);
        Logger.log(`  店舗: ${bookingInfo.store}`);
        Logger.log(`  日付: ${bookingInfo.date}`);
        Logger.log(`  開始: ${bookingInfo.start_time}`);
        if (bookingInfo.end_time) {
          Logger.log(`  終了: ${bookingInfo.end_time}`);
        }

        // メールIDを追加（重複防止）
        bookingInfo.email_id = latestMessage.getId();
        bookingInfo.email_subject = latestMessage.getSubject();
        bookingInfo.email_date = latestMessage.getDate().toISOString();

        // Flask APIに送信
        const result = sendToFlaskAPI(bookingInfo);

        if (result.success) {
          Logger.log(`  ✓ APIに送信成功`);
          latestMessage.markRead();

          // ラベルを付ける
          if (label) {
            thread.addLabel(label);
          }

          successCount++;
        } else {
          Logger.log(`  ✗ APIエラー: ${result.error}`);
          errorCount++;
        }
      } else {
        Logger.log(`  - 予約情報が見つかりません（スキップ）`);
        latestMessage.markRead();

        // スキップしたメールにもラベルを付ける
        if (label) {
          thread.addLabel(label);
        }

        skippedCount++;
      }

      // 進捗表示
      if ((index + 1) % 10 === 0) {
        Logger.log(`\n進捗: ${index + 1}/${threads.length} (${Math.round((index + 1)/threads.length*100)}%)`);
      }
    });

    Logger.log('\n' + '='.repeat(60));
    Logger.log('処理完了');
    Logger.log(`成功: ${successCount}件 / エラー: ${errorCount}件 / スキップ: ${skippedCount}件`);
    Logger.log('='.repeat(60));

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * メール件数を調査（デバッグ用）
 */
function investigateEmailCount() {
  Logger.log('=== メール件数調査 ===\n');

  const tests = [
    { days: 7, label: '過去7日' },
    { days: 30, label: '過去30日' },
    { days: 60, label: '過去60日' },
    { days: 90, label: '過去90日' }
  ];

  tests.forEach(test => {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - test.days);
    const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

    const keywordQuery = CONFIG.SEARCH_KEYWORDS
      .map(kw => `subject:${kw}`)
      .join(' OR ');

    const query = `after:${dateStr} (${keywordQuery})`;
    const threads = GmailApp.search(query, 0, 500);

    Logger.log(`${test.label}: ${threads.length}件`);
    Logger.log(`  検索クエリ: ${query}\n`);
  });

  // 未読メール数も確認
  const unreadQuery = buildSearchQuery();
  const unreadThreads = GmailApp.search(unreadQuery, 0, 500);
  Logger.log(`未読メール: ${unreadThreads.length}件`);
  Logger.log(`  検索クエリ: ${unreadQuery}`);
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
 * テスト用関数: 予約情報の抽出をテスト
 */
function testParsing() {
  const testEmails = [
    // Hacomonoメール形式（恵比寿店）
    '田中太郎様\n\nHALLEL 恵比寿店の予約が確定しました。\n\n日時：2025年12月31日(水) 02:00~03:00\n店舗： HALLEL 恵比寿店',
    // Hacomonoメール形式（半蔵門店）
    '山田花子様\n\nHALLEL 半蔵門店の予約が確定しました。\n\n日時：2025年12月1日(日) 10:00~11:00\n店舗： HALLEL 半蔵門店',
    // Hacomonoメール形式（渋谷店）
    '佐藤次郎様\n\nHALLEL 渋谷店の予約が確定しました。\n\n日時：2025年12月15日(月) 14:00~15:30\n店舗： HALLEL 渋谷店',
    // キャンセルメール
    '鈴木三郎様\n\nキャンセル\n日時：2025年12月20日(金) 16:00~17:00\n店舗： HALLEL 代々木上原店',
    // 旧形式（後方互換）
    '渋谷店\n予約: 2025-08-05 14:00-15:30\nお客様名: 田中太郎',
    '通常のメール本文（マッチしない）'
  ];

  testEmails.forEach((body, i) => {
    Logger.log(`\n--- テスト ${i + 1} ---`);
    Logger.log(`本文: ${body}`);
    const result = parseEmailBody(body);
    Logger.log(`結果: ${JSON.stringify(result, null, 2)}`);
  });
}

/**
 * テスト用関数: 店舗抽出をテスト
 */
function testStoreExtraction() {
  const testEmails = [
    '渋谷店\n予約: 2025-08-05 14:00-15:30',
    '恵比寿店\n予約: 2025-08-05 14:00-15:30',
    '半蔵門店\n予約: 2025-08-05 14:00-15:30',
    '代々木上原店\n予約: 2025-08-05 14:00-15:30',
    '中目黒店\n予約: 2025-08-05 14:00-15:30',
    '店舗名なし\n予約: 2025-08-05 14:00-15:30'
  ];

  testEmails.forEach((body, i) => {
    Logger.log(`\n--- 店舗テスト ${i + 1} ---`);
    Logger.log(`本文: ${body}`);
    const store = extractStore(body);
    Logger.log(`店舗: ${store}`);
  });
}
