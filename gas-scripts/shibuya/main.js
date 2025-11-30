/**
 * HALLEL渋谷店 - GASスクリプト
 *
 * hallel-shibuya@gmail.com のGASにコピペするだけで動作します！
 *
 * 使い方:
 * 1. このコードをGASにコピペ
 * 2. setupTrigger10min() を実行
 * 3. 以降は自動で10分ごとに実行されます
 */

// ============================================================
// 【店舗固有の設定】 - ここだけ変更すればOK
// ============================================================
const CONFIG = {
  STORE_NAME: 'shibuya',
  STORE_KEYWORD: '渋谷',
  SEARCH_QUERY: 'from:noreply@em.hacomono.jp subject:hallel',
  INCLUDE_KEYWORD: '渋谷店',  // この店舗のメールのみ処理
  EXCLUDE_KEYWORDS: ['恵比寿店', '半蔵門店', '代々木上原店', '中目黒店'],  // 他店舗を確実に除外
  DEFAULT_ROOM: '渋谷店',
  API_URL: 'https://hallel-shibuya.vercel.app/api/gas/webhook',
  API_KEY: 'Wh00k@2025!Secure$Token#ABC123XYZ',
  // カレンダー同期（null = 同期しない）
  CALENDAR_ID: null,
  // 処理済みラベル
  LABEL_NAME: 'HALLEL_処理済み_渋谷',
};

/**
 * 【店舗固有】部屋名を抽出（渋谷店: STUDIO ①~⑦）
 */
function extractStudio(body) {
  // パターン1: 「設備： 渋谷店 STUDIO ⑦ (1)」形式
  const match = body.match(/設備[：:]\s*渋谷店\s*STUDIO\s*([①②③④⑤⑥⑦])/);
  if (match) return `STUDIO ${match[1]}`;

  // パターン2: 本文中に「STUDIO ①」などが含まれている
  const nums = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
  for (const n of nums) {
    if (body.includes(`STUDIO ${n}`) || body.includes(`STUDIO${n}`)) {
      return `STUDIO ${n}`;
    }
  }

  return CONFIG.DEFAULT_ROOM;
}

// ============================================================
// 【共通コード】 以下は全店舗で共通
// ============================================================

function setupTrigger10min() {
  deleteAllTriggers();
  ScriptApp.newTrigger('processNewReservations').timeBased().everyMinutes(10).create();
  Logger.log(`トリガー設定完了: 10分ごと (${CONFIG.STORE_KEYWORD}店)`);
}

function setupTrigger1hour() {
  deleteAllTriggers();
  ScriptApp.newTrigger('processNewReservations').timeBased().everyHours(1).create();
  Logger.log(`トリガー設定完了: 1時間ごと (${CONFIG.STORE_KEYWORD}店)`);
}

function deleteAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log(`トリガー削除: ${triggers.length}件`);
}

function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`現在のトリガー: ${triggers.length}件`);
  triggers.forEach((t, i) => Logger.log(`${i + 1}. ${t.getHandlerFunction()}`));
}

/**
 * 【最強店舗判定ロジック】多層防御による完璧な店舗メール検証
 *
 * @param {string} subject - メールの件名
 * @param {string} body - メールの本文
 * @param {string[]} lines - メール本文を行に分割した配列
 * @param {string} storeKeyword - 店舗キーワード（例：'渋谷'）
 * @param {string} includeKeyword - 含むべきキーワード（例：'渋谷店'）
 * @param {string[]} excludeKeywords - 除外キーワード配列
 * @returns {Object} {isValid: boolean, reason: string, confidence: number}
 */
function validateStoreEmail(subject, body, lines, storeKeyword, includeKeyword, excludeKeywords) {
  let confidence = 0;
  const reasons = [];

  // ====== 第1層: 件名チェック ======
  let subjectCheck = false;
  if (subject.includes(includeKeyword)) {
    subjectCheck = true;
    confidence += 40;
    reasons.push(`件名に「${includeKeyword}」含有`);
  } else if (subject.includes(storeKeyword)) {
    subjectCheck = true;
    confidence += 20;
    reasons.push(`件名に「${storeKeyword}」含有`);
  }

  // ====== 第2層: 厳密な店舗行検出 ======
  let storeLineValid = false;
  let storeLineConfidence = 0;

  // パターン1: 標準的な「店舗：」行
  const standardStoreLine = lines.find(line => {
    const trimmed = line.trim();
    return trimmed.match(/^店舗[：:]\s*/) && trimmed.includes(`HALLEL ${includeKeyword}`);
  });

  if (standardStoreLine) {
    storeLineValid = true;
    storeLineConfidence = 50;
    reasons.push(`標準店舗行発見: [${standardStoreLine.trim()}]`);
  } else {
    // パターン2: 「店舗」を含む行で条件緩和
    const relaxedStoreLines = lines.filter(line =>
      line.includes('店舗') &&
      line.includes('HALLEL') &&
      line.includes(includeKeyword)
    );

    if (relaxedStoreLines.length === 1) {
      storeLineValid = true;
      storeLineConfidence = 35;
      reasons.push(`緩和店舗行発見(単一): [${relaxedStoreLines[0].trim()}]`);
    } else if (relaxedStoreLines.length > 1) {
      // 複数の店舗行がある場合は最も詳細な行を選ぶ
      const bestLine = relaxedStoreLines.reduce((best, current) => {
        const currentScore = (current.includes('設備') ? 10 : 0) +
                           (current.match(/[：:]/g) || []).length * 5;
        const bestScore = (best.includes('設備') ? 10 : 0) +
                         (best.match(/[：:]/g) || []).length * 5;
        return currentScore > bestScore ? current : best;
      });

      storeLineValid = true;
      storeLineConfidence = 30;
      reasons.push(`緩和店舗行発見(複数から選択): [${bestLine.trim()}]`);
    }
  }

  confidence += storeLineConfidence;

  // ====== 第3層: 除外キーワード位置チェック ======
  let excludeCheckPassed = true;
  let excludeDetails = [];

  for (const excludeKeyword of excludeKeywords) {
    if (body.includes(excludeKeyword)) {
      const matchingLines = lines
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) => line.includes(excludeKeyword));

      // フッター・署名・リンクエリアでの検出は許可（下位50%の行）
      const footerThreshold = Math.floor(lines.length * 0.5);
      const criticalMatches = matchingLines.filter(({ index }) => index < footerThreshold);

      if (criticalMatches.length > 0) {
        excludeCheckPassed = false;
        excludeDetails.push(`除外キーワード「${excludeKeyword}」が本文上部で検出: 行${criticalMatches[0].index}`);
      } else {
        excludeDetails.push(`除外キーワード「${excludeKeyword}」はフッター領域のみ（許可）`);
        confidence += 5; // フッター領域のみの場合は軽微なボーナス
      }
    } else {
      confidence += 10; // 除外キーワードが全く無い場合のボーナス
    }
  }

  // ====== 第4層: 総合判定 ======
  let isValid = false;
  let finalReason = '';

  if (!storeLineValid) {
    finalReason = `店舗行検出失敗: 「店舗」「HALLEL」「${includeKeyword}」を含む行が見つかりません`;
  } else if (!excludeCheckPassed) {
    finalReason = `除外チェック失敗: ${excludeDetails.filter(d => d.includes('本文上部')).join(', ')}`;
  } else {
    isValid = true;
    confidence = Math.min(confidence, 100);
    finalReason = `多層検証成功: ${reasons.join(', ')}`;
  }

  return {
    isValid,
    reason: finalReason,
    confidence,
    details: {
      subjectCheck,
      storeLineValid,
      excludeCheckPassed,
      excludeDetails
    }
  };
}

function processNewReservations() {
  Logger.log('='.repeat(60));
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：処理開始】${new Date().toLocaleString('ja-JP')}`);

  try {
    // ラベル取得/作成
    const label = GmailApp.getUserLabelByName(CONFIG.LABEL_NAME) ||
      GmailApp.createLabel(CONFIG.LABEL_NAME);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const query = `${CONFIG.SEARCH_QUERY} -label:${CONFIG.LABEL_NAME} after:${Math.floor(oneHourAgo.getTime() / 1000)}`;
    const threads = GmailApp.search(query);

    Logger.log(`未処理スレッド: ${threads.length}件`);
    if (threads.length === 0) return { success: true, processed: 0 };

    const reservations = [];
    const cancellations = [];
    const processedThreads = [];

    for (const thread of threads) {
      let hasValidData = false;

      for (const msg of thread.getMessages()) {
        if (msg.getDate() < oneHourAgo) continue;

        const body = msg.getPlainBody();
        const subject = msg.getSubject();
        const msgId = msg.getId();

        // 【デバッグログ強化】メール構造の詳細調査
        Logger.log(`\n=== メール詳細調査 [${msgId}] ===`);
        Logger.log(`件名: ${subject}`);
        Logger.log(`--- body.length: ${body.length} ---`);
        Logger.log(`--- 改行コード検出 ---`);
        Logger.log(`\\r\\n数: ${(body.match(/\r\n/g) || []).length}`);
        Logger.log(`\\r数: ${(body.match(/\r/g) || []).length}`);
        Logger.log(`\\n数: ${(body.match(/\n/g) || []).length}`);

        // 最初の200文字を16進数で表示（隠し文字検出）
        const first200 = body.substring(0, 200);
        const hexDump = first200.split('').map(c => `${c}[${c.charCodeAt(0).toString(16)}]`).slice(0, 10).join('');
        Logger.log(`--- 最初10文字の16進数 ---\n${hexDump}`);

        // この店舗のメールかチェック（最強ロジック：行単位で解析）
        const lines = body.split(/\r\n|\r|\n/);
        Logger.log(`--- 行分割結果 ---`);
        Logger.log(`総行数: ${lines.length}`);

        // 「店舗」を含む行をすべて表示
        const storeLines = lines.filter((line, i) => {
          const containsStore = line.includes('店舗');
          if (containsStore) {
            Logger.log(`行${i+1}: [${line.trim()}]`);
          }
          return containsStore;
        });
        Logger.log(`「店舗」を含む行: ${storeLines.length}件`);

        // 現在のロジックでの判定結果
        const storeLine = lines.find(line => line.trim().match(/^店舗[：:]/));
        Logger.log(`--- 現在の判定結果 ---`);
        if (storeLine) {
          Logger.log(`店舗行発見: [${storeLine.trim()}]`);
          Logger.log(`渋谷店含有: ${storeLine.includes('HALLEL 渋谷店')}`);
          Logger.log(`代々木上原店含有: ${storeLine.includes('HALLEL 代々木上原店')}`);
          Logger.log(`他店舗含有: ${CONFIG.EXCLUDE_KEYWORDS.map(k => `${k}:${storeLine.includes(k)}`).join(', ')}`);
        } else {
          Logger.log(`店舗行なし（正規表現 ^店舗[：:] にマッチしない）`);
        }

        // body全体での他店舗キーワード検出
        const excludeMatches = CONFIG.EXCLUDE_KEYWORDS.filter(k => body.includes(k));
        if (excludeMatches.length > 0) {
          Logger.log(`--- 除外キーワード検出 ---`);
          excludeMatches.forEach(keyword => {
            // キーワードが出現する行を特定
            const matchingLines = lines.filter((line, i) => {
              if (line.includes(keyword)) {
                Logger.log(`除外キーワード「${keyword}」検出 行${i+1}: [${line.trim()}]`);
                return true;
              }
              return false;
            });
          });
        }

        Logger.log(`=== 調査終了 ===\n`);

        // 【新ロジック】最強店舗判定（多層防御）
        const storeValidation = validateStoreEmail(subject, body, lines, CONFIG.STORE_KEYWORD, CONFIG.INCLUDE_KEYWORD, CONFIG.EXCLUDE_KEYWORDS);

        Logger.log(`--- 最強店舗判定結果 ---`);
        Logger.log(`検証結果: ${storeValidation.isValid ? '✅ 有効' : '❌ 無効'}`);
        Logger.log(`判定理由: ${storeValidation.reason}`);
        Logger.log(`信頼度: ${storeValidation.confidence}%`);

        if (!storeValidation.isValid) {
          Logger.log(`❌ スキップ: ${storeValidation.reason}`);
          continue;
        }

        Logger.log(`✅ 処理対象: ${CONFIG.STORE_KEYWORD}店のメール（信頼度${storeValidation.confidence}%）`);

        // 既存の処理を継続...

        const data = parseEmail(msg.getSubject(), body, msg.getDate(), msg.getId());
        if (data) {
          (data.actionType === 'reservation' ? reservations : cancellations).push(data);
          const labelText = data.isCharter ? '【貸切】' : '';
          Logger.log(`${data.actionType === 'reservation' ? '予約' : 'キャンセル'}: ${data.fullName} (${data.studio}) ${labelText}`);
          hasValidData = true;
        }
      }

      if (hasValidData) {
        processedThreads.push(thread);
      }
    }

    const allData = [...reservations, ...cancellations];
    Logger.log(`送信対象: ${allData.length}件`);

    if (allData.length === 0) return { success: true, processed: 0 };

    const result = sendToAPI(allData);
    Logger.log(result.success ? `API送信成功: ${result.count}件` : `API送信失敗: ${result.error}`);

    // API送信成功時のみラベル追加
    if (result.success) {
      processedThreads.forEach(t => t.addLabel(label));
      Logger.log(`ラベル追加: ${processedThreads.length}スレッド`);
    }

    // カレンダー同期（設定されている場合のみ）
    if (CONFIG.CALENDAR_ID) {
      syncToCalendar(reservations, cancellations);
    }

    Logger.log('【処理完了】');
    return { success: true, processed: allData.length };

  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function parseEmail(subject, body, emailDate, messageId) {
  try {
    const fullName = (body.match(/(.+?) 様/) || [])[1]?.trim() || 'Unknown';
    const timeMatch = body.match(/日時[：:]\s*([\d]{4}年[\d]{1,2}月[\d]{1,2}日)[^\d]*(\d{1,2}:\d{2})\s*[〜～~-]\s*(\d{1,2}:\d{2})/);

    if (!timeMatch) return null;

    const dateStr = timeMatch[1].replace(/年/g, '/').replace(/月/g, '/').replace(/日/g, '');
    const startTime = new Date(`${dateStr} ${timeMatch[2]}`);
    const endTime = new Date(`${dateStr} ${timeMatch[3]}`);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return null;

    const isReservation = subject.includes('予約完了');
    const isCancellation = subject.includes('キャンセル');
    if (!isReservation && !isCancellation) return null;

    const studio = extractStudio(body);
    const isCharter = body.includes('貸切利用') || body.includes('貸切');

    return {
      fullName, startTime, endTime, studio, isCharter,
      actionType: isReservation ? 'reservation' : 'cancellation',
      emailDate, messageId,
      key: `${fullName}|${startTime.getTime()}|${endTime.getTime()}|${studio}`
    };
  } catch (e) {
    Logger.log(`解析エラー: ${e.message}`);
    return null;
  }
}

function sendToAPI(reservations) {
  try {
    const payload = {
      source: 'gas',
      timestamp: new Date().toISOString(),
      reservations: reservations.map(r => ({
        date: Utilities.formatDate(r.startTime, 'JST', 'yyyy-MM-dd'),
        start: Utilities.formatDate(r.startTime, 'JST', 'HH:mm'),
        end: Utilities.formatDate(r.endTime, 'JST', 'HH:mm'),
        customer_name: r.fullName,
        room_name: r.studio,
        store: CONFIG.STORE_NAME,
        type: r.isCharter ? 'charter' : 'gmail',
        is_cancellation: r.actionType === 'cancellation',
        is_charter: r.isCharter || false,
        source: 'gas_sync',
        email_id: r.messageId,
        email_date: r.emailDate.toISOString()
      }))
    };

    const res = UrlFetchApp.fetch(CONFIG.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-Key': CONFIG.API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    return code >= 200 && code < 300
      ? { success: true, count: reservations.length }
      : { success: false, error: `HTTP ${code}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function syncToCalendar(reservations, cancellations) {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!calendar) {
    Logger.log(`カレンダー未設定: ${CONFIG.CALENDAR_ID}`);
    return;
  }

  let added = 0, deleted = 0;

  for (const r of reservations) {
    const title = r.isCharter ? `${r.fullName} - HALLEL-【貸切】` : `${r.fullName} - HALLEL-${r.studio}`;
    const events = calendar.getEvents(
      new Date(r.startTime.getTime() - 60000),
      new Date(r.endTime.getTime() + 60000)
    );

    const exists = events.some(e =>
      e.getTitle() === title &&
      Math.abs(e.getStartTime().getTime() - r.startTime.getTime()) < 60000
    );

    if (!exists) {
      calendar.createEvent(title, r.startTime, r.endTime);
      added++;
    }
  }

  for (const r of cancellations) {
    const events = calendar.getEvents(
      new Date(r.startTime.getTime() - 300000),
      new Date(r.endTime.getTime() + 300000)
    );

    for (const e of events) {
      if (e.getTitle().includes(r.fullName) && e.getTitle().includes('HALLEL')) {
        e.deleteEvent();
        deleted++;
      }
    }
  }

  Logger.log(`カレンダー: 追加${added}件, 削除${deleted}件`);
}

function syncAllToAPI() {
  Logger.log(`【${CONFIG.STORE_KEYWORD}店：全データ同期】`);

  const threads = GmailApp.search(CONFIG.SEARCH_QUERY);
  const allEmails = [];

  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const body = msg.getPlainBody();
      const subject = msg.getSubject();
      const lines = body.split(/\r\n|\r|\n/);

      // 【新ロジック】最強店舗判定を使用
      const storeValidation = validateStoreEmail(subject, body, lines, CONFIG.STORE_KEYWORD, CONFIG.INCLUDE_KEYWORD, CONFIG.EXCLUDE_KEYWORDS);

      if (!storeValidation.isValid) continue;

      const data = parseEmail(msg.getSubject(), body, msg.getDate(), msg.getId());
      if (data) allEmails.push(data);
    }
  }

  // 最新のみ抽出
  const grouped = {};
  for (const e of allEmails) {
    if (!grouped[e.key]) grouped[e.key] = [];
    grouped[e.key].push(e);
  }

  const latest = Object.values(grouped).map(arr => {
    arr.sort((a, b) => a.emailDate.getTime() - b.emailDate.getTime());
    return arr[arr.length - 1];
  }).filter(r => r.actionType === 'reservation');

  Logger.log(`送信対象: ${latest.length}件`);

  // バッチ送信
  let success = 0, failed = 0;
  for (let i = 0; i < latest.length; i += 50) {
    const batch = latest.slice(i, i + 50);
    const result = sendToAPI(batch);
    if (result.success) success += result.count;
    else failed += batch.length;
    if (i + 50 < latest.length) Utilities.sleep(1000);
  }

  Logger.log(`完了: 成功${success}件, 失敗${failed}件`);
  return { success: true, total: success, failed };
}

function testExtractStudio() {
  const tests = [
    '設備： 渋谷店 STUDIO ① (1)',
    '設備： 渋谷店 STUDIO ⑦ (1)',
    'STUDIO ③ での予約',
    '不明なルーム'
  ];
  Logger.log('部屋名抽出テスト:');
  tests.forEach(t => Logger.log(`"${t}" → "${extractStudio(t)}"`));
}

/**
 * 【デバッグ専用】メール構造調査（直近5件のメールを解析）
 * 実際にどのようなテキストが来ているかを確認するためのテスト関数
 */
function debugEmailStructure() {
  Logger.log('='.repeat(60));
  Logger.log('【デバッグ】メール構造調査開始');

  try {
    // 過去24時間のメールを取得（ラベル関係なく）
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const query = `${CONFIG.SEARCH_QUERY} after:${Math.floor(oneDayAgo.getTime() / 1000)}`;
    const threads = GmailApp.search(query);

    Logger.log(`調査対象スレッド: ${threads.length}件（直近24時間）`);

    let emailCount = 0;
    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        if (msg.getDate() < oneDayAgo || emailCount >= 5) continue;

        const body = msg.getPlainBody();
        const subject = msg.getSubject();
        const msgId = msg.getId();

        emailCount++;

        Logger.log(`\n=== 【${emailCount}/5】メール詳細調査 [${msgId}] ===`);
        Logger.log(`件名: ${subject}`);
        Logger.log(`日時: ${msg.getDate()}`);
        Logger.log(`送信者: ${msg.getFrom()}`);
        Logger.log(`--- body.length: ${body.length} ---`);

        // 改行コード検出
        Logger.log(`--- 改行コード検出 ---`);
        Logger.log(`\\r\\n数: ${(body.match(/\r\n/g) || []).length}`);
        Logger.log(`\\r数: ${(body.match(/\r/g) || []).length}`);
        Logger.log(`\\n数: ${(body.match(/\n/g) || []).length}`);

        // 最初の500文字を表示（構造把握）
        const first500 = body.substring(0, 500);
        Logger.log(`--- 最初500文字 ---`);
        Logger.log(first500);
        Logger.log(`--- 500文字終了 ---`);

        // 行分割テスト
        const lines = body.split(/\r\n|\r|\n/);
        Logger.log(`--- 行分割結果 ---`);
        Logger.log(`総行数: ${lines.length}`);

        // 最初の10行を表示
        lines.slice(0, 10).forEach((line, i) => {
          Logger.log(`行${i+1}: [${line.trim()}]`);
        });

        // 「店舗」を含む行をすべて表示
        const storeLines = lines.filter((line, i) => {
          const containsStore = line.includes('店舗');
          if (containsStore) {
            Logger.log(`★店舗含有行${i+1}: [${line.trim()}]`);
          }
          return containsStore;
        });
        Logger.log(`「店舗」を含む行: ${storeLines.length}件`);

        // 店舗名を含む行をすべて表示
        const storeNames = ['半蔵門店', '渋谷店', '恵比寿店', '中目黒店', '代々木上原店'];
        storeNames.forEach(storeName => {
          if (body.includes(storeName)) {
            Logger.log(`--- 「${storeName}」検出箇所 ---`);
            lines.forEach((line, i) => {
              if (line.includes(storeName)) {
                Logger.log(`${storeName}含有行${i+1}: [${line.trim()}]`);
              }
            });
          }
        });

        Logger.log(`=== 【${emailCount}】調査終了 ===\n`);

        if (emailCount >= 5) break;
      }
      if (emailCount >= 5) break;
    }

    Logger.log(`調査完了: ${emailCount}件のメールを解析しました`);
  } catch (error) {
    Logger.log(`エラー: ${error.message}`);
  }
}

/**
 * 全ての処理済みラベルを削除（全店舗分）
 * 古い誤ったラベルをリセットする時に使用
 */
function removeAllProcessedLabels() {
  const allLabels = [
    'HALLEL_処理済み_半蔵門',
    'HALLEL_処理済み_渋谷',
    'HALLEL_処理済み_恵比寿',
    'HALLEL_処理済み_中目黒',
    'HALLEL_処理済み_代々木上原'
  ];

  Logger.log('='.repeat(60));
  Logger.log('【ラベル削除開始】全店舗の処理済みラベルを削除します');

  let totalRemoved = 0;
  for (const labelName of allLabels) {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      const threads = label.getThreads();
      Logger.log(`${labelName}: ${threads.length}スレッド`);

      // 全スレッドからラベルを削除
      for (const thread of threads) {
        thread.removeLabel(label);
      }

      totalRemoved += threads.length;
    } else {
      Logger.log(`${labelName}: ラベルなし`);
    }
  }

  Logger.log(`合計 ${totalRemoved}スレッドからラベルを削除しました`);
  Logger.log('【削除完了】最新のコードで processNewReservations を実行してください');
}
