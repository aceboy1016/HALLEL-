/**
 * 【特定メールのテスト】北澤 佑衣菜様のメール（Nov 19, 2025, 7:33 AM）をテスト
 */
function testKitazawaEmail() {
  Logger.log('='.repeat(80));
  Logger.log('【特定メールのパーステスト】北澤 佑衣菜様のメール');
  Logger.log('='.repeat(80));

  const testBody = `hallel 予約完了メール

北澤 佑衣菜 様

ご予約ありがとうございます。

以下の内容を承りましたのでご確認ください。

--------------------------------------------------------------------

日時：2025年12月03日(水) 20:30~21:30

店舗： HALLEL 渋谷店

ルーム： 【STUDIO】利用 60分

設備： 渋谷店 STUDIO ⑦ (1)

スタッフ：

プログラム：【STUDIO】利用 60分

--------------------------------------------------------------------`;

  Logger.log('【メール本文】');
  Logger.log(testBody);
  Logger.log('\n' + '='.repeat(80));

  // パース実行
  const bookingInfo = parseEmailBody(testBody);

  if (bookingInfo) {
    Logger.log('✅ パース成功！');
    Logger.log('\n【抽出結果】');
    Logger.log(`アクション: ${bookingInfo.action_type}`);
    Logger.log(`顧客名: ${bookingInfo.customer_name}`);
    Logger.log(`店舗: ${bookingInfo.store}`);
    Logger.log(`日付: ${bookingInfo.date}`);
    Logger.log(`開始時刻: ${bookingInfo.start_time}`);
    Logger.log(`終了時刻: ${bookingInfo.end_time}`);
  } else {
    Logger.log('❌ パース失敗！');
    Logger.log('\nパースできませんでした。正規表現パターンを確認する必要があります。');
  }

  Logger.log('='.repeat(80));
  return bookingInfo;
}

/**
 * 【Gmailから実際のメールを検索】件名と日付で検索
 */
function findKitazawaEmail() {
  Logger.log('='.repeat(80));
  Logger.log('【Gmailから北澤様のメールを検索】');
  Logger.log('='.repeat(80));

  // Nov 19, 2025のメールを検索
  const query = 'from:noreply@em.hacomono.jp subject:"hallel 予約完了メール" after:2025/11/18 before:2025/11/20';
  Logger.log(`検索クエリ: ${query}\n`);

  const threads = GmailApp.search(query);
  Logger.log(`見つかったスレッド数: ${threads.length}件\n`);

  if (threads.length === 0) {
    Logger.log('メールが見つかりません。');
    Logger.log('検索条件を確認してください。');
    Logger.log('='.repeat(80));
    return;
  }

  // 全スレッドを確認
  threads.forEach((thread, threadIndex) => {
    const messages = thread.getMessages();

    Logger.log(`\n【スレッド ${threadIndex + 1}】 メッセージ数: ${messages.length}件`);

    messages.forEach((message, msgIndex) => {
      const subject = message.getSubject();
      const date = message.getDate();
      const body = message.getPlainBody();
      const messageId = message.getId();

      Logger.log(`\n  [メッセージ ${msgIndex + 1}]`);
      Logger.log(`  メールID: ${messageId}`);
      Logger.log(`  件名: ${subject}`);
      Logger.log(`  日時: ${date}`);
      Logger.log(`  未読: ${message.isUnread() ? 'はい' : 'いいえ'}`);

      // ラベルを確認
      const labels = thread.getLabels().map(l => l.getName());
      Logger.log(`  ラベル: ${labels.length > 0 ? labels.join(', ') : 'なし'}`);

      // 本文から顧客名を確認
      const customerNameMatch = body.match(/^(.+?)様/m);
      if (customerNameMatch) {
        Logger.log(`  顧客名: ${customerNameMatch[1].trim()}`);
      }

      // パース実行
      const bookingInfo = parseEmailBody(body);

      if (bookingInfo) {
        Logger.log(`  ✅ パース成功`);
        Logger.log(`     → 店舗: ${bookingInfo.store}, 日付: ${bookingInfo.date}, 開始: ${bookingInfo.start_time}`);
      } else {
        Logger.log(`  ❌ パース失敗`);
      }
    });
  });

  Logger.log('\n' + '='.repeat(80));
}

/**
 * 【このメールをAPIに送信】北澤様のメールを強制的に送信
 * メールID 19a9919cee48b12f を直接処理
 */
function sendKitazawaEmailToAPI() {
  Logger.log('='.repeat(80));
  Logger.log('【北澤様のメールを強制送信】');
  Logger.log('メールID: 19a9919cee48b12f');
  Logger.log('='.repeat(80));

  try {
    // メールIDで直接取得
    const message = GmailApp.getMessageById('19a9919cee48b12f');

    if (!message) {
      Logger.log('❌ メールが見つかりません。');
      Logger.log('='.repeat(80));
      return;
    }

    Logger.log('✅ メールを発見！\n');

    const body = message.getPlainBody();
    const bookingInfo = parseEmailBody(body);

    if (!bookingInfo) {
      Logger.log('❌ パースに失敗しました。');
      Logger.log('='.repeat(80));
      return;
    }

    Logger.log('【パース結果】');
    Logger.log(`顧客名: ${bookingInfo.customer_name}`);
    Logger.log(`店舗: ${bookingInfo.store}`);
    Logger.log(`日付: ${bookingInfo.date}`);
    Logger.log(`時間: ${bookingInfo.start_time} ~ ${bookingInfo.end_time}`);

    // メタデータ追加
    bookingInfo.email_id = message.getId();
    bookingInfo.email_subject = message.getSubject();
    bookingInfo.email_date = message.getDate().toISOString();

    Logger.log('\nVercel APIに送信中...');

    // API送信
    const result = sendToFlaskAPI(bookingInfo);

    if (result.success) {
      Logger.log('\n✅ API送信成功！');
      Logger.log('サイトに反映されました。');
      Logger.log(`\n予約詳細: ${bookingInfo.customer_name}様 / ${bookingInfo.date} ${bookingInfo.start_time}-${bookingInfo.end_time} / ${bookingInfo.store}店`);
    } else {
      Logger.log(`\n❌ API送信失敗: ${result.error}`);
    }

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }

  Logger.log('='.repeat(80));
}

/**
 * 【未読メールのみ送信】北澤様の未読メールをAPIに送信
 * メールID 19a991abce6b4b47
 */
function sendKitazawaUnreadEmail() {
  Logger.log('='.repeat(80));
  Logger.log('【北澤様の未読メールを送信】');
  Logger.log('メールID: 19a991abce6b4b47');
  Logger.log('='.repeat(80));

  try {
    const message = GmailApp.getMessageById('19a991abce6b4b47');

    if (!message) {
      Logger.log('❌ メールが見つかりません。');
      Logger.log('='.repeat(80));
      return;
    }

    Logger.log('✅ メールを発見！\n');

    const body = message.getPlainBody();
    const bookingInfo = parseEmailBody(body);

    if (!bookingInfo) {
      Logger.log('❌ パースに失敗しました。');
      Logger.log('='.repeat(80));
      return;
    }

    Logger.log('【パース結果】');
    Logger.log(`顧客名: ${bookingInfo.customer_name}`);
    Logger.log(`店舗: ${bookingInfo.store}`);
    Logger.log(`日付: ${bookingInfo.date}`);
    Logger.log(`時間: ${bookingInfo.start_time} ~ ${bookingInfo.end_time}`);

    bookingInfo.email_id = message.getId();
    bookingInfo.email_subject = message.getSubject();
    bookingInfo.email_date = message.getDate().toISOString();

    Logger.log('\nVercel APIに送信中...');

    const result = sendToFlaskAPI(bookingInfo);

    if (result.success) {
      Logger.log('\n✅ API送信成功！');
      Logger.log('サイトに反映されました。');
      message.markRead();
      Logger.log('メールを既読にしました。');
    } else {
      Logger.log(`\n❌ API送信失敗: ${result.error}`);
    }

  } catch (error) {
    Logger.log(`❌ エラー: ${error.message}`);
    Logger.log(error.stack);
  }

  Logger.log('='.repeat(80));
}
