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
  SEARCH_KEYWORDS: ['hallel'],  // ★重要: "hallel"のみに限定（他ジムを除外）★
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
 * 全メールからHALLEL/Processedラベルを削除
 */
function removeAllProcessedLabels() {
  Logger.log('='.repeat(60));
  Logger.log('HALLEL/Processedラベル削除開始');
  Logger.log('='.repeat(60));

  try {
    const label = GmailApp.getUserLabelByName(CONFIG.LABEL_NAME);

    if (!label) {
      Logger.log('ラベルが存在しません。削除不要です。');
      return;
    }

    const threads = label.getThreads();
    Logger.log(`ラベルが付いたスレッド数: ${threads.length}件`);

    if (threads.length === 0) {
      Logger.log('ラベルが付いたメールはありません。');
      // 空のラベルを削除
      GmailApp.deleteLabel(label);
      Logger.log('空のラベルを削除しました。');
      return;
    }

    // 100件ずつ処理（GAS制限対策）
    let totalRemoved = 0;
    const batchSize = 100;

    for (let i = 0; i < threads.length; i += batchSize) {
      const batch = threads.slice(i, Math.min(i + batchSize, threads.length));

      batch.forEach(thread => {
        thread.removeLabel(label);
        totalRemoved++;
      });

      Logger.log(`進捗: ${totalRemoved}/${threads.length}件削除`);

      // レート制限対策
      if (i + batchSize < threads.length) {
        Utilities.sleep(500);
      }
    }

    // ラベル自体を削除
    GmailApp.deleteLabel(label);

    Logger.log('='.repeat(60));
    Logger.log(`完了: ${totalRemoved}件のメールからラベルを削除`);
    Logger.log('ラベル自体も削除しました。');
    Logger.log('='.repeat(60));

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
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

  // HALLEL店舗が見つからない場合はnullを返す（他のジムを除外）
  return null;
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
  // 店舗を抽出（HALLEL店舗以外はnullが返る）
  const store = extractStore(body);

  // HALLEL店舗でない場合は処理しない
  if (!store) {
    return null;
  }

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
 * 送信元アドレスで検索（より広範囲）
 */
function investigateBySender() {
  Logger.log('=== 送信元アドレスで調査 ===\n');

  const senders = [
    'noreply@em.hacomono.jp',
    '@hacomono.jp',
    'hacomono'
  ];

  senders.forEach(sender => {
    const tests = [
      { days: 30, label: '過去30日' },
      { days: 60, label: '過去60日' },
      { days: 90, label: '過去90日' },
      { days: 180, label: '過去180日' }
    ];

    Logger.log(`送信元: ${sender}`);
    tests.forEach(test => {
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - test.days);
      const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

      const query = `from:${sender} after:${dateStr}`;
      const threads = GmailApp.search(query, 0, 500);

      Logger.log(`  ${test.label}: ${threads.length}件`);
    });
    Logger.log('');
  });
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

/**
 * Kirsch Robertメールのデバッグ専用関数
 * 特定のメールがなぜ処理されないかを調査
 */
function debugKirschRobertEmail() {
  Logger.log('='.repeat(60));
  Logger.log('Kirsch Robertメール デバッグ');
  Logger.log('='.repeat(60));

  // 1. 特定のメールを直接検索
  Logger.log('\n【ステップ1】Kirsch Robertメールを直接検索');
  const specificQuery = 'from:noreply@em.hacomono.jp subject:"hallel 予約完了メール" "Kirsch Robert"';
  Logger.log(`検索クエリ: ${specificQuery}`);

  const specificThreads = GmailApp.search(specificQuery, 0, 10);
  Logger.log(`結果: ${specificThreads.length}件のスレッド\n`);

  if (specificThreads.length === 0) {
    Logger.log('❌ Kirsch Robertメールが見つかりません！');
    Logger.log('   メールが実際に存在するか確認してください。');
    return;
  }

  // メールの詳細を表示
  const thread = specificThreads[0];
  const message = thread.getMessages()[0];

  Logger.log('【メール詳細】');
  Logger.log(`件名: ${message.getSubject()}`);
  Logger.log(`送信日時: ${message.getDate()}`);
  Logger.log(`送信元: ${message.getFrom()}`);
  Logger.log(`未読: ${message.isUnread()}`);
  Logger.log(`メールID: ${message.getId()}`);

  // ラベルを確認
  const labels = thread.getLabels();
  Logger.log(`\nラベル数: ${labels.length}件`);
  if (labels.length > 0) {
    labels.forEach(label => {
      Logger.log(`  - ${label.getName()}`);
    });
  } else {
    Logger.log('  (ラベルなし)');
  }

  // 2. 本文を解析
  Logger.log('\n【ステップ2】メール本文の解析');
  const body = message.getPlainBody();
  Logger.log('本文プレビュー:');
  Logger.log('-'.repeat(40));
  Logger.log(body.substring(0, 500));
  Logger.log('-'.repeat(40));

  // 3. parseEmailBody()で解析
  Logger.log('\n【ステップ3】parseEmailBody()で解析');
  const bookingInfo = parseEmailBody(body);

  if (bookingInfo) {
    Logger.log('✅ 予約情報が抽出されました:');
    Logger.log(JSON.stringify(bookingInfo, null, 2));
  } else {
    Logger.log('❌ 予約情報が抽出できませんでした！');
    Logger.log('   parseEmailBody()の正規表現がマッチしていない可能性があります。');
  }

  // 4. 通常の検索クエリでマッチするかチェック
  Logger.log('\n【ステップ4】通常の検索クエリでマッチするか確認');

  // 30日用クエリ
  const dateLimit30 = new Date();
  dateLimit30.setDate(dateLimit30.getDate() - 30);
  const dateStr30 = Utilities.formatDate(dateLimit30, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  const keywordQuery = CONFIG.SEARCH_KEYWORDS
    .map(kw => `subject:${kw}`)
    .join(' OR ');

  const query30Days = `after:${dateStr30} (${keywordQuery})`;
  Logger.log(`30日クエリ: ${query30Days}`);

  const matched30 = GmailApp.search(query30Days + ' "Kirsch Robert"', 0, 10);
  Logger.log(`30日クエリでマッチ: ${matched30.length}件`);

  if (matched30.length === 0) {
    Logger.log('❌ 30日クエリでマッチしません！');
    Logger.log('   原因:');
    Logger.log('   - 日付フィルタが古すぎる可能性');
    Logger.log('   - キーワードが件名にマッチしていない可能性');
  } else {
    Logger.log('✅ 30日クエリでマッチします');
  }

  // 5. 各キーワードで個別にマッチするか確認
  Logger.log('\n【ステップ5】各キーワードで個別にマッチするか確認');
  CONFIG.SEARCH_KEYWORDS.forEach(keyword => {
    const testQuery = `from:noreply@em.hacomono.jp subject:${keyword} "Kirsch Robert"`;
    const matches = GmailApp.search(testQuery, 0, 5);
    Logger.log(`  subject:${keyword} → ${matches.length}件`);
  });

  // 6. 結論
  Logger.log('\n' + '='.repeat(60));
  Logger.log('【結論】');

  if (!bookingInfo) {
    Logger.log('❌ 問題: メール本文から予約情報が抽出できていません');
    Logger.log('   対処: parseEmailBody()の正規表現を見直す必要があります');
  } else if (matched30.length === 0) {
    Logger.log('❌ 問題: 検索クエリにマッチしていません');
    Logger.log('   対処: 検索キーワードまたは日付範囲を見直す必要があります');
  } else {
    Logger.log('✅ メールは正常に検出・解析できます');
    Logger.log('   processLast30Days()を実行すれば処理されるはずです');

    if (labels.some(l => l.getName() === CONFIG.LABEL_NAME)) {
      Logger.log('⚠️  既に HALLEL/Processed ラベルが付いています');
      Logger.log('   このメールは既に処理済みの可能性があります');
      Logger.log('   データベースを確認してください');
    }
  }

  Logger.log('='.repeat(60));
}

/**
 * 代々木上原店の11月21日12:30の予約を探す
 */
function findYoyogiNov21Booking() {
  Logger.log('='.repeat(60));
  Logger.log('代々木上原店 11/21 12:30 予約を検索');
  Logger.log('='.repeat(60));

  // 複数の検索パターンを試す（より具体的に絞り込む）
  const searchPatterns = [
    'from:noreply@em.hacomono.jp "代々木上原" "11月21日" "12:30"',
    'from:noreply@em.hacomono.jp "Kirsch" "11月21日"',
    'from:noreply@em.hacomono.jp "代々木上原店" "2025年11月21日"',
    'from:noreply@em.hacomono.jp "代々木上原" "11月21日"',
    'from:noreply@em.hacomono.jp "代々木上原" "12:30"'
  ];

  searchPatterns.forEach((query, index) => {
    Logger.log(`\n【パターン${index + 1}】 ${query}`);
    const threads = GmailApp.search(query, 0, 20);
    Logger.log(`結果: ${threads.length}件`);

    if (threads.length > 0 && threads.length <= 10) {
      threads.forEach((thread, i) => {
        const message = thread.getMessages()[0];
        const body = message.getPlainBody();

        Logger.log(`\n  [${i + 1}] 件名: ${message.getSubject()}`);
        Logger.log(`      メールID: ${message.getId()}`);
        Logger.log(`      日時: ${message.getDate()}`);

        // 本文から顧客名と予約情報を抽出
        const customerMatch = body.match(/^(.+?)\s*様/m);
        const dateMatch = body.match(/日時[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^)]*\)\s*(\d{1,2}:\d{2})[~〜～](\d{1,2}:\d{2})/);
        const storeMatch = body.match(/店舗[：:]\s*(.+)/);

        if (customerMatch) Logger.log(`      顧客: ${customerMatch[1].trim()}`);
        if (dateMatch) Logger.log(`      予約: ${dateMatch[1]}年${dateMatch[2]}月${dateMatch[3]}日 ${dateMatch[4]}~${dateMatch[5]}`);
        if (storeMatch) Logger.log(`      店舗: ${storeMatch[1].trim()}`);

        // ラベル確認
        const labels = thread.getLabels();
        if (labels.length > 0) {
          Logger.log(`      ラベル: ${labels.map(l => l.getName()).join(', ')}`);
        } else {
          Logger.log(`      ラベル: なし`);
        }
      });
    }
  });

  Logger.log('\n' + '='.repeat(60));
  Logger.log('【次のステップ】');
  Logger.log('上記の結果から該当するメールが見つかった場合:');
  Logger.log('1. メールIDをメモ');
  Logger.log('2. processSpecificEmail() 関数で個別処理');
  Logger.log('='.repeat(60));
}

/**
 * メール送信日で検索（11月12日前後）
 */
function searchByEmailDate() {
  Logger.log('='.repeat(60));
  Logger.log('メール送信日で検索: 11月12日前後');
  Logger.log('='.repeat(60));

  // 11月12日のメールを検索
  const searchPatterns = [
    'from:noreply@em.hacomono.jp after:2025/11/11 before:2025/11/13',
    'from:noreply@em.hacomono.jp after:2025/11/10 before:2025/11/14',
  ];

  searchPatterns.forEach((query, index) => {
    Logger.log(`\n【パターン${index + 1}】 ${query}`);
    const threads = GmailApp.search(query, 0, 50);
    Logger.log(`結果: ${threads.length}件\n`);

    threads.forEach((thread, i) => {
      const message = thread.getMessages()[0];
      const body = message.getPlainBody();

      Logger.log(`[${i + 1}] 件名: ${message.getSubject()}`);
      Logger.log(`    メールID: ${message.getId()}`);
      Logger.log(`    送信日時: ${message.getDate()}`);

      // 本文から顧客名と予約情報を抽出
      const customerMatch = body.match(/^(.+?)\s*様/m);
      const dateMatch = body.match(/日時[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^)]*\)\s*(\d{1,2}:\d{2})[~〜～](\d{1,2}:\d{2})/);
      const storeMatch = body.match(/店舗[：:]\s*(.+)/);

      if (customerMatch) Logger.log(`    顧客: ${customerMatch[1].trim()}`);
      if (dateMatch) {
        Logger.log(`    予約: ${dateMatch[1]}年${dateMatch[2]}月${dateMatch[3]}日 ${dateMatch[4]}~${dateMatch[5]}`);

        // 11月21日 12:30のものをハイライト
        if (dateMatch[2] == '11' && dateMatch[3] == '21' && dateMatch[4] == '12:30') {
          Logger.log(`    ★★★ 該当メール候補！ ★★★`);
        }
      }
      if (storeMatch) Logger.log(`    店舗: ${storeMatch[1].trim()}`);

      // ラベル確認
      const labels = thread.getLabels();
      if (labels.length > 0) {
        Logger.log(`    ラベル: ${labels.map(l => l.getName()).join(', ')}`);
      } else {
        Logger.log(`    ラベル: なし`);
      }
      Logger.log('');
    });
  });

  Logger.log('='.repeat(60));
}

/**
 * 全メールから11月21日12:30の予約を探す
 */
function findNov21At1230() {
  Logger.log('='.repeat(60));
  Logger.log('全メールから11月21日 12:30の予約を探索');
  Logger.log('='.repeat(60));

  // 過去60日のメールを全件検索
  const query = 'from:noreply@em.hacomono.jp after:2025/10/01';
  Logger.log(`検索クエリ: ${query}\n`);

  const threads = GmailApp.search(query, 0, 500);
  Logger.log(`検索結果: ${threads.length}件のメール\n`);

  let foundCount = 0;

  threads.forEach((thread, index) => {
    const message = thread.getMessages()[0];
    const body = message.getPlainBody();

    // 11月21日 12:30を含むメールを探す
    if (body.includes('11月21日') && body.includes('12:30')) {
      foundCount++;

      Logger.log(`【発見 #${foundCount}】`);
      Logger.log(`件名: ${message.getSubject()}`);
      Logger.log(`メールID: ${message.getId()}`);
      Logger.log(`送信日時: ${message.getDate()}`);

      // 詳細を抽出
      const customerMatch = body.match(/^(.+?)\s*様/m);
      const dateMatch = body.match(/日時[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日[^)]*\)\s*(\d{1,2}:\d{2})[~〜～](\d{1,2}:\d{2})/);
      const storeMatch = body.match(/店舗[：:]\s*(.+)/);

      if (customerMatch) Logger.log(`顧客: ${customerMatch[1].trim()}`);
      if (dateMatch) Logger.log(`予約: ${dateMatch[1]}年${dateMatch[2]}月${dateMatch[3]}日 ${dateMatch[4]}~${dateMatch[5]}`);
      if (storeMatch) Logger.log(`店舗: ${storeMatch[1].trim()}`);

      // ラベル確認
      const labels = thread.getLabels();
      if (labels.length > 0) {
        Logger.log(`ラベル: ${labels.map(l => l.getName()).join(', ')}`);
      } else {
        Logger.log(`ラベル: なし`);
      }

      Logger.log('');
    }
  });

  Logger.log('='.repeat(60));
  if (foundCount === 0) {
    Logger.log('❌ 11月21日 12:30の予約は見つかりませんでした');
    Logger.log('\n【確認事項】');
    Logger.log('1. Gmailで該当メールが実際に存在するか確認してください');
    Logger.log('2. データベースで既に処理済みか確認してください');
    Logger.log('   URL: https://hallel-shibuya.vercel.app/admin/calendar?store=yoyogi-uehara&date=2025-11-21');
  } else {
    Logger.log(`✅ ${foundCount}件見つかりました`);
  }
  Logger.log('='.repeat(60));
}

/**
 * 特定のメールIDを処理する
 */
function processSpecificEmail() {
  const emailId = ''; // ← ここにメールIDを入力

  if (!emailId) {
    Logger.log('❌ エラー: emailIdを設定してください');
    Logger.log('   findYoyogiNov21Booking() でメールIDを確認してください');
    return;
  }

  Logger.log('='.repeat(60));
  Logger.log(`特定メール処理: ${emailId}`);
  Logger.log('='.repeat(60));

  try {
    const message = GmailApp.getMessageById(emailId);
    const thread = message.getThread();
    const body = message.getPlainBody();

    Logger.log(`件名: ${message.getSubject()}`);
    Logger.log(`送信日時: ${message.getDate()}`);

    const bookingInfo = parseEmailBody(body);

    if (bookingInfo) {
      Logger.log('\n予約情報:');
      Logger.log(JSON.stringify(bookingInfo, null, 2));

      // メールIDを追加
      bookingInfo.email_id = message.getId();
      bookingInfo.email_subject = message.getSubject();
      bookingInfo.email_date = message.getDate().toISOString();

      // APIに送信
      Logger.log('\nAPIに送信中...');
      const result = sendToFlaskAPI(bookingInfo);

      if (result.success) {
        Logger.log('✅ APIに送信成功');

        // ラベルを付ける
        const label = getOrCreateLabel();
        if (label) {
          thread.addLabel(label);
          Logger.log('✅ ラベルを付与');
        }

        message.markRead();
        Logger.log('✅ 既読にしました');
      } else {
        Logger.log(`❌ APIエラー: ${result.error}`);
      }
    } else {
      Logger.log('❌ 予約情報が抽出できませんでした');
    }

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
  }

  Logger.log('='.repeat(60));
}

/**
 * バッチ処理でAPIに送信（複数予約を1回で送信）
 */
function sendBatchToAPI(reservationsList) {
  if (!reservationsList || reservationsList.length === 0) {
    return { success: false, error: 'No reservations to send' };
  }

  try {
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: reservationsList.map(booking => ({
        date: booking.date,
        start: booking.start_time,
        end: booking.end_time || booking.start_time,
        customer_name: booking.customer_name || 'N/A',
        store: booking.store || 'shibuya',
        type: 'gmail',
        is_cancellation: booking.action_type === 'cancellation',
        source: 'gas_sync',
        email_id: booking.email_id || '',
        email_subject: booking.email_subject || '',
        email_date: booking.email_date || new Date().toISOString()
      }))
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
      return { success: true, count: reservationsList.length, data: JSON.parse(response.getContentText()) };
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
 * 【強制処理】全メールに対してラベル付与→API送信（バッチ処理版 + オフセット対応）
 * ラベルの有無に関わらず、全メールを処理
 * バックエンドが重複を自動的に上書き
 *
 * 使い方:
 * 1. removeAllProcessedLabels() でラベルを全削除
 * 2. forceProcessAllEmails() を実行（最初の500件）
 * 3. 続きがある場合、もう一度 forceProcessAllEmails() を実行（次の500件）
 * 4. resetProcessingOffset() で処理位置をリセット
 */
function forceProcessAllEmails() {
  Logger.log('='.repeat(60));
  Logger.log('【強制処理】全メール一斉処理開始（バッチ処理版）');
  Logger.log('='.repeat(60));

  const BATCH_SIZE = 50; // 50件ごとにバッチ送信
  const MAX_FETCH = 500; // 1回の実行で取得する最大件数

  try {
    // 前回の処理位置を取得
    const props = PropertiesService.getScriptProperties();
    const lastOffset = parseInt(props.getProperty('FORCE_PROCESS_OFFSET') || '0');

    Logger.log(`前回の処理位置: ${lastOffset}件目から`);
    Logger.log(`今回の取得範囲: ${lastOffset} - ${lastOffset + MAX_FETCH - 1}`);

    // ラベルを取得または作成
    const label = getOrCreateLabel();

    // 過去180日分のHALLEL関連メールを全件検索
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 180);
    const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

    // HALLEL関連のキーワードでフィルタ
    const keywordQuery = CONFIG.SEARCH_KEYWORDS
      .map(kw => `subject:${kw}`)
      .join(' OR ');

    const query = `from:noreply@em.hacomono.jp after:${dateStr} (${keywordQuery})`;
    Logger.log(`検索クエリ: ${query}`);
    Logger.log(`バッチサイズ: ${BATCH_SIZE}件ごとに送信\n`);

    // オフセットを使って取得
    const threads = GmailApp.search(query, lastOffset, MAX_FETCH);

    if (threads.length === 0) {
      Logger.log('これ以上処理対象のメールはありません。');
      Logger.log('全メールの処理が完了しました！');
      // オフセットをリセット
      props.setProperty('FORCE_PROCESS_OFFSET', '0');
      return;
    }

    Logger.log(`検索結果: ${threads.length}件のメール`);
    Logger.log('-'.repeat(60));

    let labelCount = 0;
    let parseErrorCount = 0;
    const reservationsBatch = [];
    const threadMap = {}; // index → thread のマッピング
    const messageMap = {}; // index → message のマッピング

    // ステップ1: メール本文を解析してHALLEL関連のみ抽出
    let hallelIndex = 0;
    threads.forEach((thread, index) => {
      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1];

      Logger.log(`\n[${index + 1}/${threads.length}] ${latestMessage.getSubject()}`);

      // まずメール本文を解析
      const body = latestMessage.getPlainBody();
      const bookingInfo = parseEmailBody(body);

      if (!bookingInfo) {
        Logger.log(`  - 予約情報なし（HALLEL関連ではない → スキップ）`);
        parseErrorCount++;
        return;
      }

      // HALLEL関連メールと確認できた → 処理対象に追加
      Logger.log(`  ✓ HALLEL関連メール確認: ${bookingInfo.store} / ${bookingInfo.customer_name}`);

      // メールメタデータを追加
      bookingInfo.email_id = latestMessage.getId();
      bookingInfo.email_subject = latestMessage.getSubject();
      bookingInfo.email_date = latestMessage.getDate().toISOString();

      reservationsBatch.push(bookingInfo);
      threadMap[hallelIndex] = thread;
      messageMap[hallelIndex] = latestMessage;
      hallelIndex++;
    });

    Logger.log('\n' + '='.repeat(60));
    Logger.log(`予約情報収集完了: ${reservationsBatch.length}件`);
    Logger.log(`スキップ（HALLEL関連外）: ${parseErrorCount}件`);
    Logger.log('='.repeat(60));

    // ステップ2: バッチ送信（50件ごと）
    let apiSuccessCount = 0;
    let apiErrorCount = 0;
    const apiSuccessIndices = [];

    for (let i = 0; i < reservationsBatch.length; i += BATCH_SIZE) {
      const batch = reservationsBatch.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(reservationsBatch.length / BATCH_SIZE);

      Logger.log(`\n【バッチ ${batchNum}/${totalBatches}】 ${batch.length}件を送信中...`);

      const result = sendBatchToAPI(batch);

      if (result.success) {
        Logger.log(`✓ バッチ送信成功: ${result.count}件`);
        apiSuccessCount += result.count;

        // 成功したインデックスを記録
        for (let j = i; j < i + batch.length; j++) {
          apiSuccessIndices.push(j);
        }
      } else {
        Logger.log(`✗ バッチ送信失敗: ${result.error}`);
        Logger.log(`  このバッチ${batch.length}件はラベル付与しません`);
        apiErrorCount += batch.length;
      }

      // レート制限対策: 1秒待機
      if (i + BATCH_SIZE < reservationsBatch.length) {
        Utilities.sleep(1000);
      }
    }

    // ステップ3: API送信成功したメールのみにラベル付与
    Logger.log('\n' + '='.repeat(60));
    Logger.log('API送信成功したメールにラベル付与中...');

    apiSuccessIndices.forEach(index => {
      const thread = threadMap[index];
      const message = messageMap[index];

      if (thread && message && label) {
        thread.addLabel(label);
        message.markRead();
        labelCount++;
      }
    });

    Logger.log(`ラベル付与完了: ${labelCount}件`);
    Logger.log('='.repeat(60));

    // 最終結果
    Logger.log('\n' + '='.repeat(60));
    Logger.log('【処理完了】');
    Logger.log(`総メール数: ${threads.length}件`);
    Logger.log(`ラベル付与: ${labelCount}件`);
    Logger.log(`予約収集: ${reservationsBatch.length}件`);
    Logger.log(`API送信成功: ${apiSuccessCount}件`);
    Logger.log(`APIエラー: ${apiErrorCount}件`);
    Logger.log(`解析失敗: ${parseErrorCount}件`);
    Logger.log(`API呼び出し回数: ${Math.ceil(reservationsBatch.length / BATCH_SIZE)}回`);

    // 次回の処理位置を保存
    const newOffset = lastOffset + threads.length;
    props.setProperty('FORCE_PROCESS_OFFSET', newOffset.toString());
    Logger.log(`\n次回の処理位置: ${newOffset}件目から`);

    if (threads.length >= MAX_FETCH) {
      Logger.log('\n⚠️ まだ続きがある可能性があります');
      Logger.log('もう一度 forceProcessAllEmails() を実行してください');
    } else {
      Logger.log('\n✅ 全メールの処理が完了しました！');
      props.setProperty('FORCE_PROCESS_OFFSET', '0');
    }

    Logger.log('='.repeat(60));

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 処理位置をリセット（最初からやり直す場合）
 */
function resetProcessingOffset() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('FORCE_PROCESS_OFFSET', '0');
  Logger.log('✅ 処理位置をリセットしました。次回は最初から処理されます。');
}

/**
 * 現在の処理位置を確認
 */
function checkProcessingOffset() {
  const props = PropertiesService.getScriptProperties();
  const offset = props.getProperty('FORCE_PROCESS_OFFSET') || '0';
  Logger.log(`現在の処理位置: ${offset}件目から`);
  return parseInt(offset);
}

/**
 * 【1件ずつ確実処理】全HALLEL関連メールを1件ずつAPI送信→ラベル付与
 * - 1件ずつAPI送信
 * - 成功したらラベル付与
 * - 失敗したらスキップ
 * - 全件処理（何千件あっても全部）
 */
function processOneByOne() {
  Logger.log('='.repeat(60));
  Logger.log('【1件ずつ確実処理】全HALLEL関連メールを処理');
  Logger.log('='.repeat(60));

  try {
    const label = getOrCreateLabel();
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 180);
    const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

    // HALLEL関連メールを全件検索
    const query = `from:noreply@em.hacomono.jp after:${dateStr} subject:hallel`;
    Logger.log(`検索クエリ: ${query}\n`);

    // 全件取得（GASの制限は500件/回）
    let allThreads = [];
    let offset = 0;
    const batchSize = 500;

    while (true) {
      const threads = GmailApp.search(query, offset, batchSize);
      if (threads.length === 0) break;

      allThreads = allThreads.concat(threads);
      offset += threads.length;

      if (threads.length < batchSize) break; // 最後のバッチ

      Logger.log(`検索中... ${allThreads.length}件取得`);
      Utilities.sleep(500);
    }

    Logger.log(`検索結果: ${allThreads.length}件のメール`);
    Logger.log('-'.repeat(60));

    let successCount = 0;
    let errorCount = 0;
    let skipCount = 0;

    // 1件ずつ処理
    allThreads.forEach((thread, index) => {
      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1];
      const body = latestMessage.getPlainBody();
      const subject = latestMessage.getSubject();

      Logger.log(`\n[${index + 1}/${allThreads.length}] ${subject}`);

      // 本文を解析
      const bookingInfo = parseEmailBody(body);

      if (!bookingInfo) {
        Logger.log('  → HALLEL関連外 → スキップ');
        skipCount++;
        return;
      }

      Logger.log(`  → HALLEL関連: ${bookingInfo.store} / ${bookingInfo.customer_name}`);

      // メタデータを追加
      bookingInfo.email_id = latestMessage.getId();
      bookingInfo.email_subject = subject;
      bookingInfo.email_date = latestMessage.getDate().toISOString();

      // 1件ずつAPI送信
      Logger.log(`  → API送信中...`);
      const result = sendToFlaskAPI(bookingInfo);

      if (result.success) {
        Logger.log(`  ✓ API送信成功 → ラベル付与`);

        // ラベル付与
        if (label) {
          thread.addLabel(label);
        }
        latestMessage.markRead();
        successCount++;
      } else {
        Logger.log(`  ✗ API送信失敗: ${result.error}`);
        errorCount++;
      }

      // レート制限対策: 500ms待機
      if ((index + 1) % 10 === 0) {
        Logger.log(`\n進捗: ${index + 1}/${allThreads.length} (成功:${successCount} / 失敗:${errorCount} / スキップ:${skipCount})`);
        Utilities.sleep(500);
      }
    });

    Logger.log('\n' + '='.repeat(60));
    Logger.log('【処理完了】');
    Logger.log(`総メール数: ${allThreads.length}件`);
    Logger.log(`API送信成功: ${successCount}件 → ラベル付与済み`);
    Logger.log(`API送信失敗: ${errorCount}件`);
    Logger.log(`スキップ: ${skipCount}件`);
    Logger.log('='.repeat(60));

    if (errorCount > 0) {
      Logger.log('\n⚠️ API送信失敗があります。ログを確認してください。');
    }

    if (successCount === allThreads.length - skipCount) {
      Logger.log('\n✅ 全HALLEL関連メールの処理が完了しました！');
    }

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * 【ラベル付き全メール処理】ラベルが付いている全メールを処理
 * - HALLEL関連：API送信成功 → ラベル保持、失敗 → ラベル削除
 * - HALLEL関連外：ラベル削除
 *
 * 使い方:
 * processAllLabeledEmails() を実行するだけ
 * 2000件以上ある場合は複数回実行してください
 */
function processAllLabeledEmails() {
  Logger.log('='.repeat(60));
  Logger.log('【ラベル付き全メール処理】開始');
  Logger.log('HALLEL関連のみAPI送信、それ以外はラベル削除');
  Logger.log('='.repeat(60));

  const BATCH_SIZE = 50; // API送信バッチサイズ
  const PROCESS_LIMIT = 500; // 1回の実行で処理する最大件数

  try {
    const label = GmailApp.getUserLabelByName(CONFIG.LABEL_NAME);

    if (!label) {
      Logger.log('ラベルが存在しません。処理するメールがありません。');
      return;
    }

    // ラベルが付いている全スレッドを取得
    const allThreads = label.getThreads(0, PROCESS_LIMIT);

    if (allThreads.length === 0) {
      Logger.log('ラベルが付いたメールはありません。');
      return;
    }

    Logger.log(`ラベル付きメール: ${allThreads.length}件`);
    Logger.log('-'.repeat(60));

    let hallelCount = 0;
    let otherGymCount = 0;
    let parseErrorCount = 0;
    const hallelEmails = []; // HALLEL関連メール
    const threadMap = {}; // index → thread
    const messageMap = {}; // index → message

    // ステップ1: 全メールを分類
    allThreads.forEach((thread, index) => {
      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1];
      const body = latestMessage.getPlainBody();
      const subject = latestMessage.getSubject();

      Logger.log(`\n[${index + 1}/${allThreads.length}] ${subject}`);

      // 本文を解析
      const bookingInfo = parseEmailBody(body);

      if (!bookingInfo) {
        Logger.log('  → HALLEL関連外（他のジムまたはパース失敗）→ ラベル削除予定');
        parseErrorCount++;
        // ラベルを削除
        thread.removeLabel(label);
        return;
      }

      // HALLEL関連メール
      Logger.log(`  → HALLEL関連: ${bookingInfo.store} / ${bookingInfo.customer_name}`);

      // メタデータを追加
      bookingInfo.email_id = latestMessage.getId();
      bookingInfo.email_subject = subject;
      bookingInfo.email_date = latestMessage.getDate().toISOString();

      hallelEmails.push(bookingInfo);
      threadMap[hallelCount] = thread;
      messageMap[hallelCount] = latestMessage;
      hallelCount++;
    });

    Logger.log('\n' + '='.repeat(60));
    Logger.log('【分類結果】');
    Logger.log(`HALLEL関連: ${hallelCount}件 → API送信`);
    Logger.log(`HALLEL関連外: ${parseErrorCount}件 → ラベル削除済み`);
    Logger.log('='.repeat(60));

    if (hallelCount === 0) {
      Logger.log('\nHALLEL関連メールがありません。処理完了。');
      return;
    }

    // ステップ2: HALLEL関連メールをバッチ送信
    let apiSuccessCount = 0;
    let apiErrorCount = 0;
    const apiSuccessIndices = [];

    for (let i = 0; i < hallelEmails.length; i += BATCH_SIZE) {
      const batch = hallelEmails.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(hallelEmails.length / BATCH_SIZE);

      Logger.log(`\n【バッチ ${batchNum}/${totalBatches}】 ${batch.length}件を送信中...`);

      const result = sendBatchToAPI(batch);

      if (result.success) {
        Logger.log(`✓ バッチ送信成功: ${result.count}件`);
        apiSuccessCount += result.count;

        // 成功したインデックスを記録
        for (let j = i; j < i + batch.length; j++) {
          apiSuccessIndices.push(j);
        }
      } else {
        Logger.log(`✗ バッチ送信失敗: ${result.error}`);
        apiErrorCount += batch.length;

        // 失敗したメールのラベルを削除
        for (let j = i; j < i + batch.length; j++) {
          const thread = threadMap[j];
          if (thread) {
            thread.removeLabel(label);
          }
        }
      }

      if (i + BATCH_SIZE < hallelEmails.length) {
        Utilities.sleep(1000);
      }
    }

    // ステップ3: API送信成功したメールを既読にする
    Logger.log('\n' + '='.repeat(60));
    Logger.log('API送信成功したメールを既読にします...');

    let readCount = 0;
    apiSuccessIndices.forEach(index => {
      const message = messageMap[index];
      if (message) {
        message.markRead();
        readCount++;
      }
    });

    Logger.log(`既読完了: ${readCount}件`);
    Logger.log('='.repeat(60));

    // 最終結果
    Logger.log('\n【処理完了】');
    Logger.log(`処理開始時のラベル付きメール: ${allThreads.length}件`);
    Logger.log(`HALLEL関連: ${hallelCount}件`);
    Logger.log(`HALLEL関連外（ラベル削除済み）: ${parseErrorCount}件`);
    Logger.log(`API送信成功: ${apiSuccessCount}件（ラベル保持）`);
    Logger.log(`API送信失敗: ${apiErrorCount}件（ラベル削除済み）`);

    // 残りのラベル数を確認
    const remainingThreads = label.getThreads().length;
    Logger.log(`\n現在のラベル付きメール: ${remainingThreads}件`);

    if (remainingThreads > 0) {
      Logger.log('\n⚠️ まだラベル付きメールがあります');
      Logger.log('もう一度 processAllLabeledEmails() を実行してください');
    } else {
      Logger.log('\n✅ 全てのラベル付きメールの処理が完了しました！');
    }

    Logger.log('='.repeat(60));

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}
