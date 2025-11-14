# HALLEL 代々木上原店・中目黒店 セットアップガイド

## 概要
代々木上原店と中目黒店の予約システムをGoogle Apps ScriptとVercel PostgreSQLで構築します。

---

## 店舗情報

| 店舗 | 最大枠数 | 備考 |
|------|---------|------|
| 代々木上原店 | 2枠 | 区別なし |
| 中目黒店 | 1枠 | フリーウエイトエリア（奥）のみ<br>※格闘技エリア（手前側）は除外 |

---

## システム構成

```
┌─────────────────────────────────────┐
│  Gmail (noreply@em.hacomono.jp)    │
│  予約完了/キャンセルメール          │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    v                     v
┌──────────────┐   ┌──────────────┐
│代々木上原 GAS│   │中目黒 GAS    │
│(メール処理)  │   │(メール処理)  │
└──────┬───────┘   └──────┬───────┘
       │                   │
       └────────┬──────────┘
                v
┌────────────────────────────────────┐
│  Vercel (app.py)                   │
│  https://hallel.vercel.app │
└──────────────┬─────────────────────┘
               v
        [PostgreSQL]
```

---

## セットアップ手順

### 1. Google Apps Script 設定

#### 代々木上原店

1. **新しいGASプロジェクト作成**
   - https://script.google.com/ にアクセス
   - 「新しいプロジェクト」をクリック
   - プロジェクト名: `HALLEL-YoyogiUehara-Sync`

2. **コードをコピー**
   - `gas-yoyogiuehara-sync.js` の内容を全てコピー
   - GASエディタに貼り付け

3. **Advanced Gmail Service を有効化**
   - 左側メニュー「サービス」（＋マーク）をクリック
   - 「Gmail API」を検索して追加
   - バージョン: `v1`

4. **初回テスト実行**
   - 関数選択: `testSync`
   - 実行ボタン（▶️）をクリック
   - 権限リクエストが表示されたら許可

5. **定期トリガー設定**
   - 関数選択: `setupFrequentTrigger`
   - 実行ボタン（▶️）をクリック
   - → 5分ごとに自動実行されるようになります

#### 中目黒店

1. **新しいGASプロジェクト作成**
   - https://script.google.com/ にアクセス
   - 「新しいプロジェクト」をクリック
   - プロジェクト名: `HALLEL-Nakameguro-Sync`

2. **コードをコピー**
   - `gas-nakameguro-sync.js` の内容を全てコピー
   - GASエディタに貼り付け

3. **Advanced Gmail Service を有効化**
   - 左側メニュー「サービス」（＋マーク）をクリック
   - 「Gmail API」を検索して追加
   - バージョン: `v1`

4. **初回テスト実行**
   - 関数選択: `testSync`
   - 実行ボタン（▶️）をクリック
   - 権限リクエストが表示されたら許可

5. **定期トリガー設定**
   - 関数選択: `setupFrequentTrigger`
   - 実行ボタン（▶️）をクリック
   - → 5分ごとに自動実行されるようになります

---

### 2. Vercel デプロイ

#### app.py は既に対応済み ✅

`app.py` には以下が既に実装されています：

1. **複数店舗対応**
   ```python
   STORE_CONFIG = {
       'shibuya': {'name_jp': '渋谷店', 'max_slots': 7},
       'yoyogi-uehara': {'name_jp': '代々木上原店', 'max_slots': 2},
       'nakameguro': {'name_jp': '中目黒店', 'max_slots': 1},
       ...
   }
   ```

2. **Webhook エンドポイント**
   - URL: `https://hallel.vercel.app/api/gas/webhook`
   - GASからのデータを自動受信
   - 店舗別にデータベースに保存

3. **空き状況API**
   - URL: `https://hallel.vercel.app/api/availability`
   - パラメータ: `date`, `start_time`, `end_time`, `store`

#### デプロイ手順

```bash
cd HALLEL-
git add .
git commit -m "代々木上原・中目黒店追加: GAS + 空き状況API実装"
git push origin main
```

Vercelが自動デプロイします（設定済みの場合）。

---

## 動作確認

### 1. GASのログ確認

#### 代々木上原店
```javascript
// GASエディタで実行
testSync()
```

**期待される出力:**
```
🧪 代々木上原店 テスト実行開始...
📧 テスト対象: 5件のスレッド
✅ テスト: 2025-12-01 10:00-12:00 山田太郎
📊 テスト結果: 3件の予約を検出
```

#### 中目黒店
```javascript
// GASエディタで実行
testSync()
```

**期待される出力:**
```
🧪 中目黒店 テスト実行開始（フリーウエイトエリアのみ）...
📧 テスト対象: 10件のスレッド
✅ フリーウエイトエリアを検出: フリーウエイトエリア（奥）
⏭️ テスト・スキップ: 格闘技エリア
📊 テスト結果: 5件の予約、2件スキップ
```

### 2. Webhook確認

GASでメール処理を実行すると、VercelにWebhookが送信されます。

**確認方法:**
1. GASエディタでログを確認
   - 「✅ Vercel送信成功」が表示されればOK

2. Vercel管理画面でログを確認
   - https://vercel.com/your-project/logs
   - `[DEBUG] Received X reservations` が表示されればOK

### 3. 空き状況API確認

ブラウザまたはcURLでテスト:

```bash
# 代々木上原店の空き状況
curl "https://hallel.vercel.app/api/availability?date=2025-12-01&start_time=10:00&end_time=12:00&store=yoyogi-uehara"

# 中目黒店の空き状況
curl "https://hallel.vercel.app/api/availability?date=2025-12-01&start_time=10:00&end_time=12:00&store=nakameguro"
```

**期待されるレスポンス:**
```json
{
  "store": "yoyogi-uehara",
  "store_name": "代々木上原店",
  "date": "2025-12-01",
  "start_time": "10:00",
  "end_time": "12:00",
  "available": true,
  "total_slots": 2,
  "occupied_slots": 1,
  "remaining_slots": 1
}
```

---

## トラブルシューティング

### GASエラー: "Gmail API has not been used"

**解決策:**
1. GASエディタの左側メニュー「サービス」をクリック
2. 「Gmail API」を追加
3. もう一度実行

### Webhook送信失敗: "404 Not Found"

**原因:** Vercel URLが間違っている

**解決策:**
1. `gas-yoyogiuehara-sync.js` の `WEBHOOK_URL` を確認
2. 正しいURL: `https://hallel.vercel.app/api/gas/webhook`

### 中目黒で格闘技エリアが処理される

**原因:** フィルタが正しく動作していない

**解決策:**
1. メール本文に「フリーウエイトエリア（奥）」が含まれているか確認
2. GASログで「⏭️ スキップ（格闘技エリア）」が表示されているか確認

---

## 管理関数

### トリガーを全て削除したい

```javascript
// GASエディタで実行
deleteAllTriggers()
```

### 過去のメールを全て再処理したい

```javascript
// 代々木上原
manualFullSync()

// 中目黒
manualFullSync()
```

**注意:** 大量のメールがある場合、実行時間制限により複数回実行が必要になる場合があります。

---

## データベーステーブル構造

```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    customer_name VARCHAR(255),
    store VARCHAR(50) NOT NULL,  -- 'yoyogi-uehara' または 'nakameguro'
    type VARCHAR(20) DEFAULT 'gmail',
    source VARCHAR(50),
    email_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reservations_store_date ON reservations(store, date);
CREATE INDEX idx_reservations_email_id ON reservations(email_id);
```

---

## Gmail ラベル構造

### 代々木上原店
```
HALLEL_YoyogiUehara/
├── Processed      (処理済み)
├── Booking        (予約)
├── Cancellation   (キャンセル)
└── Error          (エラー)
```

### 中目黒店
```
HALLEL_Nakameguro/
├── Processed            (処理済み)
├── Booking              (予約)
├── Cancellation         (キャンセル)
├── FreeWeight           (フリーウエイトエリア)
├── MartialArts_Skip     (格闘技エリア・スキップ)
└── Error                (エラー)
```

---

## 次のステップ

1. **恵比寿店・半蔵門店の統合**
   - 現在GASで独立運用している恵比寿・半蔵門もVercel PostgreSQLに統合可能
   - 統合すれば全店舗を1つのデータベースで管理

2. **統合予約検索システムの実装**
   - `INTEGRATED_AVAILABILITY_SEARCH.md` を参照
   - 全店舗の空き状況を横断検索するフロントエンド

3. **管理画面の拡張**
   - 店舗選択機能
   - 店舗別予約一覧表示

---

## 参考資料

- **渋谷店セットアップ:** 既存のREADME参照
- **恵比寿店GAS:** `gas-ebisu-calendar-sync.js`
- **半蔵門店GAS:** `gas-hanzomon-calendar-sync.js`
- **統合検索システム:** `INTEGRATED_AVAILABILITY_SEARCH.md`

---

**最終更新:** 2025-11-14
**ステータス:** 実装完了・テスト待ち
