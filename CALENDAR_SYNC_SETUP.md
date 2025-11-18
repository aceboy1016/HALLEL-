# Google Calendar同期設定ガイド

恵比寿店・半蔵門店の予約をGoogle Calendarに同期する設定手順です。

---

## 📋 概要

全5店舗の予約をFlask/Vercel（PostgreSQL）で一元管理し、恵比寿店・半蔵門店のみGoogle Calendarにも同期します。

### システム構成

| 店舗 | PostgreSQL | Google Calendar | 備考 |
|------|-----------|----------------|------|
| 渋谷店 | ✅ | ❌ | Web管理画面のみ |
| 代々木上原店 | ✅ | ❌ | Web管理画面のみ |
| 中目黒店 | ✅ | ❌ | Web管理画面のみ |
| **恵比寿店** | ✅ | ✅ | **両方に同期** |
| **半蔵門店** | ✅ | ✅ | **両方に同期** |

---

## 🚀 セットアップ手順

### ステップ1: Google Cloud Projectの作成

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 新しいプロジェクトを作成（例: `hallel-calendar-sync`）
3. Google Calendar APIを有効化

### ステップ2: サービスアカウントの作成

1. 左メニュー > **IAMと管理** > **サービスアカウント**
2. **サービスアカウントを作成** をクリック
3. 以下の情報を入力：
   - サービスアカウント名: `hallel-calendar-sync`
   - サービスアカウントID: `hallel-calendar-sync@...`
   - 説明: `HALLEL予約システム - Google Calendar同期用`
4. **作成して続行** をクリック
5. ロールは不要（スキップ）
6. **完了** をクリック

### ステップ3: サービスアカウントキーの生成

1. 作成したサービスアカウントをクリック
2. **キー** タブをクリック
3. **鍵を追加** > **新しい鍵を作成**
4. キーのタイプ: **JSON** を選択
5. **作成** をクリック → JSONファイルがダウンロードされます

⚠️ **重要**: このJSONファイルは厳重に保管してください（公開リポジトリにコミットしない）

### ステップ4: カレンダーへの権限付与

#### 恵比寿店カレンダー（ebisu@topform.jp）

1. Google Calendarで恵比寿店カレンダーを開く
2. カレンダー設定 > **特定のユーザーと共有**
3. サービスアカウントのメールアドレスを追加（例: `hallel-calendar-sync@xxx.iam.gserviceaccount.com`）
4. 権限: **予定の変更権限** を選択
5. **送信** をクリック

#### 半蔵門店カレンダー（light@topform.jp）

1. Google Calendarで半蔵門店カレンダーを開く
2. カレンダー設定 > **特定のユーザーと共有**
3. サービスアカウントのメールアドレスを追加
4. 権限: **予定の変更権限** を選択
5. **送信** をクリック

### ステップ5: Vercel環境変数の設定

1. [Vercel Dashboard](https://vercel.com/dashboard) にアクセス
2. HALLELプロジェクトを選択
3. **Settings** > **Environment Variables** をクリック
4. 以下の環境変数を追加：

#### GOOGLE_SERVICE_ACCOUNT_JSON

- **Name**: `GOOGLE_SERVICE_ACCOUNT_JSON`
- **Value**: ダウンロードしたJSONファイルの内容（全体をコピー＆ペースト）
- **Environment**: `Production`, `Preview`, `Development` すべて選択

```json
{
  "type": "service_account",
  "project_id": "hallel-calendar-sync",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "hallel-calendar-sync@xxx.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

#### EBISU_CALENDAR_ID（オプション）

- **Name**: `EBISU_CALENDAR_ID`
- **Value**: `ebisu@topform.jp`
- **Environment**: `Production`, `Preview`, `Development`

※デフォルトで`ebisu@topform.jp`が使用されるため、省略可能

#### HANZOMON_CALENDAR_ID（オプション）

- **Name**: `HANZOMON_CALENDAR_ID`
- **Value**: `light@topform.jp`
- **Environment**: `Production`, `Preview`, `Development`

※デフォルトで`light@topform.jp`が使用されるため、省略可能

### ステップ6: デプロイ

Vercelに環境変数を設定したら、プロジェクトを再デプロイします：

```bash
git push origin main
```

または、Vercel Dashboardから **Deployments** > **Redeploy** をクリック

---

## 🧪 テスト

### テスト1: Calendar API接続確認

Pythonスクリプトを実行して、Calendar APIが正しく動作するか確認します：

```bash
python3 calendar_sync.py
```

期待される出力：

```
=== Google Calendar Sync Test ===

[Test 1] Adding reservation to Ebisu...
✓ Calendar event added: ebisu - 2025-12-01 10:00-11:00 - テスト太郎
Result: {'event_id': '...', 'calendar_id': 'ebisu@topform.jp', 'store': 'ebisu'}

[Test 2] Adding reservation to Hanzomon...
✓ Calendar event added: hanzomon - 2025-12-01 14:00-15:00 - テスト花子
Result: {'event_id': '...', 'calendar_id': 'light@topform.jp', 'store': 'hanzomon'}

[Test 3] Deleting reservation from Ebisu...
✓ Calendar event deleted: ebisu - 2025-12-01 10:00-11:00
Result: True

[Test 4] Adding reservation to Shibuya (should skip)...
Result: None

=== Test Complete ===
```

### テスト2: GASスクリプトのテスト

Google Apps Scriptエディタで以下のテスト関数を実行：

#### 店舗抽出テスト

```javascript
testStoreExtraction()
```

期待される出力：

```
--- 店舗テスト 1 ---
本文: 渋谷店\n予約: 2025-08-05 14:00-15:30
店舗: shibuya

--- 店舗テスト 2 ---
本文: 恵比寿店\n予約: 2025-08-05 14:00-15:30
店舗: ebisu

--- 店舗テスト 3 ---
本文: 半蔵門店\n予約: 2025-08-05 14:00-15:30
店舗: hanzomon
...
```

#### パース機能テスト

```javascript
testParsing()
```

期待される出力：

```
--- テスト 1 ---
本文: 渋谷店\n予約: 2025-08-05 14:00-15:30\nお客様名: 田中太郎
結果: {
  "action_type": "booking",
  "date": "2025-08-05",
  "start_time": "14:00",
  "end_time": "15:30",
  "store": "shibuya"
}
...
```

### テスト3: E2Eテスト（実際のメール送信）

1. **恵比寿店の予約メールを送信**
   - 件名: `恵比寿店 予約`
   - 本文:
   ```
   恵比寿店
   予約: 2025-12-01 10:00-11:00
   お客様名: テスト太郎
   ```

2. **10分後に確認**
   - Web管理画面で予約が表示されるか確認（PostgreSQL）
   - Google Calendarで予約が表示されるか確認

3. **半蔵門店の予約メールを送信**
   - 件名: `半蔵門店 予約`
   - 本文:
   ```
   半蔵門店
   予約: 2025-12-01 14:00-15:00
   お客様名: テスト花子
   ```

4. **10分後に確認**
   - Web管理画面で予約が表示されるか確認（PostgreSQL）
   - Google Calendarで予約が表示されるか確認

---

## 🛠 トラブルシューティング

### エラー: `GOOGLE_SERVICE_ACCOUNT_JSON not set`

**原因**: Vercel環境変数が設定されていない

**解決方法**:
1. Vercel Dashboard > Settings > Environment Variables
2. `GOOGLE_SERVICE_ACCOUNT_JSON`を追加
3. プロジェクトを再デプロイ

### エラー: `Calendar API error: 403 Forbidden`

**原因**: サービスアカウントにカレンダーへのアクセス権限がない

**解決方法**:
1. Google Calendarでカレンダー設定を開く
2. サービスアカウントのメールアドレスに **予定の変更権限** を付与
3. 数分待ってから再試行

### エラー: `Calendar API error: 404 Not Found`

**原因**: カレンダーIDが間違っている

**解決方法**:
1. Vercel環境変数でカレンダーIDを確認
2. `EBISU_CALENDAR_ID`: `ebisu@topform.jp`
3. `HANZOMON_CALENDAR_ID`: `light@topform.jp`

### 予約がGoogle Calendarに反映されない

**原因1**: 恵比寿・半蔵門以外の店舗の予約

**解決方法**: 恵比寿店・半蔵門店のみGoogle Calendarに同期されます。渋谷店・代々木上原店・中目黒店はPostgreSQLのみです。

**原因2**: メール本文に店舗名がない

**解決方法**: メール本文に「恵比寿店」または「半蔵門店」を明記してください。店舗名がない場合は「渋谷店」として処理されます。

---

## 📝 既存GASの停止手順

全店舗統合が完了したら、以下の既存GASスクリプトを停止してください：

### 停止するGASスクリプト

1. **gas-ebisu-calendar-sync.js** （恵比寿店用）
2. **gas-hanzomon-calendar-sync.js** （半蔵門店用）

### 停止手順

1. [Google Apps Script](https://script.google.com/) にアクセス
2. 該当するプロジェクトを開く
3. 左メニュー > **トリガー** をクリック
4. 該当するトリガーの **...** をクリック > **トリガーを削除**
5. 確認ダイアログで **削除** をクリック

⚠️ **重要**: 新しいシステムが正常に動作していることを確認してから停止してください！

---

## 🎯 次のステップ

1. ✅ Google Calendar API認証設定完了
2. ✅ Flask側にCalendar同期機能追加
3. ✅ google-apps-script.js更新（全店舗対応）
4. ⏳ 環境変数設定（Vercel）
5. ⏳ テスト実施
6. ⏳ 既存GASの停止

---

## 📚 参考リンク

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/guides/overview)
- [Service Account Authentication](https://cloud.google.com/iam/docs/service-accounts)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

---

## ❓ サポート

問題が発生した場合は、以下の情報を含めて報告してください：

- エラーメッセージ
- 実行したコマンド
- Vercelのデプロイログ
- Google Calendar APIのレスポンス
