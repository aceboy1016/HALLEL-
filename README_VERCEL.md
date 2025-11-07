# HALLEL予約システム - Vercel連携版

既存のVercelシステム（https://hallelshibuyabooking.vercel.app/）と連携するGmail同期スクリプトです。

## 📋 システム構成

### 現在運用中のシステム

```
Gmail (hacomono.jp)
  ↓
Google Apps Script (GAS) ← 現在これを使用
  ├─ メール検索・パース
  ├─ ラベル付け
  └─ Webhook送信
      ↓
Vercel (https://hallelshibuyabooking.vercel.app/)
  └─ 5店舗の予約管理
     ├─ 渋谷店
     ├─ 代々木上原店
     ├─ 中目黒店
     ├─ 恵比寿店
     └─ 半蔵門店
```

### Python版（新規追加・オプション）

GASと同じ機能をPythonで実装。サーバー環境で実行可能。

---

## 🏷️ Gmail ラベル構造

### 自動生成されるラベル

```
HALLEL/
├── Processed         # 処理済み
├── Booking           # 予約
├── Cancellation      # キャンセル
├── Shibuya           # 渋谷店
├── YoyogiUehara      # 代々木上原店
├── Nakameguro        # 中目黒店
├── Ebisu             # 恵比寿店
└── Hanzomon          # 半蔵門店
```

### ラベルの付き方

**予約メールの場合:**
- `HALLEL/Processed`
- `HALLEL/Booking`
- `HALLEL/[店舗名]`（例: `HALLEL/Shibuya`）

**キャンセルメールの場合:**
- `HALLEL/Processed`
- `HALLEL/Cancellation`
- `HALLEL/[店舗名]`

---

## 🔧 セットアップ

### 方法1: Google Apps Script（推奨・現在使用中）

#### 1. GASプロジェクトを開く

既存のプロジェクト: https://script.google.com/

#### 2. コードを確認

`google-apps-script-vercel.js` の内容が設定されているか確認

#### 3. トリガー設定

```javascript
// GASエディタで実行
setupTrigger()
```

または、手動でトリガー設定：
- 関数: `scheduledSync`
- イベント: 時間主導型
- 間隔: 1時間ごと

#### 4. 手動実行でテスト

```javascript
// 少数のメールでテスト
testSync()

// 全メール同期
syncGmailReservations()
```

---

### 方法2: Python版（サーバー環境用）

#### 1. 認証情報の取得

Google Cloud Consoleで：
1. Gmail APIを有効化
2. OAuth 2.0認証情報を作成
3. `credentials.json` をダウンロード

#### 2. 初回認証

```bash
python get_gmail_token.py
# ブラウザで認証 → token.json が生成される
```

#### 3. 実行

```bash
# 手動実行
python gmail_sync_vercel.py

# 定期実行（cron）
*/30 * * * * cd /path/to/HALLEL- && python3 gmail_sync_vercel.py >> logs/gmail_sync.log 2>&1
```

---

## 📧 メールフォーマット

### 対象メール

- 送信元: `noreply@em.hacomono.jp`
- 件名: `hallel` を含む

### パース対象のフォーマット

```
[顧客名]様

[店舗名]の予約が確定しました。

2024年11月7日
14:00 〜 15:30
```

### 店舗判定

本文中に以下のキーワードが含まれるかチェック：
- `渋谷` または `shibuya` → shibuya
- `代々木上原` または `yoyogi` → yoyogi-uehara
- `中目黒` または `nakameguro` → nakameguro
- `恵比寿` または `ebisu` → ebisu
- `半蔵門` または `hanzomon` → hanzomon

---

## 🌐 Vercel Webhook

### エンドポイント

```
POST https://hallelshibuyabooking.vercel.app/api/gas/webhook
```

### ヘッダー

```json
{
  "Content-Type": "application/json",
  "X-GAS-Secret": "hallel_gas_2024"
}
```

### ペイロード形式

```json
{
  "source": "gas",  // or "python"
  "timestamp": "2024-11-07T14:00:00.000Z",
  "reservations": [
    {
      "date": "2024-11-07",
      "start": "14:00",
      "end": "15:30",
      "customer_name": "田中太郎",
      "store": "shibuya",
      "type": "gmail",
      "is_cancellation": false,
      "source": "gas_sync",
      "email_id": "abc123...",
      "email_subject": "予約確定のお知らせ",
      "email_date": "2024-11-07T13:00:00.000Z"
    }
  ]
}
```

---

## 🔄 バッチ処理

GAS版では実行時間制限（6分）を回避するため、バッチ処理を実装：

### 仕組み

1. 50件ずつメールを処理
2. 5分経過したら次のバッチをスケジュール
3. PropertiesServiceで進行状況を保存
4. 1分後に自動的に続きを処理

### 手動制御

```javascript
// 進行状況確認
checkProgress()

// バッチリセット（途中で止まった場合）
resetBatchProgress()

// 強制全件処理
forceFullSync()
```

---

## 🧪 テスト

### GAS版

```javascript
// 10件のみ処理するテスト
testSync()
```

### Python版

```bash
# メールパースのテスト
python test_email_parsing.py

# 統合テスト（要Flask起動）
python test_integration.py
```

---

## 📊 ログとモニタリング

### GAS版

GASエディタの「実行」タブでログを確認:
- ✅ 成功: 緑色
- ❌ エラー: 赤色

### Python版

```bash
# ログファイル確認
tail -f logs/gmail_sync.log

# アクティビティログ確認（Flask）
tail -f activity.log
```

---

## ⚠️ トラブルシューティング

### GASの実行時間制限エラー

**症状:** 「実行時間の上限を超えました」

**対処:**
```javascript
// バッチサイズを小さくする
CONFIG.BATCH_SIZE = 25  // デフォルト: 50
```

### ラベルが付かない

**原因:** ラベルが作成されていない

**対処:**
```javascript
setupLabels()  // ラベルを再作成
```

### Webhook送信失敗

**症状:** HTTP 401 Unauthorized

**対処:**
- `X-GAS-Secret` ヘッダーを確認
- Vercel側のAPI設定を確認

### メールが検出されない

**原因:** 検索クエリが合致していない

**対処:**
```javascript
// 検索クエリを確認
console.log(CONFIG.SEARCH_QUERY)

// 手動でGmailを検索して確認
// from:noreply@em.hacomono.jp subject:hallel
```

---

## 🔐 セキュリティ

### GAS版

- スクリプトは自分のGoogleアカウントで実行
- Webhook URLとシークレットは環境変数化を推奨

### Python版

- `credentials.json` と `token.json` を `.gitignore` に追加済み
- サーバー上では適切なアクセス権限を設定

---

## 📈 今後の改善案

1. **エラー通知**
   - Slack/Discord通知
   - 管理者へのメール通知

2. **重複チェック**
   - 同じメールを複数回処理しないように

3. **統計情報**
   - 処理件数の記録
   - 店舗別の予約数グラフ

4. **バックアップ**
   - 処理済みメールのアーカイブ
   - データベースバックアップ

---

## 📚 関連ファイル

- `google-apps-script-vercel.js` - GAS版（現在使用中）
- `gmail_sync_vercel.py` - Python版（オプション）
- `get_gmail_token.py` - Python認証用
- `test_email_parsing.py` - パーステスト
- `test_integration.py` - 統合テスト

---

## 🆘 サポート

問題が発生した場合：

1. ログを確認
2. このREADMEのトラブルシューティングを確認
3. GASエディタの実行履歴を確認
4. Vercel側のログを確認

---

**HALLEL予約システム - Vercel連携版**
最終更新: 2024-11-07
