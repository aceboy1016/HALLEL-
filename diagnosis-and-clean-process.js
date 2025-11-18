/**
 * 【診断】全メールの実態を調査
 * 本当に何件のHALLEL関連メールがあるのかを確認
 */
function diagnoseAllEmails() {
  Logger.log('='.repeat(60));
  Logger.log('【診断】全メール実態調査');
  Logger.log('='.repeat(60));

  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - 180);
  const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  // まず送信元のみで検索（広く取得）
  const query = `from:noreply@em.hacomono.jp after:${dateStr}`;
  Logger.log(`検索クエリ: ${query}\n`);

  const threads = GmailApp.search(query, 0, 500);
  Logger.log(`検索結果: ${threads.length}件のメール\n`);
  Logger.log('='.repeat(60));

  let hallelCount = 0;
  let otherCount = 0;
  const hallelEmails = [];

  threads.forEach((thread, index) => {
    const message = thread.getMessages()[0];
    const body = message.getPlainBody();
    const subject = message.getSubject();

    // 本文解析を試行（google-apps-script.jsのparseEmailBody関数を使用）
    const bookingInfo = parseEmailBody(body);

    if (bookingInfo) {
      // 店舗がHALLEL関連か確認
      const hallelStores = ['shibuya', 'yoyogi-uehara', 'nakameguro', 'ebisu', 'hanzomon'];
      const isHallel = hallelStores.includes(bookingInfo.store);

      if (isHallel) {
        hallelCount++;
        hallelEmails.push({
          index: index + 1,
          subject: subject,
          date: message.getDate(),
          store: bookingInfo.store,
          customer: bookingInfo.customer_name,
          booking_date: bookingInfo.date,
          time: `${bookingInfo.start_time}-${bookingInfo.end_time}`,
          email_id: message.getId()
        });
      } else {
        otherCount++;
      }
    } else {
      otherCount++;
    }

    if ((index + 1) % 50 === 0) {
      Logger.log(`進捗: ${index + 1}/${threads.length}`);
    }
  });

  Logger.log('\n' + '='.repeat(60));
  Logger.log('【診断結果】');
  Logger.log(`総メール数: ${threads.length}件`);
  Logger.log(`HALLEL関連: ${hallelCount}件 ← これだけ処理すべき`);
  Logger.log(`その他: ${otherCount}件 ← これは処理しない`);
  Logger.log('='.repeat(60));

  Logger.log('\n【HALLEL関連メール一覧】');
  hallelEmails.forEach((email) => {
    Logger.log(`${email.index}. ${email.subject}`);
    Logger.log(`   店舗: ${email.store} / 顧客: ${email.customer}`);
    Logger.log(`   予約: ${email.booking_date} ${email.time}`);
    Logger.log(`   メール受信日: ${email.date}`);
    Logger.log(`   ID: ${email.email_id}`);
    Logger.log('');
  });

  Logger.log('='.repeat(60));
  Logger.log('【次のステップ】');
  Logger.log(`1. HALLEL関連が${hallelCount}件で正しいか確認`);
  Logger.log('2. 確認できたら processOnlyHallelEmails() を実行');
  Logger.log('   → この${hallelCount}件だけが処理され、ラベルが付きます');
  Logger.log('='.repeat(60));

  return { hallelCount, otherCount, hallelEmails };
}

/**
 * 【新処理】HALLEL関連メールのみを確実に処理
 * - API送信が成功したメールのみにラベル付与
 * - 失敗したメールにはラベルを付けない
 */
function processOnlyHallelEmails() {
  Logger.log('='.repeat(60));
  Logger.log('【確実処理】HALLEL関連メールのみを処理');
  Logger.log('API送信成功したメールのみにラベル付与');
  Logger.log('='.repeat(60));

  const BATCH_SIZE = 50;

  try {
    const label = getOrCreateLabel();
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 180);
    const dateStr = Utilities.formatDate(dateLimit, Session.getScriptTimeZone(), 'yyyy/MM/dd');

    const query = `from:noreply@em.hacomono.jp after:${dateStr}`;
    const threads = GmailApp.search(query, 0, 500);

    Logger.log(`検索結果: ${threads.length}件のメール`);
    Logger.log('-'.repeat(60));

    const reservationsBatch = [];
    const threadMap = {}; // index → thread のマッピング
    const messageMap = {}; // index → message のマッピング

    // ステップ1: HALLEL関連メールのみ抽出
    let hallelIndex = 0;
    threads.forEach((thread, index) => {
      const message = thread.getMessages()[0];
      const body = message.getPlainBody();
      const bookingInfo = parseEmailBody(body);

      if (!bookingInfo) {
        return; // parse失敗 → スキップ
      }

      // HALLEL店舗か確認
      const hallelStores = ['shibuya', 'yoyogi-uehara', 'nakameguro', 'ebisu', 'hanzomon'];
      if (!hallelStores.includes(bookingInfo.store)) {
        return; // HALLEL以外 → スキップ
      }

      // メールメタデータを追加
      bookingInfo.email_id = message.getId();
      bookingInfo.email_subject = message.getSubject();
      bookingInfo.email_date = message.getDate().toISOString();

      reservationsBatch.push(bookingInfo);
      threadMap[hallelIndex] = thread;
      messageMap[hallelIndex] = message;
      hallelIndex++;

      Logger.log(`[${hallelIndex}] ${bookingInfo.store} / ${bookingInfo.customer_name} / ${bookingInfo.date} ${bookingInfo.start_time}`);
    });

    Logger.log('\n' + '='.repeat(60));
    Logger.log(`HALLEL関連メール: ${reservationsBatch.length}件`);
    Logger.log('='.repeat(60));

    if (reservationsBatch.length === 0) {
      Logger.log('処理対象のメールがありません。');
      return;
    }

    // ステップ2: バッチ送信
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

      if (i + BATCH_SIZE < reservationsBatch.length) {
        Utilities.sleep(1000);
      }
    }

    // ステップ3: API送信成功したメールのみにラベル付与
    Logger.log('\n' + '='.repeat(60));
    Logger.log('API送信成功したメールにラベル付与中...');

    let labelCount = 0;
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
    Logger.log('\n【処理完了】');
    Logger.log(`HALLEL関連メール: ${reservationsBatch.length}件`);
    Logger.log(`API送信成功: ${apiSuccessCount}件`);
    Logger.log(`APIエラー: ${apiErrorCount}件`);
    Logger.log(`ラベル付与: ${labelCount}件 ← API成功分のみ`);
    Logger.log('='.repeat(60));

    if (apiErrorCount > 0) {
      Logger.log('\n⚠️ API送信失敗があります');
      Logger.log('ログを確認して、エラー原因を調査してください');
    }

    if (apiSuccessCount === reservationsBatch.length) {
      Logger.log('\n✅ 全HALLEL関連メールの処理が完了しました！');
    }

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }
}
