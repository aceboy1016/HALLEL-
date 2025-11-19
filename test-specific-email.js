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
 */
function sendKitazawaEmailToAPI() {
  Logger.log('='.repeat(80));
  Logger.log('【北澤様のメールを強制送信】');
  Logger.log('='.repeat(80));

  // Nov 19, 2025のメールを検索
  const query = 'from:noreply@em.hacomono.jp subject:"hallel 予約完了メール" after:2025/11/18 before:2025/11/20';
  const threads = GmailApp.search(query);

  if (threads.length === 0) {
    Logger.log('メールが見つかりません。');
    Logger.log('='.repeat(80));
    return;
  }

  let found = false;

  threads.forEach(thread => {
    const messages = thread.getMessages();

    messages.forEach(message => {
      const body = message.getPlainBody();
      const bookingInfo = parseEmailBody(body);

      if (bookingInfo && bookingInfo.customer_name.includes('北澤')) {
        Logger.log('✅ 北澤様のメールを発見！\n');
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
          Logger.log('✅ API送信成功！');
          Logger.log('サイトに反映されました。');

          // ラベル追加
          const label = GmailApp.getUserLabelByName('HALLEL/Processed');
          if (label) {
            thread.addLabel(label);
            Logger.log('ラベルを追加しました。');
          }

          message.markRead();
          Logger.log('メールを既読にしました。');
        } else {
          Logger.log(`❌ API送信失敗: ${result.error}`);
        }

        found = true;
      }
    });
  });

  if (!found) {
    Logger.log('北澤様のメールが見つかりませんでした。');
  }

  Logger.log('='.repeat(80));
}
