/**
 * HALLEL渋谷店 - GASスクリプト
 *
 * hallel-shibuya@gmail.com のGASにコピペするだけで動作します！
 *
 * 機能:
 * - 10分ごとの自動トリガー
 * - Gmailから予約メール取得
 * - STUDIO ①~⑦ の部屋名抽出
 * - Vercel API送信
 * - キャンセル処理
 *
 * ※ カレンダー同期は行いません（Vercel APIのみ）
 *
 * 使い方:
 * 1. このコードをGASにコピペ
 * 2. setupTrigger10min() を実行（トリガー設定）
 * 3. 以降は自動で10分ごとに実行されます
 */

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  STORE_NAME: 'shibuya',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel 渋谷',
  STORE_KEYWORD: '渋谷',
  API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',
  API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',
  BATCH_SIZE: 5,
  WAIT_TIME_MS: 3000,
};

// ============================================================
// トリガー設定関数
// ============================================================

/**
 * トリガーを設定（10分ごと）- 推奨
 */
function setupTrigger10min() {
  deleteAllTriggers();

  ScriptApp.newTrigger('processNewReservations')
    .timeBased()
    .everyMinutes(10)
    .create();

  Logger.log('トリガー設定完了: 10分ごとに新規メールを処理');
  Logger.log('実行される関数: processNewReservations()');
}

/**
 * トリガーを設定（1時間ごと）
 */
function setupTrigger1hour() {
  deleteAllTriggers();

  ScriptApp.newTrigger('processNewReservations')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('トリガー設定完了: 1時間ごとに新規メールを処理');
}

/**
 * 既存のトリガーをすべて削除
 */
function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  Logger.log(`既存のトリガーを削除: ${triggers.length}件`);
}

/**
 * 現在のトリガー一覧を表示
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  Logger.log('現在のトリガー一覧:');
  Logger.log('='.repeat(60));

  if (triggers.length === 0) {
    Logger.log('トリガーが設定されていません');
    Logger.log('setupTrigger10min() を実行してください');
    return;
  }

  triggers.forEach((trigger, index) => {
    Logger.log(`${index + 1}. ${trigger.getHandlerFunction()}`);
    Logger.log(`   種類: ${trigger.getEventType()}`);
  });
}

// ============================================================
// メイン処理：新規予約メールを処理（トリガーから呼ばれる）
// ============================================================

/**
 * 新規予約メールを処理してVercel APIに送信
 * この関数がトリガーから呼ばれます
 */
function processNewReservations() {
  Logger.log('='.repeat(60));
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：新規メール処理開始】`);
  Logger.log(`実行時刻: ${new Date().toLocaleString('ja-JP')}`);
  Logger.log('='.repeat(60));

  try {
    // 過去1時間のメールを取得
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const searchQuery = `${CONFIG.SEARCH_QUERY} after:${Math.floor(oneHourAgo.getTime() / 1000)}`;
    const threads = GmailApp.search(searchQuery);

    Logger.log(`検索クエリ: ${searchQuery}`);
    Logger.log(`新規スレッド: ${threads.length}件`);

    if (threads.length === 0) {
      Logger.log('新しいメールがありません');
      Logger.log('='.repeat(60));
      return { success: true, processed: 0 };
    }

    const newReservations = [];
    const newCancellations = [];

    for (let thread of threads) {
      const messages = thread.getMessages();

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getPlainBody();
        const emailDate = message.getDate();
        const messageId = message.getId();

        // 過去1時間以内のメールのみ処理
        if (emailDate < oneHourAgo) continue;

        // 渋谷店のメールかチェック
        if (!body.includes(CONFIG.STORE_KEYWORD)) continue;

        // 他店舗のメールは除外
        if (body.includes('恵比寿') || body.includes('半蔵門') ||
            body.includes('代々木上原') || body.includes('中目黒')) continue;

        const emailData = parseReservationEmail(subject, body, emailDate, messageId);
        if (emailData) {
          if (emailData.actionType === 'reservation') {
            newReservations.push(emailData);
            Logger.log(`予約: ${emailData.fullName} (${emailData.studio}) ${formatDateTime(emailData.startTime)}`);
          } else if (emailData.actionType === 'cancellation') {
            newCancellations.push(emailData);
            Logger.log(`キャンセル: ${emailData.fullName} (${emailData.studio}) ${formatDateTime(emailData.startTime)}`);
          }
        }
      }
    }

    // 予約とキャンセルを結合
    const allData = [...newReservations, ...newCancellations];
    Logger.log(`\n送信対象: ${allData.length}件（予約: ${newReservations.length}件, キャンセル: ${newCancellations.length}件）`);

    if (allData.length === 0) {
      Logger.log('送信対象のデータがありません');
      Logger.log('='.repeat(60));
      return { success: true, processed: 0 };
    }

    // Vercel APIに送信
    const apiResult = sendBatchToVercelAPI(allData);

    if (apiResult.success) {
      Logger.log(`Vercel API送信成功: ${apiResult.count}件`);
    } else {
      Logger.log(`Vercel API送信失敗: ${apiResult.error}`);
    }

    Logger.log('\n' + '='.repeat(60));
    Logger.log('【処理完了】');
    Logger.log('='.repeat(60));

    return {
      success: true,
      processed: allData.length,
      reservations: newReservations.length,
      cancellations: newCancellations.length
    };

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
    Logger.log(error.stack);
    return { success: false, error: error.message };
  }
}

// ============================================================
// データ抽出関数
// ============================================================

/**
 * メールから予約情報を抽出
 */
function parseReservationEmail(subject, body, emailDate, messageId) {
  try {
    const fullName = extractFullName(body);
    const eventTime = extractEventTime(body);
    const studio = extractStudio(body);

    if (!eventTime.startTime || !eventTime.endTime) {
      return null;
    }

    // 予約 or キャンセル
    const isReservation = subject.includes('予約完了');
    const isCancellation = subject.includes('キャンセル');

    if (!isReservation && !isCancellation) {
      return null;
    }

    return {
      fullName: fullName,
      startTime: eventTime.startTime,
      endTime: eventTime.endTime,
      studio: studio,
      actionType: isReservation ? 'reservation' : 'cancellation',
      emailDate: emailDate,
      messageId: messageId || '',
      key: `${fullName}|${eventTime.startTime.getTime()}|${eventTime.endTime.getTime()}|${studio}`
    };

  } catch (error) {
    Logger.log(`メール解析エラー: ${error.message}`);
    return null;
  }
}

/**
 * 部屋名を抽出（渋谷店: STUDIO ①~⑦）
 * メール形式: 「設備： 渋谷店 STUDIO ⑦ (1)」
 */
function extractStudio(body) {
  // パターン1: 「設備： 渋谷店 STUDIO ⑦ (1)」形式
  const studioMatch = body.match(/設備[：:]\s*渋谷店\s*STUDIO\s*([①②③④⑤⑥⑦])/);
  if (studioMatch) {
    return `STUDIO ${studioMatch[1]}`;
  }

  // パターン2: 本文中に「STUDIO ①」などが含まれている
  const studioNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
  for (const num of studioNumbers) {
    if (body.includes(`STUDIO ${num}`) || body.includes(`STUDIO${num}`)) {
      return `STUDIO ${num}`;
    }
  }

  // デフォルト
  return '渋谷店';
}

/**
 * 氏名を抽出
 */
function extractFullName(body) {
  const nameMatch = body.match(/(.+?) 様/);
  return nameMatch ? nameMatch[1].trim() : 'Unknown';
}

/**
 * 日時を抽出
 */
function extractEventTime(body) {
  const match = body.match(/日時[：:]\s*([\d]{4}年[\d]{1,2}月[\d]{1,2}日)[^\d]*(\d{1,2}:\d{2})\s*[〜～~-]\s*(\d{1,2}:\d{2})/);

  if (match) {
    const dateStr = match[1].replace(/年/g, '/').replace(/月/g, '/').replace(/日/g, '');
    const start = new Date(`${dateStr} ${match[2]}`);
    const end = new Date(`${dateStr} ${match[3]}`);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { startTime: null, endTime: null };
    }

    return { startTime: start, endTime: end };
  }

  return { startTime: null, endTime: null };
}

// ============================================================
// Vercel API送信関数
// ============================================================

/**
 * バッチデータをVercel APIに送信
 */
function sendBatchToVercelAPI(reservations) {
  try {
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: reservations.map(r => ({
        date: formatDate(r.startTime),
        start: formatTimeOnly(r.startTime),
        end: formatTimeOnly(r.endTime),
        customer_name: r.fullName || 'N/A',
        room_name: r.studio || '渋谷店',
        store: CONFIG.STORE_NAME,
        type: 'gmail',
        is_cancellation: r.actionType === 'cancellation',
        source: 'gas_sync',
        email_id: r.messageId || '',
        email_subject: '',
        email_date: r.emailDate.toISOString()
      }))
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-API-Key': CONFIG.API_KEY
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(CONFIG.API_URL, options);
    const statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      return { success: true, count: reservations.length };
    } else {
      return {
        success: false,
        error: `HTTP ${statusCode}: ${response.getContentText().substring(0, 200)}`
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * Date を YYYY-MM-DD 形式に変換
 */
function formatDate(date) {
  return Utilities.formatDate(date, 'JST', 'yyyy-MM-dd');
}

/**
 * Date を HH:mm 形式に変換
 */
function formatTimeOnly(date) {
  return Utilities.formatDate(date, 'JST', 'HH:mm');
}

/**
 * Date を yyyy/MM/dd HH:mm 形式に変換
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, 'JST', 'yyyy/MM/dd HH:mm');
}

// ============================================================
// 一括同期関数（初回セットアップ用）
// ============================================================

/**
 * 過去の全メールから最新状態をVercel APIに一括送信
 * ※ 初回セットアップ時のみ使用
 */
function syncAllToAPI() {
  Logger.log('='.repeat(60));
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：全データ一括同期】`);
  Logger.log('='.repeat(60));

  try {
    // 全メールを取得
    Logger.log('\n全メールを取得中...');
    const threads = GmailApp.search(CONFIG.SEARCH_QUERY);
    Logger.log(`スレッド数: ${threads.length}件`);

    const allEmails = [];

    for (let thread of threads) {
      const messages = thread.getMessages();

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getPlainBody();
        const emailDate = message.getDate();
        const messageId = message.getId();

        // 渋谷店のメールのみ
        if (!body.includes(CONFIG.STORE_KEYWORD)) continue;

        // 他店舗のメールは除外
        if (body.includes('恵比寿') || body.includes('半蔵門') ||
            body.includes('代々木上原') || body.includes('中目黒')) continue;

        const emailData = parseReservationEmail(subject, body, emailDate, messageId);
        if (emailData) {
          allEmails.push(emailData);
        }
      }
    }

    Logger.log(`取得完了: ${allEmails.length}件`);

    // 日時・時間枠ごとに最新のメールのみを選択
    const groupedByKey = {};
    for (let email of allEmails) {
      if (!groupedByKey[email.key]) {
        groupedByKey[email.key] = [];
      }
      groupedByKey[email.key].push(email);
    }

    const latestOnly = [];
    for (let key in groupedByKey) {
      const emails = groupedByKey[key];
      emails.sort((a, b) => a.emailDate.getTime() - b.emailDate.getTime());
      latestOnly.push(emails[emails.length - 1]);
    }

    Logger.log(`最新状態: ${latestOnly.length}件`);

    // 予約のみをフィルタ（キャンセルは除外）
    const reservationsOnly = latestOnly.filter(r => r.actionType === 'reservation');
    Logger.log(`送信対象（予約のみ）: ${reservationsOnly.length}件`);

    // Vercel APIに送信
    const BATCH_SIZE = 50;
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < reservationsOnly.length; i += BATCH_SIZE) {
      const batch = reservationsOnly.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(reservationsOnly.length / BATCH_SIZE);

      Logger.log(`\n【バッチ ${batchNum}/${totalBatches}】 ${batch.length}件を送信中...`);

      const result = sendBatchToVercelAPI(batch);

      if (result.success) {
        Logger.log(`成功: ${result.count}件`);
        totalSuccess += result.count;
      } else {
        Logger.log(`失敗: ${result.error}`);
        totalFailed += batch.length;
      }

      if (i + BATCH_SIZE < reservationsOnly.length) {
        Utilities.sleep(1000);
      }
    }

    Logger.log('\n' + '='.repeat(60));
    Logger.log(`【処理完了】`);
    Logger.log(`全メール: ${allEmails.length}件`);
    Logger.log(`最新状態: ${latestOnly.length}件`);
    Logger.log(`送信対象: ${reservationsOnly.length}件`);
    Logger.log(`成功: ${totalSuccess}件`);
    Logger.log(`失敗: ${totalFailed}件`);
    Logger.log('='.repeat(60));

    return { success: true, total: totalSuccess, failed: totalFailed };

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
    Logger.log(error.stack);
    return { success: false, error: error.message };
  }
}

// ============================================================
// テスト・デバッグ関数
// ============================================================

/**
 * 手動テスト: processNewReservations を直接実行
 */
function testProcessNewReservations() {
  Logger.log('テスト実行: processNewReservations()');
  const result = processNewReservations();
  Logger.log('\n結果:');
  Logger.log(JSON.stringify(result, null, 2));
}

/**
 * API接続テスト
 */
function testAPIConnection() {
  Logger.log('API接続テスト開始...');
  Logger.log(`API URL: ${CONFIG.API_URL}`);

  try {
    const testPayload = {
      source: 'gas_test',
      timestamp: new Date().toISOString(),
      reservations: []
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-API-Key': CONFIG.API_KEY
      },
      payload: JSON.stringify(testPayload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(CONFIG.API_URL, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log(`ステータスコード: ${statusCode}`);
    Logger.log(`レスポンス: ${responseText.substring(0, 500)}`);

    if (statusCode >= 200 && statusCode < 300) {
      Logger.log('API接続成功！');
    } else if (statusCode === 400 && responseText.includes('No reservations provided')) {
      Logger.log('API接続成功！（空データテスト - 期待通りの400レスポンス）');
    } else if (statusCode === 401 || statusCode === 403) {
      Logger.log('API認証エラー - APIキーを確認してください');
    } else {
      Logger.log(`API接続失敗 (HTTP ${statusCode})`);
    }

  } catch (error) {
    Logger.log(`ネットワークエラー: ${error.message}`);
  }
}

/**
 * Gmailの検索テスト
 */
function testGmailSearch() {
  Logger.log('Gmail検索テスト開始...');
  Logger.log(`検索クエリ: ${CONFIG.SEARCH_QUERY}`);

  try {
    const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, 10);
    Logger.log(`見つかったスレッド: ${threads.length}件`);

    for (let i = 0; i < Math.min(threads.length, 5); i++) {
      const thread = threads[i];
      const messages = thread.getMessages();
      const firstMessage = messages[0];
      Logger.log(`\n--- メール ${i + 1} ---`);
      Logger.log(`件名: ${firstMessage.getSubject()}`);
      Logger.log(`日付: ${firstMessage.getDate()}`);
    }

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
  }
}

/**
 * 部屋名抽出のテスト
 */
function testExtractStudio() {
  const testCases = [
    '設備： 渋谷店 STUDIO ① (1)',
    '設備： 渋谷店 STUDIO ② (1)',
    '設備： 渋谷店 STUDIO ③ (1)',
    '設備： 渋谷店 STUDIO ④ (1)',
    '設備： 渋谷店 STUDIO ⑤ (1)',
    '設備： 渋谷店 STUDIO ⑥ (1)',
    '設備： 渋谷店 STUDIO ⑦ (1)',
    'STUDIO ③ での予約',
    '不明なルーム'
  ];

  Logger.log('部屋名抽出テスト:');
  Logger.log('='.repeat(60));

  testCases.forEach(body => {
    const room = extractStudio(body);
    Logger.log(`"${body}" → "${room}"`);
  });
}
