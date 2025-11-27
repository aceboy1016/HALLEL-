# GASで全メール同期する方法

## 🚀 クイックスタート

### 1. GASエディタを開く

https://script.google.com/

### 2. 以下の関数を実行

```javascript
// オプションA: 強制全件処理（推奨）
forceFullSync()

// オプションB: 通常の全件処理
syncGmailReservations()

// オプションC: テスト実行（10件のみ）
testSync()
```

### 実行手順

1. GASエディタで関数を選択
2. 「実行」ボタンをクリック
3. 初回は権限承認が必要
4. ログを確認

---

## 📊 進行状況の確認

```javascript
// 現在の進行状況を確認
checkProgress()
```

**出力例:**
```
📊 現在の進行状況: インデックス 150 から処理予定
```

または

```
📊 進行中のバッチ処理なし
```

---

## 🔄 バッチ処理がスタックした場合

### リセット方法

```javascript
// バッチ処理をリセット
resetBatchProgress()

// その後、再度実行
forceFullSync()
```

---

## 📝 ログの見方

### 成功例

```
📧 Gmail予約同期開始...
🏷️ ラベル作成: HALLEL/Processed
🔍 メール検索中... (0〜)
📧 検索完了: 523件のメールを発見
📦 バッチ処理: 1〜100件目 (100件)
⏳ 処理中... (1/523)
✅ 予約処理: [shibuya] 2024-11-10 14:00-15:30 田中太郎
📈 進行状況: 10/523 (2%)
...
✅ Vercel送信成功: 100件
📅 次のバッチをスケジュール: 100〜
```

### エラー例

```
❌ メール処理エラー: Invalid date format
⏰ 実行時間制限に近づいたため、次のバッチをスケジュール
```

---

## ⚙️ カスタマイズ

### バッチサイズの調整

```javascript
// より小さいバッチで処理（エラーが多い場合）
CONFIG.BATCH_SIZE = 25;  // デフォルト: 50
forceFullSync()

// 元に戻す
CONFIG.BATCH_SIZE = 50;
```

### 検索範囲の変更

```javascript
// 全期間のメールを検索（デフォルト）
CONFIG.SEARCH_QUERY = 'from:noreply@em.hacomono.jp subject:hallel'

// 特定期間のみ
const query = CONFIG.SEARCH_QUERY + ' after:2024/01/01'
```

---

## 🔍 デバッグ

### 特定のメールが処理されているか確認

1. Gmailで対象メールを開く
2. ラベルを確認
   - `HALLEL/Processed` があれば処理済み
   - 無ければ未処理

### メールが検出されない場合

#### チェックリスト

- [ ] 送信元が `noreply@em.hacomono.jp` か？
- [ ] 件名に `hallel` が含まれているか？
- [ ] メール本文に店舗名があるか？
- [ ] 日付・時間の形式が正しいか？

#### メール本文の確認

正しいフォーマット例：
```
田中太郎様

渋谷店のご予約が確定しました。

2024年11月10日
14:00 〜 15:30
```

---

## 📈 処理状況の確認方法

### Gmailのラベルで確認

1. Gmailを開く
2. 左サイドバーで `HALLEL` ラベルを展開
3. 各ラベルのメール数を確認

```
HALLEL/
├── Processed (523)      ← 処理済み総数
├── Booking (450)        ← 予約メール
├── Cancellation (73)    ← キャンセルメール
└── Shibuya (200)        ← 店舗別
```

### Vercelダッシュボードで確認

https://hallelshibuyabooking.vercel.app/admin

- 予約データが反映されているか確認
- 各店舗の予約数を確認

---

## ⚠️ トラブルシューティング

### 1. 「実行時間の上限を超えました」

**原因:** 一度に大量のメールを処理

**対処:**
```javascript
// バッチサイズを小さくする
CONFIG.BATCH_SIZE = 25
forceFullSync()

// 次のバッチは自動的に1分後に実行される
```

### 2. 「権限がありません」

**原因:** Gmail APIの権限が不足

**対処:**
1. GASエディタで「実行」→「認証」
2. Googleアカウントでログイン
3. 「詳細」→「安全でないページに移動」
4. 「許可」をクリック

### 3. メールが検出されない

**原因:** 検索クエリが合致していない

**対処:**
```javascript
// 手動でGmailを検索してテスト
// Gmailの検索バーで実行:
// from:noreply@em.hacomono.jp subject:hallel

// メールが表示されれば、クエリは正しい
```

### 4. ラベルが付かない

**原因:** ラベルが作成されていない

**対処:**
```javascript
// ラベルを再作成
setupLabels()

// その後、再度同期
forceFullSync()
```

### 5. Vercelに送信されない

**原因:** Webhook URLまたは認証エラー

**対処:**
```javascript
// Webhook URLを確認
console.log(CONFIG.WEBHOOK_URL)
// https://hallelshibuyabooking.vercel.app/api/gas/webhook

// 手動でテスト送信
const testReservations = [{
  date: "2024-11-10",
  start: "14:00",
  end: "15:30",
  customer_name: "テスト",
  store: "shibuya",
  type: "gmail",
  is_cancellation: false,
  source: "test"
}];
sendToVercel(testReservations);
```

---

## 📞 さらにサポートが必要な場合

### ログをコピーして確認

1. GASエディタの「実行」タブを開く
2. 実行ログ全体をコピー
3. エラーメッセージを確認

### よくあるエラーと対処

**エラー:** `TypeError: Cannot read property 'match' of null`
- **原因:** メール本文が取得できない
- **対処:** 該当メールをスキップする（自動）

**エラー:** `HTTP 401 Unauthorized`
- **原因:** Webhook認証エラー
- **対処:** `X-GAS-Secret` ヘッダーを確認

**エラー:** `Gmail API rate limit exceeded`
- **原因:** API制限超過
- **対処:** 数分待ってから再実行

---

## ✅ 全件処理完了の確認

### 1. GASログで確認

```
✅ 全バッチ処理完了: 523件の予約を処理
```

### 2. Gmailで確認

全ての対象メールに `HALLEL/Processed` ラベルが付いている

### 3. Vercelで確認

https://hallelshibuyabooking.vercel.app/admin

全ての予約がダッシュボードに表示されている

---

## 🎯 推奨ワークフロー

### 初回全件同期

```javascript
// 1. ラベル作成
setupLabels()

// 2. バッチリセット（念のため）
resetBatchProgress()

// 3. 全件同期開始
forceFullSync()

// 4. 進行状況を定期的に確認
checkProgress()
```

### 定期実行の設定

```javascript
// 1時間ごとに自動実行
setupTrigger()
```

これで新しいメールは自動的に処理されます。

---

**最終更新:** 2024-11-07
