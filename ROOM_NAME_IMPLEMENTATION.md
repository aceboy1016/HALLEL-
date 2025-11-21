# 部屋名（個室A/個室B）実装ドキュメント

## 📋 概要

HALLEL予約システムに部屋名（個室A/個室B）の抽出・表示機能を実装しました。
メールから部屋名を自動抽出し、VercelデータベースとGoogleカレンダーに反映します。

---

## 🏗️ システム設計

### データフロー

```
┌─────────────────────────────────────────────────────────────┐
│  1. メール受信（Hacomono予約システムから）                   │
│     - 件名: 【HALLEL】予約完了のお知らせ                     │
│     - 本文: ルーム：【STUDIO A】 or 【個室A】                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  2. GAS（Google Apps Script）で自動処理                      │
│     - 10分ごとにトリガー実行                                  │
│     - メール本文から部屋名を抽出                              │
│     - 重複チェック（最新状態のみ）                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        ↓                                       ↓
┌──────────────────────┐          ┌──────────────────────┐
│  3a. Googleカレンダー  │          │  3b. Vercel API       │
│  - 直接書き込み        │          │  - Webhook送信        │
│  - OAuth不要          │          │  - API Key認証        │
└──────────────────────┘          └──────────────────────┘
        ↓                                       ↓
┌──────────────────────┐          ┌──────────────────────┐
│  カレンダーイベント    │          │  PostgreSQLデータベース│
│  「顧客名 - HALLEL-個室A」│        │  room_name カラム    │
└──────────────────────┘          └──────────────────────┘
```

---

## 🏪 店舗別実装状況

### ✅ 渋谷店（shibuya）
- **GASアカウント**: （転送メール受信）
- **実装ファイル**: `process-latest-only.js`
- **機能**:
  - ✅ 部屋名抽出（恵比寿・半蔵門の両形式に対応）
  - ✅ Vercelデータベースに送信
  - ✅ 自動トリガー（既存）
- **対応店舗**: 恵比寿、半蔵門、代々木上原、中目黒、渋谷

### ✅ 恵比寿店（ebisu）
- **GASアカウント**: ebisu@topform.jp
- **実装ファイル**: `hallel-ebisu-calendar-latest-only.js`
- **カレンダーID**: ebisu@topform.jp
- **機能**:
  - ✅ 部屋名抽出（STUDIO A/B → 個室A/B）
  - ✅ Googleカレンダー同期（15,000件処理済み）
  - ✅ Vercelデータベース送信
  - ✅ 自動トリガー（10分ごと）
- **部屋名パターン**: `ルーム： 【STUDIO A】` → `個室A`

### ✅ 半蔵門店（hanzomon）
- **GASアカウント**: light@topform.jp
- **実装ファイル**: `hallel-hanzomon-calendar-latest-only.js`
- **カレンダーID**: light@topform.jp
- **機能**:
  - ✅ 部屋名抽出（個室A/B）
  - ✅ Googleカレンダー同期（全件処理済み）
  - ✅ Vercelデータベース送信
  - ✅ 自動トリガー（10分ごと）
- **部屋名パターン**: `ルーム： 【個室A】` → `個室A`

---

## 📁 ファイル構成

### GASスクリプト

```
GAS/
├── 渋谷店（転送メール受信）
│   └── process-latest-only.js          # 全店舗の予約を処理
│
├── 恵比寿店（ebisu@topform.jp）
│   ├── hallel-ebisu-calendar-latest-only.js    # カレンダー＆API送信
│   └── ebisu-trigger-setup.js                   # トリガー設定
│
└── 半蔵門店（light@topform.jp）
    ├── hallel-hanzomon-calendar-latest-only.js  # カレンダー＆API送信
    └── hanzomon-trigger-setup.js                # トリガー設定
```

### Vercel（バックエンド）

```
/
├── app.py                              # Flask API（メイン）
│   ├── /api/gas/webhook                # GASからのWebhook受信
│   ├── /api/reservations               # 予約一覧取得
│   └── /api/sync-ebisu-calendar        # （廃止）カレンダー同期
│
├── calendar_sync.py                    # （廃止）Googleカレンダー同期
├── migrations/
│   └── 002_add_room_name.sql          # room_nameカラム追加
│
└── README/
    ├── CALENDAR_SYNC_README.md        # カレンダー同期の仕組み
    └── ROOM_NAME_IMPLEMENTATION.md    # 本ドキュメント
```

---

## 🔑 主要な実装内容

### 1. 部屋名抽出ロジック

#### 恵比寿店（STUDIO形式）
```javascript
function extractRoomName(body) {
  // 恵比寿店: STUDIO A → 個室A
  if (body.includes('STUDIO A')) {
    return '個室A';
  }
  // 恵比寿店: STUDIO B → 個室B
  if (body.includes('STUDIO B')) {
    return '個室B';
  }

  // デフォルトは個室B
  return '個室B';
}
```

#### 半蔵門店（個室形式）
```javascript
function extractStudio(body) {
  // パターン1: 「ルーム： 【個室A】」
  const roomMatch1 = body.match(/ルーム[：:]\s*【(個室[AB])】/);
  if (roomMatch1) {
    return roomMatch1[1]; // 「個室A」または「個室B」
  }

  return 'Unknown';
}
```

### 2. データベーススキーマ

```sql
-- reservationsテーブルに追加
ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS room_name VARCHAR(50) DEFAULT '個室B';
```

### 3. Vercel API送信（GAS → Vercel）

```javascript
function sendBatchToVercelAPI(reservations) {
  const payload = {
    source: 'gas',
    timestamp: new Date().toISOString(),
    reservations: reservations.map(r => ({
      date: formatDate(r.startTime),
      start: formatTimeOnly(r.startTime),
      end: formatTimeOnly(r.endTime),
      customer_name: r.fullName || 'N/A',
      room_name: r.studio || '個室B',        // ← 部屋名
      store: 'ebisu',  // または 'hanzomon'
      type: 'gmail',
      is_cancellation: false,
      source: 'gas_sync'
    }))
  };

  const response = UrlFetchApp.fetch(
    'https://hallel-shibuya.vercel.app/api/gas/webhook',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-API-Key': 'Wh00k@2025!Secure$Token#ABC123XYZ' },
      payload: JSON.stringify(payload)
    }
  );
}
```

### 4. Googleカレンダーイベント形式

**旧形式:**
```
二宮 遼太朗 - HALLEL
```

**新形式:**
```
二宮 遼太朗 - HALLEL-個室A
```

---

## ⚙️ 自動実行トリガー

### 恵比寿店
```javascript
function setupEbisuTrigger10min() {
  ScriptApp.newTrigger('processNewReservations')
    .timeBased()
    .everyMinutes(10)
    .create();
}
```

### 半蔵門店
```javascript
function setupHanzomonTrigger10min() {
  ScriptApp.newTrigger('processNewReservations')
    .timeBased()
    .everyMinutes(10)
    .create();
}
```

### 動作内容
- **実行間隔**: 10分ごと
- **処理範囲**: 過去1時間の新規メール
- **処理内容**:
  1. Gmailから新規予約メールを取得
  2. 部屋名を抽出
  3. Vercel APIに送信（データベースに保存）
  4. Googleカレンダーに追加

---

## 🧪 テスト・デバッグ機能

### 1. 進捗確認
```javascript
checkProgress()  // 今後30日間の予約を集計
```

**出力例:**
```
📅 今後30日間の予約: 45件

部屋名別の集計:
  個室A: 23件
  個室B: 20件
  Unknown: 2件
```

### 2. トリガー一覧表示
```javascript
listTriggers()
```

**出力例:**
```
📋 現在のトリガー一覧:
================================================================================

1. processNewReservations
   種類: CLOCK
   実行間隔: 定期実行
```

### 3. 過去7日間のテスト実行
```javascript
testLatestSync()  // 過去7日間のみ処理
```

---

## 🚀 デプロイ・実行手順

### 初回セットアップ

#### 恵比寿店（ebisu@topform.jp）
1. Gmailにログイン
2. GASプロジェクトを開く
3. `hallel-ebisu-calendar-latest-only.js` を貼り付け
4. **初回のみ実行:**
   ```javascript
   syncLatestReservationsToCalendar()  // 全メールをカレンダーに反映
   syncLatestReservationsToAPI()       // 全メールをVercelに送信
   ```
5. **トリガー設定:**
   ```javascript
   setupEbisuTrigger10min()
   ```

#### 半蔵門店（light@topform.jp）
1. Gmailにログイン
2. GASプロジェクトを開く
3. `hallel-hanzomon-calendar-latest-only.js` を貼り付け
4. **初回のみ実行:**
   ```javascript
   syncLatestReservationsToCalendar()  // 全メールをカレンダーに反映
   syncLatestReservationsToAPI()       // 全メールをVercelに送信
   ```
5. **トリガー設定:**
   ```javascript
   setupHanzomonTrigger10min()
   ```

### Vercelデプロイ
```bash
# データベースマイグレーション実行（初回のみ）
curl -X POST https://hallel-shibuya.vercel.app/api/admin/run-migration \
  -H "Content-Type: application/json" \
  -H "X-API-Key: Wh00k@2025!Secure$Token#ABC123XYZ" \
  -d '{"migration": "002_add_room_name"}'
```

---

## 📊 処理実績

### 恵比寿店
- **全メール数**: 15,000件
- **カレンダー反映**: 完了
- **Vercel送信**: 完了
- **自動トリガー**: ✅ 稼働中

### 半蔵門店
- **全メール数**: （数千件）
- **カレンダー反映**: 完了
- **Vercel送信**: 完了
- **自動トリガー**: ✅ 稼働中

### 渋谷店
- **既存機能**: 稼働中
- **部屋名対応**: 実装済み（未実行）

---

## 🔧 トラブルシューティング

### エラー: `Identifier 'CONFIG' has already been declared`
**原因**: 複数のスクリプトを1つのGASプロジェクトに入れている
**解決策**: 各店舗で別々のGASプロジェクトを使用する

### カレンダー同期が失敗する
**原因**: Vercelベースのカレンダー同期は廃止されました
**解決策**: GAS直接書き込みを使用（各店舗のスクリプト）

### API送信失敗
**確認項目**:
1. API Key が正しいか
2. Vercelがデプロイされているか
3. データベース接続が正常か

---

## 📝 今後の拡張予定

### 次のタスク

#### 1. フロントエンド実装（高優先度）
- [ ] Next.jsで部屋名を表示
- [ ] 予約一覧ページに「部屋名」カラムを追加
- [ ] フィルター機能（個室A/個室Bで絞り込み）
- [ ] 部屋別の予約状況グラフ

#### 2. 他店舗への展開（中優先度）
- [ ] 代々木上原店の部屋名抽出パターン調査
- [ ] 中目黒店の部屋名抽出パターン調査
- [ ] 各店舗のGAS設定

#### 3. 機能強化（低優先度）
- [ ] APIエラーハンドリング強化
- [ ] ログ機能の充実
- [ ] ダッシュボードでリアルタイム同期状況表示
- [ ] 部屋名の手動修正機能

---

## 📚 関連ドキュメント

- [CALENDAR_SYNC_README.md](./CALENDAR_SYNC_README.md) - Googleカレンダー同期の詳細
- [migrations/002_add_room_name.sql](./migrations/002_add_room_name.sql) - データベーススキーマ変更

---

## 👥 担当者・連絡先

- **開発**: Claude Code
- **リポジトリ**: aceboy1016/HALLEL-
- **ブランチ**: `claude/add-room-name-extraction-01HHvHAF5jAKdG2QgmpctJFp`

---

## 📅 更新履歴

- **2025-11-20**: 初版作成
  - 恵比寿店・半蔵門店の部屋名抽出機能実装
  - Vercelデータベース送信機能実装
  - 自動トリガー設定完了
